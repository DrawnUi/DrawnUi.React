// SkiaImage and SkiaSvg Tile, SkiaImage Grayscale (C# SkiaImageFeaturesTests cbf00fa1, SvgTileTests de5ba4bb), checked in
// Node (`npm run check:image-features`): Tile repeats the image (the SVG's raster) at its natural size over the whole
// control, starting from the aligned copy; the Grayscale effect uses the 0.21 / 0.72 / 0.07 weights, BlackAndWhite keeps
// 0.2989 / 0.587 / 0.114. The SVG raster is set by hand: Node has no browser to decode an SVG.
import { Super, SKRect, SkiaAccessibilityManager, HoverManager, SkiaImage, SkiaSvg, SkiaLayer, type SkiaControl, type AnimatorBase, type Canvas, type DrawImageAlignment, type SkiaImageEffect } from "../src/index.ts";

declare const CanvasKitInit: (o: { locateFile: () => string }) => Promise<any>;
const ROOT = process.cwd();
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
  const S = 100;

  /** Draws one 100 x 100 image control on a transparent 100 x 100 surface; returns a pixel reader. */
  const draw = (img: unknown, setup: (i: SkiaImage) => void) => render(() => {
    const image = new SkiaImage(); image.WidthRequest = S; image.HeightRequest = S; image.UseCache = "None";
    setup(image);
    (image as unknown as { LoadedSource: unknown }).LoadedSource = img;
    return image;
  });
  /** A 10 x 10 point SVG whose raster at scale 1 is `img`. */
  const drawSvg = (img: unknown, h: DrawImageAlignment, v: DrawImageAlignment) => render(() => {
    const svg = new SkiaSvg(); svg.WidthRequest = S; svg.HeightRequest = S; svg.UseCache = "None"; svg.Aspect = "Tile";
    svg.HorizontalAlignment = h; svg.VerticalAlignment = v;
    Object.assign(svg as unknown as Record<string, unknown>, { element: {}, intrinsic: { Width: 10, Height: 10 }, raster: img, rasterKey: "10x10" });
    return svg;
  });
  const render = (make: () => SkiaControl) => {
    const root = new SkiaLayer(); root.WidthRequest = S; root.HeightRequest = S;
    root.AddSubView(make());
    root._superview = new FakeCanvas() as unknown as Canvas;
    const surface = CK.MakeSurface(S, S);
    surface.getCanvas().clear(CK.TRANSPARENT);
    root.Measure(S, S, 1); root.Arrange(new SKRect(0, 0, S, S), S, S, 1);
    root.Render({ Context: { Canvas: surface.getCanvas(), Surface: surface }, Destination: new SKRect(0, 0, S, S), Scale: 1 });
    const px = surface.makeImageSnapshot().readPixels(0, 0, { width: S, height: S, colorType: CK.ColorType.RGBA_8888, alphaType: CK.AlphaType.Unpremul, colorSpace: CK.ColorSpace.SRGB }) as Uint8Array;
    surface.delete();
    return (x: number, y: number) => { const i = (y * S + x) * 4; return [px[i], px[i + 1], px[i + 2], px[i + 3]]; };
  };
  const isWhite = (p: number[]) => p[0] > 230 && p[1] > 230 && p[2] > 230 && p[3] > 230;
  const isBlue = (p: number[]) => p[2] > 200 && p[0] < 40 && p[1] < 40 && p[3] > 230;

  // a 10 x 10 blue tile with a 2 x 2 white block at its top left
  const tileSurface = CK.MakeSurface(10, 10);
  const tc = tileSurface.getCanvas();
  tc.clear(CK.BLUE);
  const white = new CK.Paint(); white.setColor(CK.WHITE); tc.drawRect(CK.LTRBRect(0, 0, 2, 2), white);
  const tile = tileSurface.makeImageSnapshot();

  const start = draw(tile, (i) => { i.Aspect = "Tile"; i.HorizontalAlignment = "Start" as DrawImageAlignment; i.VerticalAlignment = "Start" as DrawImageAlignment; });
  let copies = 0, total = 0;
  for (let y = 0; y < S; y += 10) for (let x = 0; x < S; x += 10) { total++; if (isWhite(start(x + 1, y + 1)) && isBlue(start(x + 5, y + 5))) copies++; }
  check("Tile, Start: the image repeats at its natural size over the whole control", copies === total, `${copies} of ${total} copies`);
  const centered = draw(tile, (i) => { i.Aspect = "Tile"; i.HorizontalAlignment = "Center" as DrawImageAlignment; i.VerticalAlignment = "Center" as DrawImageAlignment; });
  check("Tile, Center: the copies start from the centered one", isWhite(centered(46, 46)) && isWhite(centered(6, 96)) && isBlue(centered(41, 41)) && isBlue(centered(1, 1)),
    `46,46 ${centered(46, 46)} 6,96 ${centered(6, 96)} 41,41 ${centered(41, 41)} 1,1 ${centered(1, 1)}`);

  const svgStart = drawSvg(tile, "Start" as DrawImageAlignment, "Start" as DrawImageAlignment);
  copies = 0;
  for (let y = 0; y < S; y += 10) for (let x = 0; x < S; x += 10) if (isWhite(svgStart(x + 1, y + 1)) && isBlue(svgStart(x + 5, y + 5))) copies++;
  check("SkiaSvg Tile, Start: the picture repeats at its natural size over the whole control", copies === total, `${copies} of ${total} copies`);
  const svgCentered = drawSvg(tile, "Center" as DrawImageAlignment, "Center" as DrawImageAlignment);
  check("SkiaSvg Tile, Center: the copies start from the centered one", isWhite(svgCentered(46, 46)) && isWhite(svgCentered(6, 96)) && isBlue(svgCentered(1, 1)),
    `46,46 ${svgCentered(46, 46)} 6,96 ${svgCentered(6, 96)} 1,1 ${svgCentered(1, 1)}`);

  const redSurface = CK.MakeSurface(10, 10); redSurface.getCanvas().clear(CK.RED);
  const red = redSurface.makeImageSnapshot();
  const gray = (effect: SkiaImageEffect) => draw(red, (i) => { i.Aspect = "Fill"; i.AddEffect = effect; })(50, 50);
  const g = gray("Grayscale"), bw = gray("BlackAndWhite");
  check("Grayscale on pure red: 0.21 weight, about 54", Math.abs(g[0] - 54) <= 2 && g[0] === g[1] && g[1] === g[2], `${g}`);
  check("BlackAndWhite on pure red: 0.2989 weight, about 76", Math.abs(bw[0] - 76) <= 2 && bw[0] === bw[1] && bw[1] === bw[2], `${bw}`);

  console.log(failures ? `FAIL: ${failures} checks` : "OK: image and svg Tile, Grayscale");
  process.exit(failures ? 1 : 0);
})();
