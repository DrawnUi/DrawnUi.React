// The editor follows the label's line rule (drawnui-cross 6bm, DrawnUi.Net 676cc9c2), checked in Node
// (`npm run check:editor-lines`): an editor whose label draws a 40 pt line over a 14 pt line puts a caret on the 14 pt line
// as high as that line (not the tallest one), and its AutoHeight is the sum of its lines' own heights with the paragraph
// space between them (not the tallest line times the line count). Scale 2.
import { readFileSync } from "node:fs";
import { Super, SKRect, SkiaAccessibilityManager, HoverManager, SkiaLayout, SkiaEditor, TextSpan, type Canvas, type AnimatorBase } from "../src/index.ts";

declare const CanvasKitInit: (o: { locateFile: () => string }) => Promise<any>;
const ROOT = process.cwd();
const W = 800, H = 600, S = 2;
let failures = 0;
const check = (name: string, ok: boolean, detail = "") => { if (!ok) failures++; console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`); };

class FakeCanvas {
  readonly AccessibilityManager = new SkiaAccessibilityManager();
  readonly Hover = new HoverManager();
  readonly AnimatingControls = new Map<number, AnimatorBase>();
  RenderingScale = S;
  GpuEpoch = 0;
  Update(): void {}
  FocusedChild: unknown = undefined;
  ReportFocus(value: unknown): void { this.FocusedChild = value; }
  DisposeObject(o: { Dispose(): void }): void { o.Dispose(); }
  RegisterAnimator(a: AnimatorBase): boolean { this.AnimatingControls.set(a.Uid, a); return true; }
  UnregisterAnimator(uid: number): void { this.AnimatingControls.delete(uid); }
}

const field = { value: "", selectionStart: 0, selectionEnd: 0, style: {} as Record<string, string>, dataset: {} as Record<string, string>, inputMode: "", enterKeyHint: "", spellcheck: false,
  setSelectionRange(a: number, b: number) { this.selectionStart = a; this.selectionEnd = b; }, focus() {}, blur() {}, addEventListener() {}, setAttribute() {} };
const g = globalThis as unknown as Record<string, unknown>;
g.window = Object.assign(g.window ?? {}, { addEventListener() {}, removeEventListener() {}, focus() {}, setInterval, clearInterval, setTimeout, clearTimeout });
g.document = { createElement: () => field, body: { appendChild() {} }, activeElement: null };

(async () => {
  const CK = await CanvasKitInit({ locateFile: () => `${ROOT}/node_modules/canvaskit-wasm/bin/full/canvaskit.wasm` });
  (Super as unknown as { CK: unknown }).CK = CK;
  const face = CK.Typeface.MakeFreeTypeFaceFromData(readFileSync(`${ROOT}/samples/public/fonts/OpenSans-Regular.ttf`).buffer);
  Super.Fonts.set("FontText", new Map([[400, face]])); Super.DefaultTypeface = face; Super.DefaultFontAlias = "FontText";
  const lineH = (size: number) => { const m = new CK.Font(face, size * S).getMetrics(); return Math.round(-m.ascent + m.descent); };

  const text = "Big\nsmall";
  const editor = new SkiaEditor(); editor.WidthRequest = 300; editor.MaxLines = -1; editor.AutoHeight = true; editor.FontSize = 14; editor.Text = text;
  const big = new TextSpan(); big.Text = "Big\n"; big.FontSize = 40;
  const small = new TextSpan(); small.Text = "small";
  editor.Label.AddSubView(big); editor.Label.AddSubView(small);
  const root = new SkiaLayout(); root.HorizontalOptions = "Fill"; root.VerticalOptions = "Fill"; root.AddSubView(editor);
  root._superview = new FakeCanvas() as unknown as Canvas;
  for (let i = 0; i < 2; i++) {
    const surface = CK.MakeSurface(W, H);
    root.Measure(W, H, S); root.Arrange(new SKRect(0, 0, W, H), W, H, S);
    root.Render({ Context: { Canvas: surface.getCanvas(), Surface: surface }, Destination: new SKRect(0, 0, W, H), Scale: S });
    surface.delete();
  }

  const l40 = lineH(40), l14 = lineH(14), para = 0.25 * l14;
  const caret = (editor as unknown as { CaretRectLabelPx(i: number): SKRect | undefined }).CaretRectLabelPx(text.length);
  check(`the caret on the 14 pt line is that line's height (${l14} px), not the 40 pt line's (${l40})`, caret?.Height === l14, `${caret?.Height}`);
  const firstCaret = (editor as unknown as { CaretRectLabelPx(i: number): SKRect | undefined }).CaretRectLabelPx(1);
  check(`the caret on the 40 pt line is ${l40} px`, firstCaret?.Height === l40, `${firstCaret?.Height}`);
  const py = editor.Padding.VerticalThickness * S;
  const want = Math.ceil(l40 + para + l14) + py;
  check(`AutoHeight: ${l40} + ${para} paragraph space + ${l14} + padding = ${want} px (not ${l40} x 2)`, editor.MeasuredSize.Pixels.Height === want, `${editor.MeasuredSize.Pixels.Height}`);

  console.log(failures ? `FAIL: ${failures} checks` : "OK: editor lines follow the label's line rule");
  process.exit(failures ? 1 : 0);
})();
