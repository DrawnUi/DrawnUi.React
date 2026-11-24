// A shrunk tile keeps the weight of its thin lines (DrawnUi.Net f0da51c38: SkiaImageTiles draws its tile with the control's
// rescaling quality), checked in Node (`npm run check:tiles-thin-lines`): a 512 px pattern with 2 px lines every 32 px,
// drawn as 64 px tiles (an eighth of its size). Every line must come out the same (an area average: about a quarter
// dark), none lost or doubled, as an image downscaled with its mipmaps.
import { Super, SKRect, SkiaAccessibilityManager, HoverManager, SkiaLayer, SkiaImageTiles, type AnimatorBase, type Canvas } from "../src/index.ts";

declare const CanvasKitInit: (o: { locateFile: () => string }) => Promise<any>;
const ROOT = process.cwd();
const W = 128, H = 64;
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
  // white, a 2 px black vertical line every 32 px
  const s = CK.MakeSurface(512, 512), c = s.getCanvas(), p = new CK.Paint();
  c.clear(CK.WHITE); p.setColor(CK.BLACK);
  for (let x = 0; x < 512; x += 32) c.drawRect(CK.LTRBRect(x + 15, 0, x + 17, 512), p);
  const pattern = s.makeImageSnapshot(); p.delete(); s.delete();

  const tiles = new SkiaImageTiles();
  tiles.TileWidth = 64; tiles.TileHeight = 64; tiles.TileAspect = "AspectCover";
  tiles.HorizontalOptions = "Fill"; tiles.VerticalOptions = "Fill";
  tiles.ImageBitmap = pattern;
  const root = new SkiaLayer(); root.WidthRequest = W; root.HeightRequest = H; root.AddSubView(tiles);
  root._superview = new FakeCanvas() as unknown as Canvas;
  let px: Uint8Array = new Uint8Array();
  for (let i = 0; i < 3; i++) {
    const surface = CK.MakeSurface(W, H);
    root.Measure(W, H, 1); root.Arrange(new SKRect(0, 0, W, H), W, H, 1);
    root.Render({ Context: { Canvas: surface.getCanvas(), Surface: surface }, Destination: new SKRect(0, 0, W, H), Scale: 1 });
    px = surface.makeImageSnapshot().readPixels(0, 0, { width: W, height: H, colorType: CK.ColorType.RGBA_8888, alphaType: CK.AlphaType.Unpremul, colorSpace: CK.ColorSpace.SRGB }) as Uint8Array;
    surface.delete();
  }
  // darkness of each output column on the middle row: 255 - red
  const y = 32, dark = Array.from({ length: W }, (_, x) => 255 - px[(y * W + x) * 4]);
  // each 4-px period (32 source px / 8) must hold one line of the same total darkness (2 px of 32 black = 1/16 of the
  // period's light: about 255 * 4 / 16 = 64 summed over the period)
  const sums: number[] = [];
  for (let x = 0; x < W; x += 4) sums.push(dark[x] + dark[x + 1] + dark[x + 2] + dark[x + 3]);
  const min = Math.min(...sums), max = Math.max(...sums);
  check("every thin line keeps its weight in the shrunk tiles (the same darkness per period, none lost)", min > 40 && max - min <= 12, `per-period darkness ${min}..${max}, first periods ${sums.slice(0, 8).join(",")}`);
  console.log(failures ? `FAIL: ${failures} checks` : "OK: a shrunk tile keeps its thin lines");
  process.exit(failures ? 1 : 0);
})();
