// A recycled cell cached as ImageDoubleBuffered never shows the previous item's picture after it is rebound to another
// item (DrawnUi.Net PixelsForeign), checked in Node (`npm run check:recycled-doublebuffer`): a recycled column in a scroll,
// cells red for even items and blue for odd ones, the scroll jumped by an odd number of rows so every reused cell gets
// an item of the other color; on the first frame after the jump every cell on screen shows its own item's color.
// (On the web the cache is made inside the frame, so a rebound cell is drawn new at once.)
import {
  Super, SKRect, Canvas, SkiaAccessibilityManager, HoverManager, SkiaLayout, SkiaScroll, SkiaDynamicDrawnCell, type AnimatorBase,
} from "../src/index.ts";

declare const CanvasKitInit: (o: { locateFile: () => string }) => Promise<any>;
const ROOT = process.cwd();
const W = 200, H = 200, ROW = 40;
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

class Cell extends SkiaDynamicDrawnCell {
  constructor() { super(); this.Type = "Absolute"; this.HorizontalOptions = "Fill"; this.HeightRequest = ROW; this.UseCache = "ImageDoubleBuffered"; }
  protected override SetContent(ctx: unknown): void { this.BackgroundColor = (ctx as number) % 2 === 0 ? "#FF0000" : "#0000FF"; this.UpdateDraw(); }
}

(async () => {
  const CK = await CanvasKitInit({ locateFile: () => `${ROOT}/node_modules/canvaskit-wasm/bin/full/canvaskit.wasm` });
  (Super as unknown as { CK: unknown }).CK = CK;

  const layout = new SkiaLayout(); layout.Type = "Column"; layout.Spacing = 0; layout.HorizontalOptions = "Fill";
  layout.RecyclingTemplate = "Enabled"; layout.MeasureItemsStrategy = "MeasureFirst";
  layout.ItemTemplate = () => new Cell();
  layout.ItemsSource = Array.from({ length: 200 }, (_, i) => i);
  const scroll = new SkiaScroll(); scroll.WidthRequest = W; scroll.HeightRequest = H; scroll.Bounces = false; scroll.Content = layout;
  scroll._superview = new FakeCanvas() as unknown as Canvas;
  const surface = CK.MakeSurface(W, H);
  const frame = () => {
    surface.getCanvas().clear(CK.BLACK);
    scroll.Measure(W, H, 1); scroll.Arrange(new SKRect(0, 0, W, H), W, H, 1);
    scroll.Render({ Context: { Canvas: surface.getCanvas(), Surface: surface }, Destination: new SKRect(0, 0, W, H), Scale: 1 });
    surface.flush();
  };
  const colorAt = (y: number) => {
    const px = surface.getCanvas().readPixels(W / 2, y, { width: 1, height: 1, colorType: CK.ColorType.RGBA_8888, alphaType: CK.AlphaType.Unpremul, colorSpace: CK.ColorSpace.SRGB }) as Uint8Array;
    return px[0] > 200 && px[2] < 60 ? "red" : px[2] > 200 && px[0] < 60 ? "blue" : `rgb(${px[0]},${px[1]},${px[2]})`;
  };
  for (let i = 0; i < 4; i++) frame();
  for (const rows of [3, 11, 7]) {
    scroll.ViewportOffsetY -= rows * ROW; // an odd number of rows: every reused cell gets an item of the other color
    frame();
    const top = -scroll.ViewportOffsetY;
    const wrong: string[] = [];
    for (let y = 5; y < H; y += ROW) {
      const item = Math.floor((top + y) / ROW), want = item % 2 === 0 ? "red" : "blue", got = colorAt(y);
      if (got !== want) wrong.push(`item ${item}: ${got}`);
    }
    check(`jumped ${rows} rows: the first frame shows each cell's own item (no previous item's picture)`, wrong.length === 0, wrong.join(", "));
  }
  const created = /created (\d+)/.exec(layout.DebugString)?.[1];
  check("the cells were reused (a few views for 200 items)", !!created && Number(created) < 20, layout.DebugString);
  surface.delete();
  console.log(failures ? `FAIL: ${failures} checks` : "OK: a rebound ImageDoubleBuffered cell never shows the previous item");
  process.exit(failures ? 1 : 0);
})();
