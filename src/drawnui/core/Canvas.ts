import type { Surface } from "canvaskit-wasm";
import type { SkiaControl } from "./SkiaControl";
import { Super } from "./Super";
import { type Color, Colors, type RenderingModeType, SKRect } from "./Types";

/**
 * Mirrors DrawnUi Canvas (DrawnView): hosts one Content control on an HTML canvas element,
 * owns RenderingScale (devicePixelRatio), the surface and the on-demand frame loop.
 * Frames are drawn only after Update() (invalidation), never continuously.
 */
export class Canvas {
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
    this.observer.disconnect();
    this.Content = undefined;
    this.ReleaseSurface();
  }
}
