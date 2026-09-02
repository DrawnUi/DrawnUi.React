import type { Font } from "canvaskit-wasm";
import { type DrawingContext, SkiaControl } from "../core/SkiaControl";
import { Super } from "../core/Super";
import { type Color, Colors, ScaledSize } from "../core/Types";

/** Mirrors DrawnUi SkiaLabel: single-line text. Cached as Operations by default, like DrawnUi. */
export class SkiaLabel extends SkiaControl {
  private text = "";
  private fontSize = 14;
  private textColor: Color = Colors.Black;
  private fontFamily = "";

  constructor() {
    super();
    this.UseCache = "Operations";
  }

  // Setting a text property invalidates like a DrawnUi bindable property (cache + measure, bubbling up).
  get Text(): string { return this.text; }
  set Text(v: string) { if (this.text !== v) { this.text = v; this.Update(); } }
  /** Points. */
  get FontSize(): number { return this.fontSize; }
  set FontSize(v: number) { if (this.fontSize !== v) { this.fontSize = v; this.Update(); } }
  get TextColor(): Color { return this.textColor; }
  set TextColor(v: Color) { if (this.textColor !== v) { this.textColor = v; this.Update(); } }
  /** Alias registered via ConfigureFonts; empty = default typeface. */
  get FontFamily(): string { return this.fontFamily; }
  set FontFamily(v: string) { if (this.fontFamily !== v) { this.fontFamily = v; this.Update(); } }

  private font?: Font;
  private fontKey = "";
  private ascent = 0;

  private GetFont(scale: number): Font {
    const key = `${this.FontFamily}|${this.FontSize * scale}`;
    if (this.font && this.fontKey === key) return this.font;
    this.font?.delete();
    this.font = new Super.CK.Font(Super.GetTypeface(this.FontFamily), this.FontSize * scale);
    this.fontKey = key;
    return this.font;
  }

  protected override MeasureAbsolute(_w: number, _h: number, scale: number): ScaledSize {
    const font = this.GetFont(scale);
    const m = font.getMetrics();
    this.ascent = m.ascent; // negative
    const ids = font.getGlyphIDs(this.Text);
    let width = 0;
    for (const adv of font.getGlyphWidths(ids)) width += adv;
    return ScaledSize.FromPixels(width, m.descent - m.ascent, scale);
  }

  protected override Paint(ctx: DrawingContext): void {
    if (!this.Text) return;
    const paint = new Super.CK.Paint();
    paint.setColor(Super.ParseColor(this.TextColor));
    paint.setAntiAlias(true);
    ctx.Context.Canvas.drawText(this.Text, ctx.Destination.Left, ctx.Destination.Top - this.ascent, paint, this.GetFont(ctx.Scale));
    paint.delete();
  }
}
