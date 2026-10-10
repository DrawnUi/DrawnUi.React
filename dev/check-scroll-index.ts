// ScrollToIndex follows rows as they are measured (C# OrderedScrollToIndex, DrawnUi.Rust scroll_to_index), checked in
// Node (`npm run check:scroll-index`): in a MeasureVisible list whose later rows are taller than the first ones, a
// jump to a row not measured yet goes there by the estimate and is aimed again until the row has its real place, then
// it stands at the viewport start; an animated jump to the end lands on the last row; LoadMore waits while the order
// is open and fires once after it.
import { readFileSync } from "node:fs";
import { Super, SKRect, SkiaAccessibilityManager, HoverManager, SkiaScroll, SkiaStack, SkiaDynamicDrawnCell, type AnimatorBase, type Canvas } from "../src/index.ts";

declare const CanvasKitInit: (o: { locateFile: () => string }) => Promise<any>;
const ROOT = process.cwd();
let failures = 0;
const check = (name: string, ok: boolean, detail = "") => { if (!ok) failures++; console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
(globalThis as unknown as { window: unknown }).window = globalThis; // background measurement schedules with window.setTimeout

class FakeCanvas {
  readonly AccessibilityManager = new SkiaAccessibilityManager();
  readonly Hover = new HoverManager();
  readonly AnimatingControls = new Map<number, AnimatorBase>();
  RenderingScale = 1;
  GpuEpoch = 0;
  FrameTimeNanos = 0;
  Update(): void {}
  readonly disposeQueue: { Dispose(): void }[] = [];
  DisposeObject(o: { Dispose(): void }): void { this.disposeQueue.push(o); }
  RegisterAnimator(a: AnimatorBase): boolean { this.AnimatingControls.set(a.Uid, a); return true; }
  UnregisterAnimator(uid: number): void { this.AnimatingControls.delete(uid); }
}

/** A row as tall as its item says. */
class RowCell extends SkiaDynamicDrawnCell {
  constructor() { super(); this.HorizontalOptions = "Fill"; this.BackgroundColor = "#444444"; }
  protected override SetContent(ctx: unknown): void { this.HeightRequest = (ctx as { h: number }).h; }
}

(async () => {
  const CK = await CanvasKitInit({ locateFile: () => `${ROOT}/node_modules/canvaskit-wasm/bin/full/canvaskit.wasm` });
  (Super as unknown as { CK: unknown }).CK = CK;
  const face = CK.Typeface.MakeFreeTypeFaceFromData(readFileSync(`${ROOT}/samples/public/fonts/OpenSans-Regular.ttf`).buffer);
  Super.Fonts.set("FontText", new Map([[400, face]])); Super.DefaultTypeface = face; Super.DefaultFontAlias = "FontText";

  // the first rows are short, the rest three times taller: the estimate from the first screen is far too short
  const items = Array.from({ length: 3000 }, (_, i) => ({ h: i < 60 ? 40 : 120 }));
  const W = 360, H = 640;
  const host = () => {
    const fake = new FakeCanvas();
    const list = new SkiaStack(); list.Spacing = 0; list.MeasureItemsStrategy = "MeasureVisible"; list.ItemTemplate = () => new RowCell(); list.ItemsSource = items;
    const scroll = new SkiaScroll(); scroll.Orientation = "Vertical"; scroll.Content = list;
    scroll._superview = fake as unknown as Canvas;
    const surface = CK.MakeSurface(W, H);
    const frame = () => {
      fake.FrameTimeNanos = performance.now() * 1e6;
      for (const a of [...fake.AnimatingControls.values()]) a.TickFrame(fake.FrameTimeNanos);
      scroll.Measure(W, H, 1); scroll.Arrange(new SKRect(0, 0, W, H), -1, -1, 1);
      scroll.Render({ Context: { Canvas: surface.getCanvas(), Surface: surface }, Destination: new SKRect(0, 0, W, H), Scale: 1 });
      for (const o of fake.disposeQueue.splice(0)) o.Dispose();
    };
    const open = () => !!(scroll as unknown as { indexOrder?: unknown }).indexOrder;
    /** Pixels between the row's real top and the viewport start (0 = the row stands at the start). */
    const miss = (index: number) => list.GetItemOffsetPixels(index) - list.Padding.Top + scroll.ViewportOffsetY;
    return { scroll, list, frame, open, miss };
  };
  const run = async (h: ReturnType<typeof host>, ms: number, each?: () => void) => { const end = performance.now() + ms; while (performance.now() < end) { h.frame(); each?.(); await sleep(16); } };

  {
    const h = host();
    h.frame(); // the first screen measured, the background pass not started yet
    const measuredBefore = h.list.LastMeasuredIndex;
    h.scroll.ScrollToIndex(2000, false);
    h.frame();
    const firstMiss = h.miss(2000);
    await run(h, 4000);
    check("a jump to an unmeasured row is gone to by the estimate", measuredBefore < 2000, `measured up to ${measuredBefore} when it was ordered`);
    check("the order closes once the row is measured", !h.open() && h.list.IsItemMeasured(2000), `open ${h.open()}, measured up to ${h.list.LastMeasuredIndex}`);
    check("the row stands at the viewport start", Math.abs(h.miss(2000)) <= 1, `${h.miss(2000).toFixed(1)} px off; one frame after the order ${firstMiss.toFixed(0)} px)`);
  }

  {
    const h = host();
    let calls = 0, callsWhileOpen = 0;
    h.scroll.LoadMoreCommand = () => { calls++; if (h.open()) callsWhileOpen++; };
    h.scroll.LoadMoreOffset = 300;
    await run(h, 100);
    calls = 0;
    h.scroll.ScrollToIndex(2999, true, "End");
    await run(h, 4000);
    const bottom = h.list.GetItemOffsetPixels(3000) - h.list.Padding.Top + h.scroll.ViewportOffsetY - H;
    check("an animated jump to the end lands on the last row", !h.open() && Math.abs(bottom) <= 1, `${bottom.toFixed(1)} px off`);
    check("LoadMore waits while the order is open, then fires once", callsWhileOpen === 0 && calls === 1, `${calls} calls, ${callsWhileOpen} while open`);
  }

  console.log(failures ? `FAIL: ${failures} checks` : "OK: ScrollToIndex follows measured rows");
  process.exit(failures ? 1 : 0);
})();
