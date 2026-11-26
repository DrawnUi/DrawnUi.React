// SkiaLabelFps as DrawnUi.Net (Nick, 2026-11-26: "still screens should show 0 fps"), checked in Node
// (`npm run check:fps-label`): the label shows the frames the canvas draws, 00.0 on a still screen, and asks for no frames
// by itself (a new value redraws it once); ForceRefresh keeps the canvas drawing; a hidden label asks for none.
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
  fake.FPS = 0;
  frame(); frame();
  check("a still screen shows FPS 00.0", fps.Text === "FPS 00.0", fps.Text);
  let before = fake.Updates; frame(); frame(); frame();
  check("on a still screen the label asks for no frames", fake.Updates === before, `${fake.Updates - before} requests in 3 frames`);
  fake.FPS = 60; frame();
  check("a new value shows on the next frame it draws", fps.Text === "FPS 60.0", fps.Text);
  frame(); before = fake.Updates; frame(); frame(); frame();
  check("the same value asks for nothing", fake.Updates === before, `${fake.Updates - before} requests in 3 frames`);
  fps.ForceRefresh = true; before = fake.Updates; frame(); frame(); frame();
  check("ForceRefresh keeps the canvas drawing: a request on every frame", fake.Updates - before >= 3, `${fake.Updates - before} requests in 3 frames`);
  fps.IsVisible = false; frame(); before = fake.Updates; frame(); frame();
  check("a hidden FPS label asks for no frames, ForceRefresh too", fake.Updates === before, `${fake.Updates - before} requests`);
  surface.delete();
  console.log(failures ? `FAIL: ${failures} checks` : "OK: the FPS label shows the frames the canvas draws, ForceRefresh keeps it drawing");
  process.exit(failures ? 1 : 0);
})();
