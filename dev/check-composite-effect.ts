// An ImageComposite layer keeps drawing its children through a shader effect's life (arkanoid repro, DrawnUi.Net
// 8b82c288: the reused surface returned the same snapshot image to two cache objects, and disposing the old one killed
// the live one), checked in Node (`npm run check:composite-effect`): a composite-cached layer with 12 children, a
// pass-through SkiaShaderEffect reading the layer's cache, frames, the effect removed, a frame, the effect disposed,
// frames. Every frame shows the children. Disposals wait for the frame end, as on the real Canvas.
import { Super, SKRect, SkiaAccessibilityManager, HoverManager, SkiaLayout, SkiaShape, SkiaShaderEffect, Thickness, type Canvas, type AnimatorBase } from "../src/index.ts";

declare const CanvasKitInit: (o: { locateFile: () => string }) => Promise<any>;
const ROOT = process.cwd();
const S = 240;
let failures = 0;
const check = (name: string, ok: boolean, detail = "") => { if (!ok) failures++; console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`); };

const PassThrough = `
uniform float4 iMouse;
uniform float  iTime;
uniform float2 iResolution;
uniform float2 iImageResolution;
uniform shader iImage1;
uniform float2 iOffset;
half4 main(float2 fragCoord)
{
    return iImage1.eval((fragCoord - iOffset) * iImageResolution.xy / iResolution.xy);
}
`;

class FakeCanvas {
  readonly AccessibilityManager = new SkiaAccessibilityManager();
  readonly Hover = new HoverManager();
  readonly AnimatingControls = new Map<number, AnimatorBase>();
  RenderingScale = 1;
  GpuEpoch = 0;
  readonly queue: { Dispose(): void }[] = [];
  Update(): void {}
  DisposeObject(o: { Dispose(): void }): void { this.queue.push(o); }
  Drain(): void { for (const o of this.queue.splice(0)) o.Dispose(); }
  RegisterAnimator(a: AnimatorBase): boolean { this.AnimatingControls.set(a.Uid, a); return true; }
  UnregisterAnimator(uid: number): void { this.AnimatingControls.delete(uid); }
  ControlLeft(): void {}
}

(async () => {
  const CK = await CanvasKitInit({ locateFile: () => `${ROOT}/node_modules/canvaskit-wasm/bin/full/canvaskit.wasm` });
  (Super as unknown as { CK: unknown }).CK = CK;

  const fake = new FakeCanvas();
  const layer = new SkiaLayout(); layer.UseCache = "ImageComposite"; layer.WidthRequest = S; layer.HeightRequest = S; layer.BackgroundColor = "#000000";
  // 12 red squares on a black layer, 4 per row
  for (let i = 0; i < 12; i++) {
    const c = new SkiaShape(); c.BackgroundColor = "#FF0000"; c.WidthRequest = 40; c.HeightRequest = 40;
    c.Margin = new Thickness(10 + (i % 4) * 56, 10 + Math.floor(i / 4) * 56, 0, 0);
    layer.AddSubView(c);
  }
  layer._superview = fake as unknown as Canvas;
  const surface = CK.MakeSurface(S, S);
  /** One frame; the share of the 12 squares' centers that show red. */
  const frame = () => {
    surface.getCanvas().clear(CK.TRANSPARENT);
    layer.Measure(S, S, 1); layer.Arrange(new SKRect(0, 0, S, S), S, S, 1);
    layer.Render({ Context: { Canvas: surface.getCanvas(), Surface: surface }, Destination: new SKRect(0, 0, S, S), Scale: 1 });
    surface.flush();
    const px = surface.makeImageSnapshot().readPixels(0, 0, { width: S, height: S, colorType: CK.ColorType.RGBA_8888, alphaType: CK.AlphaType.Unpremul, colorSpace: CK.ColorSpace.SRGB }) as Uint8Array;
    fake.Drain(); // disposals after the frame, as Canvas.DrainDisposeQueue
    let red = 0;
    for (let i = 0; i < 12; i++) {
      const x = 30 + (i % 4) * 56, y = 30 + Math.floor(i / 4) * 56, o = (y * S + x) * 4;
      if (px[o] > 200 && px[o + 1] < 60 && px[o + 3] > 200) red++;
    }
    return red;
  };
  const frames = (n: number) => { let min = 12; for (let i = 0; i < n; i++) min = Math.min(min, frame()); return min; };

  check("the layer draws its 12 children", frames(3) === 12);
  const effect = new SkiaShaderEffect(); effect.ShaderCode = PassThrough;
  layer.VisualEffects = [effect];
  check("with the pass-through effect reading its cache: all 12, every frame", frames(6) === 12);
  layer.VisualEffects = [];
  check("the effect removed: all 12", frames(1) === 12);
  effect.Dispose();
  check("the effect disposed: all 12, every frame", frames(6) === 12);
  const again = new SkiaShaderEffect(); again.ShaderCode = PassThrough;
  layer.VisualEffects = [again];
  const withAgain = frames(4);
  layer.VisualEffects = []; again.Dispose();
  check("an effect added and removed again: all 12 throughout", withAgain === 12 && frames(4) === 12);

  surface.delete();
  console.log(failures ? `FAIL: ${failures} checks` : "OK: a composite layer keeps its children through an effect's life");
  process.exit(failures ? 1 : 0);
})();
