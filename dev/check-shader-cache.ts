// SkiaShaderEffect.KeepParentCache (drawnui-cross 6ae, C# d0b1f2b6 ShaderKeepParentCacheTests), checked in Node
// (`npm run check:shader-cache`): a shader effect paints over its parent's cached content. With KeepParentCache a
// uniform change or an animation tick redraws the effect with the new value and the parent keeps its cache; without
// it (the default) every such change rebuilds the parent's cache.
import {
  Super, SKRect, SkiaAccessibilityManager, HoverManager, SkiaLayout, SkiaShape, SkiaShaderEffect, AnimatedShaderEffect,
  type Canvas, type AnimatorBase,
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
const Body = `
half4 main(float2 fragCoord)
{
    float2 inputCoord = (fragCoord - iOffset) * iImageResolution.xy / iResolution.xy;
    return mix(iImage1.eval(inputCoord), half4(0, 0, 1, 1), AMOUNT);
}
`;
const TintShader = Header + "uniform float uAmount;" + Body.replace("AMOUNT", "uAmount");
const ProgressShader = Header + "uniform float progress; uniform float2 iCenter;" + Body.replace("AMOUNT", "progress");

class FakeCanvas {
  readonly AccessibilityManager = new SkiaAccessibilityManager();
  readonly Hover = new HoverManager();
  readonly AnimatingControls = new Map<number, AnimatorBase>();
  RenderingScale = 1;
  GpuEpoch = 0;
  frames = 0;
  Update(): void { this.frames++; }
  DisposeObject(o: { Dispose(): void }): void { o.Dispose(); }
  RegisterAnimator(a: AnimatorBase): boolean { this.AnimatingControls.set(a.Uid, a); return true; }
  UnregisterAnimator(uid: number): void { this.AnimatingControls.delete(uid); }
}

(async () => {
  const CK = await CanvasKitInit({ locateFile: () => `${ROOT}/node_modules/canvaskit-wasm/bin/full/canvaskit.wasm` });
  (Super as unknown as { CK: unknown }).CK = CK;

  /** C# Scene: an Image-cached 200 x 200 layout filled red, the effect on it. */
  const scene = (effect: SkiaShaderEffect) => {
    const fake = new FakeCanvas();
    const card = new SkiaLayout(); card.UseCache = "Image"; card.WidthRequest = S; card.HeightRequest = S; card.VisualEffects = [effect];
    const red = new SkiaShape(); red.BackgroundColor = "#FF0000"; red.HorizontalOptions = "Fill"; red.VerticalOptions = "Fill";
    card.AddSubView(red);
    card._superview = fake as unknown as Canvas;
    let ms = 0;
    const frame = () => {
      ms += 16;
      for (const a of [...fake.AnimatingControls.values()]) if (!a.IsPaused) a.TickFrame(Math.round(ms * 1_000_000));
      const surface = CK.MakeSurface(S, S);
      card.Measure(S, S, 1); card.Arrange(new SKRect(0, 0, S, S), S, S, 1);
      card.Render({ Context: { Canvas: surface.getCanvas(), Surface: surface }, Destination: new SKRect(0, 0, S, S), Scale: 1 });
      const px = surface.makeImageSnapshot().readPixels(100, 100, { width: 1, height: 1, colorType: CK.ColorType.RGBA_8888, alphaType: CK.AlphaType.Unpremul, colorSpace: CK.ColorSpace.SRGB }) as Uint8Array;
      surface.delete();
      return { R: px[0], B: px[2] };
    };
    const frames = (n: number) => { let c = { R: 0, B: 0 }; for (let i = 0; i < n; i++) c = frame(); return c; };
    frames(6);
    return { fake, card, frames };
  };

  for (const keep of [true, false]) {
    const effect = new SkiaShaderEffect(); effect.ShaderCode = TintShader; effect.KeepParentCache = keep; effect.SetUniform("uAmount", 0);
    const { fake, card, frames } = scene(effect);
    const cache = card.RenderObject, before = frames(1);
    const asked = fake.frames;
    effect.SetUniform("uAmount", 1);
    const after = frames(3);
    check(`KeepParentCache ${keep}: SetUniform draws the new value, the parent's cache ${keep ? "kept" : "rebuilt"}`,
      !!cache && before.R > 200 && before.B < 50 && fake.frames > asked && after.B > 200 && after.R < 50 && (keep ? card.RenderObject === cache : card.RenderObject !== cache),
      `before R${before.R} B${before.B}, after R${after.R} B${after.B}, same cache ${card.RenderObject === cache}`);
  }

  {
    const effect = new AnimatedShaderEffect(); effect.ShaderCode = ProgressShader; effect.KeepParentCache = true; effect.DurationMs = 200;
    const { card, frames } = scene(effect);
    effect.Play();
    frames(2);
    const cache = card.RenderObject;
    const after = frames(20);
    check("AnimatedShaderEffect with KeepParentCache: the ticks animate over the same cache",
      !!cache && effect.Progress > 0.99 && after.B > 200 && after.R < 50 && card.RenderObject === cache,
      `progress ${effect.Progress.toFixed(2)}, R${after.R} B${after.B}, same cache ${card.RenderObject === cache}`);
  }

  console.log(failures ? `FAIL: ${failures} checks` : "OK: shader effects keep the parent's cache when asked");
  process.exit(failures ? 1 : 0);
})();
