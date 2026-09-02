import { type DrawingContext, SkiaControl } from "../core/SkiaControl";
import { type LayoutType, SKRect, ScaledSize, Thickness } from "../core/Types";

/**
 * Mirrors DrawnUi SkiaLayout (Absolute / Column / Row).
 * Column/Row give children an infinite main axis (MAUI stack semantics: Fill on the main axis = auto-sized).
 */
export class SkiaLayout extends SkiaControl {
  Type: LayoutType = "Absolute";
  Spacing = 0;
  Padding: Thickness = Thickness.Zero;

  private readonly views: SkiaControl[] = [];
  /** Read-only live children like DrawnUi Views. */
  get Views(): readonly SkiaControl[] { return this.views; }
  /** Settable children list like DrawnUi Children. */
  get Children(): readonly SkiaControl[] { return this.views; }
  set Children(value: readonly SkiaControl[]) {
    for (const v of [...this.views]) this.RemoveSubView(v);
    for (const v of value) this.AddSubView(v);
  }

  AddSubView(control: SkiaControl): void { this.InsertSubView(this.views.length, control); }

  InsertSubView(index: number, control: SkiaControl): void {
    control.Parent = this;
    this.views.splice(index, 0, control);
    this.InvalidateMeasure();
  }

  RemoveSubView(control: SkiaControl): void {
    const i = this.views.indexOf(control);
    if (i < 0) return;
    this.views.splice(i, 1);
    control.Parent = undefined;
    this.InvalidateMeasure();
  }

  protected override MeasureAbsolute(widthConstraint: number, heightConstraint: number, scale: number): ScaledSize {
    const px = this.Padding.HorizontalThickness * scale;
    const py = this.Padding.VerticalThickness * scale;
    const w = widthConstraint - px;
    const h = heightConstraint - py;
    const gap = this.Spacing * scale;
    let cw = 0, ch = 0, n = 0;

    for (const v of this.views) {
      if (!v.IsVisible) continue;
      let s: ScaledSize;
      if (this.Type === "Column") { s = v.Measure(w, Infinity, scale); cw = Math.max(cw, s.Pixels.Width); ch += s.Pixels.Height; }
      else if (this.Type === "Row") { s = v.Measure(Infinity, h, scale); cw += s.Pixels.Width; ch = Math.max(ch, s.Pixels.Height); }
      else { s = v.Measure(w, h, scale); cw = Math.max(cw, s.Pixels.Width); ch = Math.max(ch, s.Pixels.Height); }
      n++;
    }
    const gaps = Math.max(0, n - 1) * gap;
    if (this.Type === "Column") ch += gaps;
    if (this.Type === "Row") cw += gaps;
    return ScaledSize.FromPixels(cw + px, ch + py, scale);
  }

  protected override OnLayoutChanged(): void {
    const scale = this.RenderingScale;
    const p = this.Padding;
    const r = this.DrawingRect;
    const inner = new SKRect(r.Left + p.Left * scale, r.Top + p.Top * scale, r.Right - p.Right * scale, r.Bottom - p.Bottom * scale);
    const gap = this.Spacing * scale;
    let cursor = this.Type === "Row" ? inner.Left : inner.Top;

    for (const v of this.views) {
      if (!v.IsVisible) continue;
      if (this.Type === "Column") {
        const h = v.MeasuredSize.Pixels.Height;
        v.Arrange(new SKRect(inner.Left, cursor, inner.Right, cursor + h), v.WidthRequest, v.HeightRequest, scale);
        cursor += h + gap;
      } else if (this.Type === "Row") {
        const w = v.MeasuredSize.Pixels.Width;
        v.Arrange(new SKRect(cursor, inner.Top, cursor + w, inner.Bottom), v.WidthRequest, v.HeightRequest, scale);
        cursor += w + gap;
      } else {
        v.Arrange(inner, v.WidthRequest, v.HeightRequest, scale);
      }
    }
  }

  protected override Paint(ctx: DrawingContext): void {
    for (const v of this.views) v.Render(ctx);
  }
}

/** SkiaLayout Type=Column + HorizontalOptions=Fill (DrawnUi alias). */
export class SkiaStack extends SkiaLayout {
  constructor() { super(); this.Type = "Column"; this.HorizontalOptions = "Fill"; }
}

/** SkiaLayout Type=Row (DrawnUi alias). */
export class SkiaRow extends SkiaLayout {
  constructor() { super(); this.Type = "Row"; }
}

/** SkiaLayout Type=Absolute + HorizontalOptions=Fill (DrawnUi alias). */
export class SkiaLayer extends SkiaLayout {
  constructor() { super(); this.Type = "Absolute"; this.HorizontalOptions = "Fill"; }
}
