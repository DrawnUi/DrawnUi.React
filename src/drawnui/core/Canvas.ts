import type { Surface } from "canvaskit-wasm";
import type { SkiaControl } from "./SkiaControl";
import { Super } from "./Super";
import { type Color, Colors, type RenderingModeType, SKRect } from "./Types";
import {
  GestureEventProcessingInfo, type GesturesMode, SKPoint, SkiaGesturesParameters, TouchActionEventArgs,
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

  private content?: SkiaControl;
  get Content(): SkiaControl | undefined { return this.content; }
  set Content(value: SkiaControl | undefined) {
    if (this.content) this.content._superview = undefined;
    this.content = value;
    if (value) { value.Parent = undefined; value._superview = this; }
    this.Update();
  }

  private surface?: Surface;
  private frameId = 0;
  private disposed = false;
  private readonly observer: ResizeObserver;

  constructor(readonly Element: HTMLCanvasElement) {
    if (!Super.CK) throw new Error("DrawnUi: call Super.UseDrawnUi()...BuildAsync() before creating a Canvas");
    this.observer = new ResizeObserver(() => this.OnResized());
    this.observer.observe(Element);
    this.OnResized();
  }

  /** Request a redraw (full measure + arrange + render) on the next animation frame. */
  Update(): void {
    if (this.frameId || !this.surface || this.disposed) return;
    const surface = this.surface;
    this.frameId = surface.requestAnimationFrame((c) => {
      this.frameId = 0;
      if (this.surface === surface && !this.disposed) this.Draw(c);
    });
  }

  /** Deletes the current surface; a pending frame on it is cancelled first (drawing on a deleted surface faults). */
  private ReleaseSurface(): void {
    if (this.frameId) { cancelAnimationFrame(this.frameId); this.frameId = 0; }
    this.surface?.delete();
    this.surface = undefined;
  }

  private OnResized(): void {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(this.Element.clientWidth * dpr));
    const h = Math.max(1, Math.round(this.Element.clientHeight * dpr));
    if (this.surface && this.Element.width === w && this.Element.height === h && this.RenderingScale === dpr) return;
    this.RenderingScale = dpr;
    this.Element.width = w;
    this.Element.height = h;
    this.ReleaseSurface();
    this.surface = (this.RenderingMode === "Accelerated"
      ? Super.CK.MakeWebGLCanvasSurface(this.Element)
      : null) ?? Super.CK.MakeSWCanvasSurface(this.Element) ?? undefined;
    if (!this.surface) throw new Error("DrawnUi: cannot create surface");
    this.Update();
  }

  private Draw(canvas: import("canvaskit-wasm").Canvas): void {
    this.ProcessPendingGestures();
    canvas.clear(Super.CK.parseColorString(this.BackgroundColor));
    const root = this.content;
    if (!root) return;
    const scale = this.RenderingScale;
    const w = this.Element.width, h = this.Element.height;
    root.Measure(w, h, scale);
    root.Arrange(new SKRect(0, 0, w, h), root.WidthRequest, root.HeightRequest, scale);
    root.Render({ Context: { Canvas: canvas }, Destination: new SKRect(0, 0, w, h), Scale: scale });
  }

  Dispose(): void {
    this.disposed = true;
    this.Gestures = "Disabled";
    this.observer.disconnect();
    this.Content = undefined;
    this.ReleaseSurface();
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
    if (type === "Moved" && !this.activeTouchIds.has(e.pointerId)) return; // hover not ported (TouchActionResult.Pointer)
    // Capture so Up outside the element still arrives; throws for synthetic events (tests) — harmless.
    if (type === "Pressed") { try { this.Element.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ } }

    const rect = this.Element.getBoundingClientRect();
    const args = new TouchActionEventArgs();
    args.Id = e.pointerId;
    args.Type = type;
    args.Scale = this.RenderingScale;
    args.Location = new SKPoint((e.clientX - rect.left) * this.RenderingScale, (e.clientY - rect.top) * this.RenderingScale);
    this.OnTouchAction(args);
  };
  private readonly preventTouch = (e: TouchEvent) => e.preventDefault();

  private AttachInput(): void {
    const el = this.Element;
    el.style.touchAction = "none";
    el.style.userSelect = "none";
    for (const t of ["pointerdown", "pointermove", "pointerup", "pointercancel"]) el.addEventListener(t, this.onPointer as EventListener);
    if (this.gestures === "Lock") el.addEventListener("touchmove", this.preventTouch, { passive: false });
  }

  private DetachInput(): void {
    const el = this.Element;
    el.style.touchAction = "";
    el.style.userSelect = "";
    for (const t of ["pointerdown", "pointermove", "pointerup", "pointercancel"]) el.removeEventListener(t, this.onPointer as EventListener);
    el.removeEventListener("touchmove", this.preventTouch);
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

  /** Entry into the control tree, same shape as DrawnUi Canvas.ProcessGestures. */
  protected ProcessGestures(root: SkiaControl, args: SkiaGesturesParameters): SkiaControl | null {
    return root.ProcessGestures(args, new GestureEventProcessingInfo(args.Event.Location, SKPoint.Empty, SKPoint.Empty, null));
  }
}
