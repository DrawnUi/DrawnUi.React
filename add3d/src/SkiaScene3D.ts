// A 3D layer over a 2D game field: many objects, one pass. Port of DrawnUi.Add3d SkiaScene3D (.NET) and drawnui-add3d.
import { ActionOnTickAnimator, SkiaControl, type DrawingContext, type GestureEventProcessingInfo, type SkiaGesturesParameters } from "drawnui-react/core";
import { Mul, OrthographicGl, QuatAxisAngle, FromTRS, Radians, type Mat4, type Vec3 } from "./math";
import { Player3D } from "./player";
import { Renderer3D, RenderTarget, type RenderItem } from "./renderer";
import { LOCAL, Scene3D, type MaterialOverride } from "./scene";
import { Look, type SceneAnimationEnded, type SceneHit, type Texture3D } from "./types";
import type { Model3D } from "./shapes";
import { Prefetch3D, type IPrefetch3D } from "./prefetch";
import { ColorLinear, ColorSrgb } from "./colors";
import { DrawFlipped, RedrawAfterFrame } from "./SkiaModel3D";

/** A model the layer can place: its scene, the point it stands on and its height at rest. */
interface ModelEntry { Name: string; Scene: Scene3D; Anchor: Vec3; Height: number }

interface Object3D {
  Name: string;
  Model: ModelEntry;
  X: number; Y: number; Size: number; Facing: number;
  Visible: boolean;
  Player: Player3D;
  Materials: (MaterialOverride | undefined)[];
  Pose: Float32Array;
  Hidden: boolean[];
}

/**
 * A 3D layer over a 2D game field. Many objects, each a model with its own place, size, facing and animations, are drawn
 * in one pass into one texture; each model is read and uploaded once however many objects use it. Objects are placed in
 * the layer's own points, like sprites: (x, y) is where an object stands (the bottom center of its model), size its
 * height. An object lower on the field is drawn in front. The view is straight on, each object tilted forward by Tilt
 * degrees, so a game moves them as it moves 2D sprites.
 */
export class SkiaScene3D extends SkiaControl implements IPrefetch3D {
  private readonly models: ModelEntry[] = [];
  private readonly objects: Object3D[] = [];
  private readonly byName = new Map<string, Object3D>();
  private readonly errors: { Model: string; Error: string }[] = [];
  private readonly target = new RenderTarget();
  private readonly items: RenderItem[] = [];
  private locals = new Float32Array(0);
  private loop?: ActionOnTickAnimator;
  private lastNanos = 0;
  private painted = false;
  /** Drawn on screen once: it renders there, warming ahead is no longer needed. */
  private drawn = false;
  private tilt = 15;
  private outlineWidth = 0;
  private playing = true;
  private look = Look.Lit;
  private antialias = false;
  private outlineColor = "#000000";
  private gpuReady = false;
  private queued = false;
  private readonly camera = new Float32Array(16);

  /** An object's animation played with PlayOnce or Hold ended: the object's name and the animation's. */
  AnimationEnded?: (sender: SkiaScene3D, e: SceneAnimationEnded) => void;
  /** A tap landed on an object (the nearest one under the finger). Taps on empty field go to what is behind the layer. */
  Tapped3D?: (sender: SkiaScene3D, hit: SceneHit) => void;

  /** Forward tilt of every object, degrees (15 by default): how much of its top the player sees. */
  get Tilt(): number { return this.tilt; }
  set Tilt(value: number) { this.tilt = value; this.Update(); }

  /** How objects are drawn: Lit (default), Toon or Flat. */
  get Look(): Look { return this.look; }
  set Look(value: Look) { this.look = value; this.Update(); }

  /** Smooth 3D edges (4x multisampling, or the most the GPU offers), off by default. */
  get Antialias(): boolean { return this.antialias; }
  set Antialias(value: boolean) { if (this.antialias === value) return; this.antialias = value; this.Update(); }

  /** An outline around every shape, in points, like an illustration's stroke (0 = none). */
  get OutlineWidth(): number { return this.outlineWidth; }
  set OutlineWidth(value: number) { this.outlineWidth = Math.max(0, value); this.Update(); }

  /** The outline's color (black by default). */
  get OutlineColor(): string { return this.outlineColor; }
  set OutlineColor(value: string | undefined) { this.outlineColor = value ?? "#000000"; this.Update(); }

  /** Plays every animation of the layer (on by default); off stops them where they are. */
  get IsPlaying(): boolean { return this.playing; }
  set IsPlaying(value: boolean) { this.playing = value; this.Changed(); }

  /** The objects' names, in the order they were added. */
  get ObjectNames(): string[] { return this.objects.map((o) => o.Name); }

  /** Models whose files could not be read: the model name and why. */
  get Errors(): readonly { Model: string; Error: string }[] { return this.errors; }

  /** The main animation of an object, by name (undefined when none or no such object). */
  CurrentAnimation(obj: string): string | undefined {
    const o = this.byName.get(obj);
    if (!o) return undefined;
    const a = o.Player.Main.Animation;
    return a >= 0 && a < o.Model.Scene.Animations.length ? o.Model.Scene.Animations[a].Name : undefined;
  }

  /** Whether the layer asks for frames now (something moves). */
  get IsAnimating(): boolean { return this.WantsFrames; }

  // ---- models ----

  /**
   * A model objects can be made of, by name: the bytes of a .glb, or a model made in code (Model3D). The same byte array
   * used by other layers or SkiaModel3D controls is read once. A name given again replaces the model.
   */
  Model(name: string, model: Uint8Array | ArrayBuffer | Model3D): SkiaScene3D {
    let scene: Scene3D | undefined, error: string | undefined;
    if (model instanceof Uint8Array || model instanceof ArrayBuffer) ({ Scene: scene, Error: error } = Scene3D.Shared(model));
    else scene = model?.ToScene();
    if (!scene) {
      this.errors.push({ Model: name, Error: error ?? "no model" });
      console.warn(`[SkiaScene3D] model ${name}: ${error ?? "no model"}`);
      return this;
    }
    const lo = scene.BoundsMin, hi = scene.BoundsMax;
    const entry: ModelEntry = { Name: name, Scene: scene, Anchor: [(lo[0] + hi[0]) / 2, lo[1], (lo[2] + hi[2]) / 2], Height: Math.max(hi[1] - lo[1], 1e-3) };
    const at = this.models.findIndex((m) => m.Name === name);
    if (at >= 0) this.models[at] = entry; else this.models.push(entry);
    if (this.locals.length < scene.Nodes.length * LOCAL) this.locals = new Float32Array(scene.Nodes.length * LOCAL);
    return this;
  }

  // ---- objects ----

  /**
   * Places an object made of `model` (a name given to Model), standing at (x, y) of the layer in points, `size` points
   * tall; it loops its model's first animation. The same name replaces an object. False when there is no such model.
   */
  Add(name: string, model: string, x: number, y: number, size: number): boolean {
    const entry = this.models.find((m) => m.Name === model);
    if (!entry) return false;
    const scene = entry.Scene;
    const obj: Object3D = {
      Name: name, Model: entry, X: x, Y: y, Size: size, Facing: 0, Visible: true, Player: new Player3D(scene),
      Materials: new Array(scene.Materials.length).fill(undefined), Pose: new Float32Array(scene.Nodes.length * 16), Hidden: new Array(scene.Nodes.length).fill(false),
    };
    const old = this.byName.get(name);
    if (old) this.objects[this.objects.indexOf(old)] = obj; else this.objects.push(obj);
    this.byName.set(name, obj);
    this.Changed();
    return true;
  }

  /** Removes an object; false when there is none such. */
  Remove(name: string): boolean {
    const obj = this.byName.get(name);
    if (!obj) return false;
    this.byName.delete(name);
    this.objects.splice(this.objects.indexOf(obj), 1);
    this.Changed();
    return true;
  }

  /** Removes every object. */
  ClearObjects(): void { this.objects.length = 0; this.byName.clear(); this.Changed(); }

  /** Moves an object: where it stands, in the layer's points. */
  SetPosition(name: string, x: number, y: number): boolean {
    const o = this.byName.get(name);
    if (!o) return false;
    o.X = x; o.Y = y; this.Update();
    return true;
  }

  /** Turns an object around its vertical axis, degrees (0 = facing the player, 90 = to the right). */
  SetFacing(name: string, degrees: number): boolean {
    const o = this.byName.get(name);
    if (!o) return false;
    o.Facing = degrees; this.Update();
    return true;
  }

  /** An object's height in points. */
  SetSize(name: string, size: number): boolean {
    const o = this.byName.get(name);
    if (!o) return false;
    o.Size = size; this.Update();
    return true;
  }

  /** Shows or hides an object (a hidden one asks for no frames). */
  SetVisible(name: string, visible: boolean): boolean {
    const o = this.byName.get(name);
    if (!o) return false;
    o.Visible = visible; this.Changed();
    return true;
  }

  /** Loops an object's animation by name, blending into it. */
  Play(name: string, animation: string): boolean { return this.WithAnimation(name, animation, 0); }
  /** Plays an object's animation once, then back to the loop it played before. */
  PlayOnce(name: string, animation: string): boolean { return this.WithAnimation(name, animation, 1); }
  /** Plays an object's animation once and holds its last frame. */
  Hold(name: string, animation: string): boolean { return this.WithAnimation(name, animation, 2); }

  /** An object's animation speed, 1 = as authored (vary it so a crowd does not move in step). */
  SetSpeed(name: string, speed: number): boolean {
    const o = this.byName.get(name);
    if (!o) return false;
    o.Player.Speed = speed;
    return true;
  }

  /** Recolors one material of one object; undefined = the file's color. */
  SetMaterialColor(name: string, material: string, color: string | undefined): boolean {
    const o = this.byName.get(name);
    const i = o?.Model.Scene.MaterialNamed(material) ?? -1;
    if (!o || i < 0) return false;
    (o.Materials[i] ??= {}).Color = color ? ColorLinear(color) : undefined;
    this.Update();
    return true;
  }

  /** Puts an image on one material of one object; undefined = the file's again. */
  SetMaterialImage(name: string, material: string, image: Texture3D | undefined): boolean {
    const o = this.byName.get(name);
    const i = o?.Model.Scene.MaterialNamed(material) ?? -1;
    if (!o || i < 0) return false;
    (o.Materials[i] ??= {}).Image = image?.Pixels;
    this.Update();
    return true;
  }

  /** Stops or resumes every animation of the layer. */
  SetPlaying(on: boolean): void { this.IsPlaying = on; }

  private WithAnimation(name: string, animation: string, how: number): boolean {
    const o = this.byName.get(name);
    const a = o?.Model.Scene.AnimationNamed(animation) ?? -1;
    if (!o || a < 0) return false;
    if (how === 0) o.Player.Play(a); else if (how === 1) o.Player.PlayOnce(a); else o.Player.Hold(a);
    this.Changed();
    return true;
  }

  // ---- frames ----

  private Changed(): void { this.UpdateTicking(); this.Update(); }

  private get WantsFrames(): boolean {
    if (!this.playing) return false;
    for (const o of this.objects) if (o.Visible && o.Player.Busy) return true;
    return false;
  }

  private UpdateTicking(): void {
    if (!this.Superview || this.IsDisposed) return;
    if (this.WantsFrames) {
      this.loop ??= new ActionOnTickAnimator(this, (nanos) => this.Tick(nanos));
      if (!this.loop.IsRunning) { this.lastNanos = 0; this.painted = true; this.loop.Start(); this.Superview.Update(); }
    } else if (this.loop?.IsRunning) this.loop.Stop();
  }

  private Tick(nanos: number): void {
    if (!this.painted) { this.loop?.Stop(); return; } // not drawn since the last tick (off screen): no frames, time stands still
    this.painted = false;
    const delta = this.lastNanos === 0 ? 0 : (nanos - this.lastNanos) / 1e9;
    this.lastNanos = nanos;
    this.Advance(delta);
    this.Update();
    if (!this.WantsFrames) this.loop?.Stop();
  }

  /** The objects' animations advance by `delta` seconds, then the app hears what ended. */
  Advance(delta: number): void {
    if (!this.playing) return;
    // an index loop: a handler may add or remove objects
    for (let i = 0; i < this.objects.length; i++) {
      const o = this.objects[i];
      const ended = o.Player.Advance(o.Model.Scene, delta);
      if (ended >= 0) this.AnimationEnded?.(this, { Object: o.Name, Animation: o.Model.Scene.Animations[ended].Name });
    }
  }

  // ---- drawing ----

  /** The object's place in the layer: points, y down on the field, nearer the lower it stands. */
  private Placement(o: Object3D, out: Mat4): Mat4 {
    const s = o.Size / o.Model.Height, a = o.Model.Anchor;
    // T(x, -y, y) * Rx(tilt) * Ry(facing) * S * T(-anchor)
    FromTRS(out, [o.X, -o.Y, o.Y], QuatMulAxis(Radians(this.tilt), Radians(o.Facing)), [s, s, s]);
    Mul(out, out, FromTRS(scratchA, [-a[0], -a[1], -a[2]], [0, 0, 0, 1], [1, 1, 1]));
    return out;
  }

  /** Every node's world matrix of an object, its place included, into its own pose. */
  private Pose(o: Object3D): void {
    const scene = o.Model.Scene;
    o.Player.Locals(scene, this.locals);
    scene.World(this.locals, o.Pose, this.Placement(o, placement));
  }

  /** A straight-on view of the layer in points, deep enough for any object. */
  private Camera(w: number, h: number): Mat4 {
    const depth = (w + h) * 4 + 10_000;
    return OrthographicGl(this.camera, 0, w, -h, 0, -depth, depth);
  }

  private SizeInPoints(): { W: number; H: number } {
    const scale = this.RenderingScale > 0 ? this.RenderingScale : 1;
    if (this.DrawingRect.Width > 0) return { W: this.DrawingRect.Width / scale, H: this.DrawingRect.Height / scale };
    return { W: this.MeasuredSize.Units.Width, H: this.MeasuredSize.Units.Height };
  }

  /** The nearest object surface under a point of the layer (points from its corner); undefined when none. */
  HitTest(x: number, y: number): SceneHit | undefined {
    const { W: w, H: h } = this.SizeInPoints();
    if (w <= 0 || h <= 0) return undefined;
    const { From: from, Dir: dir } = Scene3D.Ray(this.Camera(w, h), x / w, y / h);
    let best: SceneHit | undefined, bestDistance = Number.MAX_VALUE;
    for (const o of this.objects) {
      if (!o.Visible) continue;
      this.Pose(o);
      const scene = o.Model.Scene;
      const hit = scene.RayHit(o.Pose, o.Hidden, o.Materials, from, dir);
      if (hit && hit.Distance < bestDistance) {
        bestDistance = hit.Distance;
        best = { Object: o.Name, Node: scene.Nodes[hit.Node].Name, Material: scene.MaterialOf(hit.Node, hit.Primitive) };
      }
    }
    return best;
  }

  override ProcessGestures(args: SkiaGesturesParameters, apply: GestureEventProcessingInfo): SkiaControl | null {
    if (this.Tapped3D && args.Type === "Tapped") {
      const at = this.GetOffsetInsideControlInPoints(apply.MappedLocation, apply.ChildOffset);
      const hit = this.HitTest(at.X, at.Y);
      if (hit) { this.Tapped3D(this, hit); return this; }
    }
    return super.ProcessGestures(args, apply);
  }

  protected override Paint(ctx: DrawingContext): void {
    super.Paint(ctx);
    const dest = ctx.Destination;
    const w = Math.round(dest.Width), h = Math.round(dest.Height);
    if (w <= 0 || h <= 0 || this.objects.length === 0) return;
    this.painted = true;
    this.drawn = true;
    if (this.WantsFrames && !this.loop?.IsRunning) this.UpdateTicking();
    const renderer = Renderer3D.Of(this.Superview);
    if (!renderer) return;
    if (!renderer.ProgramReady) { RedrawAfterFrame(this); return; }
    const image = this.Render3D(renderer, w, h, ctx.Scale);
    if (image) DrawFlipped(ctx, image, dest.Left, dest.Top, w, h);
  }

  private Render3D(renderer: Renderer3D, w: number, h: number, scale: number) {
    this.gpuReady = true;
    let count = 0;
    for (const o of this.objects) {
      if (!o.Visible) continue;
      this.Pose(o);
      const item = (this.items[count++] ??= { Scene: o.Model.Scene, Pose: o.Pose, Hidden: o.Hidden, Materials: o.Materials });
      item.Scene = o.Model.Scene; item.Pose = o.Pose; item.Hidden = o.Hidden; item.Materials = o.Materials;
    }
    scale = Math.max(scale, 0.1);
    return renderer.Draw(this.target, this.items, count, { Look: this.look, Outline: this.outlineWidth * scale, OutlineColor: ColorSrgb(this.outlineColor), Samples: this.antialias ? 4 : 1 }, this.Camera(w / scale, h / scale), w, h);
  }

  get GpuReady(): boolean { return this.gpuReady; }

  Prefetch(renderer: Renderer3D): void {
    const w = Math.round(this.MeasuredSize.Pixels.Width), h = Math.round(this.MeasuredSize.Pixels.Height);
    if (this.objects.length > 0 && !this.gpuReady && !this.drawn && w > 0 && h > 0 && Number.isFinite(w) && Number.isFinite(h)) this.Render3D(renderer, w, h, this.RenderingScale);
  }

  override Measure(widthConstraint: number, heightConstraint: number, scale: number) {
    const measured = super.Measure(widthConstraint, heightConstraint, scale);
    Renderer3D.Warm(this.Superview);
    if (!this.queued && !this.gpuReady) this.queued = Prefetch3D.Add(this);
    return measured;
  }

  protected override OnDisposing(): void {
    this.loop?.Dispose();
    this.loop = undefined;
    Renderer3D.Release(this.target);
    super.OnDisposing();
  }
}

/** Rx(tilt) * Ry(facing) as one rotation. */
function QuatMulAxis(tilt: number, facing: number): [number, number, number, number] {
  const a = QuatAxisAngle([1, 0, 0], tilt), b = QuatAxisAngle([0, 1, 0], facing);
  return [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0], a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
}
const placement = new Float32Array(16), scratchA = new Float32Array(16);
