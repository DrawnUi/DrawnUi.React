import type { Font } from "canvaskit-wasm";
import { Super } from "./Super";

/**
 * Text shaping (C# SkiaLabel DrawShapedText, HarfBuzzSharp there; DrawnUi.Rust shaping.rs, harfrust) for the text that
 * needs it: complex scripts whose letters join or reorder (Arabic, Hebrew marks, Indic, Thai...) and emoji sequences
 * (ZWJ families, skin tones, flags, keycaps). Everything else keeps the plain path: one glyph per character.
 * HarfBuzz and ICU come with the CanvasKit paragraph module, already in the build (no extra wasm): a run is laid out as a
 * one-font paragraph and its shaped glyphs are read back; the label keeps its own line breaking and font fallback.
 */

/** C# SkiaLabel.UnicodeNeedsShaping, plus the characters that make emoji sequences and the right-to-left scripts C# leaves out. */
export function NeedsShaping(cp: number): boolean {
  return (cp >= 0x0590 && cp <= 0x08FF) // Hebrew, Arabic, Syriac, Arabic Supplement, Thaana, NKo, Samaritan, Mandaic, Arabic Extended
    || (cp >= 0x0900 && cp <= 0x0DFF) // Devanagari .. Sinhala
    || (cp >= 0x0E00 && cp <= 0x0FFF) // Thai, Lao, Tibetan
    || (cp >= 0x1000 && cp <= 0x109F) // Myanmar
    || (cp >= 0x10A0 && cp <= 0x10FF) // Georgian
    || (cp >= 0x1100 && cp <= 0x11FF) // Hangul Jamo
    || (cp >= 0x1200 && cp <= 0x137F) // Ethiopic
    || (cp >= 0x1780 && cp <= 0x18AF) // Khmer, Mongolian
    || cp === 0x200C || cp === 0x200D // ZWNJ, ZWJ
    || cp === 0x20E3 // keycap
    || (cp >= 0x2600 && cp <= 0x27BF) // symbols that have emoji forms
    || (cp >= 0xFB1D && cp <= 0xFDFF) // Hebrew and Arabic presentation forms A
    || (cp >= 0xFE00 && cp <= 0xFE0F) // variation selectors (VS15 / VS16)
    || (cp >= 0xFE70 && cp <= 0xFEFF) // Arabic presentation forms B
    || (cp >= 0x1F000 && cp <= 0x1FAFF) // emoji, regional indicators (flags), skin tones
    || (cp >= 0xE0020 && cp <= 0xE007F); // tag sequences (subdivision flags)
}

/** Characters that belong to the glyph before them (an emoji sequence or a mark): they keep its font (C# JoinsPreviousGlyph). */
export function JoinsPrevious(cp: number): boolean {
  return cp === 0x200D || cp === 0x20E3 || (cp >= 0xFE00 && cp <= 0xFE0F) || (cp >= 0x1F3FB && cp <= 0x1F3FF) || (cp >= 0xE0020 && cp <= 0xE007F);
}

/** Right-to-left letters: a paragraph with one of them gets the bidirectional pass. */
export function IsRtl(cp: number): boolean {
  return (cp >= 0x0590 && cp <= 0x08FF) || (cp >= 0xFB1D && cp <= 0xFDFF) || (cp >= 0xFE70 && cp <= 0xFEFF) || (cp >= 0x10800 && cp <= 0x10FFF) || (cp >= 0x1E800 && cp <= 0x1EFFF);
}

/** Whether a text has a character `test` accepts. */
export function HasCodePoint(text: string, test: (cp: number) => boolean): boolean {
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    // below U+0590 nothing needs shaping or is right to left
    if (c < 0x0590) continue;
    const cp = text.codePointAt(i)!;
    if (test(cp)) return true;
    if (cp > 0xFFFF) i++;
  }
  return false;
}

/** One shaped run: glyphs from x = 0 on the baseline, in visual order, and the advance of every code point in logical order (a cluster's advance on its first code point). */
export interface Shaped { Glyphs: Uint16Array; Positions: Float32Array; Advances: number[]; Width: number }

const cache = new Map<string, Shaped | null>();
/** Bounds the shaping cache; a label re-measured with new text shapes again. */
const CacheLimit = 4000;

/**
 * Shapes `text` with `font` in one direction (the caller splits runs by font and by bidirectional level), `spacing`
 * pixels after every code point. Undefined when the font was not registered through the font registry (no shaping
 * data): the caller keeps its plain glyphs.
 */
export function Shape(font: Font, text: string, rtl: boolean, spacing: number): Shaped | undefined {
  const family = Super.ShapingFamilyOf(font);
  if (!family || !text) return undefined;
  const size = font.getSize();
  const key = `${family}|${size}|${rtl ? 1 : 0}|${spacing}|${text}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit ?? undefined;
  const shaped = ShapeNow(font, family, size, text, rtl, spacing);
  if (cache.size >= CacheLimit) cache.clear();
  cache.set(key, shaped ?? null);
  return shaped;
}

/** Width a run is laid out in: one line, never wrapped; a right-to-left run ends at its right edge. */
const LayoutWidth = 1e6;

function Paragraph(family: string, size: number, text: string, rtl: boolean) {
  const CK = Super.CK;
  const style = new CK.ParagraphStyle({ textStyle: { fontFamilies: [family], fontSize: size }, textDirection: rtl ? CK.TextDirection.RTL : CK.TextDirection.LTR });
  const builder = CK.ParagraphBuilder.MakeFromFontProvider(style, Super.ShapingFonts!);
  builder.addText(text);
  const paragraph = builder.build();
  builder.delete();
  paragraph.layout(LayoutWidth);
  return paragraph;
}

function ShapeNow(font: Font, family: string, size: number, text: string, rtl: boolean, spacing: number): Shaped | undefined {
  const paragraph = Paragraph(family, size, text, rtl);
  try {
    const lines = paragraph.getShapedLines();
    if (lines.length === 0) return undefined;
    // the code point of every UTF-8 byte offset (the shaped runs report clusters in UTF-8)
    const cpOfByte: number[] = [];
    let cps = 0;
    for (const ch of text) {
      const c = ch.codePointAt(0)!, bytes = c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
      for (let b = 0; b < bytes; b++) cpOfByte.push(cps);
      cps++;
    }
    const cpOf = (byte: number) => cpOfByte[Math.min(byte, cpOfByte.length - 1)] ?? 0;
    let count = 0;
    for (const l of lines) for (const r of l.runs) count += r.glyphs.length;
    const glyphs = new Uint16Array(count), positions = new Float32Array(count * 2), advances = new Array<number>(cps).fill(0), clusters = new Array<number>(count);
    // one line (no width limit, no line breaks in a run); runs come in visual order. Glyph positions include their
    // offsets (a mark sits off its pen position), so the run's left edge and width come from the paragraph itself.
    const shapedWidth = paragraph.getMaxIntrinsicWidth();
    const left = rtl ? LayoutWidth - shapedWidth : 0;
    let k = 0;
    for (const l of lines) {
      for (const r of l.runs) {
        for (let g = 0; g < r.glyphs.length; g++, k++) {
          glyphs[k] = r.glyphs[g];
          positions[k * 2] = r.positions[g * 2] - left;
          positions[k * 2 + 1] = r.positions[g * 2 + 1] - l.baseline;
          clusters[k] = cpOf(r.offsets[g]);
        }
      }
    }
    // the advance of every cluster (caret boxes): its glyphs' advances, scaled to the shaped width (kerning, joins)
    const glyphWidths = font.getGlyphWidths(glyphs);
    let sum = 0;
    for (let g = 0; g < count; g++) { advances[clusters[g]] += glyphWidths[g]; sum += glyphWidths[g]; }
    if (sum > 0) for (let i = 0; i < advances.length; i++) advances[i] *= shapedWidth / sum;
    if (spacing !== 0) {
      // visual order: the spacing of the code points between two clusters goes between them
      let extra = 0, last = -1;
      for (let g = 0; g < count; g++) {
        if (last >= 0 && last !== clusters[g]) extra += spacing * Math.abs(last - clusters[g]);
        last = clusters[g];
        positions[g * 2] += extra;
      }
      for (let i = 0; i < advances.length; i++) advances[i] += spacing;
    }
    const width = shapedWidth + spacing * cps;
    return { Glyphs: glyphs, Positions: positions, Advances: advances, Width: width };
  } finally {
    paragraph.delete();
  }
}

/**
 * Bidirectional level of every UTF-16 index of a line (Unicode bidirectional algorithm, ICU in CanvasKit): 0 left to
 * right in a left-to-right paragraph, 1 right to left, 2 left to right inside a right-to-left paragraph. Explicit
 * embeddings (U+202A..202E, U+2066..2069) are resolved by ICU but reported as their direction only.
 */
export function BidiLevels(text: string, rtlParagraph: boolean): Uint8Array | undefined {
  const family = Super.AnyShapingFamily();
  if (!family) return undefined;
  const CK = Super.CK;
  const paragraph = Paragraph(family, 12, text, rtlParagraph);
  try {
    const levels = new Uint8Array(text.length);
    let level = rtlParagraph ? 1 : 0;
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      if (c >= 0xDC00 && c <= 0xDFFF) { levels[i] = level; continue; } // low surrogate: as its pair
      const info = paragraph.getGlyphInfoAt(i);
      if (info) level = info.dir.value === CK.TextDirection.RTL.value ? 1 : rtlParagraph ? 2 : 0;
      levels[i] = level;
    }
    return levels;
  } finally {
    paragraph.delete();
  }
}
