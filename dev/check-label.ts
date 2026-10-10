// Label rules as C# / DrawnUi.Rust (label_rules.rs), checked in Node (`npm run check:label`): the height limits the
// lines (a box too short cuts the text with "…", at least one line kept); ParagraphSpacing above every paragraph after
// the first; U+2028 breaks a line inside a paragraph; a run of spaces is one; default-ignorable code points no font
// has (U+FE0F, joiners, tags) draw nothing and take no room; CharacterSpacing widens the line, and spaced text measures,
// wraps and is cut at the width it draws (C# 7cf1007c, Rust label_spacing_grid); Japanese and Chinese break between
// characters with kinsoku and a Latin word wider than the line breaks by characters (C# LabelCjkWrapTests, Rust
// label_cjk_wrap; the Japanese part needs a Japanese font: JP_FONT, else Windows' Noto Sans JP).
import { readFileSync, existsSync } from "node:fs";
import { Super, SKRect, SkiaAccessibilityManager, HoverManager, SkiaLabel, TextSpan, Thickness, type AnimatorBase, type Canvas } from "../src/index.ts";

declare const CanvasKitInit: (o: { locateFile: () => string }) => Promise<any>;
const ROOT = process.cwd();
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

const WORDS = "The quick brown fox jumps over the lazy dog again and again";

(async () => {
  const CK = await CanvasKitInit({ locateFile: () => `${ROOT}/node_modules/canvaskit-wasm/bin/full/canvaskit.wasm` });
  (Super as unknown as { CK: unknown }).CK = CK;
  const face = CK.Typeface.MakeFreeTypeFaceFromData(readFileSync(`${ROOT}/samples/public/fonts/OpenSans-Regular.ttf`).buffer);
  Super.Fonts.set("FontText", new Map([[400, face]])); Super.DefaultTypeface = face; Super.DefaultFontAlias = "FontText";

  const fake = new FakeCanvas();
  const measure = (setup: (l: SkiaLabel) => void, w = 400, h = Infinity) => {
    const l = new SkiaLabel(); l.FontSize = 16; setup(l);
    l._superview = fake as unknown as Canvas;
    l.Measure(w, h, 1); l.Arrange(new SKRect(0, 0, w, isFinite(h) ? h : 400), l.WidthRequest, l.HeightRequest, 1);
    return l;
  };
  const lines = (l: SkiaLabel) => ((l as unknown as { lines: { Runs: { Text: string }[] }[] }).lines).map((x) => x.Runs.map((r) => r.Text).join(""));

  // the height limits the lines (Rust the_height_limits_the_lines): room for one line and a half
  const cut = measure((l) => { l.Text = WORDS; l.WidthRequest = 100; l.HeightRequest = 34; });
  check("room for a line and a half: one line, with the trail", cut.LinesCount === 1 && lines(cut)[0].endsWith("…"), lines(cut).join(" | "));
  const tiny = measure((l) => { l.Text = WORDS; l.WidthRequest = 100; l.HeightRequest = 4; });
  check("a box shorter than a line keeps one line", tiny.LinesCount === 1, `${tiny.LinesCount}`);
  const free = measure((l) => { l.Text = WORDS; l.WidthRequest = 100; });
  check("unbounded height: every line, no trail", free.LinesCount > 2 && lines(free).every((x) => !x.endsWith("…")), lines(free).join(" | "));
  const fits = measure((l) => { l.Text = WORDS; l.WidthRequest = 100; l.HeightRequest = free.MeasuredSize.Pixels.Height; });
  check("a box exactly as tall as the text keeps every line", fits.LinesCount === free.LinesCount, `${fits.LinesCount} of ${free.LinesCount}`);

  // paragraphs and line separators (Rust paragraphs_spacing_and_line_height)
  const one = measure((l) => { l.Text = "a"; });
  const line = one.MeasuredLineHeight;
  const two = measure((l) => { l.Text = "a\nb"; });
  check("two paragraphs, no ParagraphSpacing: two lines high", two.MeasuredSize.Pixels.Height === Math.ceil(line * 2), `${two.MeasuredSize.Pixels.Height} vs ${Math.ceil(line * 2)}`);
  const spaced = measure((l) => { l.Text = "a\nb"; l.LineSpacing = 1.5; l.ParagraphSpacing = 1; });
  check("LineSpacing 1.5 + ParagraphSpacing 1", spaced.MeasuredSize.Pixels.Height === Math.ceil(line * 2 + line * 0.5 + line * 1.5), `${spaced.MeasuredSize.Pixels.Height} vs ${Math.ceil(line * 4)}`);
  const sep = measure((l) => { l.Text = "a b"; l.ParagraphSpacing = 1; });
  check("U+2028 breaks the line, no paragraph space", lines(sep).join() === "a,b" && sep.MeasuredSize.Pixels.Height === Math.ceil(line * 2), `${lines(sep).join()} ${sep.MeasuredSize.Pixels.Height}`);
  check("an empty paragraph is a line", lines(measure((l) => { l.Text = "a\n\nb"; })).join("|") === "a||b");
  check("a run of spaces is one", lines(measure((l) => { l.Text = "a   b"; })).join() === "a b");

  // default-ignorable code points no font has draw nothing and take no room (Rust label_ignorables)
  const width = (t: string, fallback = "") => measure((l) => { l.Text = t; l.FontSize = 40; if (fallback) l.FontFamilyFallback = fallback; }).MeasuredSize.Pixels.Width;
  const ab = width("AB");
  for (const t of ["A\u200DB", "A\uFE0FB", "A\u{E0067}B", "A\u2060B", "A\u200BB"]) check(`${JSON.stringify(t)} is as wide as AB`, width(t) === ab, `${width(t)} vs ${ab}`);
  Super.Fonts.set("FontEmoji", new Map([[400, CK.Typeface.MakeFreeTypeFaceFromData(readFileSync(`${ROOT}/samples/public/fonts/NotoColorEmoji-Subset.ttf`).buffer)]]));
  check("U+FE0F after an emoji the fallback has: no box after it", width("\u2699\uFE0F 4m", "FontEmoji") === width("\u2699 4m", "FontEmoji"), `${width("\u2699\uFE0F 4m", "FontEmoji")} vs ${width("\u2699 4m", "FontEmoji")}`);

  // CharacterSpacing (Rust character_spacing_widens_the_line, label_spacing_grid)
  const lineWidth = (l: SkiaLabel) => (l as unknown as { lines: { Width: number }[] }).lines[0].Width;
  const grown = lineWidth(measure((l) => { l.Text = "abcd"; l.CharacterSpacing = 3; })) - lineWidth(measure((l) => { l.Text = "abcd"; }));
  check("CharacterSpacing 3: 2 px more between each of 4 glyphs", Math.abs(grown - 6) < 0.01, `${grown}`);
  /** A white label on black at `scale`, in a box `w` x `h` points: one past the rightmost column with ink. */
  const inkRight = (setup: (l: SkiaLabel) => void, w: number, h: number, scale = 1) => {
    const l = new SkiaLabel(); l.TextColor = "#FFFFFF"; setup(l);
    l._superview = fake as unknown as Canvas;
    const pw = Math.round(w * scale), ph = Math.round(h * scale);
    l.Measure(pw, ph, scale); l.Arrange(new SKRect(0, 0, pw, ph), l.WidthRequest, l.HeightRequest, scale);
    const surface = CK.MakeSurface(pw, ph), c = surface.getCanvas();
    c.clear(CK.BLACK);
    l.Render({ Context: { Canvas: c, Surface: surface }, Destination: new SKRect(0, 0, pw, ph), Scale: scale });
    const px = c.readPixels(0, 0, { width: pw, height: ph, colorType: CK.ColorType.RGBA_8888, alphaType: CK.AlphaType.Unpremul, colorSpace: CK.ColorSpace.SRGB }) as Uint8Array;
    surface.delete();
    let right = 0;
    for (let y = 0; y < ph; y++) for (let x = pw - 1; x >= right; x--) if (px[(y * pw + x) * 4] > 80) { right = x + 1; break; }
    return { label: l, right };
  };
  const span = (text: string, bold = false) => { const t = new TextSpan(); t.Text = text; t.IsBold = bold; return t; };
  const titles: [string, (l: SkiaLabel) => void][] = [
    ["label", (l) => { l.Text = "ESTILIZAR UMA FOTO"; }],
    ["spans", (l) => { l.AddSubView(span("ESTILIZAR ")); l.AddSubView(span("UMA FOTO", true)); }],
  ];
  for (const [name, title] of titles) {
    const { label, right } = inkRight((l) => { title(l); l.FontSize = 32; l.CharacterSpacing = 3; }, 700, 200);
    const measured = label.MeasuredSize.Pixels.Width;
    check(`${name}: spaced text measures the width it draws`, right > 0 && right <= measured + 1 && measured - right < 12, `measured ${measured}, ink ends at ${right}`);
    // a spaced title wraps inside its column (Rust a_spaced_title_wraps_inside_its_star_column: 151 pt at 1.25)
    const wrapped = inkRight((l) => { title(l); l.FontSize = 12; l.CharacterSpacing = 3; l.MaxLines = 2; l.Padding = new Thickness(0, 8, 12, 8); }, 151, 200, 1.25);
    const textRight = Math.round((151 - 12) * 1.25);
    check(`${name}: a spaced title wraps inside its column`, wrapped.label.LinesCount === 2 && lines(wrapped.label).every((x) => !x.endsWith("…")) && wrapped.right > 0 && wrapped.right <= textRight + 1, `${lines(wrapped.label).join(" | ")}, ink ends at ${wrapped.right} of ${textRight}`);
  }
  for (const [name, title] of [...titles, ["cut in the second span", (l: SkiaLabel) => { l.AddSubView(span("ESTI ")); l.AddSubView(span("LIZARUMAFOTOLONGA", true)); }] as [string, (l: SkiaLabel) => void]]) {
    const { label, right } = inkRight((l) => { title(l); l.FontSize = 20; l.CharacterSpacing = 3; l.MaxLines = 1; l.WidthRequest = 150; }, 400, 100);
    check(`${name}: spaced text is cut at the width it draws`, right > 0 && right <= 151, `ink ends at ${right} in a 150 px label: ${lines(label).join(" | ")}`);
  }

  // Chinese / Japanese line breaks (C# LabelCjkWrapTests, Rust label_cjk_wrap)
  const wrapped = (text: string, mode: "WordWrap" | "TailTruncation", maxLines: number, width: number, family = "") => {
    const l = measure((x) => { x.Text = text; x.WidthRequest = width; x.LineBreakMode = mode; x.MaxLines = maxLines; if (family) x.FontFamily = family; });
    return (l as unknown as { lines: { Runs: { Text: string }[]; Width: number }[] }).lines.map((x) => ({ text: x.Runs.map((r) => r.Text).join(""), width: x.Width }));
  };
  const fit = (ls: { width: number }[], limit: number) => ls.every((x) => x.width <= limit);
  const URL = "https://drawnui.net/articles/a/very/long/path/without/any/space/that/cannot/fit/on/one/line";
  const url = wrapped(`See ${URL}`, "WordWrap", -1, 200);
  check("a long Latin word breaks by characters", url[0].text.trim() === "See" && url.length > 2 && fit(url, 201) && url.slice(1).map((x) => x.text).join("") === URL, url.map((x) => x.text).join(" | "));
  const breaks: [string, number, boolean][] = [["背景", 1, true], ["部屋。", 2, false], ["「今", 1, false], ["ャッ", 1, false], ["ab", 1, false], ["aの", 1, true], ["한국", 1, false], ["a\u{20000}", 1, true], ["\u{20000}b", 1, false]];
  for (const [text, index, expected] of breaks) check(`break inside ${JSON.stringify(text)} at ${index}: ${expected}`, SkiaLabel.CanBreakInsideWord(text, index) === expected);
  const jpFont = [process.env.JP_FONT, "C:/Windows/Fonts/NotoSansJP-VF.ttf", "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"].find((f) => f && existsSync(f));
  if (!jpFont) console.log("skip Japanese wrap: no Japanese font (set JP_FONT)");
  else {
    Super.Fonts.set("FontJapaneseTest", new Map([[400, CK.Typeface.MakeFreeTypeFaceFromData(readFileSync(jpFont).buffer)]]));
    const JAPANESE = "背景の部屋をどう見せるかを選びます。今のプリセットは下のスイッチでオフにできます。";
    const jp = wrapped(JAPANESE, "WordWrap", -1, 300, "FontJapaneseTest");
    check("Japanese wraps between characters with kinsoku", jp.length >= 2 && jp.length <= 4 && fit(jp, 301) && jp.slice(1).every((x) => !"、。ー」』）っゃゅょッャュョ".includes(Array.from(x.text)[0])) && jp.map((x) => x.text).join("") === JAPANESE, jp.map((x) => `${x.text} (${x.width.toFixed(0)})`).join(" | "));
    const after = wrapped(`DrawnCamera ${JAPANESE}`, "WordWrap", -1, 300, "FontJapaneseTest");
    check("Japanese after a Latin word fills the line", after[0].text.startsWith("DrawnCamera 背景") && fit(after, 301), after.map((x) => x.text).join(" | "));
    const cut = wrapped(JAPANESE + JAPANESE, "TailTruncation", 2, 300, "FontJapaneseTest");
    check("Japanese tail truncation keeps MaxLines", cut.length === 2 && fit(cut, 301), cut.map((x) => `${x.text} (${x.width.toFixed(0)})`).join(" | "));
  }

  console.log(failures ? `FAIL: ${failures} checks` : "OK: label rules");
  process.exit(failures ? 1 : 0);
})();
