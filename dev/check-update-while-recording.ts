// A change made while a parent's cache is being recorded (a child's paint shows a sibling, an event raised as a control
// draws) is drawn on the next frame (`npm run check:update-while-recording`): the parent's cache stays stale instead of
// keeping the picture recorded before the change. Found by the 3D gallery's product viewer (hotspot dots shown from
// ViewChanged, raised as the model draws inside its stage's cache).
import { Super, SKRect, SkiaLayer, SkiaShape, SkiaControl, SkiaAccessibilityManager, HoverManager, type AnimatorBase, type Canvas, type DrawingContext, type SkiaCacheType } from "../src/index.ts";

declare const CanvasKitInit: (o: { locateFile: () => string }) => Promise<any>;
const ROOT = process.cwd();
const W = 100, H = 50;
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
  ControlLeft(): void {}
}

/** Shows `dot` the first time it is painted (as the viewer shows its hotspots from ViewChanged). */
class Revealer extends SkiaControl {
  constructor(private readonly dot: SkiaControl) { super(); }
  protected override Paint(_ctx: DrawingContext): void { if (!this.dot.IsVisible) { this.dot.IsVisible = true; this.dot.Update(); } }
}

(async () => {
  const CK = await CanvasKitInit({ locateFile: () => `${ROOT}/node_modules/canvaskit-wasm/bin/full/canvaskit.wasm` });
  (Super as unknown as { CK: unknown }).CK = CK;
  for (const cache of ["None", "Operations", "Image"] as SkiaCacheType[]) {
    const root = new SkiaLayer(); root.WidthRequest = W; root.HeightRequest = H;
    const stage = new SkiaLayer(); stage.WidthRequest = W; stage.HeightRequest = H; stage.UseCache = cache;
    const dot = new SkiaShape(); dot.WidthRequest = 20; dot.HeightRequest = 20; dot.BackgroundColor = "#FF0000"; dot.IsVisible = false;
    const revealer = new Revealer(dot); revealer.WidthRequest = 10; revealer.HeightRequest = 10; revealer.HorizontalOptions = "End";
    stage.AddSubView(revealer); stage.AddSubView(dot);
    root.AddSubView(stage);
    root._superview = new FakeCanvas() as unknown as Canvas;
    const surface = CK.MakeSurface(W, H);
    const frame = () => {
      surface.getCanvas().clear(CK.TRANSPARENT);
      root.Measure(W, H, 1); root.Arrange(new SKRect(0, 0, W, H), W, H, 1);
      root.Render({ Context: { Canvas: surface.getCanvas(), Surface: surface }, Destination: new SKRect(0, 0, W, H), Scale: 1 });
      surface.flush();
      const px = surface.makeImageSnapshot();
      const p = px.readPixels(5, 5, { width: 1, height: 1, colorType: CK.ColorType.RGBA_8888, alphaType: CK.AlphaType.Unpremul, colorSpace: CK.ColorSpace.SRGB });
      px.delete();
      return p[0];
    };
    frame(); // the dot is shown while the stage's cache records
    const red = frame();
    check(`${cache} cache: a sibling shown while it recorded is drawn on the next frame`, red > 200, `red ${red}`);
    surface.delete();
  }
  console.log(failures ? `FAIL: ${failures} checks` : "OK: a change during a cache recording is drawn on the next frame");
  process.exit(failures ? 1 : 0);
})();
