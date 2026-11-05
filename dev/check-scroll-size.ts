// A SkiaScroll's own size (C# SetMeasuredAdaptToContentSize, NeedAutoWidth / NeedAutoHeight; DrawnUi.Rust scroll
// measure), checked in Node (`npm run check:scroll-size`): a side without a request that is not Fill takes the content's
// size, up to the space it is given; Fill or a request takes the box.
import { Super, SKRect, SkiaAccessibilityManager, HoverManager, SkiaLayer, SkiaScroll, SkiaShape, type AnimatorBase, type Canvas, type LayoutOptions } from "../src/index.ts";

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

  /** A scroll in a 400 x 300 point box holding a `cw` x `ch` shape; returns the scroll's arranged size in points. */
  const size = (cw: number, ch: number, setup: (s: SkiaScroll) => void = () => {}) => {
    const root = new SkiaLayer(); root.WidthRequest = 400; root.HeightRequest = 300;
    const scroll = new SkiaScroll(); setup(scroll);
    const content = new SkiaShape(); content.WidthRequest = cw; content.HeightRequest = ch; content.BackgroundColor = "#808080";
    scroll.Content = content;
    root.AddSubView(scroll);
    root._superview = new FakeCanvas() as unknown as Canvas;
    root.Measure(400, 300, 1); root.Arrange(new SKRect(0, 0, 400, 300), 400, 300, 1);
    return `${Math.round(scroll.DrawingRect.Width)}x${Math.round(scroll.DrawingRect.Height)}`;
  };
  const fill = (h: LayoutOptions, v: LayoutOptions) => (s: SkiaScroll) => { s.HorizontalOptions = h; s.VerticalOptions = v; };

  check("no size, short content: the content's size", size(100, 50) === "100x50", size(100, 50));
  check("no size, long content: as tall as the space, as wide as the content", size(100, 1000) === "100x300", size(100, 1000));
  check("Fill both ways: the whole space", size(100, 50, fill("Fill", "Fill")) === "400x300", size(100, 50, fill("Fill", "Fill")));
  check("Fill vertically only: full height, the content's width", size(100, 50, fill("Start", "Fill")) === "100x300", size(100, 50, fill("Start", "Fill")));
  check("HeightRequest 200: that height", size(100, 50, (s) => { s.HeightRequest = 200; }) === "100x200", size(100, 50, (s) => { s.HeightRequest = 200; }));
  check("horizontal scroll, long content: as wide as the space", size(1000, 50, (s) => { s.Orientation = "Horizontal"; }) === "400x50", size(1000, 50, (s) => { s.Orientation = "Horizontal"; }));

  console.log(failures ? `FAIL: ${failures} checks` : "OK: scroll size");
  process.exit(failures ? 1 : 0);
})();
