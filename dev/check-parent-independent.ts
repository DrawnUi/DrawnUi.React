// A parent-independent control (DrawnUi IsParentIndependent) whose content changes is measured again in its own slot
// before it draws, wherever it sits (`npm run check:parent-independent`): its change does not re-lay out the parent,
// but its new text shows. Found by the 3D gallery's list counter, a label in a SkiaRow that kept its first text.
import { readFileSync } from "node:fs";
import { Super, SKRect, SkiaLabel, SkiaRow, SkiaLayer, SkiaAccessibilityManager, HoverManager, type AnimatorBase, type Canvas } from "../src/index.ts";

declare const CanvasKitInit: (o: { locateFile: () => string }) => Promise<any>;
const ROOT = process.cwd();
const W = 400, H = 100;
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
  ControlLeft(): void {}
}

(async () => {
  const CK = await CanvasKitInit({ locateFile: () => `${ROOT}/node_modules/canvaskit-wasm/bin/full/canvaskit.wasm` });
  (Super as unknown as { CK: unknown }).CK = CK;
  const face = CK.Typeface.MakeFreeTypeFaceFromData(readFileSync(`${ROOT}/samples/public/fonts/OpenSans-Regular.ttf`).buffer);
  Super.Fonts.set("FontText", new Map([[400, face]])); Super.DefaultTypeface = face; Super.DefaultFontAlias = "FontText";

  const root = new SkiaLayer(); root.WidthRequest = W; root.HeightRequest = H;
  const row = new SkiaRow();
  const before = new SkiaLabel(); before.Text = "Shown:";
  // a slot of its own width, as the gallery's counter: it measures itself again inside that slot (C#: "measured here, in its slot")
  const count = new SkiaLabel(); count.Text = "5"; count.IsParentIndependent = true; count.WidthRequest = 200;
  row.AddSubView(before); row.AddSubView(count);
  root.AddSubView(row);
  root._superview = new FakeCanvas() as unknown as Canvas;
  const surface = CK.MakeSurface(W, H);
  const frame = () => {
    root.Measure(W, H, 1); root.Arrange(new SKRect(0, 0, W, H), W, H, 1);
    root.Render({ Context: { Canvas: surface.getCanvas(), Surface: surface }, Destination: new SKRect(0, 0, W, H), Scale: 1 });
  };
  frame();
  const lines = () => (count as unknown as { LinesCount: number }).LinesCount;
  const narrow = count.MeasuredSize.Pixels.Width, rowWidth = row.MeasuredSize.Pixels.Width;
  count.Text = "5 of 30 drawn now";
  frame();
  check("its new text is measured before it draws", !count.NeedMeasure && lines() === 1 && count.MeasuredSize.Pixels.Width === narrow, `NeedMeasure ${count.NeedMeasure}, ${lines()} line(s), width ${count.MeasuredSize.Pixels.Width}`);
  check("the row around it was not measured again", row.MeasuredSize.Pixels.Width === rowWidth, `${rowWidth} -> ${row.MeasuredSize.Pixels.Width}`);
  surface.delete();
  console.log(failures ? `FAIL: ${failures} checks` : "OK: a parent-independent control measures itself again in its slot");
  process.exit(failures ? 1 : 0);
})();
