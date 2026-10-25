// SkiaBackdrop under transformed and picture-cached parents (drawnui-cross 6af, C# 6fd3bae3 / bcce0739
// BackdropTransformedParentTests), checked in Node (`npm run check:backdrop`). The backdrop copies the screen area it
// really covers (its rect through the canvas matrix: scale, move, rotation), drawn back 1:1, so with no blur every
// pixel it covers equals what is behind it. In an uncached shape it follows what is behind it; a picture-cached shape
// replays the copy it recorded (the documented freeze: the library never changes a parent's cache, the app sets
// UseCache = None). Brightness 1.0001 makes React draw the copy (with no effect at all it draws nothing).
import {
  Super, SKRect, SkiaAccessibilityManager, HoverManager, SkiaLayer, SkiaRow, SkiaShape, SkiaBackdrop,
  type Canvas, type AnimatorBase, type SkiaCacheType, type SkiaControl,
} from "../src/index.ts";

declare const CanvasKitInit: (o: { locateFile: () => string }) => Promise<any>;
const ROOT = process.cwd();
const W = 400, H = 200;
let failures = 0;
const check = (name: string, ok: boolean, detail = "") => { if (!ok) failures++; console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`); };
const STRIPES = ["#FF0000", "#008000", "#0000FF", "#FFFF00"];
const RGB: [number, number, number][] = [[255, 0, 0], [0, 128, 0], [0, 0, 255], [255, 255, 0]];

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

const glass = () => { const b = new SkiaBackdrop(); b.Blur = 0; b.Brightness = 1.0001; b.HorizontalOptions = "Fill"; b.VerticalOptions = "Fill"; return b; };
const stripes = (width: number, repeat: number) => {
  const row = new SkiaRow(); row.Spacing = 0; row.VerticalOptions = "Fill";
  for (let k = 0; k < repeat; k++) for (const c of STRIPES) { const s = new SkiaShape(); s.BackgroundColor = c; s.WidthRequest = width; s.VerticalOptions = "Fill"; row.AddSubView(s); }
  return row;
};

(async () => {
  const CK = await CanvasKitInit({ locateFile: () => `${ROOT}/node_modules/canvaskit-wasm/bin/full/canvaskit.wasm` });
  (Super as unknown as { CK: unknown }).CK = CK;

  const host = (content: SkiaControl[]) => {
    const root = new SkiaLayer(); root.WidthRequest = W; root.HeightRequest = H;
    for (const c of content) root.AddSubView(c);
    root._superview = new FakeCanvas() as unknown as Canvas;
    return () => {
      const surface = CK.MakeSurface(W, H);
      surface.getCanvas().clear(CK.BLACK);
      root.Measure(W, H, 1); root.Arrange(new SKRect(0, 0, W, H), W, H, 1);
      root.Render({ Context: { Canvas: surface.getCanvas(), Surface: surface }, Destination: new SKRect(0, 0, W, H), Scale: 1 });
      const px = surface.makeImageSnapshot().readPixels(0, 0, { width: W, height: H, colorType: CK.ColorType.RGBA_8888, alphaType: CK.AlphaType.Unpremul, colorSpace: CK.ColorSpace.SRGB }) as Uint8Array;
      surface.delete();
      return (x: number, y: number) => { const i = (y * W + x) * 4; return [px[i], px[i + 1], px[i + 2]] as [number, number, number]; };
    };
  };
  const off = (a: [number, number, number], b: [number, number, number]) => Math.abs(a[0] - b[0]) > 40 || Math.abs(a[1] - b[1]) > 40 || Math.abs(a[2] - b[2]) > 40;

  for (const [scale, tx, rot] of [[1, 0, 0], [0.75, 0, 0], [0.5, 0, 0], [1, 40, 0], [0.75, 30, 0], [1, 0, 30], [0.75, 20, 30], [1, 150, 0]]) {
    const frame = new SkiaLayer(); frame.WidthRequest = 200; frame.HeightRequest = 100; frame.HorizontalOptions = "Center"; frame.VerticalOptions = "Center";
    frame.Scale = scale; frame.TranslationX = tx; frame.Rotation = rot; frame.AddSubView(glass());
    const draw = host([stripes(100, 1), frame]);
    let px = draw(); for (let i = 0; i < 7; i++) px = draw();
    const w = 200 * scale, h = 100 * scale, cx = 200 + tx, cy = 100, r = Math.min(w, h) * 0.4;
    let wrong = 0, total = 0;
    for (let x = Math.trunc(cx - r); x < Math.trunc(cx + r); x += 2) for (let y = Math.trunc(cy - r); y < Math.trunc(cy + r); y += 2) {
      if ((x - cx) ** 2 + (y - cy) ** 2 > r * r || x < 0 || x >= W || y < 0 || y >= H) continue;
      total++;
      if (off(px(x, y), RGB[Math.floor(x / 100)])) wrong++;
    }
    check(`scale ${scale}, TranslationX ${tx}, Rotation ${rot}: the backdrop copies the screen it covers`, wrong === 0, `${wrong}/${total} pixels differ from the background`);
  }

  for (const cache of ["None"] as SkiaCacheType[]) {
    // the BlockChampion popup: the backdrop in a shape inside a frame that zooms 0.75 to 1
    const frame = new SkiaLayer(); frame.WidthRequest = 200; frame.HeightRequest = 100; frame.HorizontalOptions = "Center"; frame.VerticalOptions = "Center"; frame.Scale = 0.75;
    const shape = new SkiaShape(); shape.UseCache = cache; shape.HorizontalOptions = "Fill"; shape.VerticalOptions = "Fill"; shape.AddSubView(glass());
    frame.AddSubView(shape);
    const draw = host([stripes(50, 2), frame]);
    for (let i = 0; i < 6; i++) draw();
    frame.Scale = 1; frame.RepaintComposition();
    let px = draw(); for (let i = 0; i < 5; i++) px = draw();
    let wrong = 0, total = 0;
    for (let x = 110; x < 290; x += 3) for (let y = 60; y < 140; y += 5) { total++; if (off(px(x, y), RGB[Math.floor(x / 50) % 4])) wrong++; }
    check(`shape cache ${cache}, frame zoomed 0.75 to 1: the backdrop copies the screen it covers`, wrong === 0, `${wrong}/${total} pixels differ`);
  }

  for (const cache of ["Operations", "OperationsFull", "None"] as SkiaCacheType[]) {
    // the game-over popup: what is behind the glass changes, the glass must follow it
    const behind = new SkiaShape(); behind.BackgroundColor = "#FF0000"; behind.HorizontalOptions = "Fill"; behind.VerticalOptions = "Fill";
    const frame = new SkiaLayer(); frame.WidthRequest = 200; frame.HeightRequest = 100; frame.HorizontalOptions = "Center"; frame.VerticalOptions = "Center";
    const shape = new SkiaShape(); shape.UseCache = cache; shape.HorizontalOptions = "Fill"; shape.VerticalOptions = "Fill"; shape.AddSubView(glass());
    frame.AddSubView(shape);
    const draw = host([behind, frame]);
    // frames are separate tasks in the browser: microtasks run between them
    const tick = async () => { await new Promise((r) => setTimeout(r, 0)); return draw(); };
    for (let i = 0; i < 6; i++) await tick();
    behind.BackgroundColor = "#0000FF"; behind.UpdateDraw();
    let px = await tick(); for (let i = 0; i < 5; i++) px = await tick();
    const c = px(200, 100);
    if (cache === "None") check(`shape cache ${cache}: the glass follows what is behind it`, c[2] > 200 && c[0] < 50, `center rgb(${c.join(",")})`);
    else check(`shape cache ${cache}: the picture replays its recorded copy (documented freeze, the parent's cache untouched)`,
      c[0] > 200 && c[2] < 50 && shape.UsingCacheType === "Operations", `center rgb(${c.join(",")}), shape uses ${shape.UsingCacheType}`);
  }

  console.log(failures ? `FAIL: ${failures} checks` : "OK: backdrops copy what they cover");
  process.exit(failures ? 1 : 0);
})();
