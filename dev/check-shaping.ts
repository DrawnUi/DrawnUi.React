// Text shaping and bidirectional order in SkiaLabel (DrawnUi.Rust label_shaping.rs, C# SkiaLabel DrawShapedText), checked
// in Node (`npm run check:shaping`): Arabic letters join and run right to left, a right-to-left paragraph puts its Latin
// words on the left, an emoji with a skin tone is one glyph, plain Latin text keeps its plain widths, a space keeps the
// style of its span, and SkiaRichLabel reads ***x*** / ___x___ as bold italic.
import { readFileSync } from "node:fs";
import { Super, SKRect, SkiaAccessibilityManager, HoverManager, SkiaLayout, SkiaLabel, SkiaRichLabel, TextSpan, type Canvas, type AnimatorBase } from "../src/index.ts";

declare const CanvasKitInit: (o: { locateFile: () => string }) => Promise<any>;
const ROOT = process.cwd();
const W = 600, H = 200;
let failures = 0;
const check = (name: string, ok: boolean, detail = "") => { if (!ok) failures++; console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`); };

class FakeCanvas {
  readonly AccessibilityManager = new SkiaAccessibilityManager();
  readonly Hover = new HoverManager();
  readonly AnimatingControls = new Map<number, AnimatorBase>();
  RenderingScale = 1;
  GpuEpoch = 0;
  Update(): void {}
  DisposeObject(o: { Dispose(): void }): void { o.Dispose(); }
  RegisterAnimator(a: AnimatorBase): boolean { this.AnimatingControls.set(a.Uid, a); return true; }
  UnregisterAnimator(uid: number): void { this.AnimatingControls.delete(uid); }
}

(async () => {
  const CK = await CanvasKitInit({ locateFile: () => `${ROOT}/node_modules/canvaskit-wasm/bin/full/canvaskit.wasm` });
  (Super as unknown as { CK: unknown }).CK = CK;
  const font = (file: string, alias: string) => {
    const face = Super.LoadFace(readFileSync(`${ROOT}/samples/public/fonts/${file}`))!;
    Super.Fonts.set(alias, new Map([[400, face]]));
    return face;
  };
  const text = font("OpenSans-Regular.ttf", "FontText");
  font("NotoSansArabic-Subset.ttf", "FontArabic");
  font("NotoColorEmoji-Subset.ttf", "FontEmoji");
  Super.DefaultTypeface = text; Super.DefaultFontAlias = "FontText";

  /** The label at 30 pt, white on black, in a 600 x 200 canvas; returns the label and the pixels. */
  const draw = (label: SkiaLabel) => {
    label.FontSize = 30; label.TextColor = "#FFFFFF";
    const root = new SkiaLayout(); root.HorizontalOptions = "Fill"; root.VerticalOptions = "Fill"; root.AddSubView(label);
    root._superview = new FakeCanvas() as unknown as Canvas;
    const surface = CK.MakeSurface(W, H);
    surface.getCanvas().clear(CK.BLACK);
    root.Measure(W, H, 1); root.Arrange(new SKRect(0, 0, W, H), W, H, 1);
    root.Render({ Context: { Canvas: surface.getCanvas(), Surface: surface }, Destination: new SKRect(0, 0, W, H), Scale: 1 });
    const px = surface.makeImageSnapshot().readPixels(0, 0, { width: W, height: H, colorType: CK.ColorType.RGBA_8888, alphaType: CK.AlphaType.Unpremul, colorSpace: CK.ColorSpace.SRGB }) as Uint8Array;
    surface.delete();
    return px;
  };
  const make = (t: string, fallback = "") => { const l = new SkiaLabel(); l.Text = t; l.FontFamilyFallback = fallback; return l; };
  /** Width of the text as the label lays it out, pixels. */
  const width = (t: string, fallback: string) => { const l = make(t, fallback); draw(l); return l.GetLineBoxes()[0]?.Width ?? 0; };
  /** First and last column where a color shows. */
  const columns = (px: Uint8Array, color: (r: number, g: number, b: number) => boolean): [number, number] | undefined => {
    let found: [number, number] | undefined;
    for (let x = 0; x < W; x++) for (let y = 0; y < 120; y++) {
      const i = (y * W + x) * 4;
      if (color(px[i], px[i + 1], px[i + 2])) { found = found ? [found[0], x] : [x, x]; break; }
    }
    return found;
  };
  const red = (r: number, g: number, b: number) => r > 150 && g < 80 && b < 80;
  const blue = (r: number, g: number, b: number) => b > 150 && r < 80 && g < 80;
  const span = (t: string, color: string) => { const s = new TextSpan(); s.Text = t; s.TextColor = color; return s; };
  const spans = (fallback: string, ...list: TextSpan[]) => { const l = new SkiaLabel(); l.FontFamilyFallback = fallback; for (const s of list) l.AddSubView(s); return l; };

  {
    const lam = width("ل", "FontArabic"), alef = width("ا", "FontArabic"), joined = width("لا", "FontArabic");
    check("Arabic: lam + alef is one ligature, narrower than the two letters apart", lam > 0 && alef > 0 && joined < lam + alef - 1, `${joined.toFixed(1)} vs ${lam.toFixed(1)} + ${alef.toFixed(1)}`);
  }
  {
    const arabic = "مرحبا ";
    const rtl = draw(spans("FontArabic", span(arabic, "#FF0000"), span("Hello ", "#0000FF")));
    const [a, l] = [columns(rtl, red), columns(rtl, blue)];
    check("a right-to-left paragraph puts its Latin word left of its Arabic word", !!a && !!l && l[1] < a[0], `Latin ${l}, Arabic ${a}`);
    const ltr = draw(spans("FontArabic", span("Hello ", "#0000FF"), span(arabic, "#FF0000")));
    const [a2, l2] = [columns(ltr, red), columns(ltr, blue)];
    check("a left-to-right paragraph keeps its Latin word first, on the left", !!a2 && !!l2 && l2[1] < a2[0], `Latin ${l2}, Arabic ${a2}`);
  }
  {
    const px = draw(spans("FontArabic", span("مرحبا ", "#FF0000"), span("بكم", "#0000FF")));
    const [first, second] = [columns(px, red), columns(px, blue)];
    check("Arabic words run right to left: the second word is left of the first", !!first && !!second && second[1] < first[0], `first ${first}, second ${second}`);
  }
  {
    // "حيث" ends (on its left) with the three dots of tha, a mark glyph off its pen position: the word keeps its own box
    // and the space after it shows between it and the next word (the demo's second line)
    const px = draw(spans("FontArabic", span("حيث ", "#FF0000"), span("الدقة", "#0000FF")));
    const [first, second] = [columns(px, red), columns(px, blue)];
    check("a word that ends with a dotted letter keeps the space after it", !!first && !!second && first[0] - second[1] >= 4, `first ${first}, second ${second}`);
  }
  {
    const alone = width("\u{1F64E}", "FontEmoji"), toned = width("\u{1F64E}\u{1F3FD}", "FontEmoji");
    check("an emoji with a skin tone is one glyph, as wide as the emoji alone", alone > 10 && Math.abs(toned - alone) < 1, `${toned.toFixed(1)} vs ${alone.toFixed(1)}`);
  }
  {
    const got = width("Hello world", "");
    const f = new CK.Font(text, 30); f.setSubpixel(true); f.setLinearMetrics(true);
    let want = 0; for (const w of f.getGlyphWidths(f.getGlyphIDs("Hello world"))) want += w;
    check("Latin text keeps its plain widths", Math.abs(got - want) < 0.5, `${got.toFixed(2)} vs ${want.toFixed(2)}`);
  }
  {
    // unhinted advances on every font (drawnui-cross 6f): the same widths as DrawnUi.Rust, not whole pixels
    const label = new SkiaLabel(); label.Text = "H"; label.FontSize = 20;
    const root = new SkiaLayout(); root.AddSubView(label); root._superview = new FakeCanvas() as unknown as Canvas;
    root.Measure(W, H, 1);
    const h = label.GetLineBoxes()[0]?.Width ?? 0;
    const line = new SkiaLabel(); line.Text = "One label, many styles:"; line.FontSize = 16;
    const root2 = new SkiaLayout(); root2.AddSubView(line); root2._superview = new FakeCanvas() as unknown as Canvas;
    root2.Measure(W, H, 1);
    const w16 = line.GetLineBoxes()[0]?.Width ?? 0;
    check("text measures with unhinted advances: \"H\" at 20 = 14.76, \"One label, many styles:\" at 16 = 171.344 (DrawnUi.Rust)", Math.abs(h - 14.76) < 0.01 && Math.abs(w16 - 171.344) < 0.01, `${h.toFixed(3)}, ${w16.toFixed(3)}`);
  }
  {
    // the DrawnUI .NET demo's "Format text as  BiG  and small!": the highlight covers " BiG " only
    const l = new SkiaLabel();
    const big = span(" BiG ", "#000000"); big.BackgroundColor = "#FFFF00";
    for (const s of [span("as ", "#FFFFFF"), big, span("and", "#FFFFFF")]) l.AddSubView(s);
    const px = draw(l);
    const yellow = columns(px, (r, g, b) => r > 200 && g > 200 && b < 80);
    const f = new CK.Font(text, 30); f.setSubpixel(true); f.setLinearMetrics(true);
    const w = (t: string) => { let s = 0; for (const a of f.getGlyphWidths(f.getGlyphIDs(t))) s += a; return s; };
    const as = w("as "), bigEnd = as + w(" BiG ");
    check("a space keeps the style of its span: the highlight starts after \"as \" and ends after \" BiG \"", !!yellow && yellow[0] >= as - 1 && Math.abs(yellow[1] - bigEnd) <= 2,
      `yellow ${yellow}, "as " ends ${as.toFixed(1)}, " BiG " ends ${bigEnd.toFixed(1)}`);
  }
  {
    const rich = new SkiaRichLabel(); rich.Text = "a ***auto-split*** b ___SkiaMarkdownLabel___ c";
    const styled = rich.Spans.filter((s) => s.IsBold && s.IsItalic).map((s) => s.Text);
    const stars = rich.Spans.some((s) => s.Text.includes("*") || s.Text.includes("_"));
    check("SkiaRichLabel: ***x*** and ___x___ are bold italic, no marker left", styled.join("|") === "auto-split|SkiaMarkdownLabel" && !stars, rich.Spans.map((s) => `${s.Text}${s.IsBold ? "/b" : ""}${s.IsItalic ? "/i" : ""}`).join(" "));
  }

  console.log(failures ? `FAIL: ${failures} checks` : "OK: text shaping");
  process.exit(failures ? 1 : 0);
})();
