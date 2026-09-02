import type { Font } from "canvaskit-wasm";
import { type DrawingContext, SkiaControl } from "../core/SkiaControl";
import { Super } from "../core/Super";
import { type Color, Colors, ScaledSize } from "../core/Types";

/** Mirrors DrawnUi SkiaLabel: single-line text. */
export class SkiaLabel extends SkiaControl {
  Text = "";
  /** Points. */
  FontSize = 14;
  TextColor: Color = Colors.Black;
  /** Alias registered via ConfigureFonts; empty = default typeface. */
  FontFamily = "";

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
