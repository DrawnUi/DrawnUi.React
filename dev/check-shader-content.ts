// What a shader effect reads (iImage1) and what it replaces, per cache type of its control (drawnui-cross 6ae,
// C# caa1c8c1 ShaderEffectContentByCacheTests), checked in Node (`npm run check:shader-content`). A CACHED control
// (Image, Operations, OperationsFull, ...): the shader replaces the control and iImage1 is the control's own content.
// An UNCACHED control (None): the control paints, the shader draws over it and iImage1 is the canvas there.
import {
  Super, SKRect, Thickness, SkiaAccessibilityManager, HoverManager, SkiaLayer, SkiaShape, SkiaShaderEffect,
  type Canvas, type AnimatorBase, type SkiaCacheType,
} from "../src/index.ts";

declare const CanvasKitInit: (o: { locateFile: () => string }) => Promise<any>;
const ROOT = process.cwd();
const S = 200;
let failures = 0;
const check = (name: string, ok: boolean, detail = "") => { if (!ok) failures++; console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`); };

const Header = `
uniform float4 iMouse;
uniform float  iTime;
uniform float2 iResolution;
uniform float2 iImageResolution;
uniform shader iImage1;
uniform float2 iOffset;
`;
/** Returns its input: shows what iImage1 holds. */
const PassThrough = Header + `
half4 main(float2 fragCoord) { return iImage1.eval((fragCoord - iOffset) * iImageResolution.xy / iResolution.xy); }`;
/** Returns nothing: shows what is left under the effect. */
const Transparent = Header + `
half4 main(float2 fragCoord) { return half4(0); }`;
const Tint = Header + `
uniform float uAmount;
half4 main(float2 fragCoord)
{
    half4 c = iImage1.eval((fragCoord - iOffset) * iImageResolution.xy / iResolution.xy);
    return mix(c, half4(0, 0, 1, 1), uAmount);
}`;

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

const name = (p: { R: number; G: number; B: number }) =>
  p.R > 200 && p.G < 60 && p.B < 60 ? "content" : p.G > 120 && p.R < 60 && p.B < 60 ? "behind" : `rgb(${p.R},${p.G},${p.B})`;

(async () => {
  const CK = await CanvasKitInit({ locateFile: () => `${ROOT}/node_modules/canvaskit-wasm/bin/full/canvaskit.wasm` });
  (Super as unknown as { CK: unknown }).CK = CK;

  /** C# scene: a red 100 x 100 shape at (50, 50) carrying the effect, over a green full-canvas shape. */
  const scene = (shape: SkiaShape) => {
    const root = new SkiaLayer(); root.WidthRequest = S; root.HeightRequest = S;
    const green = new SkiaShape(); green.BackgroundColor = "#008000"; green.HorizontalOptions = "Fill"; green.VerticalOptions = "Fill";
    shape.BackgroundColor = "#FF0000"; shape.WidthRequest = 100; shape.HeightRequest = 100; shape.Margin = new Thickness(50, 50, 0, 0);
    root.AddSubView(green); root.AddSubView(shape);
    root._superview = new FakeCanvas() as unknown as Canvas;
    return () => {
      const surface = CK.MakeSurface(S, S);
      root.Measure(S, S, 1); root.Arrange(new SKRect(0, 0, S, S), S, S, 1);
      root.Render({ Context: { Canvas: surface.getCanvas(), Surface: surface }, Destination: new SKRect(0, 0, S, S), Scale: 1 });
      const px = surface.makeImageSnapshot().readPixels(100, 100, { width: 1, height: 1, colorType: CK.ColorType.RGBA_8888, alphaType: CK.AlphaType.Unpremul, colorSpace: CK.ColorSpace.SRGB }) as Uint8Array;
      surface.delete();
      return { R: px[0], G: px[1], B: px[2] };
    };
  };
  const render = (cache: SkiaCacheType, shader: string) => {
    const shape = new SkiaShape(); shape.UseCache = cache;
    const e = new SkiaShaderEffect(); e.ShaderCode = shader; shape.VisualEffects = [e];
    const frame = scene(shape);
    let p = frame(); for (let i = 0; i < 7; i++) p = frame();
    return name(p);
  };

  const cases: [SkiaCacheType, string, string][] = [
    ["Image", "content", "behind"], ["Operations", "content", "behind"], ["OperationsFull", "content", "behind"], ["None", "content", "content"],
  ];
  for (const [cache, pass, clear] of cases) {
    const p = render(cache, PassThrough), c = render(cache, Transparent);
    check(`${cache}: passthrough = ${pass}, transparent = ${clear}`, p === pass && c === clear, `passthrough=${p} transparent=${c}`);
  }

  {
    // the default (the parent's cache kept) on a picture-cached shape (SkiaShape's default Operations): picture kept, new value drawn
    const shape = new SkiaShape();
    const e = new SkiaShaderEffect(); e.ShaderCode = Tint; e.SetUniform("uAmount", 0);
    shape.VisualEffects = [e];
    const frame = scene(shape);
    for (let i = 0; i < 8; i++) frame();
    const cache = shape.RenderObject, before = name(frame());
    e.SetUniform("uAmount", 1);
    let after = frame(); after = frame(); after = frame();
    check("SetUniform on an Operations shape: picture kept, the new value drawn",
      shape.UsingCacheType === "Operations" && !!cache?.Picture && before === "content" && after.B > 200 && after.R < 50 && shape.RenderObject === cache,
      `before ${before}, after rgb(${after.R},${after.G},${after.B}), same picture ${shape.RenderObject === cache}`);
  }

  console.log(failures ? `FAIL: ${failures} checks` : "OK: shader effects read and replace by cache type");
  process.exit(failures ? 1 : 0);
})();
