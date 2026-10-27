// ScrollToIndex into a recycled templated layout (SkiaWrap, split SkiaStack, SkiaGrid, SkiaRow, SkiaMasonry), checked in
// Node (`npm run check:scroll-recycled`): an item far off screen, whose view is not realized, is reached at its place,
// read from its slot; also with MeasureItemsStrategy MeasureVisible, which such layouts measure in full anyway.
import {
  Super, SKRect, Canvas, SkiaAccessibilityManager, HoverManager, SkiaLayout, SkiaShape, SkiaScroll,
  type AnimatorBase, type LayoutType, type MeasuringStrategy,
} from "../src/index.ts";

declare const CanvasKitInit: (o: { locateFile: () => string }) => Promise<any>;
const ROOT = process.cwd();
const W = 200, H = 200;
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

class Cell extends SkiaShape {
  constructor() { super(); this.BackgroundColor = "#483D8B"; this.WidthRequest = 50; this.HeightRequest = 60; }
}

(async () => {
  const CK = await CanvasKitInit({ locateFile: () => `${ROOT}/node_modules/canvaskit-wasm/bin/full/canvaskit.wasm` });
  (Super as unknown as { CK: unknown }).CK = CK;

  const run = (type: LayoutType, split: number, horizontal: boolean, strategy: MeasuringStrategy) => {
    const layout = new SkiaLayout(); layout.Type = type; layout.Split = split; layout.Spacing = 0; layout.MeasureItemsStrategy = strategy;
    if (!horizontal) layout.HorizontalOptions = "Fill";
    layout.RecyclingTemplate = "Enabled";
    layout.ItemTemplate = () => new Cell();
    layout.ItemsSource = Array.from({ length: 60 }, (_, i) => i);
    const scroll = new SkiaScroll(); scroll.Orientation = horizontal ? "Horizontal" : "Vertical"; scroll.Bounces = false;
    scroll.WidthRequest = W; scroll.HeightRequest = H; scroll.Content = layout;
    const fake = new FakeCanvas();
    scroll._superview = fake as unknown as Canvas;
    let ms = 0;
    const frames = (n: number) => {
      for (let f = 0; f < n; f++) {
        ms += 16;
        for (const a of [...fake.AnimatingControls.values()]) if (!a.IsPaused) a.TickFrame(Math.round(ms * 1_000_000));
        const surface = CK.MakeSurface(W, H);
        scroll.Measure(W, H, 1); scroll.Arrange(new SKRect(0, 0, W, H), W, H, 1);
        scroll.Render({ Context: { Canvas: surface.getCanvas(), Surface: surface }, Destination: new SKRect(0, 0, W, H), Scale: 1 });
        surface.delete();
      }
    };
    frames(6);
    const index = 30;
    const shownBefore = !!layout.ChildrenFactory.GetViewForIndex(index);
    const r = layout.GetItemRect(index);
    const want = r ? (horizontal ? r.Left - layout.DrawingRect.Left : r.Top - layout.DrawingRect.Top) : NaN;
    scroll.ScrollToIndex(index, false, "Start");
    frames(20);
    const offset = horizontal ? scroll.ViewportOffsetX : scroll.ViewportOffsetY;
    check(`${type}${split ? ` Split ${split}` : ""}${horizontal ? " (horizontal)" : ""} ${strategy}: ScrollToIndex reaches item 30, not shown before`,
      !shownBefore && Number.isFinite(want) && want > 0 && Math.abs(offset + want) < 1, `offset ${offset}, want ${-want}`);
  };

  for (const strategy of ["MeasureAll", "MeasureVisible"] as MeasuringStrategy[]) {
    run("Wrap", 3, false, strategy);
    run("Column", 2, false, strategy);
    run("Grid", 3, false, strategy);
    run("Masonry", 3, false, strategy);
    run("Row", 0, true, strategy);
  }

  console.log(failures ? `FAIL: ${failures} checks` : "OK: ScrollToIndex in recycled layouts");
  process.exit(failures ? 1 : 0);
})();
