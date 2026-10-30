// The editor caret in right-to-left and mixed text (drawnui-cross 6ak, same rules as DrawnUi.Rust), checked in Node
// (`npm run check:editor-rtl`) on a pure Arabic line, a pure Hebrew line and the mixed "Hi مرحبا 123": the caret x at
// the start, inside, at the boundaries and at the end; tap -> index; typing keeps the caret after the new letter in
// reading order; Left / Right walk visually; the selection covers the right glyphs. Fonts as the DrawnUi.Rust test:
// OpenSans, the Noto Sans Arabic subset and dev/fonts/NotoSansHebrew-Subset.ttf (OFL, from DrawnUi.Rust tests).
import { readFileSync } from "node:fs";
import { Super, SKRect, SkiaAccessibilityManager, HoverManager, SkiaLayout, SkiaEditor, type Canvas, type AnimatorBase, type GlyphBox } from "../src/index.ts";

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

/** The hidden textarea the editor mirrors its text and caret into (TextInputProxy), as far as the editor uses it. */
const field = { value: "", selectionStart: 0, selectionEnd: 0, style: {} as Record<string, string>, dataset: {} as Record<string, string>, inputMode: "", enterKeyHint: "", spellcheck: false,
  setSelectionRange(a: number, b: number) { this.selectionStart = a; this.selectionEnd = b; }, focus() {}, blur() {}, addEventListener() {}, setAttribute() {} };
const g = globalThis as unknown as Record<string, unknown>;
g.window = Object.assign(g.window ?? {}, { addEventListener() {}, removeEventListener() {}, focus() {}, setInterval, clearInterval, setTimeout, clearTimeout });
g.document = { createElement: () => field, body: { appendChild() {} }, activeElement: null };

/** The editor's caret geometry, reached past `private` for the check. */
interface Caret { CaretRectLabelPx(i: number): SKRect | undefined; HitTestIndex(x: number, y: number): number; CaretPlace(i: number): { X: number } | undefined }

(async () => {
  const CK = await CanvasKitInit({ locateFile: () => `${ROOT}/node_modules/canvaskit-wasm/bin/full/canvaskit.wasm` });
  (Super as unknown as { CK: unknown }).CK = CK;
  const font = (path: string, alias: string) => { const face = Super.LoadFace(readFileSync(path))!; Super.Fonts.set(alias, new Map([[400, face]])); return face; };
  const text = font(`${ROOT}/samples/public/fonts/OpenSans-Regular.ttf`, "FontText");
  font(`${ROOT}/samples/public/fonts/NotoSansArabic-Subset.ttf`, "FontArabic");
  font(`${ROOT}/dev/fonts/NotoSansHebrew-Subset.ttf`, "FontHebrew");
  Super.DefaultTypeface = text; Super.DefaultFontAlias = "FontText";

  /** A single-line editor, FontSize 20, focused, at scale 1 in a 600 x 200 canvas. */
  const scene = (value: string) => {
    const editor = new SkiaEditor(); editor.WidthRequest = 560; editor.FontSize = 20; editor.FontFamily = "FontText";
    editor.FontFamilyFallback = "FontArabic,FontHebrew"; editor.Text = value;
    const root = new SkiaLayout(); root.HorizontalOptions = "Fill"; root.VerticalOptions = "Fill"; root.AddSubView(editor);
    root._superview = new FakeCanvas() as unknown as Canvas;
    const frame = () => {
      const surface = CK.MakeSurface(W, H);
      root.Measure(W, H, 1); root.Arrange(new SKRect(0, 0, W, H), W, H, 1);
      root.Render({ Context: { Canvas: surface.getCanvas(), Surface: surface }, Destination: new SKRect(0, 0, W, H), Scale: 1 });
      surface.delete();
    };
    frame();
    editor.IsFocused = true;
    frame();
    const c = editor as unknown as Caret;
    const x = (i: number) => c.CaretPlace(i)!.X;
    const boxes = () => editor.Label.GetGlyphBoxes();
    const box = (i: number) => boxes().find((b) => b.Index === i)!;
    const y = () => { const b = boxes()[0]; return b ? b.Top + b.Height / 2 : 10; };
    const tap = (px: number) => c.HitTestIndex(px, y());
    const key = (dir: -1 | 1, shift = false) => { editor.MoveVisual(dir, shift); frame(); return editor.CursorPosition + editor.SelectionLength; };
    return { editor, frame, x, box, boxes, tap, key, c };
  };
  const stopsOf = (t: string) => [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(t)].map((s) => s.index).concat(t.length);

  /** A pure right-to-left line: the caret walks right to left as the index grows, taps and arrows mirror it. */
  const pureRtl = (name: string, value: string, letter: string) => {
    const t = scene(value);
    const stops = stopsOf(value);
    const xs = stops.map(t.x);
    const first = t.box(0), last = t.boxes().filter((b) => b.Width > 0).pop()!;
    check(`${name}: caret at 0 is the right edge of the first letter, at the end the left edge of the last one`,
      Math.abs(xs[0] - (first.Left + first.Width)) < 0.5 && Math.abs(xs[xs.length - 1] - last.Left) < 0.5, `x(0) ${xs[0].toFixed(1)}, box ${first.Left.toFixed(1)}..${(first.Left + first.Width).toFixed(1)}; x(end) ${xs[xs.length - 1].toFixed(1)}, box left ${last.Left.toFixed(1)}`);
    let decreasing = true;
    for (let k = 1; k < xs.length; k++) if (!(xs[k] <= xs[k - 1] + 0.01)) decreasing = false;
    check(`${name}: the caret moves left as the index grows`, decreasing && xs[xs.length - 1] < xs[0] - 50, xs.map((v) => v.toFixed(0)).join(" "));
    const r0 = first.Left + first.Width;
    check(`${name}: tap on the right half of the first letter -> 0, on its left half -> 1, far left -> end, far right -> 0`,
      t.tap(r0 - first.Width * 0.2) === 0 && t.tap(first.Left + first.Width * 0.2) === 1 && t.tap(1) === value.length && t.tap(W - 5) === 0,
      `${t.tap(r0 - first.Width * 0.2)}, ${t.tap(first.Left + first.Width * 0.2)}, ${t.tap(1)}, ${t.tap(W - 5)}`);
    let tapsBack = true;
    for (const i of stops) if (t.tap(t.x(i)) !== i && stops.filter((j) => Math.abs(t.x(j) - t.x(i)) < 0.01).length === 1) tapsBack = false;
    check(`${name}: a tap on the caret x of every index gives that index`, tapsBack);
    // arrows: Left from the start walks to the end through every stop, Right walks back
    t.editor.CursorPosition = 0; t.frame();
    const left: number[] = [0];
    for (let k = 0; k < stops.length + 2; k++) left.push(t.key(-1));
    const right: number[] = [];
    for (let k = 0; k < stops.length + 2; k++) right.push(t.key(1));
    check(`${name}: Left walks the caret leftwards through every stop to the end and stays, Right walks it back to 0`,
      left.slice(0, stops.length).join() === stops.join() && left[left.length - 1] === value.length && right[right.length - 1] === 0 && right.slice(0, stops.length - 1).join() === stops.slice(0, -1).reverse().join(),
      `Left ${left.join(",")}; Right ${right.join(",")}`);
    // typing at the end: the caret after the new letter in reading order, at its left edge
    t.editor.CursorPosition = value.length; t.frame();
    t.editor.StubTypeText(letter); t.frame();
    const nb = t.box(value.length);
    check(`${name}: typing "${letter}" at the end appends it and puts the caret at the new letter's left edge`,
      t.editor.Text === value + letter && t.editor.CursorPosition === value.length + 1 && Math.abs(t.x(value.length + 1) - nb.Left) < 0.5 && nb.Left < t.box(value.length - 1).Left,
      `text ok ${t.editor.Text === value + letter}, caret ${t.editor.CursorPosition}, x ${t.x(value.length + 1).toFixed(1)}, new letter ${nb.Left.toFixed(1)}`);
    // typing in the middle: the caret stays right after the new letter (to its left on screen)
    t.editor.CursorPosition = 2; t.frame();
    t.editor.StubTypeText(letter); t.frame();
    const mb = t.box(2);
    check(`${name}: typing in the middle inserts at the caret, the caret at the new letter's left edge`,
      t.editor.Text.slice(0, 3) === value.slice(0, 2) + letter && t.editor.CursorPosition === 3 && Math.abs(t.x(3) - mb.Left) < 0.5,
      `caret ${t.editor.CursorPosition}, x ${t.x(3).toFixed(1)}, new letter ${mb.Left.toFixed(1)}`);
  };

  pureRtl("Arabic \"مرحبا بكم\"", "مرحبا بكم", "ك");
  pureRtl("Hebrew \"שלום עולם\"", "שלום עולם", "ת");

  {
    // "Hi مرحبا 123": left to right paragraph; the digits after the Arabic word stay with it (level 2): Hi 123 ابحرم
    const value = "Hi مرحبا 123";
    const t = scene(value);
    const b = (i: number) => t.box(i);
    check("mixed: visual order Hi, 123, then the Arabic word (Unicode bidi levels)",
      b(0).Left < b(1).Left && b(1).Left < b(9).Left && b(9).Left < b(10).Left && b(11).Left < b(7).Left && b(7).Left < b(3).Left,
      `H ${b(0).Left.toFixed(0)}, 1 ${b(9).Left.toFixed(0)}, 3 ${b(11).Left.toFixed(0)}, ا ${b(7).Left.toFixed(0)}, م ${b(3).Left.toFixed(0)}`);
    const space = b(2), meem = b(3), alef = b(7);
    check("mixed: caret at 3 (after \"Hi \") is the right edge of the space, at 4 the left edge of م, at 8 the left edge of ا",
      Math.abs(t.x(3) - (space.Left + space.Width)) < 0.5 && Math.abs(t.x(4) - meem.Left) < 0.5 && Math.abs(t.x(8) - alef.Left) < 0.5,
      `x3 ${t.x(3).toFixed(1)} / ${(space.Left + space.Width).toFixed(1)}, x4 ${t.x(4).toFixed(1)} / ${meem.Left.toFixed(1)}, x8 ${t.x(8).toFixed(1)} / ${alef.Left.toFixed(1)}`);
    check("mixed: caret at 0 the left edge of H, at the end the right edge of 3", Math.abs(t.x(0) - b(0).Left) < 0.5 && Math.abs(t.x(value.length) - (b(11).Left + b(11).Width)) < 0.5);
    // Right from 0 walks every stop once with growing x, Left walks back
    t.editor.CursorPosition = 0; t.frame();
    const walk: number[] = [0];
    for (let k = 0; k < value.length + 2; k++) walk.push(t.key(1));
    const xs = [...new Set(walk)].map(t.x);
    let growing = true;
    for (let k = 1; k < xs.length; k++) if (!(xs[k] > xs[k - 1] - 0.01)) growing = false;
    const stopXs = stopsOf(value).map(t.x);
    const distinctStops = new Set(stopXs.map((v) => v.toFixed(2))).size;
    check("mixed: Right walks left to right through every caret place to the rightmost one and stays there", growing && new Set(walk.map((i) => t.x(i).toFixed(2))).size === distinctStops && Math.abs(t.x(walk[walk.length - 1]) - Math.max(...stopXs)) < 0.5,
      `${walk.join(",")}`);
    const back: number[] = [];
    for (let k = 0; k < value.length + 2; k++) back.push(t.key(-1));
    check("mixed: Left walks back to 0", back[back.length - 1] === 0, back.join(","));
    // a tap anywhere on the line lands on the caret place nearest to it (rule 2), here every 2 px across the line
    let taps = true; const bad: string[] = [];
    const stopXs2 = stopsOf(value).map(t.x);
    for (let px = 0; px < 130; px += 2) {
      const got = t.x(t.tap(px)), best = Math.min(...stopXs2.map((v) => Math.abs(v - px)));
      if (Math.abs(Math.abs(got - px) - best) > 0.01) { taps = false; bad.push(`${px}->${t.tap(px)}`); }
    }
    check("mixed: a tap puts the caret at the caret place nearest to it", taps, bad.join(" "));
    check("mixed: a tap on the right half of م (first Arabic letter) puts the caret after it (4)", t.tap(b(3).Left + b(3).Width * 0.8) === 4, `${t.tap(b(3).Left + b(3).Width * 0.8)}`);
    // selection of the Arabic word: its highlight covers exactly the Arabic glyphs
    t.editor.SetSelection(3, 8); t.frame();
    const sel = t.boxes().filter((q) => q.Index >= 3 && q.Index < 8 && q.Width > 0);
    const arabic = [3, 4, 5, 6, 7].map(b);
    const lo = Math.min(...sel.map((q) => q.Left)), hi = Math.max(...sel.map((q) => q.Left + q.Width));
    check("mixed: the selection of مرحبا covers the Arabic glyphs, not the digits", sel.length === 5 && Math.abs(lo - Math.min(...arabic.map((q) => q.Left))) < 0.5 && hi <= b(3).Left + b(3).Width + 0.5 && lo > b(11).Left + b(11).Width - 0.5,
      `${lo.toFixed(1)}..${hi.toFixed(1)}`);
    check("mixed: Left with a selection collapses to the edge with the smaller caret x (3), Right to the larger (8)",
      (() => { t.editor.SetSelection(3, 8); t.frame(); const l = t.key(-1); t.editor.SetSelection(3, 8); t.frame(); const r = t.key(1); return l === 3 && r === 8; })());
    // typing Arabic at the end of the Arabic word: the caret right after the new letter, at its left edge
    t.editor.CursorPosition = 8; t.frame();
    t.editor.StubTypeText("ك"); t.frame();
    check("mixed: typing ك after مرحبا: text in logical order, caret after it at its left edge",
      t.editor.Text === "Hi مرحباك 123" && t.editor.CursorPosition === 9 && Math.abs(t.x(9) - t.box(8).Left) < 0.5, `"${t.editor.Text}", caret ${t.editor.CursorPosition}`);
  }
  {
    // the same caret places as DrawnUi.Rust (editor_rtl.rs, preview.23): x - line left for every index, FontSize 20
    const rust: [string, number[]][] = [
      ["مرحبا", [42.08, 31.58, 24.46, 12.68, 5.82, 0.0]],
      ["שלום", [44.54, 29.94, 19.5, 13.68, 0.0]],
    ];
    for (const [value, want] of rust) {
      const t = scene(value);
      const left = t.editor.Label.GetLineBoxes()[0].Left;
      const got = want.map((_, i) => t.x(i) - left);
      check(`same caret x as DrawnUi.Rust for "${value}" (0.5 px)`, got.every((v, i) => Math.abs(v - want[i]) < 0.5), got.map((v) => v.toFixed(2)).join(", "));
    }
  }
  {
    // left to right text keeps its caret places: the caret at i is the left edge of character i
    const t = scene("Hello world");
    let same = true;
    for (let i = 0; i < 11; i++) if (Math.abs(t.x(i) - t.box(i).Left) > 0.01) same = false;
    t.editor.CursorPosition = 0; t.frame();
    const r = [t.key(1), t.key(1), t.key(1)], l = [t.key(-1)];
    check("left to right: the caret at i is the left edge of character i, Right / Left step one letter", same && r.join() === "1,2,3" && l.join() === "2");
  }
  {
    // an emoji with a skin tone is one caret step and one tap target
    const t = scene("a🙎🏽b");
    t.editor.FontFamilyFallback = "FontEmoji"; t.frame();
    t.editor.CursorPosition = 1; t.frame();
    const after = t.key(1);
    check("🙎🏽 is one step for Right (never between the person and the skin tone)", after === 5, `${after}`);
  }

  console.log(failures ? `FAIL: ${failures} checks` : "OK: editor caret in right-to-left text");
  process.exit(failures ? 1 : 0);
})();
