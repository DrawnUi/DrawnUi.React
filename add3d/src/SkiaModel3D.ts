// A glTF 2.0 scene (.glb) drawn in real 3D inside a DrawnUI screen. Port of DrawnUi.Add3d SkiaModel3D (.NET) and
// drawnui-add3d (Rust): same names, same rules.
import { ActionOnTickAnimator, SkiaControl, SkiaScroll, Super, type DrawingContext, type GestureEventProcessingInfo, type SkiaGesturesParameters } from "drawnui-react/core";
import { Euler, type Mat4, type Quat, type Vec3 } from "./math";
import { Player3D } from "./player";
import { Renderer3D, RenderTarget, type RenderItem } from "./renderer";
import { LOCAL, Scene3D, type MaterialOverride } from "./scene";
import { Look, LoadState3D, type ModelHit, type PointOnScreen, type Texture3D } from "./types";
import type { Model3D } from "./shapes";
import { Prefetch3D, type IPrefetch3D } from "./prefetch";
import { ColorLinear, ColorSrgb } from "./colors";

/** A node's own transform set from code: it replaces what the file and the animations give that part. */
interface NodeOverride { T?: Vec3; R?: Quat; S?: Vec3; Hidden?: boolean }

/**
 * A glTF 2.0 scene (.glb) drawn in real 3D: depth buffer, a light, base colors and color textures, skeleton animations.
 * Drawn with CanvasKit's own WebGL2 context into a texture the control then shows, so layout, gestures and everything
 * drawn around it work as for any control. Drag to turn it. Give it no image cache on it or above it while it moves.
 */
export class SkiaModel3D extends SkiaControl implements IPrefetch3D {
  private scene?: Scene3D;
  private player = new Player3D();
  private readonly target = new RenderTarget();
  private nodes: NodeOverride[] = [];
  private materials: (MaterialOverride | undefined)[] = [];
  private locals = new Float32Array(0);
  private pose = new Float32Array(0);
  private ownHidden: boolean[] = [];
  private hidden: boolean[] = [];
  private hiddenDirty = true;
  private source?: string;
  private loadVersion = 0;
  private tilt = 0;
  private tiltX = 0;
  private tiltY = 0;
  private tiltOn = false;
  private shownYaw = NaN;
  private shownPitch = 0;
  private shownZoom = 0;
  private readonly items: RenderItem[] = [];
  private loop?: ActionOnTickAnimator;
  private lastNanos = 0;
  private drawn = false;
  private animation?: string;
  private yaw = 20;
  private pitch = 10;
  private autoRotate = 0;
  private zoom = 1;
  private outlineWidth = 0;
  private homeYaw = 20;
  private homePitch = 10;
  private homeZoom = 1;
  /** The glide back to the home view, 0 to 1 (1 = none running), and where it started. */
  private reset = 1;
  private fromYaw = 0;
  private fromPitch = 0;
  private fromZoom = 1;
  private minZoom = 0.5;
  private maxZoom = 2.5;
  /** This gesture's drag: 0 not decided yet, 1 turns the model, 2 left to the parent. */
  private panAxis = 0;
  /** The pinch so far as one factor (0 = no pinch going on), and the zoom it started from. */
  private pinch = 0;
  private pinchFrom = 1;
  private multiTouch = false;
  private lastTapMs = 0;
  /** Drawn since the last frame tick: a model that was not (off screen) stops asking for frames. */
  private painted = false;
  /** Something changed since the last 3D render (every change calls Update); false = its image can be shown again. */
  private stale = true;
  private look = Look.Lit;
  private antialias = false;
  private outlineColor = "#000000";
  private camera = new Float32Array(16);
  private gpuReady = false;
  private queued = false;

  /** Drags turn the scene (on by default). */
  Orbit = true;
  /** Two fingers pinching and Ctrl (Cmd) + mouse wheel zoom the view, between MinZoom and MaxZoom (off by default). A plain wheel over the model still scrolls the page. */
  PinchZoom = false;
  /** Two taps in a row glide the view back home (ResetView); off by default. */
  ResetOnDoubleTap = false;
  /**
   * Drags turn the model only around its vertical axis, and a drag that starts vertical is left to the parent, also
   * outside a scroll (off by default). Inside a vertical SkiaScroll a drag that starts vertical always scrolls; without
   * LockPitch a sideways one turns and tilts the model.
   */
  LockPitch = false;
  /** The file could not be read, or loading Source failed: why (undefined when it was read). */
  Error?: string;
  /** Where loading Source stands; Ready for a model given as bytes or made in code. */
  LoadState: LoadState3D = LoadState3D.Ready;

  /** Loading Source started (Loading), ended (Ready), or failed (Failed, the reason in Error). */
  LoadStateChanged?: (sender: SkiaModel3D, state: LoadState3D) => void;
  /** An animation played with PlayOnce or Hold ended: its name. */
  AnimationEnded?: (sender: SkiaModel3D, name: string) => void;
  /**
   * The view moved (turn, tilt or zoom), at most once per frame, raised as the model draws: the place to move labels kept
   * on its points (ScreenPosition).
   */
  ViewChanged?: (sender: SkiaModel3D) => void;
  /** A tap landed on the scene's surface (not on empty space around it): the node, the material and the point it hit. */
  Tapped3D?: (sender: SkiaModel3D, hit: ModelHit) => void;

  /** A scene from the bytes of a .glb, a model made in code (Model3D), or nothing yet (Source names the file). */
  constructor(model?: Uint8Array | ArrayBuffer | Model3D) {
    super();
    if (model !== undefined) this.SetModel(model);
  }

  private SetModel(model: Uint8Array | ArrayBuffer | Model3D | undefined): void {
    if (model === undefined) { this.Attach(undefined); return; }
    let scene: Scene3D | undefined, error: string | undefined;
    if (model instanceof Uint8Array || model instanceof ArrayBuffer) ({ Scene: scene, Error: error } = Scene3D.Shared(model));
    else scene = model.ToScene();
    this.Error = error;
    if (error) console.warn(`[SkiaModel3D] ${error}`);
    this.Attach(scene);
    this.Changed();
  }

  /** The bytes of a .glb to show (or a .gltf with its buffers embedded). Controls showing the same array share one copy, read once. */
  set Glb(bytes: Uint8Array | ArrayBuffer | undefined) { this.SetModel(bytes); }
  /** A model made in code (Model3D) to show. */
  set Model(model: Model3D | undefined) { this.SetModel(model); }

  /** Shows a scene: its own pose, node and material slots; the playing state and speed carry over. */
  private Attach(scene: Scene3D | undefined): void {
    const old = this.player;
    this.scene = scene;
    this.player = new Player3D(scene);
    this.player.Playing = old.Playing; this.player.Speed = old.Speed; this.player.Fade = old.Fade;
    const n = scene?.Nodes.length ?? 0;
    this.nodes = Array.from({ length: n }, () => ({}));
    this.locals = new Float32Array(n * LOCAL);
    this.pose = new Float32Array(n * 16);
    this.ownHidden = new Array(n).fill(false);
    this.hidden = new Array(n).fill(false);
    this.hiddenDirty = true;
    this.materials = new Array(scene?.Materials.length ?? 0).fill(undefined);
    const a = scene?.AnimationNamed(this.animation) ?? -1;
    if (a >= 0) { this.player.Play(a); this.player.FadeNow(); }
    this.gpuReady = false;
  }

  // ---- properties ----

  /**
   * The .glb to show, loaded in the background: a file shipped with the app (a path, as for images) or an http(s) address.
   * LoadState and LoadStateChanged follow it; the app draws its own placeholder and error from them (the reason is in
   * Error). Node and material changes made before the model is ready do not carry over: make them on Ready.
   */
  get Source(): string | undefined { return this.source; }
  set Source(value: string | undefined) {
    this.source = value;
    void this.Load(value, ++this.loadVersion);
  }

  private SetLoadState(state: LoadState3D): void {
    if (this.LoadState === state) return;
    this.LoadState = state;
    this.LoadStateChanged?.(this, state);
  }

  private async Load(source: string | undefined, version: number): Promise<void> {
    if (!source) { this.Attach(undefined); this.SetLoadState(LoadState3D.Ready); this.Changed(); return; }
    this.SetLoadState(LoadState3D.Loading);
    let scene: Scene3D | undefined, problem: string | undefined;
    try {
      const response = await fetch(Super.ResolveAssetUrl(source));
      if (!response.ok) problem = `the server answered ${response.status}${response.statusText ? ` ${response.statusText}` : ""}`;
      else ({ Scene: scene, Error: problem } = Scene3D.Shared(await response.arrayBuffer()));
    } catch (e) {
      problem = e instanceof TypeError ? "there was no answer from the server" : e instanceof Error ? e.message : String(e);
    }
    if (version !== this.loadVersion || this.IsDisposed) return;
    if (!scene) {
      this.Error = problem ?? "the file could not be read";
      console.warn(`[SkiaModel3D] ${source}: ${this.Error}`);
      this.Attach(undefined);
      this.SetLoadState(LoadState3D.Failed);
    } else {
      this.Error = undefined;
      this.Attach(scene);
      this.SetLoadState(LoadState3D.Ready);
    }
    this.Changed();
  }

  /**
   * Leans the model toward the mouse over it or the finger on it, up to this many degrees at the control's edge (0 = off,
   * the default); it glides home when the pointer leaves or the finger lifts. On, drags do not turn it.
   */
  get TiltToPointer(): number { return this.tilt; }
  set TiltToPointer(value: number) {
    this.tilt = Math.max(0, value);
    this.ReceivesHover = this.tilt > 0;
    if (this.tilt === 0) this.tiltOn = false;
    this.Changed();
  }

  /** The names of the scene's animations, in file order. */
  get Animations(): string[] { return this.scene?.Animations.map((a) => a.Name) ?? []; }
  /** The names of the scene's nodes (objects, bones, cameras), in file order. */
  get NodeNames(): string[] { return this.scene?.Nodes.map((n) => n.Name) ?? []; }
  /** The names of the scene's materials (its parts by look), in file order. */
  get MaterialNames(): string[] { return this.scene?.Materials.map((m) => m.Name) ?? []; }
  /** The main animation playing, by name (undefined when none). */
  get CurrentAnimation(): string | undefined {
    const a = this.player.Main.Animation;
    return this.scene && a >= 0 && a < this.scene.Animations.length ? this.scene.Animations[a].Name : undefined;
  }

  /** The animation it loops from the start, by name; the first one when not set. Set later, it plays it, blending into it. */
  get Animation(): string | undefined { return this.animation; }
  set Animation(value: string | undefined) {
    this.animation = value;
    const i = this.scene?.AnimationNamed(value) ?? -1;
    if (i < 0) return;
    const playing = this.player.Playing;
    this.player.Play(i);
    if (!this.drawn) { this.player.FadeNow(); this.player.Playing = playing; } // the start pose: no fade
    this.Changed();
  }

  /** Plays the animations (on by default); off stops them where they are. */
  get IsPlaying(): boolean { return this.player.Playing; }
  set IsPlaying(value: boolean) { this.player.Playing = value; this.Changed(); }

  /** Animation speed, 1 = as authored. */
  get Speed(): number { return this.player.Speed; }
  set Speed(value: number) { this.player.Speed = value; }

  /** How long one animation blends into the next, milliseconds (250 by default, 0 = cut). */
  get CrossfadeMs(): number { return this.player.Fade * 1000; }
  set CrossfadeMs(value: number) { this.player.Fade = Math.max(0, value) / 1000; }

  /** Turns the scene by itself, degrees per second (0 = still). */
  get AutoRotate(): number { return this.autoRotate; }
  set AutoRotate(value: number) { this.autoRotate = value; this.Changed(); }

  /** The view's turn around the vertical axis, degrees (20 by default). */
  get Yaw(): number { return this.yaw; }
  set Yaw(value: number) { this.yaw = this.homeYaw = value; this.Update(); }

  /** The view's tilt, degrees (10 by default). */
  get Pitch(): number { return this.pitch; }
  set Pitch(value: number) { this.pitch = this.homePitch = value; this.Update(); }

  /** Distance as a factor of the one that fits the scene (1 = fits, below 1: closer). */
  get Zoom(): number { return this.zoom; }
  set Zoom(value: number) { this.zoom = this.homeZoom = Math.max(0.05, value); this.Update(); }

  /** The nearest a pinch or the wheel brings the view, as a Zoom factor (0.5 by default). */
  get MinZoom(): number { return this.minZoom; }
  set MinZoom(value: number) { this.minZoom = Math.max(0.05, value); }
  /** The farthest a pinch or the wheel takes the view, as a Zoom factor (2.5 by default). */
  get MaxZoom(): number { return this.maxZoom; }
  set MaxZoom(value: number) { this.maxZoom = Math.max(0.05, value); }

  /** How it is drawn: Lit (default), Toon or Flat. */
  get Look(): Look { return this.look; }
  set Look(value: Look) { this.look = value; this.Update(); }

  /**
   * Smooth 3D edges (4x multisampling, or the most the GPU offers), off by default. On, the control's GPU frame takes about
   * four times the memory; off, nothing extra is allocated. Can be switched at any time.
   */
  get Antialias(): boolean { return this.antialias; }
  set Antialias(value: boolean) { if (this.antialias === value) return; this.antialias = value; this.Update(); }

  /** An outline around every shape, in points, like an illustration's stroke (0 = none). */
  get OutlineWidth(): number { return this.outlineWidth; }
  set OutlineWidth(value: number) { this.outlineWidth = Math.max(0, value); this.Update(); }

  /** The outline's color (black by default). */
  get OutlineColor(): string { return this.outlineColor; }
  set OutlineColor(value: string | undefined) { this.outlineColor = value ?? "#000000"; this.Update(); }

  /** Whether the control asks for frames now (it moves). */
  get IsAnimating(): boolean { return this.WantsFrames; }

  // ---- methods ----

  /** Loops the animation with this name, blending into it; false when the scene has none such. */
  Play(name: string): boolean { return this.WithAnimation(name, 0); }
  /**
   * Plays the animation with this name once, then blends back into the looping one that played before it (an attack,
   * then idle again); AnimationEnded hears its end. With nothing looping before, it holds its last frame. False when none such.
   */
  PlayOnce(name: string): boolean { return this.WithAnimation(name, 1); }
  /** Plays the animation once and stays on its last frame; nothing goes back. False when there is none such. */
  Hold(name: string): boolean { return this.WithAnimation(name, 2); }
  /** Loops another animation together with the main one (another object of the scene). False when none such. */
  PlayLayer(name: string): boolean { return this.WithAnimation(name, 3); }
  /** Stops an animation started with PlayLayer. */
  StopLayer(name: string): void { this.WithAnimation(name, 4); }

  /** Glides the view (turn, tilt, zoom) back to the one the app set last through Yaw, Pitch and Zoom, in 300 ms. */
  ResetView(): void {
    this.fromYaw = this.yaw; this.fromPitch = this.pitch; this.fromZoom = this.zoom;
    this.reset = 0;
    this.Changed();
  }

  /**
   * Where a point of the scene (scene units, the space of ModelHit.Point) shows in this control now: points from its top
   * left, and Occluded when the model's own surface hides it. Undefined with no scene, before the control has a size, or
   * for a point behind the eye. Call it each frame to keep a label on a point of a turning model.
   */
  ScreenPosition(point: Vec3): PointOnScreen | undefined {
    const scene = this.scene;
    if (!scene) return undefined;
    const { W: w, H: h } = this.SizeInPoints();
    if (w <= 0 || h <= 0) return undefined;
    const camera = this.Camera(w, h);
    const m = camera;
    const cx = m[0] * point[0] + m[4] * point[1] + m[8] * point[2] + m[12], cy = m[1] * point[0] + m[5] * point[1] + m[9] * point[2] + m[13];
    const cw = m[3] * point[0] + m[7] * point[1] + m[11] * point[2] + m[15];
    if (cw <= 1e-6) return undefined;
    const fx = (cx / cw + 1) * 0.5, fy = (1 - cy / cw) * 0.5;
    this.ComputePose();
    const { From: from, Dir: dir } = Scene3D.Ray(camera, fx, fy);
    // a point on the surface must not hide behind itself: half a percent of the model's size
    const lo = scene.BoundsMin, hi = scene.BoundsMax;
    const near = Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) * 0.005;
    const distance = Math.hypot(point[0] - from[0], point[1] - from[1], point[2] - from[2]);
    const occluded = scene.RayBlocked(this.pose, this.hidden, this.materials, from, dir, distance - near);
    return { X: fx * w, Y: fy * h, Occluded: occluded };
  }

  /** Shows or hides a node by name, with what hangs under it. False when there is none such. */
  SetNodeVisible(name: string, visible: boolean): boolean {
    const i = this.NodeIndex(name);
    if (i < 0) return false;
    this.nodes[i].Hidden = !visible; this.hiddenDirty = true; this.Update();
    return true;
  }
  /** Moves a node by name: its own position, in its parent's units. It replaces what the file and the animations give it. */
  SetNodeTranslation(name: string, x: number, y: number, z: number): boolean {
    const i = this.NodeIndex(name);
    if (i < 0) return false;
    this.nodes[i].T = [x, y, z]; this.Update();
    return true;
  }
  /** Turns a node by name: rotations around x, y, z in degrees (applied in that order). */
  SetNodeRotation(name: string, x: number, y: number, z: number): boolean {
    const i = this.NodeIndex(name);
    if (i < 0) return false;
    this.nodes[i].R = Euler(x, y, z); this.Update();
    return true;
  }
  /** Scales a node by name. */
  SetNodeScale(name: string, x: number, y: number, z: number): boolean {
    const i = this.NodeIndex(name);
    if (i < 0) return false;
    this.nodes[i].S = [x, y, z]; this.Update();
    return true;
  }
  /** Gives a node back what the file and the animations say: position, turn, scale, shown. */
  ResetNode(name: string): boolean {
    const i = this.NodeIndex(name);
    if (i < 0) return false;
    this.nodes[i] = {}; this.hiddenDirty = true; this.Update();
    return true;
  }

  private Material(name: string): number { return this.scene?.MaterialNamed(name) ?? -1; }
  private Override(i: number): MaterialOverride { return this.materials[i] ??= {}; }

  /** Recolors a material by name (a part of the model: skin, armor); undefined = the file's color. A texture is tinted by it. */
  SetMaterialColor(name: string, color: string | undefined): boolean {
    const i = this.Material(name);
    if (i < 0) return false;
    this.Override(i).Color = color ? ColorLinear(color) : undefined; this.Update();
    return true;
  }
  /**
   * Puts an image on a material in place of the file's own; undefined = the file's again. The image is multiplied by the
   * material's color: a white material shows it as it is. False when there is no such material.
   */
  SetMaterialImage(name: string, image: Texture3D | undefined): boolean {
    const i = this.Material(name);
    if (i < 0) return false;
    this.Override(i).Image = image?.Pixels; this.Update();
    return true;
  }
  /** How matte a material is, 0 (glossy) to 1 (matte, no highlight); undefined = the file's own. Lit look only. */
  SetMaterialRoughness(name: string, roughness: number | undefined): boolean {
    const i = this.Material(name);
    if (i < 0) return false;
    this.Override(i).Roughness = roughness === undefined ? undefined : Math.min(Math.max(roughness, 0), 1); this.Update();
    return true;
  }
  /** Shows or hides every surface with this material. False when there is none such. */
  SetMaterialVisible(name: string, visible: boolean): boolean {
    const i = this.Material(name);
    if (i < 0) return false;
    this.Override(i).Hidden = !visible; this.Update();
    return true;
  }

  private WithAnimation(name: string, how: number): boolean {
    const i = this.scene?.AnimationNamed(name) ?? -1;
    if (i < 0) return false;
    switch (how) {
      case 0: this.player.Play(i); break;
      case 1: this.player.PlayOnce(i); break;
      case 2: this.player.Hold(i); break;
      case 3: this.player.AddLayer(i); break;
      default: this.player.RemoveLayer(i);
    }
    this.Changed();
    return true;
  }

  private NodeIndex(name: string): number { return this.scene?.NodeNamed(name) ?? -1; }

  /** Something that may start or stop the motion changed: frames on or off, and one redraw. */
  private Changed(): void { this.UpdateTicking(); this.Update(); }

  private get WantsFrames(): boolean { return !!this.scene && (this.autoRotate !== 0 || this.reset < 1 || this.player.Busy || this.TiltMoving); }

  private get TiltMoving(): boolean {
    if (this.tilt <= 0) return false;
    const t = this.TiltTarget();
    return Math.abs(t.Yaw - this.yaw) > 0.02 || Math.abs(t.Pitch - this.pitch) > 0.02;
  }

  private TiltTarget(): { Yaw: number; Pitch: number } {
    return this.tiltOn ? { Yaw: this.homeYaw - this.tiltX * this.tilt, Pitch: this.homePitch + this.tiltY * this.tilt } : { Yaw: this.homeYaw, Pitch: this.homePitch };
  }

  private UpdateTicking(): void {
    if (!this.Superview || this.IsDisposed) return;
    if (this.WantsFrames) {
      this.loop ??= new ActionOnTickAnimator(this, (nanos) => this.Tick(nanos));
      if (!this.loop.IsRunning) { this.lastNanos = 0; this.painted = true; this.loop.Start(); this.Superview.Update(); }
    } else if (this.loop?.IsRunning) this.loop.Stop();
  }

  /** One frame: time moves on, an animation played once that ended is reported. */
  private Tick(nanos: number): void {
    if (!this.painted) { this.loop?.Stop(); return; } // not drawn since the last tick (off screen): no frames, time stands still
    this.painted = false;
    const delta = this.lastNanos === 0 ? 0 : (nanos - this.lastNanos) / 1e9;
    this.lastNanos = nanos;
    this.Advance(delta);
    this.Update();
    if (!this.WantsFrames) this.loop?.Stop();
  }

  /** Advances the animations and the auto rotation by `delta` seconds. */
  Advance(delta: number): void {
    const scene = this.scene;
    if (!scene) return;
    this.yaw = (this.yaw + this.autoRotate * delta) % 360;
    if (this.tilt > 0) {
      // pointer moves come in bursts: the lean chases where they point, reaching it in about 0.15 s
      const t = this.TiltTarget(), k = Math.min(1, delta * 14);
      this.yaw += (t.Yaw - this.yaw) * k;
      this.pitch += (t.Pitch - this.pitch) * k;
    }
    if (this.reset < 1) {
      this.reset = Math.min(1, this.reset + delta / 0.3);
      const e = 1 - Math.pow(1 - this.reset, 3);
      const turn = ((((this.homeYaw - this.fromYaw) % 360) + 540) % 360) - 180; // the short way round
      this.yaw = this.fromYaw + turn * e;
      this.pitch = this.fromPitch + (this.homePitch - this.fromPitch) * e;
      this.zoom = this.fromZoom + (this.homeZoom - this.fromZoom) * e;
    }
    const ended = this.player.Advance(scene, delta);
    if (ended >= 0) this.AnimationEnded?.(this, scene.Animations[ended].Name);
  }

  /** Every node's world matrix for this frame: the animations', then what code set. */
  private ComputePose(): void {
    const scene = this.scene!;
    this.player.Locals(scene, this.locals);
    for (let i = 0; i < this.nodes.length; i++) {
      const o = this.nodes[i], at = i * LOCAL;
      if (o.T) this.locals.set(o.T, at);
      if (o.R) this.locals.set(o.R, at + 3);
      if (o.S) this.locals.set(o.S, at + 7);
    }
    scene.World(this.locals, this.pose, IDENTITY);
    if (this.hiddenDirty) {
      for (let i = 0; i < this.nodes.length; i++) this.ownHidden[i] = !!this.nodes[i].Hidden;
      scene.Hidden(this.ownHidden, this.hidden);
      this.hiddenDirty = false;
    }
  }

  private Camera(width: number, height: number): Mat4 { return this.scene!.Camera(this.camera, this.yaw, this.pitch, this.zoom, width / Math.max(height, 1)); }

  /** What the ray through this point of the control (in points from its corner) meets first; undefined when nothing. */
  HitTest(x: number, y: number): ModelHit | undefined {
    const scene = this.scene;
    if (!scene) return undefined;
    const { W: w, H: h } = this.SizeInPoints();
    if (w <= 0 || h <= 0) return undefined;
    this.ComputePose();
    const { From: from, Dir: dir } = Scene3D.Ray(this.Camera(w, h), x / w, y / h);
    const hit = scene.RayHit(this.pose, this.hidden, this.materials, from, dir);
    if (!hit) return undefined;
    return { Node: scene.Nodes[hit.Node].Name, Material: scene.MaterialOf(hit.Node, hit.Primitive), Point: [from[0] + dir[0] * hit.Distance, from[1] + dir[1] * hit.Distance, from[2] + dir[2] * hit.Distance] };
  }

  private SizeInPoints(): { W: number; H: number } {
    const scale = this.RenderingScale > 0 ? this.RenderingScale : 1;
    if (this.DrawingRect.Width > 0) return { W: this.DrawingRect.Width / scale, H: this.DrawingRect.Height / scale };
    return { W: this.MeasuredSize.Units.Width, H: this.MeasuredSize.Units.Height };
  }

  /**
   * Which way the drag goes, decided once per drag: 1 = this model's (sideways, or any drag when nothing around it scrolls
   * vertically), 2 = the parent's (it started mostly vertical inside a vertical scroll, or with LockPitch), 0 = not moved
   * past the slop yet. As Google's model-viewer: a model inside a scrolling page never traps the vertical drags that scroll it.
   */
  private DragAxis(args: SkiaGesturesParameters): number {
    if (this.panAxis !== 0) return this.panAxis;
    if (!this.LockPitch && !this.InVerticalScroll()) return (this.panAxis = 1);
    const total = args.Event.Distance.Total;
    if (Math.abs(total.X) + Math.abs(total.Y) < 2) return 0;
    return (this.panAxis = Math.abs(total.Y) > Math.abs(total.X) ? 2 : 1);
  }

  private InVerticalScroll(): boolean {
    for (let p = this.Parent; p; p = p.Parent) if (p instanceof SkiaScroll && (p.Orientation === "Vertical" || p.Orientation === "Both")) return true;
    return false;
  }

  override ProcessGestures(args: SkiaGesturesParameters, apply: GestureEventProcessingInfo): SkiaControl | null {
    if (this.scene) {
      if (args.Type === "Down" || args.Type === "Up") this.pinch = 0;
      // a gesture that had two fingers on it never turns the model, up to its last finger
      if (args.Event.NumberOfTouches > 1) this.multiTouch = true;
      else if (args.Type === "Down") this.multiTouch = false;
      const type = args.Type;
      if (this.tilt > 0 && (type === "Pointer" || type === "Down" || type === "Panning")) {
        if (type === "Down") this.panAxis = 0;
        else if (type === "Panning") {
          const axis = this.DragAxis(args);
          if (axis === 0) return this;
          if (axis === 2) { this.tiltOn = false; this.Changed(); return null; }
        }
        const pointer = this.GetOffsetInsideControlInPoints(apply.MappedLocation, apply.ChildOffset);
        const { W: w, H: h } = this.SizeInPoints();
        if (w > 0 && h > 0) {
          this.tiltX = Math.min(Math.max((pointer.X / w) * 2 - 1, -1), 1);
          this.tiltY = Math.min(Math.max((pointer.Y / h) * 2 - 1, -1), 1);
          this.tiltOn = true;
          this.Changed();
        }
        if (type !== "Pointer") { super.ProcessGestures(args, apply); return this; }
      } else if (this.tilt > 0 && type === "Up") {
        this.tiltOn = false;
        this.Changed();
      } else if (type === "Down" && (this.Orbit || this.PinchZoom || this.ResetOnDoubleTap || this.Tapped3D)) {
        this.panAxis = 0;
        super.ProcessGestures(args, apply);
        return this;
      } else if (type === "Panning" && this.PinchZoom && args.Event.Manipulation) {
        this.reset = 1;
        // the whole pinch from where it started, clamped only at the end
        if (this.pinch <= 0) { this.pinch = 1; this.pinchFrom = this.zoom; }
        this.pinch *= Math.max(0.2, 1 + args.Event.Manipulation.Scale);
        this.zoom = Math.min(Math.max(this.pinchFrom / this.pinch, this.minZoom), this.maxZoom);
        this.Update();
        return this;
      } else if (type === "Panning" && this.Orbit) {
        if (this.multiTouch) return this;
        const axis = this.DragAxis(args);
        if (axis === 0) return this;
        if (axis === 2) return null;
        const scale = Math.max(this.RenderingScale, 0.1);
        this.reset = 1;
        // the surface follows the finger: a drag to the right turns the near side to the right, in points whatever the density
        this.yaw -= (args.Event.Distance.Delta.X / scale) * 0.5;
        if (!this.LockPitch) this.pitch = Math.min(Math.max(this.pitch + (args.Event.Distance.Delta.Y / scale) * 0.3, -60), 80);
        this.Update();
        return this;
      } else if (type === "Wheel" && this.PinchZoom && args.Event.Wheel.IsZoom) {
        // a plain wheel scrolls the page; Ctrl (Cmd) + wheel or a touchpad pinch zooms (6bp)
        const perNotch = this.Superview?.WheelDeltaPerNotch ?? 0;
        const notches = perNotch > 0 ? args.Event.Wheel.Delta / perNotch : Math.sign(args.Event.Wheel.Delta);
        this.reset = 1;
        this.zoom = Math.min(Math.max(this.zoom * Math.pow(0.88, -notches), this.minZoom), this.maxZoom);
        args.Event.Handled = true;
        this.Update();
        return this;
      } else if (type === "Tapped" && this.ResetOnDoubleTap && performance.now() - this.lastTapMs < 300) {
        this.lastTapMs = 0;
        this.ResetView();
        return this;
      } else if (type === "Tapped" && (this.ResetOnDoubleTap || this.Tapped3D)) {
        if (this.ResetOnDoubleTap) this.lastTapMs = performance.now();
        if (!this.Tapped3D) return this;
        const at = this.GetOffsetInsideControlInPoints(apply.MappedLocation, apply.ChildOffset);
        const hit = this.HitTest(at.X, at.Y);
        if (hit) { this.Tapped3D(this, hit); return this; }
      }
    }
    return super.ProcessGestures(args, apply);
  }

  protected override Paint(ctx: DrawingContext): void {
    super.Paint(ctx);
    if (!this.scene) return;
    const dest = ctx.Destination;
    const w = Math.round(dest.Width), h = Math.round(dest.Height);
    if (w <= 0 || h <= 0) return;
    this.drawn = true;
    this.painted = true;
    if (this.WantsFrames && !this.loop?.IsRunning) this.UpdateTicking();
    if (this.yaw !== this.shownYaw || this.pitch !== this.shownPitch || this.zoom !== this.shownZoom) {
      this.shownYaw = this.yaw; this.shownPitch = this.pitch; this.shownZoom = this.zoom;
      this.ViewChanged?.(this);
    }
    const renderer = Renderer3D.Of(this.Superview);
    if (!renderer) return;
    // the 3D program still compiling (it started as the control was laid out): nothing drawn yet, no frame waits for it
    if (!renderer.ProgramReady) { RedrawAfterFrame(this); return; }
    // nothing changed since the last render (a parent redraws): its image again, no 3D pass
    let image = !this.stale && this.target.Owner === renderer && this.target.Width === w && this.target.Height === h ? this.target.Image : undefined;
    image ??= this.Render3D(renderer, w, h, ctx.Scale);
    if (image) DrawFlipped(ctx, image, dest.Left, dest.Top, w, h);
  }

  private Render3D(renderer: Renderer3D, w: number, h: number, scale: number) {
    this.stale = false;
    this.gpuReady = true;
    this.ComputePose();
    this.items[0] = { Scene: this.scene!, Pose: this.pose, Hidden: this.hidden, Materials: this.materials };
    return renderer.Draw(this.target, this.items, 1, { Look: this.look, Outline: this.outlineWidth * scale, OutlineColor: ColorSrgb(this.outlineColor), Samples: this.antialias ? 4 : 1 }, this.Camera(w, h), w, h);
  }

  get GpuReady(): boolean { return this.gpuReady; }

  /** Renders once off screen at its measured size: uploads its model and images, makes its target (warming, 6bn). */
  Prefetch(renderer: Renderer3D): void {
    const w = Math.round(this.MeasuredSize.Pixels.Width), h = Math.round(this.MeasuredSize.Pixels.Height);
    // a control already drawn on screen renders there (its cached parents record it then)
    if (this.scene && !this.gpuReady && !this.drawn && w > 0 && h > 0 && Number.isFinite(w) && Number.isFinite(h)) this.Render3D(renderer, w, h, this.RenderingScale);
  }

  override Measure(widthConstraint: number, heightConstraint: number, scale: number) {
    const measured = super.Measure(widthConstraint, heightConstraint, scale);
    // the 3D program compiles from the first layout on, before anything 3D draws (drawnui-cross 6bn)
    Renderer3D.Warm(this.Superview);
    // rendered ahead once it comes near the screen (Prefetch3D)
    if (!this.queued && !this.gpuReady) this.queued = Prefetch3D.Add(this);
    return measured;
  }

  override ApplyHover(on: boolean): void {
    if (!on && this.tiltOn) { this.tiltOn = false; this.Changed(); } // the pointer left: the lean glides home
    super.ApplyHover(on);
  }

  override Update(): void {
    this.stale = true;
    super.Update();
  }

  protected override OnDisposing(): void {
    this.loop?.Dispose();
    this.loop = undefined;
    Renderer3D.Release(this.target);
    super.OnDisposing();
  }
}

/**
 * Drawn nothing this frame (its 3D program still compiling): once the frame is over, the control and every cached parent
 * that recorded it empty draw again. Asked from inside the frame, a parent's cache recording would end with the request
 * forgotten and keep the empty picture.
 */
export function RedrawAfterFrame(control: SkiaControl): void {
  const canvas = control.Superview;
  if (!canvas) return;
  const once = () => { canvas.WasDrawnListeners.delete(once); if (!control.IsDisposed) control.Update(); };
  canvas.WasDrawnListeners.add(once);
}

const IDENTITY = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

/** The 3D frame's rows go bottom up (GL): drawn mirrored vertically into its rect. */
export function DrawFlipped(ctx: DrawingContext, image: import("canvaskit-wasm").Image, left: number, top: number, w: number, h: number): void {
  const c = ctx.Context.Canvas;
  c.save();
  c.translate(left, top + h);
  c.scale(1, -1);
  c.drawImageRect(image, [0, 0, w, h], [0, 0, w, h], drawPaint());
  c.restore();
}
let paint: import("canvaskit-wasm").Paint | undefined;
const drawPaint = () => (paint ??= new (Super.CK.Paint)());
