import type { Font } from "canvaskit-wasm";
import { type DrawingContext, SkiaControl } from "../core/SkiaControl";
import { ControlTappedEventArgs, type GestureEventProcessingInfo, type SkiaGesturesParameters } from "../core/Gestures";
import { Super } from "../core/Super";
import {
  type Color, Colors, type DrawTextAlignment, type FontAttributes, type LineBreakMode, ScaledSize, SKRect, type SkiaGradient, type TextAlignment,
  type TextTransform, Thickness, type ThicknessValue,
} from "../core/Types";
import { TextSpan } from "./TextSpan";
import { BidiRuns, type BidiMap, HasCodePoint, IsRtl, JoinsPrevious, NeedsShaping, Shape, type Shaped } from "../core/Shaping";

/** Resolved faces for one style (the label itself or one span): main font + FontFamilyFallback chain + metrics. */
interface SpanFonts { Key: string; Main: Font; Fallbacks: Font[]; Ascent: number; Descent: number; SizePx: number }
/**
 * A run of text drawn with one font (main, or a fallback for glyphs the main font lacks) and one span style. After the
 * layout, a run that needs shaping carries its shaped glyphs, and on a line with right-to-left text its bidirectional
 * level and its x from the line start (runs stay in logical order).
 */
interface TextRun { Text: string; Font: Font; Width: number; Span?: TextSpan; Fonts: SpanFonts; Shaped?: Shaped; Level?: number; X?: number; /** Rank of its visual run and its offset in the line text (bidirectional lines). */ Rank?: number; At?: number }
/** One laid-out line: runs, total advance, max ascent above / descent below the baseline (pixels). */
interface TextLine { Runs: TextRun[]; Width: number; Ascent: number; Descent: number; /** Starts a paragraph after the first one (ParagraphSpacing above it). */ Para?: boolean; /** Its paragraph runs right to left (first strong letter). */ Rtl?: boolean }
/** A paragraph of wrap tokens; `LineBreak`: it follows a U+2028 line separator, not a new paragraph. */
type Paragraph = Token[] & { LineBreak?: boolean };

/** One code point of the laid-out text: its UTF-16 index/length in Text and its box in pixels relative to DrawingRect. */
export interface GlyphBox { Index: number; Length: number; Line: number; Left: number; Top: number; Width: number; Height: number; /** The code point runs right to left (its box is in visual place). */ Rtl?: boolean }
/** A laid-out line: first text index, box in pixels relative to DrawingRect. */
export interface LineBox { Line: number; Start: number; End: number; Left: number; Top: number; Width: number; Height: number }
/**
 * A wrap unit: a word (or glued span fragment) with its style. `Carried`: the space the fragment before it ends with,
 * in that fragment's style (a space keeps the style of the span it was written in, as C#).
 */
interface Token { Text: string; Fonts: SpanFonts; Span?: TextSpan; SpaceBefore: boolean; TrailingSpace?: boolean; Carried?: { Fonts: SpanFonts; Span?: TextSpan } }

/**
 * Mirrors DrawnUi SkiaLabel: multi-line text with word wrapping, MaxLines + tail ellipsis, horizontal /
 * vertical alignment, LineSpacing / LineHeight, weights and attributes resolved through the font registry,
 * the opt-in per-codepoint FontFamilyFallback (symbols/emoji missing from the main face) and `Spans`
 * (TextSpan children: per-fragment color/size/weight/italic/underline/strikeout/background/Tapped).
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
  private paragraphSpacing = 0;
  private characterSpacing = 1;
  private textTransform: TextTransform = "None";
  private padding: Thickness = Thickness.Zero;

  /** Styled fragments; when not empty they replace `Text` (same precedence as C#). */
  readonly Spans: TextSpan[] = [];

  /** Set to `Aria.RoleText` to expose every label to screen readers (React extension; C# is opt-in per control). */
  static override DefaultAccessibilityRole?: string;
  /** Like C# OnTextInternalChanged: the spoken label is the text (or the joined spans) unless AccessibilityLabel is set. */
  protected override DefaultAccessibilityLabel(): string | undefined {
    return this.Spans.length > 0 ? this.Spans.map((s) => s.Text).join("") : this.text || undefined;
  }

  constructor() {
    super();
    this.UseCache = "Operations";
  }

  // ---- invalidating accessors (DrawnUi bindable properties) ----
  private Set<K extends keyof this>(key: K, v: this[K]): void { if (this[key] !== v) { this[key] = v; this.Update(); } }
  /** A property that changes only the look (a color): no layout change, see UpdateDraw. */
  private SetLook<K extends keyof this>(key: K, v: this[K]): void { if (this[key] !== v) { this[key] = v; this.UpdateDraw(); } }

  get Text(): string { return this.text; }
  set Text(v: string) { this.Set("text" as keyof this, v as this[keyof this]); }

  get FontSize(): number { return this.fontSize; }
  set FontSize(v: number) { this.Set("fontSize" as keyof this, v as this[keyof this]); }
  get TextColor(): Color { return this.textColor; }
  set TextColor(v: Color) { this.SetLook("textColor" as keyof this, v as this[keyof this]); }

  get FontFamily(): string { return this.fontFamily; }
  set FontFamily(v: string) { this.Set("fontFamily" as keyof this, v as this[keyof this]); }
  /**
   * Alias (or comma-separated chain of aliases) tried per codepoint when the main font has no glyph,
   * e.g. "FontSymbols,FontSymbols2" from `AddSymbols()`. Same idea as C# FontFamilyFallback, extended to a chain.
   */
  get FontFamilyFallback(): string { return this.fontFamilyFallback; }
  set FontFamilyFallback(v: string) { this.Set("fontFamilyFallback" as keyof this, v as this[keyof this]); }

  get FontWeight(): number { return this.fontWeight; }
  set FontWeight(v: number) { this.Set("fontWeight" as keyof this, v as this[keyof this]); }
  get FontAttributes(): FontAttributes { return this.fontAttributes; }
  set FontAttributes(v: FontAttributes) { this.Set("fontAttributes" as keyof this, v as this[keyof this]); }

  get MaxLines(): number { return this.maxLines; }
  set MaxLines(v: number) { this.Set("maxLines" as keyof this, v as this[keyof this]); }
  get LineBreakMode(): LineBreakMode { return this.lineBreakMode; }
  set LineBreakMode(v: LineBreakMode) { this.Set("lineBreakMode" as keyof this, v as this[keyof this]); }
  get HorizontalTextAlignment(): DrawTextAlignment { return this.horizontalTextAlignment; }
  set HorizontalTextAlignment(v: DrawTextAlignment) { this.Set("horizontalTextAlignment" as keyof this, v as this[keyof this]); }
  get VerticalTextAlignment(): TextAlignment { return this.verticalTextAlignment; }
  set VerticalTextAlignment(v: TextAlignment) { this.Set("verticalTextAlignment" as keyof this, v as this[keyof this]); }

  get LineSpacing(): number { return this.lineSpacing; }
  set LineSpacing(v: number) { this.Set("lineSpacing" as keyof this, v as this[keyof this]); }
  /** Multiplier applied to the natural line height (ascent + descent). */
  get LineHeight(): number { return this.lineHeight; }
  set LineHeight(v: number) { this.Set("lineHeight" as keyof this, v as this[keyof this]); }
  /**
   * Space above every paragraph after the first, in lines (C# ParagraphSpacing; 0 here as DrawnUi.Rust, C# 0.25). A
   * paragraph starts after "\n"; U+2028 breaks the line inside a paragraph.
   */
  get ParagraphSpacing(): number { return this.paragraphSpacing; }
  set ParagraphSpacing(v: number) { this.Set("paragraphSpacing" as keyof this, v as this[keyof this]); }
  /**
   * C# CharacterSpacing: 1 = the font's own spacing; every glyph is followed by (CharacterSpacing - 1) points more
   * (less below 1), the line measures and wraps at the width it draws (C# 7cf1007c, DrawnUi.Rust label).
   */
  get CharacterSpacing(): number { return this.characterSpacing; }
  set CharacterSpacing(v: number) { this.Set("characterSpacing" as keyof this, v as this[keyof this]); }
  get TextTransform(): TextTransform { return this.textTransform; }
  set TextTransform(v: TextTransform) { this.Set("textTransform" as keyof this, v as this[keyof this]); }
  get Padding(): Thickness { return this.padding; }
  set Padding(v: ThicknessValue) { this.Set("padding" as keyof this, Thickness.From(v) as this[keyof this]); }

  /** Number of laid-out lines after the last measure. */
  get LinesCount(): number { return this.lines.length; }

  // ---- spans as children (reconciler AddSubView / InsertSubView / RemoveSubView) ----
  override AddSubView(control: SkiaControl | TextSpan): void { this.InsertSubView(this.Spans.length, control); }
  override InsertSubView(index: number, control: SkiaControl | TextSpan): void {
    if (!(control instanceof TextSpan)) throw new Error("DrawnUi: SkiaLabel children must be <TextSpan>");
    const at = control.Parent === this ? this.Spans.indexOf(control) : -1; // already a span: a move, never a 2nd copy
    if (at >= 0) { this.Spans.splice(at, 1); if (at < index) index--; }
    control.Parent = this;
    this.Spans.splice(Math.min(Math.max(0, index), this.Spans.length), 0, control);
    this.Update();
  }
  override RemoveSubView(control: SkiaControl | TextSpan): void {
    const i = this.Spans.indexOf(control as TextSpan);
    if (i < 0) return;
    this.Spans.splice(i, 1);
    (control as TextSpan).Parent = undefined;
    this.Update();
  }

  // ---- layout ----
  private lines: TextLine[] = [];
  private mainFonts?: SpanFonts;
  private readonly fontsCache = new Map<string, SpanFonts>();
  private readonly runCache = new Map<string, TextRun[]>();
  /** CharacterSpacing in pixels at the measured scale: added after every glyph of a run (its Width includes them). */
  private glyphSpacing = 0;

  private ResolveFonts(family: string, weight: number, italic: boolean, sizePx: number): SpanFonts {
    const key = `${family}|${this.fontFamilyFallback}|${weight}|${italic}|${sizePx}`;
    let f = this.fontsCache.get(key);
    if (f) return f;
    const main = Super.GetFont(family, weight, italic, sizePx);
    const m = main.getMetrics();
    f = {
      Key: key, Main: main, SizePx: sizePx, Ascent: -m.ascent, Descent: m.descent,
      Fallbacks: this.fontFamilyFallback
        ? this.fontFamilyFallback.split(",").map((a) => a.trim()).filter(Boolean).map((a) => Super.GetFont(a, weight, italic, sizePx))
        : [],
    };
    this.fontsCache.set(key, f);
    return f;
  }

  /** The label's own style, and the base every span inherits from. */
  private ResolveMainFonts(scale: number): SpanFonts {
    const bold = this.fontAttributes === "Bold" || this.fontAttributes === "BoldItalic";
    const italic = this.fontAttributes === "Italic" || this.fontAttributes === "BoldItalic";
    const weight = this.fontWeight > 0 ? this.fontWeight : bold ? 700 : 0;
    return this.ResolveFonts(this.fontFamily, weight, italic, this.fontSize * scale);
  }

  private ResolveSpanFonts(span: TextSpan, scale: number): SpanFonts {
    const bold = span.IsBold || this.fontAttributes === "Bold" || this.fontAttributes === "BoldItalic";
    const italic = span.IsItalic || this.fontAttributes === "Italic" || this.fontAttributes === "BoldItalic";
    const weight = span.FontWeight > 0 ? span.FontWeight : span.IsBold ? 700 : this.fontWeight > 0 ? this.fontWeight : bold ? 700 : 0;
    return this.ResolveFonts(span.FontFamily ?? this.fontFamily, weight, italic, (span.FontSize ?? this.fontSize) * scale);
  }

  private static NeedsShapingOrRtl(cp: number): boolean { return NeedsShaping(cp) || IsRtl(cp); }

  /** Width of a text in one font: the shaped glyphs where the text needs shaping (Arabic joins, emoji sequences), else glyph by glyph. */
  private Advance(font: Font, text: string): number {
    if (HasCodePoint(text, SkiaLabel.NeedsShapingOrRtl)) {
      const shaped = Shape(font, text, HasCodePoint(text, IsRtl), this.glyphSpacing);
      if (shaped) return shaped.Width;
    }
    let w = 0;
    for (const adv of font.getGlyphWidths(font.getGlyphIDs(text))) w += adv + this.glyphSpacing;
    return w;
  }

  private static readonly Ignorable = /[\u200B-\u200F\u2060-\u2064\uFE00-\uFE0F\u{E0000}-\u{E0FFF}]/u;
  /**
   * Default-ignorable code points (zero width space, joiners, direction marks, word joiners, variation selectors such
   * as U+FE0F after an emoji, tags) that none of the fonts has draw nothing and take no room, never the missing-glyph
   * box (DrawnUi.Rust label_ignorables; text is not shaped here, C# hides them by shaping).
   */
  private static DropIgnorables(text: string, main: Font, fallbacks: readonly Font[]): string {
    if (!SkiaLabel.Ignorable.test(text)) return text;
    const has = (cp: string) => main.getGlyphIDs(cp)[0] !== 0 || fallbacks.some((f) => f.getGlyphIDs(cp)[0] !== 0);
    return Array.from(text).filter((cp) => !SkiaLabel.Ignorable.test(cp) || has(cp)).join("");
  }

  /**
   * Splits text into runs by glyph availability: the main font, or the first fallback that has a glyph where the
   * main font has glyph 0. Spaces always stay on the main font (fallback faces often carry very wide spaces). A joiner,
   * a variation selector, a skin tone or a tag keeps the font of the glyph before it: an emoji sequence is one run.
   */
  private Segment(text: string, fonts: SpanFonts, span?: TextSpan): TextRun[] {
    if (text.length === 0) return [];
    const cacheKey = fonts.Key + " " + text;
    let cached = this.runCache.get(cacheKey);
    if (!cached) {
      const main = fonts.Main;
      const fbs = fonts.Fallbacks;
      cached = [];
      text = SkiaLabel.DropIgnorables(text, main, fbs);
      if (text.length === 0) { this.runCache.set(cacheKey, cached); return cached; }
      if (fbs.length === 0) {
        cached.push({ Text: text, Font: main, Width: this.Advance(main, text), Fonts: fonts });
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
          const f = JoinsPrevious(cps[i].codePointAt(0)!) ? current : fontFor(i);
          if (f !== current) {
            const t = cps.slice(start, i).join("");
            cached.push({ Text: t, Font: current, Width: this.Advance(current, t), Fonts: fonts });
            start = i; current = f;
          }
        }
        const t = cps.slice(start).join("");
        cached.push({ Text: t, Font: current, Width: this.Advance(current, t), Fonts: fonts });
      }
      this.runCache.set(cacheKey, cached);
    }
    return span ? cached.map((r) => ({ ...r, Span: span })) : cached;
  }

  private Width(runs: TextRun[]): number { let w = 0; for (const r of runs) w += r.Width; return w; }

  /** A line never starts with these (closing punctuation, small kana, the long vowel mark): JIS X 4051 kinsoku (C#). */
  private static readonly NoBreakBefore = "、。，．・：；？！゛゜ヽヾゝゞ々〻ー」』）〕］｝〉》】〗〙〟｠»’”‐゠–〜～ぁぃぅぇぉっゃゅょゎゕゖァィゥェォッャュョヮヵヶㇰㇱㇲㇳㇴㇵㇶㇷㇸㇹㇺㇻㇼㇽㇾㇿ｡｣､･ｰｧｨｩｪｫｬｭｮｯ)]},.!?:;%";
  /** A line never ends with these (opening brackets and quotes). */
  private static readonly NoBreakAfter = "「『（〔［｛〈《【〖〘〝｟«‘“｢([{";
  /** Chinese / Japanese: ideographs, kana, CJK punctuation, full-width forms (C# IsCjkAt). Korean breaks at spaces only. */
  private static readonly Cjk = /[\u3000-\u312F\u3190-\u33FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF\u{20000}-\u{3FFFF}]/u;

  private static CanBreakBetween(before: string, after: string): boolean {
    return (SkiaLabel.Cjk.test(before) || SkiaLabel.Cjk.test(after)) && !SkiaLabel.NoBreakBefore.includes(after) && !SkiaLabel.NoBreakAfter.includes(before);
  }

  /**
   * C# CanBreakInsideWord: whether a line may break between text[index - 1] and text[index] (UTF-16 indexes) inside a
   * space-free run: next to a Chinese or Japanese character, never before closing punctuation or small kana, never
   * after an opening bracket, never inside a surrogate pair.
   */
  static CanBreakInsideWord(text: string, index: number): boolean {
    if (index <= 0 || index >= text.length) return false;
    const hi = (k: number) => { const c = text.charCodeAt(k); return c >= 0xD800 && c <= 0xDBFF; };
    if (hi(index - 1)) return false; // inside a surrogate pair
    const before = String.fromCodePoint(text.codePointAt(hi(index - 2) && index >= 2 ? index - 2 : index - 1)!);
    const after = String.fromCodePoint(text.codePointAt(index)!);
    return SkiaLabel.CanBreakBetween(before, after);
  }

  /**
   * C# FitAtBreak: the last place inside the word where a Chinese / Japanese line may break and `prefix` plus the word
   * up to there still fits; code points from the word's start, 0 = none.
   */
  private FitCjk(word: TextRun[], prefix: number, maxWidth: number): number {
    if (!word.some((r) => SkiaLabel.Cjk.test(r.Text))) return 0;
    const sp = this.glyphSpacing;
    let x = prefix, best = 0, before = "", k = 0;
    for (const r of word) {
      const cps = Array.from(r.Text), widths = r.Font.getGlyphWidths(r.Font.getGlyphIDs(r.Text, cps.length));
      for (let i = 0; i < cps.length; i++) {
        if (k > 0 && SkiaLabel.CanBreakBetween(before, cps[i])) {
          if (x - sp > maxWidth) return best;
          best = k;
        }
        x += widths[i] + sp; before = cps[i]; k++;
      }
    }
    return best;
  }

  /** The word cut after `count` code points: the head goes on a line, the rest follows. */
  private SplitWord(word: TextRun[], count: number): [TextRun[], TextRun[]] {
    const head: TextRun[] = [], rest: TextRun[] = [];
    let left = count;
    for (const r of word) {
      const cps = Array.from(r.Text);
      if (left >= cps.length) { head.push(r); left -= cps.length; continue; }
      if (left > 0) {
        const a = cps.slice(0, left).join(""), b = cps.slice(left).join("");
        head.push({ ...r, Text: a, Width: this.Advance(r.Font, a) });
        rest.push({ ...r, Text: b, Width: this.Advance(r.Font, b) });
        left = 0;
        continue;
      }
      rest.push(r);
    }
    return [head, rest];
  }

  private Transform(text: string): string {
    switch (this.textTransform) {
      case "Uppercase": return text.toUpperCase();
      case "Lowercase": return text.toLowerCase();
      case "Titlecase": return text.replace(/(^|\s)(\S)/g, (_, s, c) => s + c.toUpperCase());
      default: return text;
    }
  }

  /**
   * Paragraphs (split on "\n") of wrap tokens, built from Spans when present, else from Text.
   * A fragment that does not start with a space glues to the previous word (no break opportunity is added).
   */
  private Tokenize(scale: number): Paragraph[] {
    const paragraphs: Paragraph[] = [[]];
    const add = (text: string, fonts: SpanFonts, span?: TextSpan) => {
      // "\n" starts a paragraph, U+2028 breaks the line inside one
      const pieces = this.Transform(text).split(/(\n|\u2028)/);
      const parts = pieces.filter((_, i) => i % 2 === 0), seps = pieces.filter((_, i) => i % 2 === 1);
      for (let p = 0; p < parts.length; p++) {
        if (p > 0) { const next: Paragraph = []; if (seps[p - 1] === "\u2028") next.LineBreak = true; paragraphs.push(next); }
        const para = paragraphs[paragraphs.length - 1];
        const words = parts[p].split(" ");
        for (let w = 0; w < words.length; w++) {
          if (words[w] === "") continue;
          para.push({ Text: words[w], Fonts: fonts, Span: span, SpaceBefore: w > 0 || (para.length > 0 && parts[p].startsWith(" ")) });
        }
        if (parts[p].endsWith(" ") && para.length > 0) para[para.length - 1].TrailingSpace = true;
      }
    };
    if (this.Spans.length > 0) {
      for (const s of this.Spans) if (s.IsVisible && s.Text) add(s.Text, this.ResolveSpanFonts(s, scale), s);
    } else if (this.text) {
      add(this.text, this.mainFonts!);
    }
    // a fragment ending with a space puts that space, in its own style, before the NEXT token
    for (const para of paragraphs) {
      for (let i = 0; i < para.length; i++) {
        if (para[i].TrailingSpace && i + 1 < para.length) para[i + 1].Carried = { Fonts: para[i].Fonts, Span: para[i].Span };
      }
    }
    return paragraphs;
  }

  private NewLine(): TextLine { return { Runs: [], Width: 0, Ascent: 0, Descent: 0 }; }

  private Append(line: TextLine, runs: TextRun[]): void {
    for (const r of runs) {
      const last = line.Runs[line.Runs.length - 1];
      if (last && last.Font === r.Font && last.Span === r.Span) { last.Text += r.Text; last.Width += r.Width; }
      else line.Runs.push({ ...r });
      line.Width += r.Width;
      if (r.Fonts.Ascent > line.Ascent) line.Ascent = r.Fonts.Ascent;
      if (r.Fonts.Descent > line.Descent) line.Descent = r.Fonts.Descent;
    }
  }

  /**
   * Word-wraps tokens into lines that fit maxWidth (Infinity = no wrap); keeps the lines that fit maxHeight (at least one)
   * and MaxLines, the last kept one ending with a tail ellipsis (C# / DrawnUi.Rust: a label in a box too short for its
   * text cuts it, not only MaxLines).
   */
  private LayoutLines(maxWidth: number, scale: number, maxHeight = Infinity): TextLine[] {
    const wrap = this.lineBreakMode !== "NoWrap" && isFinite(maxWidth);
    // run widths carry the gap after every glyph; the one after a line's last glyph is not drawn
    const sp = this.glyphSpacing;
    const out: TextLine[] = [];
    const empty = (fonts: SpanFonts): TextLine => { const l = this.NewLine(); l.Ascent = fonts.Ascent; l.Descent = fonts.Descent; return l; };

    for (const para of this.Tokenize(scale)) {
      let line = this.NewLine();
      if (out.length > 0 && !para.LineBreak) line.Para = true;
      let lastFonts = this.mainFonts!;
      for (let i = 0; i < para.length; i++) {
        const tok = para[i];
        lastFonts = tok.Fonts;
        // glued fragments (no space between spans) wrap as one word
        let word = this.Segment(tok.Text, tok.Fonts, tok.Span);
        while (i + 1 < para.length && !para[i + 1].SpaceBefore && !para[i + 1].Carried) { i++; word = word.concat(this.Segment(para[i].Text, para[i].Fonts, para[i].Span)); }
        for (;;) {
          // the space the fragment before ends with, then the word's own one, each in its style
          const space = line.Runs.length === 0 ? [] : [
            ...(tok.Carried ? this.Segment(" ", tok.Carried.Fonts, tok.Carried.Span) : []),
            ...(tok.SpaceBefore ? this.Segment(" ", tok.Fonts, tok.Span) : []),
          ];
          const spaceW = this.Width(space), wordW = this.Width(word);
          if (!wrap || line.Width + spaceW + wordW - sp <= maxWidth || (line.Runs.length === 0 && wordW - sp <= maxWidth)) {
            this.Append(line, space); this.Append(line, word);
            break;
          }
          // Chinese / Japanese: the word fills the line up to its last break that fits (C# FitAtBreak)
          const k = this.FitCjk(word, line.Width + spaceW, maxWidth);
          if (k > 0) {
            const [head, rest] = this.SplitWord(word, k);
            this.Append(line, space); this.Append(line, head);
            out.push(line); line = this.NewLine(); word = rest;
            continue;
          }
          if (line.Runs.length > 0) { out.push(line); line = this.NewLine(); continue; }
          // word longer than the line: break by code points
          for (const r of word) {
            for (const ch of Array.from(r.Text)) {
              const run = this.Segment(ch, r.Fonts, r.Span);
              const chW = this.Width(run);
              if (line.Runs.length > 0 && line.Width + chW - sp > maxWidth) { out.push(line); line = this.NewLine(); }
              this.Append(line, run);
            }
          }
          break;
        }
      }
      out.push(line.Runs.length > 0 ? line : empty(lastFonts));
    }

    let kept = this.maxLines > 0 ? Math.min(out.length, this.maxLines) : out.length;
    if (isFinite(maxHeight)) {
      let used = 0, fit = 0;
      for (let i = 0; i < out.length; i++) {
        const lh = this.LineHeightPx(out[i]);
        // the block height of the first i + 1 lines: spacing after every line but the last, paragraph space above
        const total = used + lh + (i > 0 ? this.ParagraphSpace(out[i]) : 0);
        if (total > maxHeight && fit > 0) break;
        fit++;
        used = total - lh + lh * this.lineSpacing;
      }
      kept = Math.min(kept, fit);
    }
    if (kept < out.length) {
      out.length = kept;
      const truncates = this.lineBreakMode === "TailTruncation" || this.lineBreakMode === "HeadTruncation" || this.lineBreakMode === "MiddleTruncation";
      if (truncates) {
        const last = out[kept - 1];
        const tailRun = last.Runs[last.Runs.length - 1];
        const fonts = tailRun ? tailRun.Fonts : this.mainFonts!;
        const ell = this.Segment("…", fonts, tailRun?.Span);
        const ellW = this.Width(ell);
        while (last.Runs.length > 0 && last.Width + ellW - sp > maxWidth) {
          const r = last.Runs[last.Runs.length - 1];
          const cps = Array.from(r.Text);
          cps.pop();
          while (cps.length > 0 && cps[cps.length - 1] === " ") cps.pop();
          last.Width -= r.Width;
          if (cps.length === 0) { last.Runs.pop(); continue; }
          r.Text = cps.join(""); r.Width = this.Advance(r.Font, r.Text);
          last.Width += r.Width;
        }
        this.Append(last, ell);
      }
    }
    if (sp !== 0) for (const l of out) if (l.Runs.length > 0) l.Width -= sp;
    return out;
  }

  /** A paragraph is right to left when its first strong letter is (DrawnUi.Rust split_bidi). */
  static FirstStrongIsRtl(text: string): boolean {
    for (const ch of text) {
      const cp = ch.codePointAt(0)!;
      if (IsRtl(cp)) return true;
      if (/\p{L}/u.test(ch)) return false;
    }
    return false;
  }

  /** The runs of a line cut where its visual run changes; `map` per UTF-16 index of the line text. */
  private SplitByRuns(runs: TextRun[], map: BidiMap): TextRun[] {
    const out: TextRun[] = [];
    let at = 0;
    for (const r of runs) {
      const piece = (from: number, to: number) => {
        const text = r.Text.slice(from, to);
        out.push({ ...r, Text: text, Width: from === 0 && to === r.Text.length ? r.Width : this.Advance(r.Font, text), Level: map.Rtl[at + from] ? 1 : 0, Rank: map.Rank[at + from], At: at + from, Shaped: undefined, X: undefined });
      };
      let from = 0;
      for (let i = 0; i < r.Text.length;) {
        if (i > 0 && map.Rank[at + i] !== map.Rank[at + from]) { piece(from, i); from = i; }
        i += r.Text.codePointAt(i)! > 0xFFFF ? 2 : 1;
      }
      if (r.Text.length > 0) piece(from, r.Text.length);
      at += r.Text.length;
    }
    return out;
  }

  /**
   * After the layout, lines whose text needs shaping or runs right to left (DrawnUi.Rust build_blobs): with
   * right-to-left text every run is cut where its bidirectional run changes (Unicode bidirectional algorithm, ICU, the
   * paragraph direction from its first strong letter); runs that are right to left or need shaping get shaped glyphs;
   * runs are placed in visual order. Lines without such text are left as they are (plain path).
   */
  private ShapeLines(lines: TextLine[]): void {
    const sp = this.glyphSpacing;
    const lineText = (l: TextLine) => l.Runs.map((r) => r.Text).join("");
    const anyRtl = lines.some((l) => l.Runs.some((r) => HasCodePoint(r.Text, IsRtl)));
    let rtlParagraph = false;
    for (let li = 0; li < lines.length; li++) {
      const line = lines[li];
      let bidi = false;
      if (anyRtl) {
        if (li === 0 || line.Para) {
          let end = li + 1;
          while (end < lines.length && !lines[end].Para) end++;
          rtlParagraph = SkiaLabel.FirstStrongIsRtl(lines.slice(li, end).map(lineText).join(""));
        }
        line.Rtl = rtlParagraph;
        const map = BidiRuns(lineText(line), rtlParagraph);
        if (map) { line.Runs = this.SplitByRuns(line.Runs, map); bidi = line.Runs.some((r) => (r.Level ?? 0) > 0); }
      }
      let shaped = false;
      for (const run of line.Runs) {
        const rtl = (run.Level ?? 0) % 2 === 1;
        if (!rtl && !HasCodePoint(run.Text, NeedsShaping)) continue;
        const s = Shape(run.Font, run.Text, rtl, sp);
        if (s) { run.Shaped = s; run.Width = s.Width; shaped = true; }
      }
      if (!shaped && !bidi) continue;
      let width = 0;
      for (const run of line.Runs) width += run.Width;
      line.Width = line.Runs.length > 0 ? width - sp : 0;
      if (bidi) SkiaLabel.PlaceRuns(line.Runs);
    }
  }

  /**
   * Where each run of a line with right-to-left text goes: visual runs left to right; inside a run, pieces (spans, fonts)
   * in logical order, reversed in a right-to-left run.
   */
  private static PlaceRuns(runs: TextRun[]): void {
    const order = runs.map((_, i) => i).sort((a, b) => {
      const ra = runs[a], rb = runs[b];
      if ((ra.Rank ?? 0) !== (rb.Rank ?? 0)) return (ra.Rank ?? 0) - (rb.Rank ?? 0);
      return ((ra.Level ?? 0) % 2 === 1 ? -1 : 1) * ((ra.At ?? 0) - (rb.At ?? 0));
    });
    let x = 0;
    for (const k of order) { runs[k].X = x; x += runs[k].Width; }
  }

  private LineHeightPx(line: TextLine): number { return (line.Ascent + line.Descent) * this.lineHeight; }

  /** ParagraphSpacing above a line that starts a paragraph (after the first): that many of its lines, with their spacing. */
  private ParagraphSpace(line: TextLine): number { return line.Para && this.paragraphSpacing ? this.LineHeightPx(line) * this.lineSpacing * this.paragraphSpacing : 0; }

  private BlockHeight(): number {
    let h = 0;
    for (let i = 0; i < this.lines.length; i++) {
      const lh = this.LineHeightPx(this.lines[i]);
      h += (i < this.lines.length - 1 ? lh * this.lineSpacing : lh) + this.ParagraphSpace(this.lines[i]);
    }
    return h;
  }

  /** Pixels of ink outside the lines' advance boxes, at their left and right ends (side bearings, italic slant). */
  private inkLeft = 0;
  private inkRight = 0;

  /** Ink drawn outside the label's box (a "j" hook, an italic slant) is recorded by caches too, as C# draws it whole. */
  override ComputeEffectsMargin(scale: number): Thickness {
    const m = super.ComputeEffectsMargin(scale);
    if (this.inkRight === 0 && this.inkLeft === 0) return m;
    return new Thickness(m.Left + this.inkLeft, m.Top, m.Right + this.inkRight, m.Bottom);
  }

  /**
   * C# (after 106e768a): the ink bounds of the first glyph of each line's leftmost run and the last glyph of its
   * rightmost run, beyond the advance box of that run. Two glyph bounds per line, at measure.
   */
  private MeasureInkOverhang(): [number, number] {
    const sp = this.glyphSpacing;
    let left = 0, right = 0;
    for (const line of this.lines) {
      const runs = line.Runs.filter((r) => r.Text.trim().length > 0);
      if (runs.length === 0) continue;
      const first = runs.reduce((a, b) => ((b.X ?? 0) < (a.X ?? 0) ? b : a)), last = runs.reduce((a, b) => ((b.X ?? 0) >= (a.X ?? 0) ? b : a));
      const firstX = first.X ?? 0, lastEnd = (last.X ?? line.Width) + (last.X === undefined ? 0 : last.Width - sp);
      // ink x of a run's visually first / last glyph, from the line start
      const ends = (r: TextRun, x0: number): [number, number] => {
        if (r.Shaped) {
          const g = r.Shaped.Glyphs, n = g.length;
          if (n === 0) return [x0, x0];
          const b = r.Font.getGlyphBounds([g[0], g[n - 1]]);
          return [x0 + r.Shaped.Positions[0] + b[0], x0 + r.Shaped.Positions[(n - 1) * 2] + b[6]];
        }
        const ids = r.Font.getGlyphIDs(r.Text);
        const n = ids.length;
        const b = r.Font.getGlyphBounds([ids[0], ids[n - 1]]);
        const lastAdvance = r.Font.getGlyphWidths([ids[n - 1]])[0];
        return [x0 + b[0], x0 + r.Width - sp - lastAdvance + b[6]];
      };
      // a line without placed runs (no bidi): its runs follow each other from x 0, the last ends at the line width
      const lastX0 = last.X ?? (line.Width - (last.Width - sp));
      left = Math.max(left, firstX - ends(first, firstX)[0]);
      right = Math.max(right, ends(last, lastX0)[1] - (last.X === undefined ? line.Width : lastEnd));
    }
    return [Math.max(0, left), Math.max(0, right)];
  }

  /**
   * Where a line starts inside [left, right] (drawnui-cross 6am): Start and End follow the paragraph's direction (in a
   * right-to-left paragraph Start is the right edge); Center is centered; Fill* lines are not stretched here and sit
   * at the paragraph's start.
   */
  private LineX(line: TextLine, left: number, right: number, lineW: number): number {
    const a = this.horizontalTextAlignment;
    if (a === "Center") return left + (right - left - lineW) / 2;
    const atEnd = a === "End" ? !line.Rtl : !!line.Rtl;
    return atEnd ? right - lineW : left;
  }

  protected override MeasureAbsolute(widthConstraint: number, heightConstraint: number, scale: number): ScaledSize {
    this.mainFonts = this.ResolveMainFonts(scale);
    const glyphSpacing = scale * (this.characterSpacing - 1);
    if (glyphSpacing !== this.glyphSpacing) { this.glyphSpacing = glyphSpacing; this.runCache.clear(); }
    const px = this.padding.HorizontalThickness * scale, py = this.padding.VerticalThickness * scale;
    const extraH = this.EffectsExtra(scale).H;
    this.lines = this.text || this.Spans.length > 0 ? this.LayoutLines(widthConstraint - px, scale, heightConstraint - py - extraH) : [];
    this.ShapeLines(this.lines);
    // ink past the lines' ends (a "j" hook, an italic slant) is drawing room for caches; widths unchanged
    const [inkLeft, inkRight] = this.MeasureInkOverhang();
    if (inkLeft !== this.inkLeft || inkRight !== this.inkRight) { this.inkLeft = inkLeft; this.inkRight = inkRight; this.InvalidateEffectsMargin(); }
    let width = 0;
    for (const l of this.lines) width = Math.max(width, l.Width);
    const extra = this.EffectsExtra(scale);
    this.LayoutVersion++;
    return ScaledSize.FromPixels(Math.ceil(width + extra.W) + px, Math.ceil(this.BlockHeight() + extra.H) + py, scale);
  }

  /** C# GradientByLines: FillGradient spans each line's bounds (default) instead of the whole text block. */
  GradientByLines = true;
  /** C# KeepSpacesOnLineBreaks / NeedsGlyphPositions: accepted; glyph boxes are always available through GetGlyphBoxes. */
  KeepSpacesOnLineBreaks = false;
  NeedsGlyphPositions = false;
  /** Bumped on every measure: consumers cache GetGlyphBoxes() against it. */
  LayoutVersion = 0;
  /** Height of the first laid-out line in pixels (C# MeasuredLineHeight); 0 before the first measure. */
  get MeasuredLineHeight(): number { return this.lines.length ? this.LineHeightPx(this.lines[0]) : 0; }

  /** Line origins relative to DrawingRect, same alignment math as Paint. */
  private LineGeometry(): { x: number; y: number; w: number; h: number; text: string }[] {
    const scale = this.RenderingScale, d = this.DrawingRect, p = this.padding;
    const left = p.Left * scale, right = d.Width - p.Right * scale, top = p.Top * scale, bottom = d.Height - p.Bottom * scale;
    const extra = this.EffectsExtra(scale);
    const blockH = this.BlockHeight() + extra.H;
    let y = top;
    if (this.verticalTextAlignment === "Center") y = top + (bottom - top - blockH) / 2;
    else if (this.verticalTextAlignment === "End") y = bottom - blockH;
    y += extra.Stroke / 2;
    const out: { x: number; y: number; w: number; h: number; text: string }[] = [];
    for (const line of this.lines) {
      y += this.ParagraphSpace(line);
      const lh = this.LineHeightPx(line);
      const lineW = line.Width + extra.W;
      let x = this.LineX(line, left, right, lineW);
      x += extra.Stroke / 2;
      out.push({ x, y, w: line.Width, h: lh, text: line.Runs.map((r) => r.Text).join("") });
      y += lh * this.lineSpacing;
    }
    return out;
  }

  /** Lines as CSS text for the accessibility overlay (AccessibilityTextSelectable): font alias chain, weight and px size. */
  override GetAccessibilityTextLines(scale: number): import("../core/Accessibility").AccessibilityTextLine[] {
    const family = [this.fontFamily || Super.DefaultFontAlias, ...this.fontFamilyFallback.split(",").map((f) => f.trim()).filter(Boolean)].filter(Boolean).join(", ");
    const weight = this.fontWeight > 0 ? this.fontWeight : this.fontAttributes === "Bold" || this.fontAttributes === "BoldItalic" ? 600 : 400;
    const size = this.fontSize;
    return this.LineGeometry().map((g) => ({ Text: g.text, Left: g.x / scale, Top: g.y / scale, Width: g.w / scale, Height: g.h / scale, FontFamily: family, FontWeight: weight, FontSize: size }));
  }

  /** Laid-out lines with their text index range (a wrapped-away space or line break sits between two lines). */
  GetLineBoxes(): LineBox[] {
    const geo = this.LineGeometry();
    const out: LineBox[] = [];
    let cursor = 0;
    geo.forEach((g, i) => {
      let start = g.text.length ? this.text.indexOf(g.text, cursor) : cursor;
      if (start < 0) start = cursor;
      const end = start + g.text.length;
      out.push({ Line: i, Start: start, End: end, Left: g.x, Top: g.y, Width: g.w, Height: g.h });
      cursor = end;
    });
    return out;
  }

  /** Every code point of the laid-out text with its box (editor caret / selection / hit testing). */
  GetGlyphBoxes(): GlyphBox[] {
    const out: GlyphBox[] = [];
    const geo = this.LineGeometry();
    let cursor = 0;
    this.lines.forEach((line, li) => {
      const g = geo[li];
      let start = g.text.length ? this.text.indexOf(g.text, cursor) : cursor;
      if (start < 0) start = cursor;
      // boxes in logical order, each at its visual place: a right-to-left run fills from its right edge
      let x = g.x, index = start;
      const sp = this.glyphSpacing;
      for (const run of line.Runs) {
        if (run.X !== undefined) x = g.x + run.X;
        const cps = Array.from(run.Text);
        const widths = run.Shaped ? run.Shaped.Advances.map((a) => a - sp) : run.Font.getGlyphWidths(run.Font.getGlyphIDs(run.Text, cps.length));
        const rtl = (run.Level ?? 0) % 2 === 1;
        let right = x + run.Width - sp;
        cps.forEach((cp, k) => {
          const w = widths[k] ?? 0;
          if (rtl) { out.push({ Index: index, Length: cp.length, Line: li, Left: right - w, Top: g.y, Width: w, Height: g.h, Rtl: true }); right -= w + sp; }
          else { out.push({ Index: index, Length: cp.length, Line: li, Left: x, Top: g.y, Width: w, Height: g.h }); x += w + sp; }
          index += cp.length;
        });
        if (rtl) x += run.Width;
      }
      cursor = start + g.text.length;
    });
    return out;
  }
  /** Outline around the glyphs, drawn under the fill (C# StrokeColor / StrokeWidth in points; Transparent = none). */
  StrokeColor: Color = Colors.Transparent;
  StrokeWidth = 1;
  StrokeGradient?: SkiaGradient;
  /** Drop shadow: a stroked copy of the text offset by DropShadowOffsetX/Y points (C# DropShadow*). */
  DropShadowColor: Color = Colors.Transparent;
  DropShadowSize = 2;
  DropShadowOffsetX = 2;
  DropShadowOffsetY = 2;

  private HasStroke(): boolean { return this.StrokeWidth > 0 && this.StrokeColor !== Colors.Transparent; }
  private HasDropShadow(): boolean { return this.DropShadowSize > 0 && this.DropShadowColor !== Colors.Transparent; }
  /** C# measurement: stroke adds StrokeWidth*2 on each axis, the shadow adds DropShadowSize + offset (pixels). */
  private EffectsExtra(scale: number): { W: number; H: number; Stroke: number } {
    const stroke = this.HasStroke() ? this.StrokeWidth * 2 * scale : 0;
    const sw = this.HasDropShadow() ? (this.DropShadowSize + this.DropShadowOffsetX) * scale : 0;
    const sh = this.HasDropShadow() ? (this.DropShadowSize + this.DropShadowOffsetY) * scale : 0;
    return { W: stroke + sw, H: stroke + sh, Stroke: stroke };
  }
  /** C# SkiaLabel.SetupBackgroundPaint: no BackgroundColor = no background, the gradient goes on the glyphs. */
  protected override FillGradientPaintsBackground(): boolean { return !!this.BackgroundColor; }

  protected override Paint(ctx: DrawingContext): void {
    if (this.lines.length === 0 || !this.mainFonts) return;
    const scale = ctx.Scale;
    const d = ctx.Destination;
    const p = this.padding;
    const left = d.Left + p.Left * scale, right = d.Right - p.Right * scale;
    const top = d.Top + p.Top * scale, bottom = d.Bottom - p.Bottom * scale;
    const extra = this.EffectsExtra(scale);
    const blockH = this.BlockHeight() + extra.H;
    let y = top;
    if (this.verticalTextAlignment === "Center") y = top + (bottom - top - blockH) / 2;
    else if (this.verticalTextAlignment === "End") y = bottom - blockH;
    // C#: the glyphs sit strokeOffset in from the left/top of the inflated box, the shadow band stays below/right
    y += extra.Stroke / 2;
    const CKp = Super.CK;
    let strokePaint: InstanceType<typeof CKp.Paint> | undefined, shadowPaint: InstanceType<typeof CKp.Paint> | undefined;
    if (this.HasStroke()) { strokePaint = new CKp.Paint(); strokePaint.setAntiAlias(true); strokePaint.setStyle(CKp.PaintStyle.Stroke); strokePaint.setStrokeWidth(this.StrokeWidth * 2 * scale); strokePaint.setColor(Super.ParseColor(this.StrokeColor)); }
    if (this.HasDropShadow()) { shadowPaint = new CKp.Paint(); shadowPaint.setAntiAlias(true); shadowPaint.setStyle(CKp.PaintStyle.Stroke); shadowPaint.setStrokeWidth(this.DropShadowSize * 2 * scale); shadowPaint.setColor(Super.ParseColor(this.DropShadowColor)); }
    const shadowDx = Math.trunc(this.DropShadowOffsetX * scale), shadowDy = Math.trunc(this.DropShadowOffsetY * scale);

    for (const s of this.Spans) s.Rects.length = 0;

    const CK = Super.CK;
    const paints = new Map<string, InstanceType<typeof CK.Paint>>();
    const paintFor = (color: Color, stroke = 0) => {
      const key = color + "|" + stroke;
      let paint = paints.get(key);
      if (!paint) {
        paint = new CK.Paint();
        paint.setColor(Super.ParseColor(color));
        paint.setAntiAlias(true);
        if (stroke > 0) { paint.setStyle(CK.PaintStyle.Stroke); paint.setStrokeWidth(stroke); }
        paints.set(key, paint);
      }
      return paint;
    };
    const canvas = ctx.Context.Canvas;
    const sp = this.glyphSpacing;
    // spaced text: every glyph placed with the gap after it (C# MeasureLineGlyphs positions)
    const drawRun = (run: TextRun, rx: number, ry: number, paint: InstanceType<typeof CK.Paint>) => {
      if (run.Shaped) { canvas.drawGlyphs(run.Shaped.Glyphs, run.Shaped.Positions, rx, ry, run.Font, paint); return; }
      if (sp === 0) { canvas.drawText(run.Text, rx, ry, paint, run.Font); return; }
      const ids = run.Font.getGlyphIDs(run.Text), widths = run.Font.getGlyphWidths(ids);
      const positions = new Float32Array(ids.length * 2);
      for (let k = 0, gx = 0; k < ids.length; k++) { positions[k * 2] = gx; gx += widths[k] + sp; }
      canvas.drawGlyphs(ids, positions, rx, ry, run.Font, paint);
    };
    const gradient = this.FillGradient;
    const textRect = new SKRect(left, top, right, bottom);
    for (const line of this.lines) {
      y += this.ParagraphSpace(line);
      const lh = this.LineHeightPx(line);
      const lineW = line.Width + extra.W;
      let x = this.LineX(line, left, right, lineW);
      x += extra.Stroke / 2;
      const baseline = y + line.Ascent;
      // C# paintDefault gets the gradient over rectDraw, or over line.Bounds per line (GradientByLines)
      const gradientRect = gradient ? (this.GradientByLines ? new SKRect(x, y, x + line.Width, y + lh) : textRect) : undefined;
      if (strokePaint && this.StrokeGradient) this.SetupGradient(strokePaint, this.StrokeGradient, gradientRect ?? new SKRect(x, y, x + line.Width, y + lh));
      const lineX = x;
      for (const run of line.Runs) {
        // a line with right-to-left text places its runs in visual order
        if (run.X !== undefined) x = lineX + run.X;
        const span = run.Span;
        const drawnW = run.Width - sp; // the gap after the run's last glyph is not part of it
        if (span) {
          span.Rects.push(new SKRect(x - d.Left, y - d.Top, x + drawnW - d.Left, y + lh - d.Top));
          if (span.BackgroundColor) canvas.drawRect(CK.LTRBRect(x, y, x + drawnW, y + lh), paintFor(span.BackgroundColor));
        }
        const color = span?.TextColor ?? this.textColor;
        if (run.Text) {
          // C# DrawText order: drop shadow, stroke, fill
          if (shadowPaint) drawRun(run, x + shadowDx, baseline + shadowDy, shadowPaint);
          if (strokePaint) drawRun(run, x, baseline, strokePaint);
          const paint = paintFor(color);
          if (gradient && gradientRect) this.SetupGradient(paint, gradient, gradientRect);
          drawRun(run, x, baseline, paint);
        }
        if (span?.HasDecorations) {
          // same geometry as C# DrawSpanDecorations; CanvasKit exposes no underline/strikeout/x-height metrics,
          // so the C# fallbacks apply: underline 1 scaled px under the baseline, strikeout at half an estimated x-height
          if (span.Underline && span.UnderlineWidth !== 0) {
            const w = span.UnderlineWidth > 0 ? span.UnderlineWidth * scale : -span.UnderlineWidth;
            const yl = Math.round(baseline + scale);
            canvas.drawLine(x, yl, x + drawnW, yl, paintFor(color, w));
          }
          if (span.Strikeout) {
            const yl = Math.round(baseline - (run.Fonts.SizePx * 0.52) / 2);
            canvas.drawLine(x, yl, x + drawnW, yl, paintFor(span.StrikeoutColor, span.StrikeoutWidth * scale));
          }
        }
        x += run.Width;
      }
      y += lh * this.lineSpacing;
    }
    for (const paint of paints.values()) paint.delete();
    strokePaint?.delete(); shadowPaint?.delete();
  }

  // ---- span taps (port of C# SkiaLabel.ProcessGestures) ----
  override ProcessGestures(args: SkiaGesturesParameters, apply: GestureEventProcessingInfo): SkiaControl | null {
    if (args.Type === "Tapped" && this.Spans.length > 0) {
      const x = apply.MappedLocation.X + apply.ChildOffset.X - this.DrawingRect.Left;
      const y = apply.MappedLocation.Y + apply.ChildOffset.Y - this.DrawingRect.Top;
      for (const span of this.Spans) {
        if (span.HasTapHandler && span.HitIsInside(x, y)) {
          this.PlayRippleAnimation(this.TouchEffectColor, x / this.RenderingScale, y / this.RenderingScale);
          return this.OnSpanTapped(span, args, apply);
        }
      }
    }
    return super.ProcessGestures(args, apply);
  }

  /** Pointer cursor over a tappable span (the label itself may not be tappable). */
  override WantsPointerCursor(x: number, y: number): boolean {
    if (super.WantsPointerCursor(x, y)) return true;
    for (const span of this.Spans) if (span.HasTapHandler && span.HitIsInside(x, y)) return true;
    return false;
  }

  /** Return null to not consume the tap. */
  protected OnSpanTapped(span: TextSpan, args: SkiaGesturesParameters, apply: GestureEventProcessingInfo): SkiaControl | null {
    span.FireTap(new ControlTappedEventArgs(this, args, apply));
    return this;
  }
}
