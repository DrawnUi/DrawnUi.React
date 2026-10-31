// SkiaLabel reuses its lines (C# 5f24f577, LabelReuseLinesTests), checked in Node (`npm run check:label-reuse`): lines
// laid out without wrapping or cutting are kept for any later room that holds them while nothing in the label changed,
// and every change that alters the lines lays them out again: each property below gives the size a new label with the
// same settings gets.
import { readFileSync } from "node:fs";
import { Super, SkiaLabel, TextSpan, SkiaAccessibilityManager, HoverManager, type Canvas, type AnimatorBase } from "../src/index.ts";

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

(async () => {
  const CK = await CanvasKitInit({ locateFile: () => `${ROOT}/node_modules/canvaskit-wasm/bin/full/canvaskit.wasm` });
  (Super as unknown as { CK: unknown }).CK = CK;
  const face = Super.LoadFace(readFileSync(`${ROOT}/samples/public/fonts/OpenSans-Regular.ttf`))!;
  Super.Fonts.set("FontText", new Map([[400, face]])); Super.DefaultTypeface = face; Super.DefaultFontAlias = "FontText";

  const proto = SkiaLabel.prototype as unknown as { LayoutLines: (...a: unknown[]) => unknown };
  const original = proto.LayoutLines;
  let layouts = 0;
  proto.LayoutLines = function (this: unknown, ...a: unknown[]) { layouts++; return original.apply(this, a); };

  const make = (setup: (l: SkiaLabel) => void) => {
    const l = new SkiaLabel(); l.FontSize = 20; setup(l); l._superview = new FakeCanvas() as unknown as Canvas; return l;
  };
  const size = (l: SkiaLabel, w: number) => { const s = l.Measure(w, 1000, 1).Pixels; return `${s.Width}x${s.Height}|${l.LinesCount}`; };
  const base = (l: SkiaLabel) => { l.Text = "Hello reusable lines\nsecond paragraph\nthird"; };

  {
    const l = make(base);
    size(l, Infinity);
    layouts = 0;
    const a = size(l, 900), b = size(l, 700), c = size(l, 901);
    check("unchanged label measured at wider rooms: the lines are reused (no new layout), the same size", layouts === 0 && a === b && b === c, `${layouts} layouts, ${a} ${b} ${c}`);
  }

  // every change gives what a new label with that setting gets, at a room the old lines would have fit
  const cases: [string, (l: SkiaLabel) => void][] = [
    ["Text", (l) => { l.Text = "Changed text that is much longer than before\nsecond\nthird"; }],
    ["FontSize", (l) => { l.FontSize = 28; }],
    ["FontAttributes Bold", (l) => { l.FontAttributes = "Bold"; }],
    ["CharacterSpacing", (l) => { l.CharacterSpacing = 3; }],
    ["TextTransform", (l) => { l.TextTransform = "Uppercase"; }],
    ["MaxLines", (l) => { l.MaxLines = 1; }],
    ["LineSpacing", (l) => { l.LineSpacing = 2; }],
    ["Padding", (l) => { l.Padding = 10; }],
  ];
  for (const [name, change] of cases) {
    const l = make(base);
    size(l, Infinity); size(l, 900);
    change(l);
    const got = size(l, 900), want = size(make((n) => { base(n); change(n); }), 900);
    check(`${name} changed: laid out again, the size of a new label (${want})`, got === want, got);
  }

  const spans = (l: SkiaLabel) => { for (const t of ["Spans ", "reuse ", "lines"]) { const s = new TextSpan(); s.Text = t; l.AddSubView(s); } };
  const spanCases: [string, (l: SkiaLabel) => void][] = [
    ["span Text", (l) => { l.Spans[1].Text = "a much longer middle span "; }],
    ["span FontSize", (l) => { l.Spans[0].FontSize = 30; }],
    ["span added", (l) => { const s = new TextSpan(); s.Text = " and one more"; l.AddSubView(s); }],
  ];
  for (const [name, change] of spanCases) {
    const l = make(spans);
    size(l, Infinity); size(l, 900);
    change(l);
    const got = size(l, 900), want = size(make((n) => { spans(n); change(n); }), 900);
    check(`${name}: laid out again, the size of a new label (${want})`, got === want, got);
  }

  {
    // a narrower parent than the lines: laid out again and wrapped
    const l = make((n) => { n.Text = "Hello reusable lines that wrap when the room is narrow"; });
    const wide = size(l, Infinity);
    layouts = 0;
    const narrow = size(l, 120), want = size(make((n) => { n.Text = "Hello reusable lines that wrap when the room is narrow"; }), 120);
    check(`narrower room than the lines: laid out again and wrapped like a new label (${want})`, layouts >= 1 && narrow === want && narrow !== wide, narrow);
    const back = size(l, 2000), fresh = size(make((n) => { n.Text = "Hello reusable lines that wrap when the room is narrow"; }), 2000);
    check("wide again after wrapping: laid out again (wrapped lines are not reused), one line", back === fresh, `${back} vs ${fresh}`);
  }
  {
    // a room shorter than the lines: they were cut, so the next taller room lays them out again
    const l = make(base);
    const cut = size(l, 900).split("|")[1];
    l.Measure(900, 30, 1);
    const short = l.LinesCount;
    const tall = size(l, 900).split("|")[1];
    check("a height that cuts lines, then a taller one: all lines again", short === 1 && tall === cut, `${short} then ${tall} of ${cut}`);
  }

  console.log(failures ? `FAIL: ${failures} checks` : "OK: label line reuse");
  process.exit(failures ? 1 : 0);
})();
