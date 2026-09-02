import type { Font } from "canvaskit-wasm";
import { type DrawingContext, SkiaControl } from "../core/SkiaControl";
import { Super } from "../core/Super";
import {
  type Color, Colors, type DrawTextAlignment, type FontAttributes, type LineBreakMode, ScaledSize, type TextAlignment,
  type TextTransform, Thickness,
} from "../core/Types";

/** A run of text drawn with one font (main, or FontFamilyFallback for glyphs the main font lacks). */
interface TextRun { Text: string; Font: Font; Width: number }
/** One laid-out line. */
interface TextLine { Runs: TextRun[]; Width: number }

/**
 * Mirrors DrawnUi SkiaLabel: multi-line text with word wrapping, MaxLines + tail ellipsis, horizontal /
 * vertical alignment, LineSpacing / LineHeight, weights and attributes resolved through the font registry,
 * and the opt-in per-codepoint FontFamilyFallback (symbols/emoji missing from the main face).
 * Cached as Operations by default, like DrawnUi. Every text property invalidates like a bindable property.
 */
export class SkiaLabel extends SkiaControl {
  private text = "";
  private fontSize = 12;
  private textColor: Color = Colors.GreenYellow;
  private fontFamily = "";
  private fontFamilyFallback = "";
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
  /**
   * Alias used for code points the main font has no glyph for (e.g. "FontSymbols", "FontEmoji").
   * A comma-separated list is tried in order ("FontSymbols,FontSymbols2,FontEmoji").
   */
  get FontFamilyFallback(): string { return this.fontFamilyFallback; }
  set FontFamilyFallback(v: string) { this.Set("fontFamilyFallback" as keyof this, v as this[keyof this]); }
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
  private fallbackFonts: Font[] = [];
  private readonly runCache = new Map<string, TextRun[]>();
  private runCacheKey = "";

  private ResolveFonts(scale: number): Font {
    const bold = this.fontAttributes === "Bold" || this.fontAttributes === "BoldItalic";
    const italic = this.fontAttributes === "Italic" || this.fontAttributes === "BoldItalic";
    const weight = this.fontWeight > 0 ? this.fontWeight : bold ? 700 : 0;
    const sizePx = this.fontSize * scale;
    const key = `${this.fontFamily}|${this.fontFamilyFallback}|${weight}|${italic}|${sizePx}`;
    if (key !== this.runCacheKey) { this.runCache.clear(); this.runCacheKey = key; }
    this.font = Super.GetFont(this.fontFamily, weight, italic, sizePx);
    this.fallbackFonts = this.fontFamilyFallback
      ? this.fontFamilyFallback.split(",").map((a) => a.trim()).filter(Boolean).map((a) => Super.GetFont(a, weight, italic, sizePx))
      : [];
    return this.font;
  }

  private static Advance(font: Font, text: string): number {
    let w = 0;
    for (const adv of font.getGlyphWidths(font.getGlyphIDs(text))) w += adv;
    return w;
  }

  /**
   * Splits text into runs by glyph availability: the main font, or the first fallback that has a glyph where the
   * main font has glyph 0. Spaces always stay on the main font (fallback faces often carry very wide spaces).
   */
  private Segment(text: string): TextRun[] {
    if (text.length === 0) return [];
    let runs = this.runCache.get(text);
    if (runs) return runs;
    const main = this.font!;
    const fbs = this.fallbackFonts;
    runs = [];
    if (fbs.length === 0) {
      runs.push({ Text: text, Font: main, Width: SkiaLabel.Advance(main, text) });
    } else {
      const cps = Array.from(text);
      const mainIds = main.getGlyphIDs(text, cps.length);
      const fbIds = fbs.map((f) => f.getGlyphIDs(text, cps.length));
      const fontFor = (i: number): Font => {
        if (cps[i] === " " || mainIds[i] !== 0) return main;
        for (let k = 0; k < fbs.length; k++) if (fbIds[k][i] !== 0) return fbs[k];
        return main;
      };
      let start = 0, current = fontFor(0);
      for (let i = 1; i < cps.length; i++) {
        const f = fontFor(i);
        if (f !== current) {
          const t = cps.slice(start, i).join("");
          runs.push({ Text: t, Font: current, Width: SkiaLabel.Advance(current, t) });
          start = i; current = f;
        }
      }
      const t = cps.slice(start).join("");
      runs.push({ Text: t, Font: current, Width: SkiaLabel.Advance(current, t) });
    }
    this.runCache.set(text, runs);
    return runs;
  }

  private Width(runs: TextRun[]): number { let w = 0; for (const r of runs) w += r.Width; return w; }
  private Plain(line: TextLine): string { return line.Runs.map((r) => r.Text).join(""); }

  private TransformedText(): string {
    switch (this.textTransform) {
      case "Uppercase": return this.text.toUpperCase();
      case "Lowercase": return this.text.toLowerCase();
      case "Titlecase": return this.text.replace(/(^|\s)(\S)/g, (_, s, c) => s + c.toUpperCase());
      default: return this.text;
    }
  }

  /** Word-wraps into lines that fit maxWidth (Infinity = no wrap), applies MaxLines with a tail ellipsis. */
  private LayoutLines(maxWidth: number): TextLine[] {
    const text = this.TransformedText();
    const wrap = this.lineBreakMode !== "NoWrap" && isFinite(maxWidth);
    const out: TextLine[] = [];
    const spaceW = this.Width(this.Segment(" "));
    const line = (t: string): TextLine => { const runs = this.Segment(t); return { Runs: runs, Width: this.Width(runs) }; };

    for (const paragraph of text.split("\n")) {
      if (!wrap) { out.push(line(paragraph)); continue; }
      const words = paragraph.split(" ");
      let current = "", currentW = 0;
      const flush = () => { out.push(line(current)); current = ""; currentW = 0; };
      for (const word of words) {
        const wordW = this.Width(this.Segment(word));
        const needed = current ? currentW + spaceW + wordW : wordW;
        if (needed <= maxWidth || (!current && wordW <= maxWidth)) {
          if (current) { current += " " + word; currentW = needed; } else { current = word; currentW = wordW; }
          continue;
        }
        if (current) flush();
        if (wordW <= maxWidth) { current = word; currentW = wordW; continue; }
        // word longer than the line: break by code points
        let chunk = "", chunkW = 0;
        for (const ch of Array.from(word)) {
          const chW = this.Width(this.Segment(ch));
          if (chunk && chunkW + chW > maxWidth) { out.push(line(chunk)); chunk = ""; chunkW = 0; }
          chunk += ch; chunkW += chW;
        }
        current = chunk; currentW = chunkW;
      }
      flush();
    }

    if (this.maxLines > 0 && out.length > this.maxLines) {
      out.length = this.maxLines;
      const truncates = this.lineBreakMode === "TailTruncation" || this.lineBreakMode === "HeadTruncation" || this.lineBreakMode === "MiddleTruncation";
      if (truncates) {
        const ellipsis = "…";
        const ellW = this.Width(this.Segment(ellipsis));
        let t = this.Plain(out[this.maxLines - 1]);
        let w = this.Width(this.Segment(t));
        while (t.length > 0 && w + ellW > maxWidth) { t = t.slice(0, -1).trimEnd(); w = this.Width(this.Segment(t)); }
        out[this.maxLines - 1] = line(t + ellipsis);
      }
    }
    return out;
  }

  protected override MeasureAbsolute(widthConstraint: number, _heightConstraint: number, scale: number): ScaledSize {
    const font = this.ResolveFonts(scale);
    const m = font.getMetrics();
    this.ascentPx = m.ascent;
    this.lineHeightPx = (m.descent - m.ascent) * this.lineHeight;
    this.advancePx = this.lineHeightPx * this.lineSpacing;
    const px = this.padding.HorizontalThickness * scale, py = this.padding.VerticalThickness * scale;
    this.lines = this.text ? this.LayoutLines(widthConstraint - px) : [];
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
      const baseline = y - this.ascentPx;
      for (const run of line.Runs) {
        if (run.Text) canvas.drawText(run.Text, x, baseline, paint, run.Font);
        x += run.Width;
      }
      y += this.advancePx;
    }
    paint.delete();
  }
}
