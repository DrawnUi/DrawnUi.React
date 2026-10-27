// Keyboard navigation in a Masonry group (C# 2ad608d1, KeyboardListNavigationTests MasonryChildren_* / MasonryTemplated_*),
// checked in Node (`npm run check:masonry-keys`): arrows follow the placed tiles, not index +- Split. Up / Down = the
// previous / next tile of the same column, Left / Right = the tile of the neighbour column nearest in height (nothing
// moves when there is no column that way), PageDown = the last tile of the column starting within one viewport.
import {
  Super, SKRect, SkiaAccessibilityManager, SkiaMasonry, SkiaScroll, SkiaShape, Aria, type SkiaControl, type AnimatorBase, type Canvas,
} from "../src/index.ts";

declare const CanvasKitInit: (o: { locateFile: () => string }) => Promise<any>;
const ROOT = process.cwd();
let failures = 0;
const check = (name: string, ok: boolean, detail = "") => { if (!ok) failures++; console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`); };

// Split 2, heights 100,20,20,100,100,20: col0 = #0 (0..100), #4 (100..200); col1 = #1, #2, #3, #5 (0..20, 20..40,
// 40..140, 140..160). Index + Split is rarely the tile underneath (#1 + 2 = #3 skips #2 below it).
const HEIGHTS = [100, 20, 20, 100, 100, 20];

class FakeCanvas {
  readonly AccessibilityManager = new SkiaAccessibilityManager();
  readonly AnimatingControls = new Map<number, AnimatorBase>();
  RenderingScale = 1;
  GpuEpoch = 0;
  Update(): void {}
  readonly disposeQueue: { Dispose(): void }[] = [];
  DisposeObject(o: { Dispose(): void }): void { this.disposeQueue.push(o); }
  RegisterAnimator(a: AnimatorBase): boolean { this.AnimatingControls.set(a.Uid, a); return true; }
  UnregisterAnimator(uid: number): void { this.AnimatingControls.delete(uid); }
}

class Tile extends SkiaShape {
  constructor() { super(); this.BackgroundColor = "#555555"; this.HorizontalOptions = "Fill"; this.AccessibilityRole = Aria.RoleButton; this.Tapped = () => {}; }
  protected override OnBindingContextChanged(): void {
    const i = this.BindingContext;
    if (typeof i === "number") { this.HeightRequest = HEIGHTS[i % HEIGHTS.length]; this.AccessibilityLabel = `tile ${i}`; this.NeedMeasure = true; }
  }
}

(async () => {
  const CK = await CanvasKitInit({ locateFile: () => `${ROOT}/node_modules/canvaskit-wasm/bin/full/canvaskit.wasm` });
  (Super as unknown as { CK: unknown }).CK = CK;

  const host = (content: SkiaControl, W: number, H: number) => {
    const fake = new FakeCanvas(), mgr = fake.AccessibilityManager;
    mgr.MinUpdateIntervalMs = 0;
    content._superview = fake as unknown as Canvas;
    let focused: SkiaControl | undefined, ms = 0;
    mgr.OnKeyboardFocusRequested((n) => { focused = n; });
    const frame = () => {
      ms += 16;
      for (const a of [...fake.AnimatingControls.values()]) if (!a.IsPaused) a.TickFrame(Math.round(ms * 1_000_000));
      const surface = CK.MakeSurface(W, H);
      content.Measure(W, H, 1); content.Arrange(new SKRect(0, 0, W, H), W, H, 1);
      content.Render({ Context: { Canvas: surface.getCanvas(), Surface: surface }, Destination: new SKRect(0, 0, W, H), Scale: 1 });
      surface.delete();
      for (const o of fake.disposeQueue.splice(0)) o.Dispose();
      mgr.OnFrameEnd(1, W, H, () => {});
    };
    const frames = async (n: number) => { for (let i = 0; i < n; i++) { frame(); await new Promise((r) => setTimeout(r, 16)); } };
    const label = () => focused?.AccessibilityLabel ?? "none";
    const focus = (node: SkiaControl) => { focused = node; mgr.NotifyFocused(node); };
    const press = async (key: string) => { if (!focused) return; SkiaAccessibilityManager.Key(focused, key); await frames(8); if (focused) mgr.NotifyFocused(focused); };
    return { frames, label, focus, press };
  };

  /** From #1: Down 2, Down 3, Left 0, Down 4, Right 5, Up 3, Right stays 3. */
  const walk = async (h: ReturnType<typeof host>, tile: (i: number) => SkiaControl | undefined, name: string) => {
    h.focus(tile(1)!);
    const steps: [string, string][] = [["ArrowDown", "tile 2"], ["ArrowDown", "tile 3"], ["ArrowLeft", "tile 0"], ["ArrowDown", "tile 4"], ["ArrowRight", "tile 5"], ["ArrowUp", "tile 3"], ["ArrowRight", "tile 3"]];
    const got: string[] = [];
    for (const [key] of steps) { await h.press(key); got.push(h.label()); }
    check(`${name}: arrows move to the tile on screen that way`, got.join() === steps.map((s) => s[1]).join(), `got ${got.join(", ")}`);
  };

  {
    const masonry = new SkiaMasonry(); masonry.AccessibilityRole = Aria.RoleGrid; masonry.Spacing = 0;
    const tiles = HEIGHTS.map((_, i) => { const t = new Tile(); t.BindingContext = i; masonry.AddSubView(t); return t; });
    const h = host(masonry, 200, 400);
    await h.frames(4);
    await walk(h, (i) => tiles[i], "Children");
  }

  {
    const masonry = new SkiaMasonry(); masonry.AccessibilityRole = Aria.RoleGrid; masonry.Spacing = 0;
    masonry.RecyclingTemplate = "Enabled"; masonry.ItemTemplate = () => new Tile(); masonry.ItemsSource = Array.from({ length: 60 }, (_, i) => i);
    const scroll = new SkiaScroll(); scroll.HorizontalOptions = "Fill"; scroll.VerticalOptions = "Fill"; scroll.WidthRequest = 200; scroll.HeightRequest = 300;
    scroll.Content = masonry;
    const h = host(scroll, 200, 300);
    await h.frames(4);
    await walk(h, (i) => masonry.ChildrenFactory.GetViewForIndex(i), "Templated");

    // PageDown from #3 (col1, top 40): the last tile of col1 starting within one 300 px viewport below it
    const cells = masonry.GetMasonryPlacement(), from = cells.find((c) => c.Index === 3)!.Rect;
    const expected = cells.filter((c) => Math.round(c.Rect.Left) === Math.round(from.Left) && c.Rect.Top > from.Top && c.Rect.Top <= from.Top + 300)
      .sort((a, b) => a.Rect.Top - b.Rect.Top).pop()!.Index;
    await h.press("PageDown");
    check("Templated: PageDown goes one viewport down the same column", h.label() === `tile ${expected}`, `got ${h.label()}, want tile ${expected}`);
  }

  console.log(failures ? `FAIL: ${failures} checks` : "OK: masonry keyboard");
  process.exit(failures ? 1 : 0);
})();
