import type { Font } from "canvaskit-wasm";
import { type DrawingContext, SkiaControl } from "../core/SkiaControl";
import { Super } from "../core/Super";
import {
  type Color, Colors, type DrawTextAlignment, type FontAttributes, type LineBreakMode, ScaledSize, type TextAlignment,
  type TextTransform, Thickness,
} from "../core/Types";

/** One laid-out line: text and its advance width in pixels. */
interface TextLine { Text: string; Width: number }

/**
 * Mirrors DrawnUi SkiaLabel: multi-line text with word wrapping, MaxLines + tail ellipsis, horizontal /
 * vertical alignment, LineSpacing / LineHeight, weights and attributes resolved through the font registry.
 * Cached as Operations by default, like DrawnUi. Every text property invalidates like a bindable property.
 */
export class SkiaLabel extends SkiaControl {
  private text = "";
  private fontSize = 12;
  private textColor: Color = Colors.GreenYellow;
  private fontFamily = "";
  private fontWeight = 0;
  private fontAttributes: FontAttributes = "None";
  private maxLines = -1;
  private lineBreakMode: LineBreakMode = "TailTruncation";
  private horizontalTextAlignment: DrawTextAlignment = "Start";
  private verticalTextAlignment: TextAlignment = "Start";
  private lineSpacing = 1;
  private lineHeight = 1;
  private textTransform: TextTransform = "None";
  private padding: Thickness = Thickness.Zero;

  constructor() {
    super();
    this.UseCache = "Operations";
  }

  // ---- invalidating accessors (DrawnUi bindable properties) ----
  private Set<K extends keyof this>(key: K, v: this[K]): void { if (this[key] !== v) { this[key] = v; this.Update(); } }

  get Text(): string { return this.text; }
  set Text(v: string) { this.Set("text" as keyof this, v as this[keyof this]); }
  /** Points. */
  get FontSize(): number { return this.fontSize; }
  set FontSize(v: number) { this.Set("fontSize" as keyof this, v as this[keyof this]); }
  get TextColor(): Color { return this.textColor; }
  set TextColor(v: Color) { this.Set("textColor" as keyof this, v as this[keyof this]); }
  /** Alias registered via ConfigureFonts; empty = default typeface. */
  get FontFamily(): string { return this.fontFamily; }
  set FontFamily(v: string) { this.Set("fontFamily" as keyof this, v as this[keyof this]); }
  /** 100..900, 0 = the family's registered default. Picks the nearest registered weight of the family. */
  get FontWeight(): number { return this.fontWeight; }
  set FontWeight(v: number) { this.Set("fontWeight" as keyof this, v as this[keyof this]); }
  get FontAttributes(): FontAttributes { return this.fontAttributes; }
  set FontAttributes(v: FontAttributes) { this.Set("fontAttributes" as keyof this, v as this[keyof this]); }
  /** -1 = unlimited. */
  get MaxLines(): number { return this.maxLines; }
  set MaxLines(v: number) { this.Set("maxLines" as keyof this, v as this[keyof this]); }
  get LineBreakMode(): LineBreakMode { return this.lineBreakMode; }
  set LineBreakMode(v: LineBreakMode) { this.Set("lineBreakMode" as keyof this, v as this[keyof this]); }
  get HorizontalTextAlignment(): DrawTextAlignment { return this.horizontalTextAlignment; }
  set HorizontalTextAlignment(v: DrawTextAlignment) { this.Set("horizontalTextAlignment" as keyof this, v as this[keyof this]); }
  get VerticalTextAlignment(): TextAlignment { return this.verticalTextAlignment; }
  set VerticalTextAlignment(v: TextAlignment) { this.Set("verticalTextAlignment" as keyof this, v as this[keyof this]); }
  /** Multiplier for the distance between lines (1 = font line height). */
  get LineSpacing(): number { return this.lineSpacing; }
  set LineSpacing(v: number) { this.Set("lineSpacing" as keyof this, v as this[keyof this]); }
  /** Multiplier for each line's own height. */
  get LineHeight(): number { return this.lineHeight; }
  set LineHeight(v: number) { this.Set("lineHeight" as keyof this, v as this[keyof this]); }
  get TextTransform(): TextTransform { return this.textTransform; }
  set TextTransform(v: TextTransform) { this.Set("textTransform" as keyof this, v as this[keyof this]); }
  get Padding(): Thickness { return this.padding; }
  set Padding(v: Thickness) { this.Set("padding" as keyof this, v as this[keyof this]); }

  /** Lines laid out by the last measure (read-only diagnostics, like DrawnUi LinesCount). */
  get LinesCount(): number { return this.lines.length; }

  // ---- layout state ----
  private lines: TextLine[] = [];
  private lineHeightPx = 0;
  private advancePx = 0;
  private ascentPx = 0;
  private font?: Font;
  private readonly widthCache = new Map<string, number>();
  private widthCacheKey = "";

  private ResolveFont(scale: number): Font {
    const bold = this.fontAttributes === "Bold" || this.fontAttributes === "BoldItalic";
    const italic = this.fontAttributes === "Italic" || this.fontAttributes === "BoldItalic";
    const weight = this.fontWeight > 0 ? this.fontWeight : bold ? 700 : 0;
    const font = Super.GetFont(this.fontFamily, weight, italic, this.fontSize * scale);
    const key = `${this.fontFamily}|${weight}|${italic}|${this.fontSize * scale}`;
    if (key !== this.widthCacheKey) { this.widthCache.clear(); this.widthCacheKey = key; }
    this.font = font;
    return font;
  }

  /** Advance width of a run in pixels, memoized per font. */
  private MeasureRun(font: Font, run: string): number {
    if (run.length === 0) return 0;
    let w = this.widthCache.get(run);
    if (w === undefined) {
      w = 0;
      for (const adv of font.getGlyphWidths(font.getGlyphIDs(run))) w += adv;
      this.widthCache.set(run, w);
    }
    return w;
  }

  private TransformedText(): string {
    switch (this.textTransform) {
      case "Uppercase": return this.text.toUpperCase();
      case "Lowercase": return this.text.toLowerCase();
      case "Titlecase": return this.text.replace(/(^|\s)(\S)/g, (_, s, c) => s + c.toUpperCase());
      default: return this.text;
    }
  }

  /** Word-wraps into lines that fit maxWidth (Infinity = no wrap), applies MaxLines with a tail ellipsis. */
  private LayoutLines(font: Font, maxWidth: number): TextLine[] {
    const text = this.TransformedText();
    const wrap = this.lineBreakMode !== "NoWrap" && isFinite(maxWidth);
    const out: TextLine[] = [];
    const paragraphs = text.split("\n");
    const spaceW = this.MeasureRun(font, " ");

    for (const paragraph of paragraphs) {
      if (!wrap) { out.push({ Text: paragraph, Width: this.MeasureRun(font, paragraph) }); continue; }
      const words = paragraph.split(" ");
      let line = "", lineW = 0;
      const flush = () => { out.push({ Text: line, Width: lineW }); line = ""; lineW = 0; };
      for (const word of words) {
        const wordW = this.MeasureRun(font, word);
        const needed = line ? lineW + spaceW + wordW : wordW;
        if (needed <= maxWidth || !line && wordW <= maxWidth) {
          if (line) { line += " " + word; lineW = needed; } else { line = word; lineW = wordW; }
          continue;
        }
        if (line) flush();
        if (wordW <= maxWidth) { line = word; lineW = wordW; continue; }
        // word longer than the line: break by characters
        let chunk = "", chunkW = 0;
        for (const ch of word) {
          const chW = this.MeasureRun(font, ch);
          if (chunk && chunkW + chW > maxWidth) { out.push({ Text: chunk, Width: chunkW }); chunk = ""; chunkW = 0; }
          chunk += ch; chunkW += chW;
        }
        line = chunk; lineW = chunkW;
      }
      flush();
    }

    if (this.maxLines > 0 && out.length > this.maxLines) {
      out.length = this.maxLines;
      if (this.lineBreakMode !== "NoWrap" && this.lineBreakMode !== "WordWrap" && this.lineBreakMode !== "CharacterWrap") {
        const last = out[this.maxLines - 1];
        const ellipsis = "…";
        const ellW = this.MeasureRun(font, ellipsis);
        let t = last.Text;
        let w = this.MeasureRun(font, t);
        while (t.length > 0 && w + ellW > maxWidth) { t = t.slice(0, -1).trimEnd(); w = this.MeasureRun(font, t); }
        out[this.maxLines - 1] = { Text: t + ellipsis, Width: w + ellW };
      }
    }
    return out;
  }

  protected override MeasureAbsolute(widthConstraint: number, heightConstraint: number, scale: number): ScaledSize {
    const font = this.ResolveFont(scale);
    const m = font.getMetrics();
    this.ascentPx = m.ascent;
    this.lineHeightPx = (m.descent - m.ascent) * this.lineHeight;
    this.advancePx = this.lineHeightPx * this.lineSpacing;
    const px = this.padding.HorizontalThickness * scale, py = this.padding.VerticalThickness * scale;
    this.lines = this.text ? this.LayoutLines(font, widthConstraint - px) : [];
    let width = 0;
    for (const l of this.lines) width = Math.max(width, l.Width);
    const n = this.lines.length;
    const height = n === 0 ? 0 : this.lineHeightPx + (n - 1) * this.advancePx;
    return ScaledSize.FromPixels(Math.ceil(width) + px, Math.ceil(height) + py, scale);
  }

  protected override Paint(ctx: DrawingContext): void {
    if (this.lines.length === 0 || !this.font) return;
    const scale = ctx.Scale;
    const d = ctx.Destination;
    const p = this.padding;
    const left = d.Left + p.Left * scale, right = d.Right - p.Right * scale;
    const top = d.Top + p.Top * scale, bottom = d.Bottom - p.Bottom * scale;
    const blockH = this.lineHeightPx + (this.lines.length - 1) * this.advancePx;
    let y = top;
    if (this.verticalTextAlignment === "Center") y = top + (bottom - top - blockH) / 2;
    else if (this.verticalTextAlignment === "End") y = bottom - blockH;

    const paint = new Super.CK.Paint();
    paint.setColor(Super.ParseColor(this.textColor));
    paint.setAntiAlias(true);
    const canvas = ctx.Context.Canvas;
    for (const line of this.lines) {
      let x = left;
      if (this.horizontalTextAlignment === "Center") x = left + (right - left - line.Width) / 2;
      else if (this.horizontalTextAlignment === "End") x = right - line.Width;
      if (line.Text) canvas.drawText(line.Text, x, y - this.ascentPx, paint, this.font);
      y += this.advancePx;
    }
    paint.delete();
  }
}
