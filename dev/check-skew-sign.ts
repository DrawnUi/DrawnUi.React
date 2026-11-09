// A negative SkewX / SkewY is used, not only a positive one (DrawnUi.Net d7759667: the matrix took a skew only when > 0),
// checked in Node (`npm run check:skew-sign`): a centered square skewed by -25 degrees draws the mirror image of the same
// square skewed by +25 (horizontal mirror for SkewX, vertical for SkewY), cached or not, and taps land on the drawn shape.
import { Super, SKRect, SKPoint, SkiaAccessibilityManager, HoverManager, SkiaLayer, SkiaShape, type AnimatorBase, type Canvas, type SkiaCacheType } from "../src/index.ts";

declare const CanvasKitInit: (o: { locateFile: () => string }) => Promise<any>;
const ROOT = process.cwd();
const S = 160;
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

  /** A white 60 x 60 square centered in a 160 x 160 black layer with the given skew; its pixels (1 = lit) and the shape. */
  const draw = (skewX: number, skewY: number, cache: SkiaCacheType) => {
    const root = new SkiaLayer(); root.WidthRequest = S; root.HeightRequest = S; root.BackgroundColor = "#000000";
    const shape = new SkiaShape(); shape.WidthRequest = 60; shape.HeightRequest = 60; shape.BackgroundColor = "#FFFFFF";
    shape.HorizontalOptions = "Center"; shape.VerticalOptions = "Center"; shape.SkewX = skewX; shape.SkewY = skewY; shape.UseCache = cache;
    root.AddSubView(shape);
    root._superview = new FakeCanvas() as unknown as Canvas;
    const surface = CK.MakeSurface(S, S);
    for (let i = 0; i < 2; i++) {
      root.Measure(S, S, 1); root.Arrange(new SKRect(0, 0, S, S), S, S, 1);
      root.Render({ Context: { Canvas: surface.getCanvas(), Surface: surface }, Destination: new SKRect(0, 0, S, S), Scale: 1 });
    }
    const px = surface.makeImageSnapshot().readPixels(0, 0, { width: S, height: S, colorType: CK.ColorType.RGBA_8888, alphaType: CK.AlphaType.Unpremul, colorSpace: CK.ColorSpace.SRGB }) as Uint8Array;
    surface.delete();
    const lit = (x: number, y: number) => px[(y * S + x) * 4] > 128;
    return { lit, root, shape };
  };
  /** Share of pixels where `a` differs from `b` read through `map`. */
  const differs = (a: (x: number, y: number) => boolean, b: (x: number, y: number) => boolean, map: (x: number, y: number) => [number, number]) => {
    let n = 0;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const [mx, my] = map(x, y); if (a(x, y) !== b(mx, my)) n++; }
    return n / (S * S);
  };

  for (const cache of ["None", "Image", "Operations"] as SkiaCacheType[]) {
    const plus = draw(25, 0, cache), minus = draw(-25, 0, cache), flat = draw(0, 0, cache);
    check(`SkewX -25 draws skewed (${cache})`, differs(minus.lit, flat.lit, (x, y) => [x, y]) > 0.02, `${(differs(minus.lit, flat.lit, (x, y) => [x, y]) * 100).toFixed(1)}% differ from no skew`);
    check(`SkewX -25 is the mirror of +25 (${cache})`, differs(minus.lit, plus.lit, (x, y) => [S - 1 - x, y]) < 0.005, `${(differs(minus.lit, plus.lit, (x, y) => [S - 1 - x, y]) * 100).toFixed(2)}% off`);
    const plusY = draw(0, 25, cache), minusY = draw(0, -25, cache);
    check(`SkewY -25 is the mirror of +25 (${cache})`, differs(minusY.lit, plusY.lit, (x, y) => [x, S - 1 - y]) < 0.005 && differs(minusY.lit, flat.lit, (x, y) => [x, y]) > 0.02,
      `${(differs(minusY.lit, plusY.lit, (x, y) => [x, S - 1 - y]) * 100).toFixed(2)}% off`);
  }
  // taps follow the drawn shape: with SkewX -25 the square's bottom leans right, its top left
  const { root, shape, lit } = draw(-25, 0, "None");
  const inside = (x: number, y: number) => (root as unknown as { IsGestureForChild(c: unknown, p: SKPoint): boolean }).IsGestureForChild(shape, new SKPoint(x, y));
  let agree = 0, total = 0;
  for (let y = 50; y <= 110; y += 5) for (let x = 30; x <= 130; x += 5) { total++; if (inside(x, y) === lit(x, y)) agree++; }
  check("SkewX -25: taps land where the skewed square is drawn", agree / total > 0.95, `${agree} of ${total} sample points agree`);

  console.log(failures ? `FAIL: ${failures} checks` : "OK: negative skews are used");
  process.exit(failures ? 1 : 0);
})();
