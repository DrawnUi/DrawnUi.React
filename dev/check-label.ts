// Label rules as C# / DrawnUi.Rust (label_rules.rs), checked in Node (`npm run check:label`): the height limits the
// lines (a box too short cuts the text with "…", at least one line kept); ParagraphSpacing above every paragraph after
// the first; U+2028 breaks a line inside a paragraph; a run of spaces is one.
import { readFileSync } from "node:fs";
import { Super, SKRect, SkiaAccessibilityManager, HoverManager, SkiaLabel, type AnimatorBase, type Canvas } from "../src/index.ts";

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

  console.log(failures ? `FAIL: ${failures} checks` : "OK: label rules");
  process.exit(failures ? 1 : 0);
})();
