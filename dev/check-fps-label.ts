// SkiaLabelFps keeps its canvas drawing while it is shown, as DrawnUi.Net and Rust (drawnui-cross), checked in Node
// (`npm run check:fps-label`): every frame it draws asks for the next one, so the number is the frame rate the canvas
// reaches; a hidden label asks for none.
import { readFileSync } from "node:fs";
import { Super, SKRect, SkiaAccessibilityManager, HoverManager, SkiaLayer, SkiaLabel, SkiaLabelFps, Aria, Thickness, type AnimatorBase, type Canvas } from "../src/index.ts";

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
  Updates = 0;
  FPS = 60;
  Update(): void { this.Updates++; }
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

  const surface = CK.MakeSurface(W, H);
  const fake = new FakeCanvas();
  const root = new SkiaLayer(); root.WidthRequest = W; root.HeightRequest = H;
  const fps = new SkiaLabelFps(); root.AddSubView(fps);
  root._superview = fake as unknown as Canvas;
  const frame = () => { root.Measure(W, H, 1); root.Arrange(new SKRect(0, 0, W, H), W, H, 1); root.Render({ Context: { Canvas: surface.getCanvas(), Surface: surface }, Destination: new SKRect(0, 0, W, H), Scale: 1 }); };
  let before = fake.Updates; frame(); frame(); frame();
  check("an FPS label on screen asks for the next frame on every frame it draws (no animator running)", fake.Updates - before >= 3, `${fake.Updates - before} requests in 3 frames`);
  frame(); check("it shows the canvas FPS", fps.Text === "FPS 60.0", fps.Text);
  fps.IsVisible = false; frame(); before = fake.Updates; frame(); frame();
  check("a hidden FPS label asks for no frames", fake.Updates === before, `${fake.Updates - before} requests`);
  surface.delete();
  console.log(failures ? `FAIL: ${failures} checks` : "OK: an FPS label keeps its canvas drawing while it is shown");
  process.exit(failures ? 1 : 0);
})();
