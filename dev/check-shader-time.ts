// Shader iTime counts from the first shader frame (drawnui-cross 6bq, DrawnUi.Net 4a985047 ShaderTimeTests), checked in
// Node (`npm run check:shader-time`): with a page clock 18 days in, two effects draw frames 1/60 s apart; iTime starts
// at 0 for the first shader frame, both effects share that origin, and iTime as the GPU float (float32) still moves by
// a frame each frame, not in 0.125 s steps.
import { Super, SKRect, SkiaAccessibilityManager, HoverManager, SkiaLayer, SkiaShape, SkiaShaderEffect, type Canvas, type AnimatorBase } from "../src/index.ts";

declare const CanvasKitInit: (o: { locateFile: () => string }) => Promise<any>;
const ROOT = process.cwd();
const S = 100;
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

const Code = `
uniform float  iTime;
uniform float2 iResolution;
half4 main(float2 fragCoord) { return half4(fract(iTime), 0, 0, 1); }`;

(async () => {
  const CK = await CanvasKitInit({ locateFile: () => `${ROOT}/node_modules/canvaskit-wasm/bin/full/canvaskit.wasm` });
  (Super as unknown as { CK: unknown }).CK = CK;

  // the page has been open for 18 days
  let now = 18 * 86400 * 1000 + 123.456;
  performance.now = () => now;

  const root = new SkiaLayer(); root.WidthRequest = S; root.HeightRequest = S;
  const effects = [0, 1].map(() => {
    const shape = new SkiaShape(); shape.BackgroundColor = "#FFFFFF"; shape.WidthRequest = 40; shape.HeightRequest = 40; shape.UseCache = "None";
    const e = new SkiaShaderEffect(); e.ShaderCode = Code; shape.VisualEffects = [e];
    root.AddSubView(shape);
    return e;
  });
  root._superview = new FakeCanvas() as unknown as Canvas;
  const times: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const surface = CK.MakeSurface(S, S);
    root.Measure(S, S, 1); root.Arrange(new SKRect(0, 0, S, S), S, S, 1);
    root.Render({ Context: { Canvas: surface.getCanvas(), Surface: surface }, Destination: new SKRect(0, 0, S, S), Scale: 1 });
    surface.delete();
    times.push(effects.map((e) => e.TimeSeconds));
    now += 1000 / 60;
  }
  check("the first shader frame is iTime 0", times[0][0] === 0, `${times[0][0]}`);
  check("both effects share one origin", times.every((t) => t[0] === t[1]), JSON.stringify(times));
  const steps = times.slice(1).map((t, i) => Math.fround(t[0]) - Math.fround(times[i][0]));
  check("as a float32, iTime moves by one frame each frame (no 0.125 s steps)", steps.every((d) => Math.abs(d - 1 / 60) < 1e-4), steps.map((d) => d.toFixed(5)).join(" "));

  console.log(failures ? `FAIL: ${failures} checks` : "OK: iTime counts from the first shader frame");
  process.exit(failures ? 1 : 0);
})();
