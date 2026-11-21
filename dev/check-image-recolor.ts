// AddEffect "Recolor" paints a picture's brightness (0.30 R + 0.57 G + 0.13 B) in ColorTint, stretched around 0.5 by
// Contrast; on SkiaImageTiles the control's image effects apply once to the whole tiled result. Checked in Node
// (`npm run check:image-recolor`), port of DrawnUi.Net ImageRecolorTests (0c12ec284).
import { Super, SKRect, SkiaAccessibilityManager, HoverManager, SkiaLayer, SkiaImage, SkiaImageTiles, type AnimatorBase, type Canvas, type SkiaControl } from "../src/index.ts";

declare const CanvasKitInit: (o: { locateFile: () => string }) => Promise<any>;
const ROOT = process.cwd();
const W = 100, H = 100;
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

  /** w x h picture: left half gray 64, right half gray 191. */
  const twoGrays = (w: number, h: number) => {
    const s = CK.MakeSurface(w, h), c = s.getCanvas(), p = new CK.Paint();
    p.setColor(CK.Color(64, 64, 64, 1)); c.drawRect(CK.LTRBRect(0, 0, w / 2, h), p);
    p.setColor(CK.Color(191, 191, 191, 1)); c.drawRect(CK.LTRBRect(w / 2, 0, w, h), p);
    const img = s.makeImageSnapshot(); p.delete(); s.delete();
    return img;
  };
  const expected = (gray: number, tint: number[], contrast: number) => {
    const v = (gray / 255 - 0.5) * contrast + 0.5;
    return tint.map((t) => Math.min(255, Math.max(0, Math.round(v * t))));
  };
  /** Draws the control filling a 100 x 100 black canvas; returns pixel (x, y) as [r, g, b]. */
  const render = (control: SkiaControl) => {
    const root = new SkiaLayer(); root.WidthRequest = W; root.HeightRequest = H; root.BackgroundColor = "#000000";
    control.HorizontalOptions = "Fill"; control.VerticalOptions = "Fill";
    root.AddSubView(control);
    root._superview = new FakeCanvas() as unknown as Canvas;
    let px: Uint8Array = new Uint8Array();
    for (let i = 0; i < 3; i++) {
      const surface = CK.MakeSurface(W, H);
      root.Measure(W, H, 1); root.Arrange(new SKRect(0, 0, W, H), W, H, 1);
      root.Render({ Context: { Canvas: surface.getCanvas(), Surface: surface }, Destination: new SKRect(0, 0, W, H), Scale: 1 });
      px = surface.makeImageSnapshot().readPixels(0, 0, { width: W, height: H, colorType: CK.ColorType.RGBA_8888, alphaType: CK.AlphaType.Unpremul, colorSpace: CK.ColorSpace.SRGB }) as Uint8Array;
      surface.delete();
    }
    return (x: number, y: number) => { const i = (y * W + x) * 4; return [px[i], px[i + 1], px[i + 2]]; };
  };
  const near = (a: number[], b: number[]) => a.every((v, i) => Math.abs(v - b[i]) <= 3);

  for (const contrast of [1, 2.6]) {
    const tint = [97, 56, 140];
    const image = new SkiaImage();
    image.Aspect = "Fill"; image.AddEffect = "Recolor"; image.ColorTint = "#61388C"; image.Contrast = contrast;
    image.ImageBitmap = twoGrays(100, 100);
    const at = render(image);
    const dark = at(25, 50), light = at(75, 50);
    check(`Recolor, contrast ${contrast}: the dark half is the tint times its brightness`, near(dark, expected(64, tint, contrast)), `${dark} vs ${expected(64, tint, contrast)}`);
    check(`Recolor, contrast ${contrast}: the light half too`, near(light, expected(191, tint, contrast)), `${light} vs ${expected(191, tint, contrast)}`);
  }
  {
    const tint = [190, 140, 45];
    const tiles = new SkiaImageTiles();
    tiles.TileAspect = "AspectCover"; tiles.TileWidth = 20; tiles.TileHeight = 20;
    tiles.AddEffect = "Recolor"; tiles.ColorTint = "#BE8C2D"; tiles.Contrast = 1.6;
    tiles.ImageBitmap = twoGrays(40, 40);
    const at = render(tiles);
    let bad = "";
    for (let x = 0; x < 100; x += 20) {
      const d = at(x + 5, 50), l = at(x + 15, 50);
      if (!near(d, expected(64, tint, 1.6))) bad += ` tile ${x} dark ${d}`;
      if (!near(l, expected(191, tint, 1.6))) bad += ` tile ${x} light ${l}`;
    }
    check("SkiaImageTiles: the effect applies to the whole tiled result", bad === "", bad.trim() || `expected ${expected(64, tint, 1.6)} / ${expected(191, tint, 1.6)}`);
  }
  console.log(failures ? `FAIL: ${failures} checks` : "OK: Recolor paints the picture's brightness in the tint, on images and tiles");
  process.exit(failures ? 1 : 0);
})();
