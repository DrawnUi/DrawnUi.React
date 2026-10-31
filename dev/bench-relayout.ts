// Relayout cost of a designer-like page (drawnui-cross 6an measuring savings), in Node (`npm run bench:relayout`): a
// centered Column, max 640, of Fill cards (title + body text), a row of buttons, a short title with a Fill divider and
// 4 nested Fill cards, laid out at alternating widths so every control is measured again. Reports ms per relayout and
// how many label line layouts it took.
import { readFileSync } from "node:fs";
import {
  Super, SKRect, SkiaAccessibilityManager, HoverManager, SkiaLayout, SkiaLabel, SkiaShape, SkiaButton, Thickness,
  type Canvas, type AnimatorBase,
} from "../src/index.ts";

declare const CanvasKitInit: (o: { locateFile: () => string }) => Promise<any>;
const ROOT = process.cwd();

class FakeCanvas {
  readonly AccessibilityManager = new SkiaAccessibilityManager();
  readonly Hover = new HoverManager();
  readonly AnimatingControls = new Map<number, AnimatorBase>();
  RenderingScale = 1.25;
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

  // count label line layouts
  const proto = SkiaLabel.prototype as unknown as { LayoutLines: (...a: unknown[]) => unknown };
  const original = proto.LayoutLines;
  let layouts = 0;
  proto.LayoutLines = function (this: unknown, ...a: unknown[]) { layouts++; return original.apply(this, a); };

  const text = (t: string, size = 16) => { const l = new SkiaLabel(); l.Text = t; l.FontSize = size; l.FontFamily = "FontText"; l.HorizontalOptions = "Fill"; return l; };
  const card = (title: string, body: string) => {
    const s = new SkiaShape(); s.HorizontalOptions = "Fill"; s.Padding = new Thickness(16); s.BackgroundColor = "#333333";
    const col = new SkiaLayout(); col.Type = "Column"; col.Spacing = 6; col.HorizontalOptions = "Fill";
    col.AddSubView(text(title, 20)); col.AddSubView(text(body)); s.AddSubView(col); return s;
  };
  const page = new SkiaLayout(); page.Type = "Column"; page.Spacing = 16; page.HorizontalOptions = "Center"; page.MaximumWidthRequest = 640;
  const header = new SkiaLabel(); header.Text = "Designer"; header.FontSize = 28; page.AddSubView(header);
  const divider = new SkiaShape(); divider.HorizontalOptions = "Fill"; divider.HeightRequest = 1; divider.BackgroundColor = "#888888"; page.AddSubView(divider);
  for (let i = 0; i < 6; i++) page.AddSubView(card(`Card ${i + 1}`, i % 2 ? "Short body text." : "A longer body that may wrap when the card is narrow, as cards in a phone layout do."));
  let nest = card("Nested 1", "Inner text");
  for (let i = 2; i <= 4; i++) { const outer = card(`Nested ${i}`, "Inner text"); (outer.Views[0] as SkiaLayout).AddSubView(nest); nest = outer; }
  page.AddSubView(nest);
  const row = new SkiaLayout(); row.Type = "Row"; row.Spacing = 8;
  for (const t of ["Save", "Share", "Delete"]) { const b = new SkiaButton(); b.Text = t; row.AddSubView(b); }
  page.AddSubView(row);
  const root = new SkiaLayout(); root.AddSubView(page);
  root._superview = new FakeCanvas() as unknown as Canvas;

  const S = 1.25, H = 4000;
  const relayout = (w: number) => { root.Measure(w, H, S); root.Arrange(new SKRect(0, 0, w, H), w, H, S); };
  for (const widths of [[1000, 1001], [420, 421]]) {
    for (let i = 0; i < 50; i++) relayout(widths[i % 2]); // warm up
    const runs: number[] = [];
    for (let r = 0; r < 3; r++) {
      layouts = 0;
      const n = 300, t0 = performance.now();
      for (let i = 0; i < n; i++) relayout(widths[i % 2]);
      runs.push((performance.now() - t0) / n);
    }
    runs.sort((a, b) => a - b);
    console.log(`width ${widths[0]}: ${runs[1].toFixed(3)} ms per relayout (median of 3), ${(layouts / 300).toFixed(1)} label layouts per relayout`);
  }
  process.exit(0);
})();
