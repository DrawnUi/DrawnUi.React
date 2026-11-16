import type { GrDirectContext, Surface, WebGLContextHandle } from "canvaskit-wasm";
import { type CachedObject, CanvasLeaveWatchers, type DrawingContext, SkiaControl } from "./SkiaControl";
import type { AnimatorBase } from "./Animators";
import { Super } from "./Super";
import { SkiaAccessibilityManager } from "./Accessibility";
import { HoverManager } from "./Hover";
import { TooltipController, type TooltipStyleLike } from "./Tooltips";
import { PopupAnchor, PopupLayer, type PopupId, type PopupWindowOptions } from "./PopupWindows";
import { KeyboardManager, type InputKey } from "./KeyboardManager";
import { TouchEffect } from "./Gestures";
import { TextInputProxy } from "./TextInputProxy";
import { type Color, Colors, type RenderingModeType, SKRect } from "./Types";
import {
  ContextMenuEventArgs, type ContextMenuSource,
  GestureEventProcessingInfo, MultitouchTracker, PointerData, type GesturesMode, SKPoint, SkiaGesturesParameters, TouchActionEventArgs,
  type TouchActionResult, type TouchActionType,
} from "./Gestures";

/**
 * Mirrors DrawnUi Canvas (DrawnView): hosts one Content control on an HTML canvas element,
 * owns RenderingScale (devicePixelRatio), the surface, the on-demand frame loop and raw input.
 * Frames are drawn only after Update() (invalidation), never continuously.
 * Gestures are accumulated and processed in order at the START of the next frame, like DrawnUi.
 */
/** The system's light / dark appearance (DrawnUi.Rust SystemTheme). */
export type SystemTheme = "Light" | "Dark";

export class Canvas {
  /** Points a pointer may travel between Down and Up and still count as a tap (AppoMobi TouchEffect default). */
  static TappedCancelMoveThresholdPoints = 16;
  /** Alias of TouchEffect.LongPressTimeMsDefault: how long a press is held still to be a LongPressing. */
  static get LongPressTimeMs(): number { return TouchEffect.LongPressTimeMsDefault; }
  static set LongPressTimeMs(ms: number) { TouchEffect.LongPressTimeMsDefault = ms; }

  BackgroundColor: Color = Colors.Transparent;
  /** Accelerated = WebGL surface, Default = software. Read once at first frame. */
  RenderingMode: RenderingModeType = "Accelerated";
  RenderingScale = 1;
  /** Duration of the last Draw in ms (measure + arrange + render, excluding GPU flush). */
  FrameTime = 0;
  /** Frames per second over the last second of drawn frames. */
  FPS = 0;
  private frameTimes: number[] = [];

  /** DrawnView.WasRendered: a frame has been drawn on a ready surface (set after the first one completes). */
  WasRendered = false;
  /** DrawnView.CanRender: the surface (and its GPU context when accelerated) is ready to draw. */
  get CanRender(): boolean { return !!this.surface && !this.disposed; }
  /**
   * DrawnView.WillFirstTimeDraw: raised once, right before the first frame drawn on a ready surface, with that
   * frame's drawing context. The engine draws its first frame while it is being constructed (so the page never shows
   * an unpainted canvas): pass it through the constructor's `init` to receive that frame.
   */
  WillFirstTimeDraw?: (sender: Canvas, context: DrawingContext["Context"]) => void;
  /** DrawnView.WasDrawn: raised after every frame has been drawn (the C# event passes no context). */
  WasDrawn?: (sender: Canvas) => void;

  /**
   * The system's light / dark appearance (DrawnUi.Rust `system_theme`): undefined until the host learns it, which it
   * does when the canvas is created (`prefers-color-scheme`), then it follows every change.
   */
  get SystemTheme(): SystemTheme | undefined { return this.systemTheme; }
  /**
   * Raised once when the host learns the system theme (set it in the Canvas init / the `<Canvas>` prop to get that first
   * value), then once per change; a repeated value is not raised. No handler, no call; it never asks for a frame.
   */
  SystemThemeChanged?: (theme: SystemTheme) => void;
  private systemTheme?: SystemTheme;
  private themeQuery?: MediaQueryList;
  private readonly onThemeQuery = () => this.SetSystemTheme(this.themeQuery!.matches ? "Dark" : "Light");
  private SetSystemTheme(theme: SystemTheme): void {
    if (theme === this.systemTheme) return;
    this.systemTheme = theme;
    this.SystemThemeChanged?.(theme);
  }
  /** Registry + rate-limited snapshot of accessible controls, rendered by the DOM overlay (DrawnUi AccessibilityManager). */
  readonly AccessibilityManager = new SkiaAccessibilityManager();
  /** Mouse hover of the controls (drawnui-cross 6m): ReceivesHover / IsHovered / HoverChanged. */
  readonly Hover = new HoverManager();

  // ---- tooltips (drawnui-cross 6ar) ----
  private tooltipController?: TooltipController;
  /** Made on first use: a canvas that never shows a tooltip allocates nothing for it. */
  private get tooltip(): TooltipController { return this.tooltipController ??= new TooltipController(this); }
  /** Look and timing of the tooltips on this canvas; unset uses `Super.TooltipStyle`. */
  TooltipStyle?: TooltipStyleLike;
  get TooltipStyleUsed(): TooltipStyleLike { return this.TooltipStyle ?? Super.TooltipStyle!; }
  /** The text of the tooltip shown now, undefined when none is shown. */
  get ShownTooltip(): string | undefined { return this.tooltip.ShownText; }

  // ---- popup windows (drawnui-cross 6at, the DrawnUi.Rust / .NET API) ----
  private popupLayer?: PopupLayer;
  /** Made on first use, like the tooltip. */
  private get popups(): PopupLayer { return this.popupLayer ??= new PopupLayer(this); }
  private popupKeysHooked = false;
  /** Raised when a popup window closed: picked, a press outside, Escape, the wheel, window blur or ClosePopupWindow. */
  readonly PopupWindowClosed = new Set<(id: PopupId) => void>();
  /** The root controls of the open popup windows, bottom to top: a read-only view for tools (a new array per read). */
  get PopupWindowRoots(): readonly SkiaControl[] { return this.popupLayer?.Roots ?? []; }

  private wasDrawnListeners?: Set<(sender: Canvas) => void>;
  /**
   * Handlers run at the end of every drawn frame, after the `WasDrawn` callback and before the surface is flushed (a
   * tool drawing an overlay on `Surface.getCanvas()`). Made on first use: a canvas without listeners does no work.
   */
  get WasDrawnListeners(): Set<(sender: Canvas) => void> { return this.wasDrawnListeners ??= new Set(); }
  private readonly raiseWasDrawn = (f: (sender: Canvas) => void) => Canvas.Guard("a WasDrawn listener", f, () => f(this));

  /**
   * Shows `content` over everything, opening from `anchor` the way native menus do: at a point (a right click, canvas
   * points), or below a rect or a control (a dropdown), flipped to the other side where it does not fit. It closes with
   * a press outside it, Escape, the wheel outside it, window blur, `ClosePopupWindow` and the options.
   */
  OpenPopupWindow(content: SkiaControl, anchor: PopupAnchor | SKPoint | SKRect | SkiaControl | { X: number; Y: number }, options: PopupWindowOptions = {}): PopupId {
    const id = this.popups.Open(content, PopupAnchor.From(anchor), options, this);
    this.HookPopupKeys(true);
    if (!options.Passive) this.tooltip.Reset(); // a menu opening closes the tooltip
    this.Hover.RequestCheck();
    this.Update();
    return id;
  }
  /** Closes the popup window (nothing when it is closed already). */
  ClosePopupWindow(id: PopupId): void { this.popups.Close(id); this.AfterPopupsChanged(); }
  /** Closes every popup window. */
  ClosePopupWindows(): void { this.popups.CloseAll(true); this.AfterPopupsChanged(); }
  /** The popup window is still open. */
  IsPopupWindowOpen(id: PopupId): boolean { return this.popups.IsOpen(id); }
  /**
   * Moves the keyboard and screen-reader focus to `control` at the end of the next frame, for app code such as a custom
   * menu that moves its highlight (C# DrawnView.SetAccessibilityFocus). A control not drawn yet gets it once it is, within
   * 3 seconds. It wins over the library's own moves in the same frame (a closed popup window giving the keyboard back to
   * its opener); undefined cancels a move still waiting. The focus ring shows only if the keyboard is in use.
   */
  SetAccessibilityFocus(control?: SkiaControl): void { this.AccessibilityManager.SetAccessibilityFocus(control); this.Update(); }

  /**
   * The drawn control with the keyboard and screen-reader focus (C# KeyboardFocusNode). Set undefined to let no drawn
   * control keep it: the DOM focus goes back to the canvas and the keys belong to the app; a control moves it there.
   */
  get KeyboardFocusNode(): SkiaControl | undefined { return this.AccessibilityManager.FocusedNode; }
  set KeyboardFocusNode(control: SkiaControl | undefined) {
    if (control) this.AccessibilityManager.SetAccessibilityFocus(control); else this.AccessibilityManager.ClearKeyboardFocus();
    this.Update();
  }
  /** True while a popup window that takes input is open. */
  get HasPopupWindows(): boolean { return this.popups.HasInteractive; }
  /** The content of the top popup window that takes input. */
  get TopPopupWindow(): SkiaControl | undefined { return this.popups.TopInteractive; }
  /** The window stopped being active (blur): popup windows and the tooltip close, as native menus do. */
  OnWindowDeactivated(): void { this.ClosePopupWindows(); this.tooltip.CloseOnInput(); }
  /**
   * The browser window (tab) has the keyboard (C# DrawnView.IsWindowActive): false after its blur, true again after its
   * focus. A focused editor hides its caret while it is false.
   */
  IsWindowActive = typeof document === "undefined" || typeof document.hasFocus !== "function" || document.hasFocus();
  /** Raised when IsWindowActive changes (C# WindowActiveChanged). */
  readonly WindowActiveChanged = new Set<(active: boolean) => void>();
  private SetWindowActive(active: boolean): void {
    if (this.IsWindowActive === active) return;
    this.IsWindowActive = active;
    for (const h of [...this.WindowActiveChanged]) h(active);
  }
  RaisePopupWindowClosed(id: PopupId): void { for (const h of [...this.PopupWindowClosed]) h(id); }

  private AfterPopupsChanged(): void {
    if (!this.popups.HasAny) this.HookPopupKeys(false);
    this.Hover.RequestCheck();
    this.Update();
  }
  private readonly onPopupKey = (key: InputKey): boolean => {
    if (key !== "Escape" || !this.popups.CloseTop()) return false;
    this.AfterPopupsChanged();
    return true;
  };
  private HookPopupKeys(on: boolean): void {
    if (on === this.popupKeysHooked) return;
    this.popupKeysHooked = on;
    if (on) KeyboardManager.SubscribeNavigation(this.onPopupKey);
    else KeyboardManager.UnsubscribeNavigation(this.onPopupKey);
  }
  private readonly onWindowBlur = () => this.OnWindowDeactivated();
  // IsWindowActive follows the window for the canvas' whole life, input on or off (a focused editor needs it)
  private readonly onWindowInactive = () => this.SetWindowActive(false);
  private readonly onWindowActive = () => this.SetWindowActive(true);

  private content?: SkiaControl;
  get Content(): SkiaControl | undefined { return this.content; }
  set Content(value: SkiaControl | undefined) {
    if (this.content && this.content !== value) { this.ControlLeft(this.content, false); this.content._superview = undefined; }
    this.content = value;
    if (value) { value.Parent = undefined; value._superview = this; }
    this.Hover.RequestCheck();
    this.Update();
  }

  private surface?: Surface;
  /** GL context + GrContext live for the Canvas lifetime; only the on-screen surface is recreated on resize. */
  private glHandle?: WebGLContextHandle;
  private grContext?: GrDirectContext;
  private frameId = 0;
  private disposed = false;
  private readonly observer: ResizeObserver;
  /**
   * The device pixels the element covers, as the browser reports them (ResizeObserver device-pixel-content-box). At a
   * fractional display scale the rounded CSS size can be a pixel off (701.3 x 333.3 CSS px at 1.25 cover 877 x 416 device
   * px), and the browser would then resample the whole canvas, softening every glyph.
   */
  private devicePixels?: [number, number];
  /** The element's CSS width when the device-pixel box was reported. */
  private devicePixelsCss = 0;
  /** The WebGL context is lost: no frames until the browser restores it. */
  private contextLost = false;
  /**
   * The GPU context generation, unique across canvases: a new one when this canvas is made and when its WebGL context
   * is restored. Every GPU object made under another one (Image caches, picture caches that may replay them, kept
   * composite surfaces, effect textures; also those a control brought from another canvas) is remade at its next draw
   * (DrawnUi.Rust Gpu::epoch). A texture of another WebGL context draws nothing.
   */
  GpuEpoch = Canvas.NextGpuEpoch();
  private static gpuEpochs = 0;
  private static NextGpuEpoch(): number { return ++Canvas.gpuEpochs; }

  /** `init` runs before the first frame is drawn: the place to attach `WillFirstTimeDraw` / `WasDrawn` for that frame. */
  constructor(readonly Element: HTMLCanvasElement, init?: (canvas: Canvas) => void) {
    if (!Super.CK) throw new Error("DrawnUi: call Super.UseDrawnUi()...BuildAsync() before creating a Canvas");
    init?.(this);
    if (typeof window.matchMedia === "function") {
      this.themeQuery = window.matchMedia("(prefers-color-scheme: dark)");
      this.themeQuery.addEventListener?.("change", this.onThemeQuery);
      this.onThemeQuery();
    }
    Element.addEventListener("webglcontextlost", this.onContextLost);
    Element.addEventListener("webglcontextrestored", this.onContextRestored);
    window.addEventListener("blur", this.onWindowInactive);
    window.addEventListener("focus", this.onWindowActive);
    this.Hover.RootAt = (x, y) => this.popupLayer?.At(x, y) ?? this.content;
    this.observer = new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1];
      const box = entry?.devicePixelContentBoxSize?.[0];
      if (box) { this.devicePixels = [box.inlineSize, box.blockSize]; this.devicePixelsCss = entry.contentBoxSize?.[0]?.inlineSize ?? entry.contentRect.width; }
      this.OnResized();
    });
    // browsers without the device-pixel box (Safari) take the rounded size
    try { this.observer.observe(Element, { box: "device-pixel-content-box" }); } catch { this.observer.observe(Element); }
    this.OnResized();
  }

  /** Request a redraw (full measure + arrange + render) on the next animation frame. */
  Update(): void {
    if (this.frameId || !this.surface || this.disposed || this.contextLost) return;
    const surface = this.surface;
    this.frameId = surface.requestAnimationFrame((c) => {
      this.frameId = 0;
      if (this.surface === surface && !this.disposed) this.DrawGuarded(c, surface);
    });
  }

  /** Deletes the current surface; a pending frame on it is cancelled first (drawing on a deleted surface faults). */
  private ReleaseSurface(): void {
    if (this.frameId) { cancelAnimationFrame(this.frameId); this.frameId = 0; }
    // dispose, not delete: a software surface owns pixels CanvasKit allocated for it, which delete() leaves behind
    this.surface?.dispose();
    this.surface = undefined;
  }

  /** On-screen surface at the element's current pixel size, reusing the GL/GrContext when accelerated. */
  private CreateSurface(w: number, h: number): Surface | undefined {
    const CK = Super.CK;
    if (this.RenderingMode === "Accelerated") {
      if (!this.grContext) {
        this.glHandle = Canvas.WithoutPolygonMode(() => CK.GetWebGLContext(this.Element));
        this.grContext = (this.glHandle ? CK.MakeWebGLContext(this.glHandle) : null) ?? undefined;
      }
      if (this.grContext) {
        const gl = CK.MakeOnScreenGLSurface(this.grContext, w, h, CK.ColorSpace.SRGB);
        if (gl) return gl;
      }
    }
    return CK.MakeSWCanvasSurface(this.Element) ?? undefined;
  }

  /**
   * Resize = the browser wipes the bitmap when width/height change, so the new frame is drawn
   * SYNCHRONOUSLY here. ResizeObserver callbacks run after layout and before paint, so the
   * redrawn content lands in the same paint and no blank frame is ever shown while dragging.
   */
  private OnResized(): void {
    let dpr = window.devicePixelRatio || 1;
    // the device-pixel box can disagree with devicePixelRatio (DPR emulation in DevTools or Playwright, some zoom cases):
    // past 2% the scale follows the box, so the layout keeps the element's CSS size (DrawnUi.Rust e7ff239)
    if (this.devicePixels && this.devicePixelsCss > 0) {
      const boxScale = this.devicePixels[0] / this.devicePixelsCss;
      if (Math.abs(boxScale - dpr) > dpr * 0.02) dpr = boxScale;
    }
    const w = Math.max(1, this.devicePixels?.[0] ?? Math.round(this.Element.clientWidth * dpr));
    const h = Math.max(1, this.devicePixels?.[1] ?? Math.round(this.Element.clientHeight * dpr));
    if (this.surface && this.Element.width === w && this.Element.height === h && this.RenderingScale === dpr) return;
    this.RenderingScale = dpr;
    this.Element.width = w;
    this.Element.height = h;
    if (this.contextLost) return; // the restore makes the surface at this size
    this.ReleaseSurface();
    this.surface = this.CreateSurface(w, h);
    if (!this.surface) throw new Error("DrawnUi: cannot create surface");
    this.DrawNow();
  }

  /**
   * Registers the WebGL context without `WEBGL_polygon_mode` (drawnui-cross 6bt): Emscripten turns on every extension it
   * knows while it registers a context, nothing here draws with that one, and WebKit warns "non-portable extension
   * enabled" for it. The lookup is hidden only for this synchronous call (creating the context here first would change
   * the attributes CanvasKit asks for).
   */
  private static WithoutPolygonMode<T>(make: () => T): T {
    type GetExtension = (this: unknown, name: string) => unknown;
    const prototypes = [globalThis.WebGL2RenderingContext?.prototype, globalThis.WebGLRenderingContext?.prototype]
      .filter((p): p is WebGL2RenderingContext & WebGLRenderingContext => !!p) as unknown as { getExtension: GetExtension }[];
    const originals = prototypes.map((p) => p.getExtension);
    prototypes.forEach((p, i) => { p.getExtension = function (name: string) { return name === "WEBGL_polygon_mode" ? null : originals[i].call(this, name); }; });
    try { return make(); } finally { prototypes.forEach((p, i) => { p.getExtension = originals[i]; }); }
  }

  /**
   * WebGL context lost: keep the browser restoring it (preventDefault) and stop the frames. The old Skia context is
   * abandoned here, while the context is lost: WebGL ignores every call on a lost context without a word, so the GL
   * deletes Skia makes while it lets go of its objects stay silent (done after the restore, they reach the new
   * generation and every one logs "object does not belong to this context"). CanvasKit has no `abandonContext`;
   * `releaseResourcesAndAbandonContext` is its only way, and after it freeing an old image or surface makes no GL call.
   */
  private readonly onContextLost = (e: Event) => {
    e.preventDefault();
    this.contextLost = true;
    if (this.frameId) { cancelAnimationFrame(this.frameId); this.frameId = 0; }
    if (this.grContext) this.grContext.releaseResourcesAndAbandonContext();
    this.surface?.dispose();
    this.surface = undefined;
    this.grContext?.delete();
    this.grContext = undefined;
  };

  /**
   * WebGL context restored (as DrawnUi.Rust and the C# Wasm / Blazor heads): every GL object of the lost generation is
   * gone, and the old Skia context was abandoned when it was lost. The same WebGL object is registered again (the old
   * handle deleted first, which clears the canvas' context object) with a new GrContext and surface; GpuEpoch makes the
   * old generation's GPU objects remake themselves.
   */
  private readonly onContextRestored = () => {
    if (this.disposed) return;
    if (this.grContext) this.grContext.releaseResourcesAndAbandonContext(); // lost before this Canvas listened
    this.surface?.dispose();
    this.surface = undefined;
    this.grContext?.delete();
    this.grContext = undefined;
    if (this.glHandle) { Super.CK.deleteContext(this.glHandle); this.glHandle = undefined; }
    this.contextLost = false;
    this.GpuEpoch = Canvas.NextGpuEpoch();
    this.surface = this.CreateSurface(this.Element.width, this.Element.height);
    this.DrawNow();
  };

  /** Draws one frame immediately (outside the rAF loop) and presents it. */
  private DrawNow(): void {
    const surface = this.surface;
    if (!surface || this.disposed || this.contextLost) return;
    this.DrawGuarded(surface.getCanvas(), surface);
  }

  private Draw(canvas: import("canvaskit-wasm").Canvas): void {
    const started = performance.now();
    this.ProcessPendingGestures();
    this.ProcessTextSelectionFrame();
    // Animators run on the frame's vsync time (inside a rAF callback document.timeline.currentTime is the frame
    // timestamp), not on when this callback happened to start: callback starts drift by several ms around vsync
    // (measured 12..23 ms between frames shown 16.7 ms apart), and a game loop moving by speed * delta then
    // jumps unevenly on screen.
    const frameTime = Number(document.timeline?.currentTime ?? started);
    this.FrameTimeNanos = Math.round(frameTime * 1_000_000);
    const executed = this.ExecuteAnimators(Math.round(frameTime * 1_000_000));
    const canRender = this.CanRender;
    if (canRender && !this.WasRendered && this.WillFirstTimeDraw) Canvas.Guard("WillFirstTimeDraw", this.WillFirstTimeDraw, () => this.WillFirstTimeDraw!(this, { Canvas: canvas, Surface: this.surface }));
    canvas.clear(Super.ParseColor(this.BackgroundColor));
    const root = this.content;
    if (root) {
      const scale = this.RenderingScale;
      const w = this.Element.width, h = this.Element.height;
      root.Measure(w, h, scale);
      root.Arrange(new SKRect(0, 0, w, h), root.WidthRequest, root.HeightRequest, scale);
      root.Render({ Context: { Canvas: canvas, Surface: this.surface }, Destination: new SKRect(0, 0, w, h), Scale: scale });
    }
    // popup windows, then the tooltip, over everything
    const top = { Context: { Canvas: canvas, Surface: this.surface }, Destination: new SKRect(0, 0, this.Element.width, this.Element.height), Scale: this.RenderingScale };
    if (this.popupLayer?.HasAny) this.popupLayer.Draw(top, top.Destination);
    this.tooltipController?.Draw(top, top.Destination);
    this.AccessibilityManager.OnFrameEnd(this.RenderingScale, this.Element.width, this.Element.height, () => this.Update());
    TextInputProxy.AfterFrame(this);
    this.Hover.AfterFrame(this.content, this.activeTouchIds.size > 0);
    if (this.Hover.Paused) this.tooltipController?.Reset(); // content moves under the pointer
    const now = performance.now();
    this.FrameTime = now - started;
    this.FrameIndex++;
    this.frameTimes.push(now);
    while (this.frameTimes.length && this.frameTimes[0] < now - 1000) this.frameTimes.shift();
    this.FPS = this.frameTimes.length;
    this.ForgetGoneControls();
    if (executed > 0) this.Update(); // animators running: keep frames coming
    // C# order: WasDrawn at the end of the frame, then the frame counts as rendered
    if (this.WasDrawn) Canvas.Guard("WasDrawn", this.WasDrawn, () => this.WasDrawn!(this));
    const listeners = this.wasDrawnListeners;
    if (listeners !== undefined && listeners.size > 0) listeners.forEach(this.raiseWasDrawn);
    if (!this.WasRendered && canRender) this.WasRendered = true;
  }

  // ---- deferred disposal (DrawnUi DisposeObject: never delete Skia objects mid-frame) ----

  private readonly disposeQueue: { Dispose(): void }[] = [];

  /** Queues a cache for deletion after the current frame has been flushed. */
  DisposeObject(obj: { Dispose(): void }): void { this.disposeQueue.push(obj); }

  private DrainDisposeQueue(): void {
    if (this.disposeQueue.length === 0) return;
    for (const o of this.disposeQueue) o.Dispose();
    this.disposeQueue.length = 0;
  }

  // ---- animators (DrawnView.AnimatingControls) ----

  readonly AnimatingControls = new Map<number, AnimatorBase>();

  RegisterAnimator(animator: AnimatorBase): boolean {
    if (this.disposed) return false;
    this.AnimatingControls.set(animator.Uid, animator);
    return true;
  }

  UnregisterAnimator(uid: number): void { this.AnimatingControls.delete(uid); }

  /**
   * `root` leaves this canvas (removed from its parent, replaced as content, disposed): what runs for its subtree stops,
   * as DrawnUi.Rust 44c718f. Its animators leave the frame loop: disposed, they stop; only removed, they pause and wait on
   * their control (PendingUnattachedAnimators), going on from there when it is arranged on a canvas again. A focused editor in it loses the
   * focus, a game in it stops getting keys (CanvasLeaveWatchers). Runs once per removal, never per frame.
   */
  ControlLeft(root: SkiaControl, disposed: boolean): void {
    const inside = (c: SkiaControl) => { for (let p: SkiaControl | undefined = c; p; p = p.Parent) if (p === root) return true; return false; };
    for (const a of this.AnimatingControls.values()) {
      const control = a.Parent;
      if (!control || !inside(control)) continue;
      this.AnimatingControls.delete(a.Uid);
      if (disposed || control.IsDisposed) a.Stop();
      else {
        // paused as a hidden control's animator is: the time off the canvas is not counted when it goes on
        if (!a.IsPaused) { a.Pause(); a.PausedWhileHidden = true; }
        if (!control.PendingUnattachedAnimators?.includes(a)) (control.PendingUnattachedAnimators ??= []).push(a);
      }
    }
    for (const c of [...CanvasLeaveWatchers]) if (inside(c)) c.OnLeftCanvas();
  }

  private static readonly reportedAnimators = new WeakSet<AnimatorBase>();
  /** An animator's callback threw: logged once for that animator, the frame goes on. */
  /**
   * One exception never stops the frame loop (drawnui-cross 6ch, DrawnUi.Net 3db4eba3): app code the frame runs (a
   * listener, a gesture handler) is called through this; a throw is logged once per source and the frame goes on.
   */
  private static Guard<T>(what: string, source: object, call: () => T): T | undefined {
    try { return call(); } catch (e) {
      if (!Canvas.reportedSources.has(source)) { Canvas.reportedSources.add(source); console.error(`DrawnUi: ${what} threw; the frame goes on`, e); }
      return undefined;
    }
  }
  private static readonly reportedSources = new WeakSet<object>();

  /**
   * Draws a frame and always shows it: a throw inside it (app drawing code) is logged once, the canvas state is reset and
   * the frame loop goes on (a running animation or game keeps asking for frames).
   */
  private DrawGuarded(canvas: import("canvaskit-wasm").Canvas, surface: Surface): void {
    try { this.Draw(canvas); } catch (e) {
      canvas.restoreToCount(1);
      if (!Canvas.reportedFrameError) { Canvas.reportedFrameError = true; console.error("DrawnUi: drawing a frame threw; the next frames go on", e); }
      if (this.AnimatingControls.size > 0) this.Update();
    } finally {
      surface.flush();
      this.DrainDisposeQueue();
    }
  }
  private static reportedFrameError = false;

  private static ReportAnimatorError(a: AnimatorBase, e: unknown): void {
    if (Canvas.reportedAnimators.has(a)) return;
    Canvas.reportedAnimators.add(a);
    console.error("DrawnUi: an animator's callback threw; the other animators and the frame go on", e);
  }

  /** Ticks every registered animator once; returns how many ran. */
  protected ExecuteAnimators(frameTimeNanos: number): number {
    let executed = 0, wake = Infinity;
    for (const a of [...this.AnimatingControls.values()]) {
      if (!a.Parent) { this.AnimatingControls.delete(a.Uid); continue; }
      // the control or a parent is hidden: its animator pauses, no frames, and goes on from where it was when shown
      if (a.Parent.HiddenInTree()) { if (!a.IsPaused) { a.Pause(); a.PausedWhileHidden = true; } continue; }
      if (a.PausedWhileHidden) { a.PausedWhileHidden = false; a.Resume(); }
      if (a.IsPaused) continue; // a paused animator neither ticks nor keeps frames coming (C# DrawnView)
      if (a.SleepUntilNanos > frameTimeNanos) { wake = Math.min(wake, a.SleepUntilNanos); continue; } // nothing changes yet
      // one animator whose callback throws must not stop the others or the frame (DrawnUi.Net catches the pass, Super.Log)
      try { a.TickFrame(frameTimeNanos); } catch (e) { Canvas.ReportAnimatorError(a, e); }
      executed++;
      if (a.SleepUntilNanos > frameTimeNanos) wake = Math.min(wake, a.SleepUntilNanos);
    }
    this.WakeAt(wake, frameTimeNanos);
    return executed;
  }

  private wakeTimer = 0;
  private wakeAtNanos = Infinity;
  /** One timer for the earliest sleeping animator: the frame loop wakes then, no frames run in between. */
  private WakeAt(nanos: number, nowNanos: number): void {
    if (!isFinite(nanos)) return;
    if (this.wakeTimer && this.wakeAtNanos <= nanos) return;
    if (this.wakeTimer) clearTimeout(this.wakeTimer);
    this.wakeAtNanos = nanos;
    this.wakeTimer = window.setTimeout(() => { this.wakeTimer = 0; this.wakeAtNanos = Infinity; this.Update(); }, Math.max(0, (nanos - nowNanos) / 1_000_000));
  }

  /** Frames drawn so far (SkiaBackdrop uses it to refresh once after a cached record). */
  FrameIndex = 0;
  /**
   * DrawnView.WheelDeltaPerNotch: the Wheel.Delta one mouse-wheel notch produces, 100 CSS pixels in Chrome and Edge. A
   * scroll moves by the event's share of a notch, so a touchpad, which sends many small events, scrolls as far as the
   * fingers moved. 0 = units unknown: every event scrolls one line.
   */
  WheelDeltaPerNotch = 100;
  /** Vsync time of the last frame the animators ran on (nanoseconds, the performance.now() timeline). */
  FrameTimeNanos = 0;

  /** On-screen surface (SkiaBackdrop snapshots it). */
  get Surface(): Surface | undefined { return this.surface; }

  /**
   * A picture of what is on screen right now, as PNG bytes (C# DrawnView.TakeScreenShot).
   *
   * The on-screen canvas cannot simply be read: an accelerated surface lives in a WebGL drawing
   * buffer the browser clears after compositing, so both `canvas.toDataURL()` and a snapshot of
   * the live surface come back blank. The content is therefore drawn once more into an offscreen
   * RASTER surface, which can be read back anywhere.
   *
   * This is a still picture, not a frame of the loop: animators are not ticked and the frame
   * counters do not move, so taking one never changes what the next real frame shows.
   */
  TakeScreenShot(): Uint8Array | null {
    const CK = Super.CK;
    const w = this.Element.width, h = this.Element.height;
    if (!CK || !w || !h) return null;
    const surface = CK.MakeSurface(w, h);
    if (!surface) return null;
    try {
      const canvas = surface.getCanvas();
      canvas.clear(Super.ParseColor(this.BackgroundColor));
      const root = this.content;
      if (root) {
        const scale = this.RenderingScale;
        root.Measure(w, h, scale);
        root.Arrange(new SKRect(0, 0, w, h), root.WidthRequest, root.HeightRequest, scale);
        root.Render({ Context: { Canvas: canvas, Surface: surface }, Destination: new SKRect(0, 0, w, h), Scale: scale });
      }
      surface.flush();
      const image = surface.makeImageSnapshot();
      if (!image) return null;
      try { return image.encodeToBytes(); } finally { image.delete(); }
    } finally {
      surface.dispose(); // its pixels too (CK.MakeSurface allocates them)
    }
  }

  Dispose(): void {
    this.disposed = true;
    if (this.wakeTimer) { clearTimeout(this.wakeTimer); this.wakeTimer = 0; }
    this.Element.removeEventListener("webglcontextlost", this.onContextLost);
    this.Element.removeEventListener("webglcontextrestored", this.onContextRestored);
    this.themeQuery?.removeEventListener?.("change", this.onThemeQuery);
    this.SystemThemeChanged = undefined;
    window.removeEventListener("blur", this.onWindowInactive);
    window.removeEventListener("focus", this.onWindowActive);
    this.WindowActiveChanged.clear();
    this.Gestures = "Disabled";
    this.ArrowsStartKeyboardNavigation = false;
    this.tooltipController?.Dispose();
    this.popupLayer?.Dispose();
    this.HookPopupKeys(false);
    this.observer.disconnect();
    this.content?.Dispose();
    this.Content = undefined;
    this.DrainDisposeQueue(); // what the last frames handed over for deletion goes while the context lives
    this.ReleaseSurface();
    // GPU objects that outlive this canvas (a control the app keeps and shows on another canvas) are freed later, under
    // another WebGL context: the abandoned Skia context makes no GL call when they go (as DrawnUi.Net Cells 81b89f1a)
    if (this.grContext && !this.contextLost) this.grContext.releaseResourcesAndAbandonContext();
    this.grContext?.delete();
    this.grContext = undefined;
    if (this.glHandle) { Super.CK.deleteContext(this.glHandle); this.glHandle = undefined; }
  }

  // ---- gestures: raw pointer -> TouchActionEventArgs -> recognized SkiaGesturesParameters -> queue ----

  private gestures: GesturesMode = "Disabled";
  get Gestures(): GesturesMode { return this.gestures; }
  set Gestures(value: GesturesMode) {
    if (this.gestures === value) return;
    if (this.gestures !== "Disabled") this.DetachInput();
    this.gestures = value;
    if (value !== "Disabled") this.AttachInput();
  }

  private readonly activeTouchIds = new Set<number>();
  private readonly pointerDownArgs = new Map<number, TouchActionEventArgs>();
  private readonly previousTouchArgs = new Map<number, TouchActionEventArgs>();
  private readonly pendingGestures: SkiaGesturesParameters[] = [];

  // ---- page text selection with the mouse, as in browsers (port of C# DrawnView.TextSelection, drawnui-cross 6cc) ----
  // A main-button drag that starts on no interactive control selects the selectable labels (AccessibilityTextSelectable)
  // it crosses, in reading order, the first and last partly. Idle cost: one check per gesture and per frame.
  private textDrag?: { Labels: SelectableLabel[]; StartLabel: SelectableLabel; StartIndex: number; Scroll?: ScrollLike; X: number; Y: number; Moved: boolean };
  private readonly pageSelection: SelectableLabel[] = [];
  private pageSelectionKeys = false;

  /**
   * The text selected on the page: the labels a mouse drag selected, joined with new lines, in page order; else the
   * selection of the label in focus. Empty when nothing is selected.
   */
  get SelectedText(): string {
    if (this.pageSelection.length > 0) return this.pageSelection.map((l) => l.SelectedText).filter((t) => t).join("\n");
    return (this.focusedChild as SelectableLabel | undefined)?.SelectedText ?? "";
  }
  /** True while a mouse drag selection holds page text: the page, not a label, owns Ctrl+C. */
  get OwnsTextSelectionKeys(): boolean { return this.pageSelection.some((l) => l.SelectionLength > 0); }
  /** Puts SelectedText on the clipboard through Super.SetClipboardText. False when nothing is selected. */
  CopyTextSelection(): boolean {
    const text = this.SelectedText;
    if (!text) return false;
    Super.SetClipboardText(text);
    return true;
  }
  /** Drops the page text selection (every label a drag selected) and the selection of the label in focus. */
  ClearTextSelection(): void {
    for (const label of this.pageSelection) label.ClearSelection();
    this.pageSelection.length = 0;
    (this.focusedChild as SelectableLabel | undefined)?.ClearSelection?.();
    this.AttachPageSelectionKeys(false);
  }

  /**
   * Before a gesture goes to the controls: a mouse drag that is selecting text keeps its moves (a scroll under it does
   * not scroll), a main-button press drops the previous page selection. True when the gesture was used here.
   */
  private PreviewTextSelectionGesture(args: SkiaGesturesParameters): boolean {
    const mouseMain = args.Event.Pointer?.DeviceType === "Mouse" && args.Event.Pointer.Button === "Left";
    const drag = this.textDrag;
    if (args.Type === "Down" && mouseMain) {
      this.textDrag = undefined;
      // a press on an open popup window (the menu that copies the selection) keeps it, as browsers keep a selection
      // while their context menu is used
      const onPopup = this.popups.HasInteractive && !!this.popups.At(args.Event.Location.X, args.Event.Location.Y);
      if (this.pageSelection.length > 0 && !onPopup) this.ClearTextSelection();
    } else if (args.Type === "Panning" && drag) {
      drag.X = args.Event.Location.X; drag.Y = args.Event.Location.Y; drag.Moved = true;
      this.UpdateTextDrag(drag);
      this.Update();
      return true;
    } else if (args.Type === "Up" && drag) {
      if (drag.Moved) this.UpdateTextDrag(drag);
      this.textDrag = undefined;
    }
    return false;
  }

  /**
   * After a mouse main-button press went to the controls: when it landed on no interactive control (empty space, a
   * scroll's empty area, a selectable label), a drag from here selects text. Not inside a scroll that holds no
   * selectable text: that one keeps scrolling by mouse drag.
   */
  private AfterTextSelectionDown(args: SkiaGesturesParameters, consumed: SkiaControl | null): void {
    if (args.Type !== "Down" || args.Event.Pointer?.DeviceType !== "Mouse" || args.Event.Pointer.Button !== "Left") return;
    if (consumed && !IsScroll(consumed) && !IsSelectableLabel(consumed)) return;
    if (consumed && IsScroll(consumed) && consumed.ScrollBarOwnsGesture) return; // a press on the scroll bar drags the bar
    const collected: SelectableLabel[] = [];
    if (this.content) CollectSelectable(this.content, collected);
    if (collected.length === 0) return;
    const labels = ReadingOrder(collected);
    const x = args.Event.Location.X, y = args.Event.Location.Y;
    const scroll = (consumed && IsScroll(consumed) ? consumed : undefined) ?? ScrollOf(consumed ?? undefined) ?? ScrollAt(labels, x, y);
    if (scroll && !labels.some((l) => IsInside(l, scroll))) return;
    const [label, index] = Locate(labels, x, y);
    if (!label) return;
    this.textDrag = { Labels: labels, StartLabel: label, StartIndex: index, Scroll: scroll, X: x, Y: y, Moved: false };
  }

  /** Frame start: while a drag holds the pointer past a scroll's top or bottom edge, the scroll follows it. */
  private ProcessTextSelectionFrame(): void {
    const drag = this.textDrag;
    if (!drag?.Scroll || !drag.Moved) return;
    const view = drag.Scroll.GetAccessibilityPixelRect();
    if (view.Width <= 0 || view.Height <= 0) return;
    const past = drag.Y > view.Bottom ? drag.Y - view.Bottom : drag.Y < view.Top ? drag.Y - view.Top : 0;
    if (past === 0) return;
    // faster the farther past the edge, as browsers do
    const step = Math.min(Math.max(Math.abs(past) * 0.25, 2), 40) / this.RenderingScale * Math.sign(past);
    drag.Scroll.ScrollTo(drag.Scroll.ViewportOffsetX, drag.Scroll.ViewportOffsetY - step, 0, true);
    this.UpdateTextDrag(drag);
    this.Update();
  }

  private UpdateTextDrag(drag: NonNullable<Canvas["textDrag"]>): void {
    const [endLabel, endIndex] = Locate(drag.Labels, drag.X, drag.Y);
    if (!endLabel) return;
    const a = drag.Labels.indexOf(drag.StartLabel), b = drag.Labels.indexOf(endLabel);
    if (a < 0 || b < 0) return;
    const [fromLabel, fromIndex, toLabel, toIndex] = a < b || (a === b && drag.StartIndex <= endIndex)
      ? [a, drag.StartIndex, b, endIndex] : [b, endIndex, a, drag.StartIndex];
    for (const label of this.pageSelection) {
      const at = drag.Labels.indexOf(label);
      if (at < fromLabel || at > toLabel) label.ClearSelection();
    }
    this.pageSelection.length = 0;
    for (let i = fromLabel; i <= toLabel; i++) {
      const label = drag.Labels[i];
      const start = i === fromLabel ? fromIndex : 0, end = i === toLabel ? toIndex : label.SelectableLength;
      label.Select(start, Math.max(0, end - start));
      this.pageSelection.push(label);
    }
    this.AttachPageSelectionKeys(this.OwnsTextSelectionKeys);
  }

  private AttachPageSelectionKeys(attach: boolean): void {
    if (attach === this.pageSelectionKeys) return;
    this.pageSelectionKeys = attach;
    if (attach) KeyboardManager.Subscribe(this.onPageSelectionKey, Canvas.noChar); else KeyboardManager.Unsubscribe(this.onPageSelectionKey, Canvas.noChar);
  }
  private static readonly noChar = () => {};
  private readonly onPageSelectionKey = (key: InputKey, e: KeyboardEvent) => {
    // Esc keeps the selection, as in browsers: a click elsewhere drops it
    if (KeyboardManager.IsOwnedByElement(e) || !KeyboardManager.IsControlPressed) return;
    if (key === "KeyC") this.CopyTextSelection();
    else if (key === "KeyA" && IsSelectableLabel(this.focusedChild)) {
      // as for one label: Ctrl+A selects all of the label in focus
      e.preventDefault();
      const focused = this.focusedChild as SelectableLabel;
      for (const label of this.pageSelection) label.ClearSelection();
      this.pageSelection.length = 0;
      this.AttachPageSelectionKeys(false);
      focused.SelectAll();
    }
  };

  private readonly onPointer = (e: PointerEvent) => {
    const type: TouchActionType | undefined =
      e.type === "pointerdown" ? "Pressed" :
      e.type === "pointermove" ? "Moved" :
      e.type === "pointerup" ? "Released" :
      e.type === "pointercancel" ? "Cancelled" : undefined;
    if (!type) return;
    if (type === "Moved" && !this.activeTouchIds.has(e.pointerId)) {
      if (e.pointerType === "touch") return; // touch never hovers
      const hx = e.offsetX * this.RenderingScale, hy = e.offsetY * this.RenderingScale;
      if (this.activeTouchIds.size === 0) {
        this.Hover.Move(this.content, hx, hy);
        this.tooltip.OnPointerMove(this.Hover.Path, hx, hy);
      }
      if (this.popups.HasAny) this.popups.PointerAt(hx, hy);
      if (e.pointerType === "mouse") this.UpdateCursor();
      return;
    }
    if ((type === "Released" || type === "Cancelled") && !this.activeTouchIds.has(e.pointerId)) return; // Up of a pointer that never pressed here
    // Capture so Up outside the element still arrives; throws for synthetic events (tests) — harmless.
    if (type === "Pressed") this.tooltip.CloseOnInput();
    if (type === "Pressed") { try { this.Element.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ } }

    const rect = this.Element.getBoundingClientRect();
    const args = new TouchActionEventArgs();
    args.Id = e.pointerId;
    args.Type = type;
    args.Scale = this.RenderingScale;
    args.Location = new SKPoint((e.clientX - rect.left) * this.RenderingScale, (e.clientY - rect.top) * this.RenderingScale);
    // every mouse button is delivered with its PointerData (AppoMobi.Gestures): a right click is a Down / Up / Tapped
    // with Button "Right" for games and custom controls, and a ContextMenu on top
    const pd = new PointerData();
    pd.Button = e.button === 0 ? "Left" : e.button === 1 ? "Middle" : e.button === 2 ? "Right" : e.button === 3 ? "XButton1" : e.button === 4 ? "XButton2" : "Extended";
    pd.ButtonNumber = e.button === 1 ? 3 : e.button === 2 ? 2 : e.button + 1;
    pd.DeviceType = e.pointerType === "touch" ? "Touch" : e.pointerType === "pen" ? "Pen" : "Mouse";
    pd.PressedButtons = e.buttons;
    args.Pointer = pd;
    this.OnTouchAction(args);
    if (type === "Released" || type === "Cancelled") { this.claimedTouches.delete(e.pointerId); this.UpdateTouchAction(); }
    // a click on the focused field gives its input DOM focus again (desktop typing and IME); on touch that is done in the
    // touchend (onTouchEnd), the only event iOS opens the soft keyboard from
    if (type === "Released" && e.pointerType === "mouse") TextInputProxy.FocusFromTap(e.clientX, e.clientY);
    // the touch taps the browser delivered, for a double tap whose second tap it kept (onDoubleClick)
    if (type === "Released" && e.pointerType !== "mouse" && !this.replayingTap) { this.touchUps.push(performance.now()); if (this.touchUps.length > 2) this.touchUps.shift(); }
  };
  /** The mouse left the canvas: hover ends at once, also while content moves. */
  private readonly onPointerLeave = (e: PointerEvent) => {
    if (e.pointerType === "touch") return;
    this.Hover.Leave();
    this.tooltip.Reset();
    if (this.popups.HasAny) this.popups.PointerAt(undefined, undefined);
  };
  private readonly preventTouch = (e: TouchEvent) => e.preventDefault();

  // ---- the on-screen keyboard (C# DrawnView.Keyboard, drawnui-cross 6cj: SkiaScroll.AdaptToKeyboardAuto, off by default) ----
  /** Points of this canvas, up from its bottom, that the on-screen keyboard covers (0 when none). */
  KeyboardCovered = 0;
  private keyboardScroll?: KeyboardScroll;
  private readonly onViewportResize = () => this.ApplyKeyboard();
  /**
   * Measures the part the keyboard covers (the visual viewport shrinks when it opens) and, when the focused text field sits
   * in a scroll with AdaptToKeyboardAuto, hands that scroll the field and the covered height; the scroll it adapted lets go
   * when the keyboard closes or the field moves to another scroll. Runs on viewport resizes and focus changes only.
   */
  private ApplyKeyboard(): void {
    const vv = typeof window !== "undefined" ? window.visualViewport : undefined;
    if (!vv) return;
    const layoutH = window.innerHeight, visibleBottom = vv.offsetTop + vv.height;
    // a keyboard shrinks the visual viewport against the layout viewport (a page zoom scales it instead)
    const keyboard = layoutH - vv.height > 80 && Math.abs((vv.scale ?? 1) - 1) < 0.01;
    const b = this.Element.getBoundingClientRect();
    const covered = keyboard ? Math.max(0, Math.min(b.bottom, layoutH) - visibleBottom) : 0;
    this.KeyboardCovered = covered;
    let scroll: KeyboardScroll | undefined;
    const field = this.focusedChild as (SkiaControl & { IsFocused?: boolean; CursorPosition?: number }) | undefined;
    if (covered > 0 && field?.IsFocused && field.CursorPosition !== undefined) {
      for (let p = field.Parent; p && !scroll; p = p.Parent) if ((p as unknown as Partial<KeyboardScroll>).AdaptToKeyboardAuto) scroll = p as unknown as KeyboardScroll;
      if (scroll) { scroll.AdaptToKeyboardFor = field; scroll.AdaptToKeyboardSize = covered; }
    }
    // keyboard up, no focused field (between two fields): the adapted scroll keeps its room
    if (covered > 0 && !scroll) return;
    if (this.keyboardScroll && this.keyboardScroll !== scroll) { this.keyboardScroll.AdaptToKeyboardFor = undefined; this.keyboardScroll.AdaptToKeyboardSize = 0; }
    this.keyboardScroll = scroll;
  }
  /** When the last touch releases came (ms), at most two. */
  private readonly touchUps: number[] = [];
  private replayingTap = false;
  /**
   * iOS Safari (measured on an iPhone, iOS 26.6.1) takes the second tap of a double tap for itself: it sends no pointer or
   * touch event for it, only click, click and dblclick. A dblclick that follows ONE touch release (the other browsers
   * deliver both taps first) brings that tap back as a touch tap at its place, so a double tap reaches the controls (a 3D
   * viewer's reset).
   */
  private readonly onDoubleClick = (e: MouseEvent) => {
    const now = performance.now(), recent = this.touchUps.filter((t) => now - t < 700);
    this.touchUps.length = 0;
    if (recent.length !== 1) return;
    const pointerId = 2_000_000 + Math.floor(now);
    const at = { clientX: e.clientX, clientY: e.clientY, pointerId, pointerType: "touch", button: 0, isTrusted: true };
    this.replayingTap = true;
    try {
      this.onPointer({ ...at, type: "pointerdown", buttons: 1 } as unknown as PointerEvent);
      this.onPointer({ ...at, type: "pointerup", buttons: 0 } as unknown as PointerEvent);
    } finally { this.replayingTap = false; }
  };
  /**
   * The end of a touch is the user gesture iOS opens the soft keyboard from (a focus() in pointerup does not open it): the
   * press's gestures run now, inside it, so a field they focus focuses its input here, and a tap on the focused field gives
   * its input focus again.
   */
  /** A finger or a pen is down on the canvas: a text field focused now takes its input focus in the touchend (onTouchEnd). */
  get TouchPressed(): boolean {
    for (const a of this.pointerDownArgs.values()) if (a.Pointer && a.Pointer.DeviceType !== "Mouse") return true;
    return false;
  }
  private readonly onTouchEnd = (e: TouchEvent) => {
    TextInputProxy.TouchGesture = true;
    try { this.ProcessPendingGestures(); } finally { TextInputProxy.TouchGesture = false; }
    const t = e.changedTouches[0];
    // the input has focus now: no compatibility mouse events or click follow, whose focus would go to the canvas host
    // and take the keyboard away again
    if (t && TextInputProxy.FocusFromTap(t.clientX, t.clientY, true) && e.cancelable) e.preventDefault();
    TextInputProxy.AfterTouchEnd();
  };
  /** Gestures="Enabled": touch / pen pointers whose Down a control used (see OnTouchAction). */
  private readonly claimedTouches = new Set<number>();
  /** Gestures="Enabled": while a claimed touch is down the page may not take its drag. */
  private readonly preventClaimedTouch = (e: TouchEvent) => { if (this.claimedTouches.size > 0 && e.cancelable) e.preventDefault(); };

  /** Called when no control handled a context-menu request; return true to suppress the browser's canvas menu. */
  ContextMenu?: (sender: Canvas, e: ContextMenuEventArgs) => boolean | void;

  /** DOM contextmenu (right click / long press / Menu key) -> ContextMenuEventArgs routed through the tree like a tap. */
  private readonly onContextMenu = (e: MouseEvent) => {
    const pointerType = (e as PointerEvent).pointerType;
    const source: ContextMenuSource = pointerType === "touch" || pointerType === "pen" ? "touch" : pointerType === "mouse" || e.button === 2 ? "mouse" : "keyboard";
    // a long press: the browser's own contextmenu (Android Chrome) or the press's long press raises it, once (6cb); a
    // browser menu that comes first runs the long press before it (the word under the finger is selected first, C#
    // SkipRepeatedTouchContextMenu)
    if (source === "touch") this.LongPressNow((e as PointerEvent).pointerId);
    // the press the menu comes from first, in the order it happened (the browser sends contextmenu at the press on macOS
    // and Linux, after the release on Windows): processed later, its press would close a menu that opens now
    else this.ProcessPendingGestures();
    const handled = source === "touch" ? this.RaiseTouchContextMenu(e.clientX, e.clientY, e) : this.RaiseContextMenu(e.clientX, e.clientY, source, e);
    if (handled) e.preventDefault();
    // a menu opened while the button is still down: the rest of that press goes nowhere (its release would tap the item
    // under it)
    if (source !== "touch" && this.activeTouchIds.size > 0 && this.popups.HasInteractive) this.popups.SwallowPress = true;
  };

  /** A context-menu request at a point of the page (client CSS px), routed through the tree like a tap; true when one took it. */
  private RaiseContextMenu(clientX: number, clientY: number, source: ContextMenuSource, native: MouseEvent): boolean {
    const rect = this.Element.getBoundingClientRect();
    const scale = this.RenderingScale;
    const x = clientX - rect.left, y = clientY - rect.top;
    const args = new ContextMenuEventArgs(new SKPoint(x, y), new SKPoint(x * scale, y * scale), source, native);
    this.tooltip.CloseOnInput();
    // over a popup window its content is asked; elsewhere the popups close and the request goes on, so a new menu can
    // open there (C# PopupLayer ContextMenu)
    const popupRoot = this.popups.HasInteractive ? this.popups.At(args.Pixels.X, args.Pixels.Y) : undefined;
    if (popupRoot) { popupRoot.ProcessContextMenu(args.Pixels, args); return true; }
    if (this.popups.HasInteractive) { this.popups.CloseAll(false); this.AfterPopupsChanged(); }
    let handled = this.content?.ProcessContextMenu(args.Pixels, args) ?? false;
    if (!handled && this.ContextMenu) handled = this.ContextMenu(this, args) === true;
    return handled;
  }

  // ---- a long press on touch raises the context menu (drawnui-cross 6cb) ----
  /** The touch or pen press going on: its context menu is raised once, by the browser's contextmenu or after its long press. */
  private touchMenu?: { Raised: boolean; Handled: boolean };
  /** The long press of a touch press was just queued: its context menu follows the LongPressing (client CSS px). */
  private touchMenuDue?: { X: number; Y: number };
  /** A touch or pen press starts (on the canvas, or on selectable text of the overlay): its context menu is still to come. */
  StartTouchPress(): void { this.touchMenu = { Raised: false, Handled: false }; }
  /**
   * The context menu of the touch press now (Source "touch"), raised once per press whoever asks first: the browser's own
   * contextmenu (Android Chrome fires one on a long press) or the press's long press (iOS Safari fires none). True when a
   * handler took it: the browser's own menu is then suppressed where it can be.
   */
  RaiseTouchContextMenu(clientX: number, clientY: number, native?: MouseEvent): boolean {
    const press = this.touchMenu ??= { Raised: false, Handled: false };
    if (press.Raised) return press.Handled;
    press.Raised = true;
    press.Handled = this.RaiseContextMenu(clientX, clientY, "touch", native ?? new MouseEvent("contextmenu", { clientX, clientY }));
    // the app showed its own menu: the drawn Copy button of a touch text selection steps aside, the selection stays
    if (press.Handled) (this.focusedChild as SelectableLabel | undefined)?.HideCopyButton?.();
    return press.Handled;
  }

  /**
   * The Menu key, Shift+F10 or a screen reader's context-menu command on the control in keyboard focus (the DOM
   * `contextmenu` of its overlay node): its context menu opens at its center, from it or the first control above it with
   * a ContextMenu handler, then the Canvas' own (Source "keyboard", as every DrawnUI engine). True when one took it.
   */
  OpenContextMenuFromKeyboard(control: SkiaControl, native: MouseEvent): boolean {
    const r = control.GetAccessibilityPixelRect(), scale = this.RenderingScale;
    const pixels = new SKPoint((r.Left + r.Right) / 2, (r.Top + r.Bottom) / 2);
    const args = new ContextMenuEventArgs(new SKPoint(pixels.X / scale, pixels.Y / scale), pixels, "keyboard", native);
    this.tooltip.CloseOnInput();
    for (let c: SkiaControl | undefined = control; c; c = c.Parent) {
      if (!c.ContextMenu) continue;
      args.Control = c;
      args.Local = new SKPoint(pixels.X - c.DrawingRect.Left, pixels.Y - c.DrawingRect.Top);
      if (c.ContextMenu(c, args) === true) return true;
    }
    args.Control = undefined;
    return !!this.ContextMenu && this.ContextMenu(this, args) === true;
  }

  private cursorPointer = false;
  /**
   * DrawnUi.Blazor shows `cursor: pointer` over interactive controls through its overlay elements; here the overlay
   * is pointer-events:none, so the canvas decides from the hover hit path (Hover.Path: the controls under the mouse by
   * the routing rules of ProcessGestures, so nothing below a popup that blocks gestures below): a control in the
   * accessibility tree (it has a role) that answers WantsPointerCursor (itself tappable, or a tappable span of a label)
   * shows the hand. A popup's close-on-background-tap wrapper has no role, so its backdrop shows none. The canvas
   * element's cursor is switched only when the answer changes. Mouse moves only, none in the frame loop.
   */
  private UpdateCursor(): void {
    let hit = false;
    const path = this.Hover.Path, xs = this.Hover.PathX, ys = this.Hover.PathY;
    for (let i = path.length - 1; i >= 0 && !hit; i--) {
      const c = path[i];
      if (c.IsAccessibilityElement && c.WantsPointerCursor(xs[i] - c.DrawingRect.Left, ys[i] - c.DrawingRect.Top)) hit = true;
    }
    if (hit !== this.cursorPointer) { this.cursorPointer = hit; this.Element.style.cursor = hit ? "pointer" : ""; }
  }

  /**
   * Mouse wheel -> TouchActionResult.Wheel.
   * Lock keeps every wheel on the canvas. Enabled shares it with the page, like DrawnUi.Blazor's
   * TouchHandlingStyle.Manual: the page scrolls unless a control consumed this wheel. The browser needs that answer
   * inside this handler, so the wheel is processed now instead of at the next frame (Blazor does the same, for the
   * same reason); pending gestures are flushed first so the event order is kept.
   */
  private readonly onWheel = (e: WheelEvent) => {
    const rect = this.Element.getBoundingClientRect();
    const args = new TouchActionEventArgs();
    args.Id = -1;
    args.Type = "Wheel";
    args.Scale = this.RenderingScale;
    args.Location = new SKPoint((e.clientX - rect.left) * this.RenderingScale, (e.clientY - rect.top) * this.RenderingScale);
    args.StartingLocation = args.Location;
    // lines and pages to pixels, then the dominant axis (the .NET browser heads, fc8980c1); a vertical scroll leaves
    // horizontal events alone (C# ba03cb20)
    const factor = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? 800 : 1;
    const horizontal = Math.abs(e.deltaX) > Math.abs(e.deltaY);
    // IsZoom: Ctrl / Cmd + wheel, or a touchpad pinch (browsers send it as a Ctrl wheel), as AppoMobi WheelEventArgs.IsZoom
    args.Wheel = { Delta: (horizontal ? e.deltaX : e.deltaY) * factor, IsHorizontal: horizontal, IsZoom: e.ctrlKey || e.metaKey };
    this.tooltip.CloseOnInput();
    if (this.gestures === "Lock") {
      e.preventDefault();
      this.OnGestureEvent(args, "Wheel");
      return;
    }
    if (this.ProcessGestureNow(args, "Wheel")) e.preventDefault();
  };

  /**
   * Processes one gesture immediately (after whatever is queued) and reports whether a control USED it: a consumer
   * that marked the event Handled, or any consumer that is not a `BlockGesturesBelow` layer. A blocker returns itself
   * for every gesture it keeps from the controls below (a shell page, a popup backdrop), which is not a use: counting
   * it would block the page wheel over every shell app.
   */
  private ProcessGestureNow(args: TouchActionEventArgs, result: TouchActionResult): boolean {
    this.ProcessPendingGestures();
    const root = this.content;
    const gesture = SkiaGesturesParameters.Create(result, args);
    const consumed = root ? Canvas.Guard("a gesture handler", root, () => this.ProcessGestures(root, gesture)) ?? null : null;
    this.Update();
    return !!consumed && (args.Handled || !consumed.BlockGesturesBelow);
  }

  /**
   * The page axes a touch pan over the canvas hands to the browser: "pan-y" when the page (or a scrolling ancestor) can
   * scroll vertically, "pan-x" horizontally, both, or "none". Mirrors MAUI's Gestures="Enabled" inside a native scroll
   * view, where the parent takes the pans it scrolls in.
   */
  private static PageScrollAxes(el: HTMLElement): string {
    const scrolls = (v: string) => v === "auto" || v === "scroll" || v === "overlay";
    const clips = (v: string) => v === "hidden" || v === "clip";
    let x = false, y = false;
    for (let n = el.parentElement; n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
      const st = getComputedStyle(n);
      if (!y && scrolls(st.overflowY) && n.scrollHeight > n.clientHeight + 1) y = true;
      if (!x && scrolls(st.overflowX) && n.scrollWidth > n.clientWidth + 1) x = true;
    }
    // the viewport scrolls unless html or body clips it
    const root = document.scrollingElement ?? document.documentElement;
    const hs = getComputedStyle(document.documentElement), bs = getComputedStyle(document.body);
    if (!y && !clips(hs.overflowY) && !clips(bs.overflowY) && root.scrollHeight > root.clientHeight + 1) y = true;
    if (!x && !clips(hs.overflowX) && !clips(bs.overflowX) && root.scrollWidth > root.clientWidth + 1) x = true;
    // a canvas filling a framed document (a widget in an iframe): the page that scrolls is the parent, which a
    // cross-origin frame cannot inspect, so assume it scrolls vertically; horizontal pans and taps stay on the canvas
    if (!y && window.self !== window.top) y = true;
    return x && y ? "pan-x pan-y" : y ? "pan-y" : x ? "pan-x" : "none";
  }

  /**
   * Gestures="Enabled" shares touch pans with the page like MAUI's Enabled inside a native scroll view: along an axis
   * the page can scroll, the browser takes the pan (and sends pointercancel), taps and the other axis stay on the
   * canvas. A page that cannot scroll, and Lock, keep every touch. The browser reads touch-action when a touch starts,
   * so it is kept current ahead of time: on attach, when the window / html / body resize, and after every touch.
   */
  private readonly UpdateTouchAction = (): void => {
    if (this.gestures === "Disabled") return;
    const pan = this.gestures === "Enabled" ? Canvas.PageScrollAxes(this.Element) : "none";
    if (this.Element.style.touchAction !== pan) this.Element.style.touchAction = pan;
  };
  private pageObserver?: ResizeObserver;

  private AttachInput(): void {
    const el = this.Element;
    this.UpdateTouchAction();
    window.addEventListener("resize", this.UpdateTouchAction);
    this.pageObserver = new ResizeObserver(this.UpdateTouchAction);
    this.pageObserver.observe(document.documentElement);
    this.pageObserver.observe(document.body);
    el.style.userSelect = "none";
    for (const t of ["pointerdown", "pointermove", "pointerup", "pointercancel"]) el.addEventListener(t, this.onPointer as EventListener);
    el.addEventListener("pointerleave", this.onPointerLeave);
    el.addEventListener("contextmenu", this.onContextMenu);
    el.addEventListener("touchend", this.onTouchEnd);
    el.addEventListener("dblclick", this.onDoubleClick);
    window.visualViewport?.addEventListener("resize", this.onViewportResize);
    el.addEventListener("wheel", this.onWheel, { passive: false });
    window.addEventListener("blur", this.onWindowBlur);
    if (this.gestures === "Lock") {
      el.addEventListener("touchmove", this.preventTouch, { passive: false });
      // the canvas owns every touch (DrawnUi.Web applyGestureStyle, DrawnUi.Rust host): no iOS callout or text
      // selection on a long press, and no rubber band / pull-down of the page starting on it
      const st = el.style as CSSStyleDeclaration & { webkitUserSelect: string; webkitTouchCallout: string };
      st.webkitUserSelect = "none"; st.webkitTouchCallout = "none";
      this.pageOverscroll = [document.documentElement.style.overscrollBehavior, document.body.style.overscrollBehavior];
      document.documentElement.style.overscrollBehavior = "none";
      document.body.style.overscrollBehavior = "none";
    } else if (this.gestures === "Enabled") el.addEventListener("touchmove", this.preventClaimedTouch, { passive: false });
  }
  /** The page's own overscroll-behavior before Lock set it to none (html, body), put back on detach. */
  private pageOverscroll?: [string, string];

  private DetachInput(): void {
    const el = this.Element;
    el.style.touchAction = "";
    window.removeEventListener("resize", this.UpdateTouchAction);
    this.pageObserver?.disconnect();
    this.pageObserver = undefined;
    el.style.userSelect = "";
    for (const t of ["pointerdown", "pointermove", "pointerup", "pointercancel"]) el.removeEventListener(t, this.onPointer as EventListener);
    el.removeEventListener("pointerleave", this.onPointerLeave);
    el.removeEventListener("contextmenu", this.onContextMenu);
    el.removeEventListener("touchend", this.onTouchEnd);
    el.removeEventListener("dblclick", this.onDoubleClick);
    window.visualViewport?.removeEventListener("resize", this.onViewportResize);
    this.textDrag = undefined;
    el.removeEventListener("wheel", this.onWheel);
    window.removeEventListener("blur", this.onWindowBlur);
    el.removeEventListener("touchmove", this.preventTouch);
    el.removeEventListener("touchmove", this.preventClaimedTouch);
    if (this.pageOverscroll) {
      const st = el.style as CSSStyleDeclaration & { webkitUserSelect: string; webkitTouchCallout: string };
      st.webkitUserSelect = ""; st.webkitTouchCallout = "";
      [document.documentElement.style.overscrollBehavior, document.body.style.overscrollBehavior] = this.pageOverscroll;
      this.pageOverscroll = undefined;
    }
    this.claimedTouches.clear();
    for (const id of [...this.longPressTimers.keys()]) this.DisarmLongPress(id);
    this.longPressed.clear();
    this.activeTouchIds.clear(); this.pointerDownArgs.clear(); this.previousTouchArgs.clear(); this.fingers.Reset();
  }

  /** Port of DrawnUi.Blazor Canvas.OnTouchAction: per-pointer state machine producing Down / Panning / Tapped / Up. */
  OnTouchAction(args: TouchActionEventArgs): void {
    if (this.gestures === "Disabled") return;
    const id = args.Id;

    if (args.Type === "Pressed") {
      if (args.Pointer && args.Pointer.DeviceType !== "Mouse" && this.activeTouchIds.size === 0) this.StartTouchPress();
      this.ArmLongPress(id, args);
      // the fingers for pinch and turn: the first restarts them, a second one makes the press no tap
      if (this.activeTouchIds.size === 0) { this.fingers.Restart(id, args.Location); this.multiTouch = false; }
      else {
        for (const [other, last] of this.previousTouchArgs) this.fingers.AddMovement(other, last.Location); // their latest places
        this.fingers.AddMovement(id, args.Location);
        this.multiTouch = true;
      }
      this.activeTouchIds.add(id);
      args.NumberOfTouches = this.activeTouchIds.size;
      args.StartingLocation = args.Location;
      args.IsInContact = true;
      this.pointerDownArgs.set(id, args);
      this.previousTouchArgs.set(id, args);
      // Gestures="Enabled", touch or pen: page scrolling was left to touch-action alone, and iOS Safari still takes an
      // off-axis drag from the page axis (pointercancel mid-gesture, w3c/pointerevents#303). So the Down is processed
      // now, like the wheel (queued gestures first, same "used" rule): when a control used it the touch is claimed and
      // its touchmoves are default-prevented until it ends. It is not queued as well, so it is processed exactly once and
      // the Panning / Up that follow keep their order. An unclaimed touch shares the page as before.
      if (this.gestures === "Enabled" && args.Pointer && args.Pointer.DeviceType !== "Mouse") {
        if (this.ProcessGestureNow(args, "Down")) this.claimedTouches.add(id);
        return;
      }
      this.OnGestureEvent(args, "Down");
      return;
    }

    args.NumberOfTouches = this.activeTouchIds.size;
    TouchActionEventArgs.FillDistanceInfo(args, this.previousTouchArgs.get(id));
    const downArgs = this.pointerDownArgs.get(id);
    args.StartingLocation = downArgs ? downArgs.StartingLocation : args.Location;

    if (args.Type === "Moved") {
      if (this.activeTouchIds.size > 1) args.Manipulation = this.fingers.AddMovement(id, args.Location); // nothing for one finger
      const threshold = Canvas.TappedCancelMoveThresholdPoints * Math.max(0.1, this.RenderingScale);
      if (Math.abs(args.Distance.Total.X) >= threshold || Math.abs(args.Distance.Total.Y) >= threshold) this.DisarmLongPress(id);
      if (args.Distance.Delta.X !== 0 || args.Distance.Delta.Y !== 0) this.OnGestureEvent(args, "Panning");
      this.previousTouchArgs.set(id, args);
      return;
    }

    if (args.Type === "Released" || args.Type === "Cancelled") {
      args.IsInContact = args.NumberOfTouches > 1;
      const longPressed = this.longPressed.delete(id);
      this.DisarmLongPress(id);
      if (!args.IsInContact && downArgs && args.Type === "Released" && !longPressed && !this.multiTouch) {
        const threshold = Canvas.TappedCancelMoveThresholdPoints * Math.max(0.1, this.RenderingScale);
        if (Math.abs(args.Distance.Total.X) < threshold && Math.abs(args.Distance.Total.Y) < threshold) this.OnGestureEvent(args, "Tapped");
      }
      this.OnGestureEvent(args, "Up");
      this.previousTouchArgs.delete(id);
      this.pointerDownArgs.delete(id);
      this.activeTouchIds.delete(id);
      if (this.activeTouchIds.size === 0) this.fingers.Reset(); else this.fingers.Lifted(id);
    }
  }

  /** The fingers down, for TouchActionEventArgs.Manipulation (pinch and turn). */
  private readonly fingers = new MultitouchTracker();
  /** The press had a second finger: it is no tap (AppoMobi.Blazor.Gestures). */
  private multiTouch = false;

  private readonly longPressTimers = new Map<number, number>();
  private readonly longPressed = new Set<number>();

  /** The long press of a new press: due LongPressTimeMs later unless the pointer moves away or lets go. */
  private ArmLongPress(id: number, down: TouchActionEventArgs): void {
    this.DisarmLongPress(id);
    this.longPressed.delete(id);
    this.longPressTimers.set(id, window.setTimeout(() => {
      this.longPressTimers.delete(id);
      if (!this.activeTouchIds.has(id)) return;
      this.longPressed.add(id);
      const args = new TouchActionEventArgs();
      Object.assign(args, down);
      args.Location = down.StartingLocation ?? down.Location;
      this.OnGestureEvent(args, "LongPressing");
      // on touch the context menu follows the long press (6cb), at the press point
      if (down.Pointer && down.Pointer.DeviceType !== "Mouse") {
        const rect = this.Element.getBoundingClientRect(), scale = Math.max(0.1, this.RenderingScale);
        this.touchMenuDue = { X: rect.left + args.Location.X / scale, Y: rect.top + args.Location.Y / scale };
      }
    }, Canvas.LongPressTimeMs));
  }

  /** The long press of a held touch, now (the browser's context menu came first): queued gestures first, then it; its timer is off. */
  private LongPressNow(pointerId: number): void {
    const id = this.longPressTimers.has(pointerId) ? pointerId : [...this.longPressTimers.keys()][0];
    const down = id === undefined ? undefined : this.pointerDownArgs.get(id);
    if (id === undefined || !down || !this.activeTouchIds.has(id)) return;
    this.DisarmLongPress(id);
    this.longPressed.add(id);
    const args = new TouchActionEventArgs();
    Object.assign(args, down);
    args.Location = down.StartingLocation ?? down.Location;
    this.ProcessGestureNow(args, "LongPressing");
  }

  private DisarmLongPress(id: number): void {
    const t = this.longPressTimers.get(id);
    if (t) { clearTimeout(t); this.longPressTimers.delete(id); }
  }

  private OnGestureEvent(args: TouchActionEventArgs, result: TouchActionResult): void {
    this.pendingGestures.push(SkiaGesturesParameters.Create(result, args));
    this.Update();
  }

  private ProcessPendingGestures(): void {
    if (this.pendingGestures.length === 0) return;
    const batch = this.pendingGestures.splice(0);
    const root = this.content;
    if (!root) return;
    for (const args of batch) Canvas.Guard("a gesture handler", root, () => this.ProcessGestures(root, args));
    const due = this.touchMenuDue;
    if (due) { this.touchMenuDue = undefined; this.RaiseTouchContextMenu(due.X, due.Y); }
  }

  /**
   * The control that consumed the current gesture keeps it until it lets go (DrawnUi Canvas.HadInput). Without this a
   * gesture is re-routed by the pointer position on every event, so anything the finger drags away from — a drag
   * handle, a slider thumb, a button being held — stops receiving Panning the moment the pointer leaves its box.
   * Single pointer, which is what the web gives us here; C# keeps a set for multi-touch.
   */
  private gestureOwner: SkiaControl | null = null;

  /** DrawnUi IsSavedGesture: the types replayed to the owner instead of being routed again. */
  private static IsSavedGesture(type: SkiaGesturesParameters["Type"]): boolean {
    return type === "Panning" || type === "Wheel" || type === "Up";
  }

  // ---- arrows start keyboard navigation (C# 6aee5c51) ----
  private arrowsStart = false;
  /**
   * While no drawn control has keyboard focus (or only one behind the active modal), the arrow keys start keyboard
   * navigation as the first Tab does: Down and Right go to the first Tab stop, Up and Left to the last, and the key is used
   * for that. Once a control has focus the arrows work as usual (inside a list or a menu). Off by default, since games use
   * the arrows as their own keys while nothing is focused: an app turns it on for its menu screens and off while playing.
   */
  get ArrowsStartKeyboardNavigation(): boolean { return this.arrowsStart; }
  set ArrowsStartKeyboardNavigation(v: boolean) {
    if (this.arrowsStart === v) return;
    this.arrowsStart = v;
    if (v) KeyboardManager.SubscribeNavigation(this.onArrowKey); else KeyboardManager.UnsubscribeNavigation(this.onArrowKey);
  }
  private readonly onArrowKey = (key: InputKey, e: KeyboardEvent): boolean => {
    const forward = key === "ArrowDown" || key === "ArrowRight" ? true : key === "ArrowUp" || key === "ArrowLeft" ? false : undefined;
    // a page element, a drawn control's element or the editor's input has the keys: nothing to start
    if (forward === undefined || this.disposed || KeyboardManager.IsOwnedByElement(e) || e.defaultPrevented) return false;
    const mgr = this.AccessibilityManager, focused = mgr.FocusedNode;
    if (focused && !mgr.IsOutsideModal(focused)) return false;
    const first = mgr.NextTabStop(undefined, forward);
    if (!first) return false;
    e.preventDefault();
    mgr.RequestKeyboardFocus(first);
    this.Update();
    return true;
  };

  // ---- focus (C# DrawnView FocusedChild / ReportFocus, drawnui-cross 6ap) ----
  private focusedChild?: SkiaControl;
  private focusAtDown?: SkiaControl;
  private tapNoFocus = false;
  private reportingFocus = false;

  /**
   * A control that left the canvas (removed or disposed) is let go by the focus, the gesture dispatch and the tooltips,
   * so the last control that took input does not keep its page alive (C# 4cb28ab6). Checked once per frame.
   */
  private ForgetGoneControls(): void {
    const gone = (c: SkiaControl | null | undefined) => !!c && (c.IsDisposed || c.Superview !== this);
    if (gone(this.focusedChild)) this.focusedChild = undefined;
    if (gone(this.focusAtDown)) this.focusAtDown = undefined;
    if (gone(this.gestureOwner)) this.gestureOwner = null;
    this.tooltipController?.ForgetGone(gone);
  }

  /** The control that has the canvas focus (an editor while it edits, a CanBeFocused control that was tapped). */
  get FocusedChild(): SkiaControl | undefined { return this.focusedChild; }

  /**
   * Moves the focus. The new control is asked first and the focus moves only when it takes it (a tap on a button leaves an
   * editor focused); undefined clears it. Nothing moves while the focused control has LockFocus. `setter` is a control
   * that focused itself already (an editor on its press) or the focused control letting go itself (Escape, submit).
   */
  ReportFocus(value: SkiaControl | undefined, setter?: SkiaControl): void {
    if (value === this.focusedChild || this.reportingFocus) return;
    if (this.focusedChild?.LockFocus && setter !== this.focusedChild) return;
    this.reportingFocus = true;
    try {
      if (value && value !== setter && !value.SetFrameworkFocus(true)) return;
      const previous = this.focusedChild;
      this.focusedChild = value;
      if (previous && !previous.IsDisposed) previous.SetFrameworkFocus(false);
      // the keyboard is up: the newly focused field goes above it too
      if (this.KeyboardCovered > 0) setTimeout(() => this.ApplyKeyboard(), 50);
    } finally { this.reportingFocus = false; }
  }

  /** Entry into the control tree; on a completed tap the focus follows it (C# Canvas: focus only on Tapped). */
  protected ProcessGestures(root: SkiaControl, args: SkiaGesturesParameters): SkiaControl | null {
    if (args.Type === "Down") { this.focusAtDown = this.focusedChild; this.tapNoFocus = false; }
    // a mouse drag selecting page text keeps its moves: no scroll under it scrolls (the pointer is captured, so the
    // moves keep coming once it leaves the canvas and the scroll follows it past its edge)
    if (this.PreviewTextSelectionGesture(args)) return null;
    const consumed = this.RouteGestures(root, args);
    this.AfterTextSelectionDown(args, consumed);
    // a control that claimed the focus during this gesture (an editor on its press) keeps it; a press that closed the
    // popup windows moves nothing
    if (args.Type === "Tapped" && !this.tapNoFocus && this.focusedChild === this.focusAtDown) this.ReportFocus(consumed ?? undefined);
    return consumed;
  }

  /** Same shape as DrawnUi Canvas.ProcessGestures. */
  private RouteGestures(root: SkiaControl, args: SkiaGesturesParameters): SkiaControl | null {
    const info = () => new GestureEventProcessingInfo(args.Event.Location, SKPoint.Empty, SKPoint.Empty, null);
    const popups = this.popups, at = args.Event.Location;

    // the rest of a press that closed the popup windows goes nowhere (native menus)
    if (args.Type === "Down") popups.SwallowPress = false;
    if (popups.SwallowPress) { if (args.Type === "Up") popups.SwallowPress = false; return null; }
    // the wheel outside the popup windows closes them (what they opened from is about to move), before any owner takes it
    if (args.Type === "Wheel" && popups.HasInteractive && !popups.At(at.X, at.Y)) { popups.CloseAll(false); this.AfterPopupsChanged(); }

    // the wheel goes to the press owner only while a press is held; between presses it goes by position, and it
    // never makes an owner: a wheel over a second scroll moves that one, not the last one the wheel moved
    // (DrawnUi.Rust input_router "the wheel goes to the owner of the press first"; C# keeps the last wheel consumer)
    const wheel = args.Type === "Wheel";
    if (args.Type === "Down") this.gestureOwner = null;
    else if (this.gestureOwner && Canvas.IsSavedGesture(args.Type) && (!wheel || this.activeTouchIds.size > 0)) {
      const owner = this.gestureOwner;
      const alive = !!owner.Superview && owner.IsVisible && !owner.InputTransparent;
      const consumed = alive ? owner.OnSkiaGestureEvent(args, info()) : null;
      if (consumed) {
        // it still wants the gesture: nobody else sees this one (C# skips the tree pass for a saved gesture)
        if (!wheel) this.gestureOwner = args.Type === "Up" ? null : consumed;
        return consumed;
      }
      // it let go (a button whose press turned into a pan): route normally again; a wheel it does not use goes by
      // position and leaves it the press
      if (!wheel) this.gestureOwner = null;
    }

    // over a popup window its controls take the gesture and nothing below sees it; a press elsewhere closes them
    if (popups.HasInteractive) {
      const popupRoot = popups.At(at.X, at.Y);
      if (popupRoot) {
        const used = popupRoot.ProcessGestures(args, info()) ?? popupRoot;
        if (!wheel) this.gestureOwner = args.Type !== "Up" ? used : null;
        return used;
      }
      if (args.Type === "Down") {
        this.tapNoFocus = true;
        popups.CloseAll(false);
        popups.SwallowPress = true;
        this.AfterPopupsChanged();
        return null;
      }
    }

    const consumed = root.ProcessGestures(args, info());
    // a mouse move never makes an owner (DrawnUi.Net 62608ca7): a focused field takes every hover, and as the owner it
    // would get the next release of a press that began elsewhere
    if (!wheel && args.Type !== "Pointer") this.gestureOwner = consumed && args.Type !== "Up" ? consumed : null;
    return consumed;
  }
}

/** What the page selection needs from a selectable SkiaLabel (core does not import the controls). */
interface SelectableLabel extends SkiaControl {
  readonly SelectedText: string; readonly SelectionLength: number; readonly SelectableLength: number;
  Select(start: number, length: number): void; SelectAll(): void; ClearSelection(): void; HideCopyButton(): void; TextIndexAtCanvas(x: number, y: number): number;
}
interface ScrollLike extends SkiaControl { ViewportOffsetX: number; ViewportOffsetY: number; ScrollBarOwnsGesture?: boolean; ScrollTo(x: number, y: number, secs: number, clamp?: boolean): void }
const IsScroll = (c: SkiaControl | undefined): c is ScrollLike => !!c && "ScrollTo" in c && "ViewportOffsetY" in c;
const IsSelectableLabel = (c: SkiaControl | undefined): c is SelectableLabel => !!c && c.AccessibilityTextSelectable && "TextIndexAtCanvas" in c;

/**
 * Where a canvas point falls in the labels' order: inside a drawn label, its text index there; before a label (above it,
 * or left of it on its line), that label's start; past them all, the end of the last drawn one.
 */
function Locate(labels: SelectableLabel[], x: number, y: number): [SelectableLabel | undefined, number] {
  let last: SelectableLabel | undefined;
  for (const label of labels) {
    const r = label.GetAccessibilityPixelRect();
    if (r.Width <= 0 || r.Height <= 0) continue;
    if (x >= r.Left && x < r.Right && y >= r.Top && y < r.Bottom) return [label, label.TextIndexAtCanvas(x, y)];
    if (y < r.Top || (y <= r.Bottom && x < r.Left)) return [label, 0];
    last = label;
  }
  return last ? [last, last.SelectableLength] : [undefined, 0];
}
/**
 * The labels in reading order, as they are seen (the tree order is not: a page in two columns lists the left column's
 * labels first, and a drag in the right column would then start at a label below it): by top, labels whose tops are within
 * half the smaller height forming one line, read left to right.
 */
function ReadingOrder(labels: SelectableLabel[]): SelectableLabel[] {
  const rects = new Map(labels.map((l) => [l, l.GetAccessibilityPixelRect()]));
  const sorted = [...labels].sort((a, b) => rects.get(a)!.Top - rects.get(b)!.Top || rects.get(a)!.Left - rects.get(b)!.Left);
  for (let start = 0, i = 1; i <= sorted.length; i++) {
    if (i < sorted.length) {
      const first = rects.get(sorted[start])!, next = rects.get(sorted[i])!;
      if (next.Top - first.Top < Math.min(first.Height, next.Height) / 2) continue;
    }
    if (i - start > 1) {
      const line = sorted.slice(start, i).sort((a, b) => rects.get(a)!.Left - rects.get(b)!.Left);
      for (let k = 0; k < line.length; k++) sorted[start + k] = line[k];
    }
    start = i;
  }
  return sorted;
}
function CollectSelectable(control: SkiaControl, into: SelectableLabel[]): void {
  if (!control.IsVisible || control.IsDisposed) return;
  if (IsSelectableLabel(control)) into.push(control);
  const views = "Views" in control ? (control as unknown as { Views: readonly SkiaControl[] }).Views : undefined;
  const content = views ? undefined : (control as unknown as { Content?: SkiaControl }).Content;
  for (const child of views ?? (content ? [content] : [])) CollectSelectable(child, into);
}
function ScrollOf(control: SkiaControl | undefined): ScrollLike | undefined {
  for (let p = control?.Parent; p; p = p.Parent) if (IsScroll(p)) return p;
  return undefined;
}
/** The innermost drawn scroll around a selectable label whose viewport holds the point. */
function ScrollAt(labels: SelectableLabel[], x: number, y: number): ScrollLike | undefined {
  for (const label of labels) {
    for (let p = label.Parent; p; p = p.Parent) {
      if (!IsScroll(p)) continue;
      const r = p.GetAccessibilityPixelRect();
      if (x >= r.Left && x < r.Right && y >= r.Top && y < r.Bottom) return p;
    }
  }
  return undefined;
}
function IsInside(control: SkiaControl, ancestor: SkiaControl): boolean {
  for (let p = control.Parent; p; p = p.Parent) if (p === ancestor) return true;
  return false;
}

/** What the canvas needs from a SkiaScroll to keep a field above the keyboard (core does not import the controls). */
interface KeyboardScroll extends SkiaControl { AdaptToKeyboardAuto: boolean; AdaptToKeyboardFor?: SkiaControl; AdaptToKeyboardSize: number }
