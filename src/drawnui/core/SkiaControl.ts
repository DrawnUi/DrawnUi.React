import type { Canvas as SkCanvas } from "canvaskit-wasm";
import { Super } from "./Super";
import { type Color, type LayoutOptions, SKRect, ScaledSize, Thickness } from "./Types";
import type { Canvas } from "./Canvas";

/** Mirrors DrawnUi DrawingContext: ctx.Context.Canvas, ctx.Destination (pixels), ctx.Scale. */
export interface DrawingContext {
  Context: { Canvas: SkCanvas };
  Destination: SKRect;
  Scale: number;
}

/**
 * Base of every drawn control. Same contract as DrawnUi SkiaControl:
 * Measure(constraints px, scale) -> MeasuredSize (includes Margin),
 * Arrange(destination px) -> DrawingRect,
 * Render(ctx) -> background + Paint(ctx).
 */
export class SkiaControl {
  // ---- layout properties (points) ----
  HorizontalOptions: LayoutOptions = "Start";
  VerticalOptions: LayoutOptions = "Start";
  /** -1 = auto. */
  WidthRequest = -1;
  HeightRequest = -1;
  Margin: Thickness = Thickness.Zero;
  BackgroundColor?: Color;
  IsVisible = true;
  Tag?: string;

  // ---- tree ----
  Parent?: SkiaControl;
  /** Set by Canvas on its Content. Children resolve through Parent. */
  _superview?: Canvas;
  get Superview(): Canvas | undefined {
    return this.Parent ? this.Parent.Superview : this._superview;
  }

  // ---- state (pixels) ----
  MeasuredSize: ScaledSize = ScaledSize.Default;
  DrawingRect: SKRect = SKRect.Empty;
  RenderingScale = 1;
  NeedMeasure = true;

  /** Public non-virtual entry like DrawnUi: applies Margin/requests, then MeasureAbsolute for content. */
  Measure(widthConstraint: number, heightConstraint: number, scale: number): ScaledSize {
    this.RenderingScale = scale;
    const mx = this.Margin.HorizontalThickness * scale;
    const my = this.Margin.VerticalThickness * scale;

    let w = widthConstraint - mx;
    let h = heightConstraint - my;
    if (this.WidthRequest >= 0) w = this.WidthRequest * scale;
    if (this.HeightRequest >= 0) h = this.HeightRequest * scale;

    const content = this.MeasureAbsolute(w, h, scale);

    let rw = this.WidthRequest >= 0 ? w : this.HorizontalOptions === "Fill" && isFinite(w) ? w : content.Pixels.Width;
    let rh = this.HeightRequest >= 0 ? h : this.VerticalOptions === "Fill" && isFinite(h) ? h : content.Pixels.Height;

    this.MeasuredSize = ScaledSize.FromPixels(rw + mx, rh + my, scale);
    this.NeedMeasure = false;
    return this.MeasuredSize;
  }

  /** Override to measure own content, constraints already exclude Margin. */
  protected MeasureAbsolute(_widthConstraint: number, _heightConstraint: number, scale: number): ScaledSize {
    return ScaledSize.FromPixels(0, 0, scale);
  }

  /** Places MeasuredSize inside destination per Margin + Horizontal/VerticalOptions -> DrawingRect. */
  Arrange(destination: SKRect, _widthRequest: number, _heightRequest: number, scale: number): void {
    const m = this.Margin;
    const availL = destination.Left + m.Left * scale;
    const availT = destination.Top + m.Top * scale;
    const availW = destination.Width - m.HorizontalThickness * scale;
    const availH = destination.Height - m.VerticalThickness * scale;

    const w = this.HorizontalOptions === "Fill" ? availW : Math.min(availW, this.MeasuredSize.Pixels.Width - m.HorizontalThickness * scale);
    const h = this.VerticalOptions === "Fill" ? availH : Math.min(availH, this.MeasuredSize.Pixels.Height - m.VerticalThickness * scale);

    const x = availL + SkiaControl.Align(this.HorizontalOptions, availW, w);
    const y = availT + SkiaControl.Align(this.VerticalOptions, availH, h);
    this.DrawingRect = SKRect.Create(x, y, w, h);
    this.OnLayoutChanged();
  }

  private static Align(o: LayoutOptions, avail: number, size: number): number {
    if (o === "Center") return (avail - size) / 2;
    if (o === "End") return avail - size;
    return 0;
  }

  /** Called after DrawingRect changed; layouts arrange children here. */
  protected OnLayoutChanged(): void {}

  /** Draws background then Paint(). */
  Render(ctx: DrawingContext): void {
    if (!this.IsVisible) return;
    const own: DrawingContext = { ...ctx, Destination: this.DrawingRect };
    if (this.BackgroundColor) {
      const paint = new Super.CK.Paint();
      paint.setColor(Super.CK.parseColorString(this.BackgroundColor));
      const r = this.DrawingRect;
      ctx.Context.Canvas.drawRect(Super.CK.LTRBRect(r.Left, r.Top, r.Right, r.Bottom), paint);
      paint.delete();
    }
    this.Paint(own);
  }

  /** Override to draw own content into ctx.Destination. */
  protected Paint(_ctx: DrawingContext): void {}

  // ---- invalidation (same names as DrawnUi) ----

  /** Content changed: remeasure + redraw. */
  Update(): void {
    this.InvalidateMeasure();
  }

  /** Redraw without remeasure. */
  Repaint(): void {
    this.Superview?.Update();
  }

  InvalidateMeasure(): void {
    this.NeedMeasure = true;
    if (this.Parent) this.Parent.InvalidateMeasure();
    else this.Superview?.Update();
  }
}
