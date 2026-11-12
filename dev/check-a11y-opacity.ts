// A control at opacity 0 is not read (DrawnUi.Net 4bd759e8, DrawnUi.Rust), checked in Node (`npm run check:a11y-opacity`):
// a label faded to 0 leaves the screen-reader tree with its children, and comes back when it is shown again.
import { readFileSync } from "node:fs";
import { Super, SKRect, SkiaAccessibilityManager, HoverManager, SkiaLayer, SkiaLabel, Aria, Thickness, type AnimatorBase, type Canvas } from "../src/index.ts";

declare const CanvasKitInit: (o: { locateFile: () => string }) => Promise<any>;
const ROOT = process.cwd();
const W = 400, H = 300;
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
  const face = CK.Typeface.MakeFreeTypeFaceFromData(readFileSync(`${ROOT}/samples/public/fonts/OpenSans-Regular.ttf`).buffer);
  Super.Fonts.set("FontText", new Map([[400, face]])); Super.DefaultTypeface = face; Super.DefaultFontAlias = "FontText";
  SkiaLabel.DefaultAccessibilityRole = Aria.RoleText;

  const fake = new FakeCanvas();
  fake.AccessibilityManager.MinUpdateIntervalMs = 0;
  const root = new SkiaLayer(); root.WidthRequest = W; root.HeightRequest = H;
  const label = (text: string, top: number) => { const l = new SkiaLabel(); l.Text = text; l.Margin = new Thickness(0, top, 0, 0); return l; };
  const shown = label("Shown", 0), faded = label("Faded", 40);
  const box = new SkiaLayer(); box.Margin = new Thickness(0, 80, 0, 0); box.HorizontalOptions = "Fill"; box.HeightRequest = 40;
  box.AddSubView(label("Inside", 0));
  root.AddSubView(shown); root.AddSubView(faded); root.AddSubView(box);
  root._superview = fake as unknown as Canvas;
  const surface = CK.MakeSurface(W, H);
  const frame = () => {
    root.Measure(W, H, 1); root.Arrange(new SKRect(0, 0, W, H), W, H, 1);
    root.Render({ Context: { Canvas: surface.getCanvas(), Surface: surface }, Destination: new SKRect(0, 0, W, H), Scale: 1 });
    fake.AccessibilityManager.OnFrameEnd(1, W, H, () => {});
    return fake.AccessibilityManager.Snapshot.map((n) => n.Label).join(",");
  };
  check("all shown: three labels read", frame() === "Shown,Faded,Inside", frame());
  faded.Opacity = 0; box.Opacity = 0; faded.Update(); box.Update();
  const hidden = frame();
  check("a label at opacity 0 and a layer at opacity 0 (with its label): only the shown label is read", hidden === "Shown", hidden);
  faded.Opacity = 1; box.Opacity = 1; faded.Update(); box.Update();
  const back = frame();
  check("shown again: read again", back === "Shown,Faded,Inside", back);
  surface.delete();

  console.log(failures ? `FAIL: ${failures} checks` : "OK: controls at opacity 0 are not read");
  process.exit(failures ? 1 : 0);
})();
