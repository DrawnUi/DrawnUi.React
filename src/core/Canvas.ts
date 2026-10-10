import type { GrDirectContext, Surface, WebGLContextHandle } from "canvaskit-wasm";
import type { CachedObject, DrawingContext, SkiaControl } from "./SkiaControl";
import type { AnimatorBase } from "./Animators";
import { Super } from "./Super";
import { SkiaAccessibilityManager } from "./Accessibility";
import { HoverManager } from "./Hover";
import { type Color, Colors, type RenderingModeType, SKRect } from "./Types";
import {
  ContextMenuEventArgs, type ContextMenuSource,
  GestureEventProcessingInfo, PointerData, type GesturesMode, SKPoint, SkiaGesturesParameters, TouchActionEventArgs,
  type TouchActionResult, type TouchActionType,
} from "./Gestures";

/**
 * Mirrors DrawnUi Canvas (DrawnView): hosts one Content control on an HTML canvas element,
 * owns RenderingScale (devicePixelRatio), the surface, the on-demand frame loop and raw input.
 * Frames are drawn only after Update() (invalidation), never continuously.
 * Gestures are accumulated and processed in order at the START of the next frame, like DrawnUi.
 */
export class Canvas {
  /** Points a pointer may travel between Down and Up and still count as a tap (AppoMobi TouchEffect default). */
  static TappedCancelMoveThresholdPoints = 16;

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
  /** Registry + rate-limited snapshot of accessible controls, rendered by the DOM overlay (DrawnUi AccessibilityManager). */
  readonly AccessibilityManager = new SkiaAccessibilityManager();
  /** Mouse hover of the controls (drawnui-cross 6m): ReceivesHover / IsHovered / HoverChanged. */
  readonly Hover = new HoverManager();

  private content?: SkiaControl;
  get Content(): SkiaControl | undefined { return this.content; }
  set Content(value: SkiaControl | undefined) {
    if (this.content) this.content._superview = undefined;
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
  /** The WebGL context is lost: no frames until the browser restores it. */
  private contextLost = false;
  /**
   * Bumped when the WebGL context was restored: every GPU object made before (Image caches, picture caches that may
   * replay them, kept composite surfaces, effect textures) is remade at its next draw (DrawnUi.Rust Gpu::epoch).
   */
  GpuEpoch = 0;

  /** `init` runs before the first frame is drawn: the place to attach `WillFirstTimeDraw` / `WasDrawn` for that frame. */
  constructor(readonly Element: HTMLCanvasElement, init?: (canvas: Canvas) => void) {
    if (!Super.CK) throw new Error("DrawnUi: call Super.UseDrawnUi()...BuildAsync() before creating a Canvas");
    init?.(this);
    Element.addEventListener("webglcontextlost", this.onContextLost);
    Element.addEventListener("webglcontextrestored", this.onContextRestored);
    this.observer = new ResizeObserver(() => this.OnResized());
    this.observer.observe(Element);
    this.OnResized();
  }

  /** Request a redraw (full measure + arrange + render) on the next animation frame. */
  Update(): void {
    if (this.frameId || !this.surface || this.disposed || this.contextLost) return;
    const surface = this.surface;
    this.frameId = surface.requestAnimationFrame((c) => {
      this.frameId = 0;
      if (this.surface === surface && !this.disposed) { this.Draw(c); surface.flush(); this.DrainDisposeQueue(); }
    });
  }

  /** Deletes the current surface; a pending frame on it is cancelled first (drawing on a deleted surface faults). */
  private ReleaseSurface(): void {
    if (this.frameId) { cancelAnimationFrame(this.frameId); this.frameId = 0; }
    this.surface?.delete();
    this.surface = undefined;
  }

  /** On-screen surface at the element's current pixel size, reusing the GL/GrContext when accelerated. */
  private CreateSurface(w: number, h: number): Surface | undefined {
    const CK = Super.CK;
    if (this.RenderingMode === "Accelerated") {
      if (!this.grContext) {
        this.glHandle = CK.GetWebGLContext(this.Element);
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
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(this.Element.clientWidth * dpr));
    const h = Math.max(1, Math.round(this.Element.clientHeight * dpr));
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

  /** WebGL context lost: keep the browser restoring it (preventDefault) and stop the frames. */
  private readonly onContextLost = (e: Event) => {
    e.preventDefault();
    this.contextLost = true;
    if (this.frameId) { cancelAnimationFrame(this.frameId); this.frameId = 0; }
  };

  /**
   * WebGL context restored (as DrawnUi.Rust and the C# Wasm / Blazor heads): every GL object of the lost generation is
   * gone. The old Skia context is abandoned first, while its own GL handle is current and before the new context makes
   * any object, so its GL calls reach only lost-generation objects. CanvasKit exposes no `abandonContext`;
   * `releaseResourcesAndAbandonContext` is its only way to abandon, and after it freeing an old image or surface makes no
   * GL call. Then the same WebGL object is registered again (the old handle deleted first, which clears the canvas'
   * context object) with a new GrContext and surface; GpuEpoch makes the old generation's GPU objects remake themselves.
   */
  private readonly onContextRestored = () => {
    if (this.disposed) return;
    if (this.grContext) this.grContext.releaseResourcesAndAbandonContext();
    this.surface?.delete();
    this.surface = undefined;
    this.grContext?.delete();
    this.grContext = undefined;
    if (this.glHandle) { Super.CK.deleteContext(this.glHandle); this.glHandle = undefined; }
    this.contextLost = false;
    this.GpuEpoch++;
    this.surface = this.CreateSurface(this.Element.width, this.Element.height);
    this.DrawNow();
  };

  /** Draws one frame immediately (outside the rAF loop) and presents it. */
  private DrawNow(): void {
    const surface = this.surface;
    if (!surface || this.disposed || this.contextLost) return;
    this.Draw(surface.getCanvas());
    surface.flush();
    this.DrainDisposeQueue();
  }

  private Draw(canvas: import("canvaskit-wasm").Canvas): void {
    const started = performance.now();
    this.ProcessPendingGestures();
    // Animators run on the frame's vsync time (inside a rAF callback document.timeline.currentTime is the frame
    // timestamp), not on when this callback happened to start: callback starts drift by several ms around vsync
    // (measured 12..23 ms between frames shown 16.7 ms apart), and a game loop moving by speed * delta then
    // jumps unevenly on screen.
    const frameTime = Number(document.timeline?.currentTime ?? started);
    this.FrameTimeNanos = Math.round(frameTime * 1_000_000);
    const executed = this.ExecuteAnimators(Math.round(frameTime * 1_000_000));
    const canRender = this.CanRender;
    if (canRender && !this.WasRendered) this.WillFirstTimeDraw?.(this, { Canvas: canvas, Surface: this.surface });
    canvas.clear(Super.ParseColor(this.BackgroundColor));
    const root = this.content;
    if (root) {
      const scale = this.RenderingScale;
      const w = this.Element.width, h = this.Element.height;
      root.Measure(w, h, scale);
      root.Arrange(new SKRect(0, 0, w, h), root.WidthRequest, root.HeightRequest, scale);
      root.Render({ Context: { Canvas: canvas, Surface: this.surface }, Destination: new SKRect(0, 0, w, h), Scale: scale });
    }
    this.AccessibilityManager.OnFrameEnd(this.RenderingScale, this.Element.width, this.Element.height, () => this.Update());
    this.Hover.AfterFrame(this.content, this.activeTouchIds.size > 0);
    const now = performance.now();
    this.FrameTime = now - started;
    this.FrameIndex++;
    this.frameTimes.push(now);
    while (this.frameTimes.length && this.frameTimes[0] < now - 1000) this.frameTimes.shift();
    this.FPS = this.frameTimes.length;
    if (executed > 0) this.Update(); // animators running: keep frames coming
    // C# order: WasDrawn at the end of the frame, then the frame counts as rendered
    this.WasDrawn?.(this);
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

  /** Ticks every registered animator once; returns how many ran. */
  protected ExecuteAnimators(frameTimeNanos: number): number {
    let executed = 0;
    for (const a of [...this.AnimatingControls.values()]) {
      if (!a.Parent) { this.AnimatingControls.delete(a.Uid); continue; }
      a.TickFrame(frameTimeNanos);
      executed++;
    }
    return executed;
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
      surface.delete();
    }
  }

  Dispose(): void {
    this.disposed = true;
    this.Element.removeEventListener("webglcontextlost", this.onContextLost);
    this.Element.removeEventListener("webglcontextrestored", this.onContextRestored);
    this.Gestures = "Disabled";
    this.observer.disconnect();
    this.content?.Dispose();
    this.Content = undefined;
    this.ReleaseSurface();
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

  private readonly onPointer = (e: PointerEvent) => {
    const type: TouchActionType | undefined =
      e.type === "pointerdown" ? "Pressed" :
      e.type === "pointermove" ? "Moved" :
      e.type === "pointerup" ? "Released" :
      e.type === "pointercancel" ? "Cancelled" : undefined;
    if (!type) return;
    if (type === "Moved" && !this.activeTouchIds.has(e.pointerId)) {
      if (e.pointerType === "touch") return; // touch never hovers
      if (this.activeTouchIds.size === 0) this.Hover.Move(this.content, e.offsetX * this.RenderingScale, e.offsetY * this.RenderingScale);
      if (e.pointerType === "mouse") this.UpdateCursor();
      return;
    }
    if ((type === "Released" || type === "Cancelled") && !this.activeTouchIds.has(e.pointerId)) return; // Up of a pointer that never pressed here
    // Capture so Up outside the element still arrives; throws for synthetic events (tests) — harmless.
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
  };
  /** The mouse left the canvas: hover ends at once, also while content moves. */
  private readonly onPointerLeave = (e: PointerEvent) => { if (e.pointerType !== "touch") this.Hover.Leave(); };
  private readonly preventTouch = (e: TouchEvent) => e.preventDefault();
  /** Gestures="Enabled": touch / pen pointers whose Down a control used (see OnTouchAction). */
  private readonly claimedTouches = new Set<number>();
  /** Gestures="Enabled": while a claimed touch is down the page may not take its drag. */
  private readonly preventClaimedTouch = (e: TouchEvent) => { if (this.claimedTouches.size > 0 && e.cancelable) e.preventDefault(); };

  /** Called when no control handled a context-menu request; return true to suppress the browser's canvas menu. */
  ContextMenu?: (sender: Canvas, e: ContextMenuEventArgs) => boolean | void;

  /** DOM contextmenu (right click / long press / Menu key) -> ContextMenuEventArgs routed through the tree like a tap. */
  private readonly onContextMenu = (e: MouseEvent) => {
    const rect = this.Element.getBoundingClientRect();
    const scale = this.RenderingScale;
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    const pointerType = (e as PointerEvent).pointerType;
    const source: ContextMenuSource = pointerType === "touch" || pointerType === "pen" ? "touch" : pointerType === "mouse" || e.button === 2 ? "mouse" : "keyboard";
    const args = new ContextMenuEventArgs(new SKPoint(x, y), new SKPoint(x * scale, y * scale), source, e);
    let handled = this.content?.ProcessContextMenu(args.Pixels, args) ?? false;
    if (!handled && this.ContextMenu) handled = this.ContextMenu(this, args) === true;
    if (handled) e.preventDefault();
  };

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
    args.Wheel = { Delta: (horizontal ? e.deltaX : e.deltaY) * factor, IsHorizontal: horizontal };
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
    const consumed = root ? this.ProcessGestures(root, SkiaGesturesParameters.Create(result, args)) : null;
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
    el.addEventListener("wheel", this.onWheel, { passive: false });
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
    el.removeEventListener("wheel", this.onWheel);
    el.removeEventListener("touchmove", this.preventTouch);
    el.removeEventListener("touchmove", this.preventClaimedTouch);
    if (this.pageOverscroll) {
      const st = el.style as CSSStyleDeclaration & { webkitUserSelect: string; webkitTouchCallout: string };
      st.webkitUserSelect = ""; st.webkitTouchCallout = "";
      [document.documentElement.style.overscrollBehavior, document.body.style.overscrollBehavior] = this.pageOverscroll;
      this.pageOverscroll = undefined;
    }
    this.claimedTouches.clear();
    this.activeTouchIds.clear(); this.pointerDownArgs.clear(); this.previousTouchArgs.clear();
  }

  /** Port of DrawnUi.Blazor Canvas.OnTouchAction: per-pointer state machine producing Down / Panning / Tapped / Up. */
  OnTouchAction(args: TouchActionEventArgs): void {
    if (this.gestures === "Disabled") return;
    const id = args.Id;

    if (args.Type === "Pressed") {
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
      if (args.Distance.Delta.X !== 0 || args.Distance.Delta.Y !== 0) this.OnGestureEvent(args, "Panning");
      this.previousTouchArgs.set(id, args);
      return;
    }

    if (args.Type === "Released" || args.Type === "Cancelled") {
      args.IsInContact = args.NumberOfTouches > 1;
      if (!args.IsInContact && downArgs && args.Type === "Released") {
        const threshold = Canvas.TappedCancelMoveThresholdPoints * Math.max(0.1, this.RenderingScale);
        if (Math.abs(args.Distance.Total.X) < threshold && Math.abs(args.Distance.Total.Y) < threshold) this.OnGestureEvent(args, "Tapped");
      }
      this.OnGestureEvent(args, "Up");
      this.previousTouchArgs.delete(id);
      this.pointerDownArgs.delete(id);
      this.activeTouchIds.delete(id);
    }
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
    for (const args of batch) this.ProcessGestures(root, args);
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

  /** Entry into the control tree, same shape as DrawnUi Canvas.ProcessGestures. */
  protected ProcessGestures(root: SkiaControl, args: SkiaGesturesParameters): SkiaControl | null {
    const info = () => new GestureEventProcessingInfo(args.Event.Location, SKPoint.Empty, SKPoint.Empty, null);

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

    const consumed = root.ProcessGestures(args, info());
    if (!wheel) this.gestureOwner = consumed && args.Type !== "Up" ? consumed : null;
    return consumed;
  }
}
