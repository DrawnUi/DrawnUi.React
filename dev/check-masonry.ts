// Masonry layout (drawnui-cross 6ag, C# MasonryLayoutTests), checked in Node (`npm run check:masonry`): Split columns,
// every item at the bottom of the shortest column (the first on a tie), with Children or ItemsSource + ItemTemplate
// (recycled slots, ScrollToIndex, taps, LoadMore); a changed item is measured alone and every item is placed again;
// an appended page measures only the new items; every item is laid out.
import {
  Super, SKRect, SKPoint, Canvas, SkiaAccessibilityManager, HoverManager, SkiaLayer, SkiaLayout, SkiaShape, SkiaScroll, Thickness,
  SkiaGesturesParameters, TouchActionEventArgs, type SkiaControl, type AnimatorBase, type TouchActionResult, type LayoutType,
} from "../src/index.ts";

declare const CanvasKitInit: (o: { locateFile: () => string }) => Promise<any>;
const ROOT = process.cwd();
let failures = 0;
const check = (name: string, ok: boolean, detail = "") => { if (!ok) failures++; console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`); };

// Wrap rows take the tallest item of each row: (100,20) (20,100) (100,20) = 300.
// Masonry: col0 100, col1 20 -> item2 col1 (20..40) -> item3 col1 (40..140) -> item4 col0 (100..200) -> item5 col1 (140..160): 200 tall.
const HEIGHTS = [100, 20, 20, 100, 100, 20];

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

let measures = 0;
/** A cell whose height is its item: a number, or an Item that can grow (a photo card whose image arrives). */
class HeightCell extends SkiaShape {
  private item?: Item;
  constructor() { super(); this.BackgroundColor = "#483D8B"; this.HorizontalOptions = "Fill"; }
  private readonly follow = () => { if (this.item) { this.HeightRequest = this.item.Height; this.Update(); } };
  protected override OnBindingContextChanged(): void {
    this.item?.off(this.follow);
    const ctx = this.BindingContext;
    this.item = ctx instanceof Item ? ctx : undefined;
    this.item?.on(this.follow);
    this.HeightRequest = this.item ? this.item.Height : typeof ctx === "number" ? ctx : -1;
    this.NeedMeasure = true; // a pooled view bound to another item measures again
  }
  protected override MeasureAbsolute(w: number, h: number, scale: number) { measures++; return super.MeasureAbsolute(w, h, scale); }
}
class Item {
  private listeners = new Set<() => void>();
  constructor(private height: number) {}
  get Height(): number { return this.height; }
  set Height(v: number) { this.height = v; for (const l of this.listeners) l(); }
  on(l: () => void): void { this.listeners.add(l); }
  off(l: () => void): void { this.listeners.delete(l); }
}

/** Reference placement: two 100 pt columns, each item to the shortest one (the first on a tie). */
const expected = (heights: readonly number[]) => {
  const bottoms = [0, 0];
  const at = heights.map((h) => { const col = bottoms[1] < bottoms[0] ? 1 : 0; const p = { left: col * 100, top: bottoms[col] }; bottoms[col] += h; return p; });
  return { at, height: Math.max(...bottoms) };
};

(async () => {
  const CK = await CanvasKitInit({ locateFile: () => `${ROOT}/node_modules/canvaskit-wasm/bin/full/canvaskit.wasm` });
  (Super as unknown as { CK: unknown }).CK = CK;

  /** A canvas W x H around `content`: frames tick animators, measure, arrange, draw; taps go through the Canvas routing. */
  const host = (content: SkiaControl, W: number, H: number) => {
    const fake = new FakeCanvas();
    content._superview = fake as unknown as Canvas;
    let ms = 0;
    const frame = () => {
      ms += 16;
      for (const a of [...fake.AnimatingControls.values()]) if (!a.IsPaused) a.TickFrame(Math.round(ms * 1_000_000));
      const surface = CK.MakeSurface(W, H);
      surface.getCanvas().clear(CK.BLACK);
      content.Measure(W, H, 1); content.Arrange(new SKRect(0, 0, W, H), W, H, 1);
      content.Render({ Context: { Canvas: surface.getCanvas(), Surface: surface }, Destination: new SKRect(0, 0, W, H), Scale: 1 });
      const px = surface.makeImageSnapshot().readPixels(0, 0, { width: W, height: H, colorType: CK.ColorType.RGBA_8888, alphaType: CK.AlphaType.Unpremul, colorSpace: CK.ColorSpace.SRGB }) as Uint8Array;
      surface.delete();
      let lit = 0; for (let i = 0; i < px.length; i += 4) if (px[i] + px[i + 1] + px[i + 2] > 30) lit++;
      return lit / (W * H);
    };
    const frames = (n: number) => { let f = 0; for (let i = 0; i < n; i++) f = frame(); return f; };
    const cv = Object.create(Canvas.prototype) as Canvas & { gestureOwner: SkiaControl | null; activeTouchIds: Set<number> };
    cv.gestureOwner = null; cv.activeTouchIds = new Set();
    const send = (type: TouchActionResult, x: number, y: number) => {
      const a = new TouchActionEventArgs(); a.Location = new SKPoint(x, y); a.StartingLocation = a.Location; a.Scale = 1;
      if (type === "Down") cv.activeTouchIds.add(1);
      (cv as unknown as { ProcessGestures(r: SkiaControl, p: SkiaGesturesParameters): SkiaControl | null }).ProcessGestures(content, SkiaGesturesParameters.Create(type, a));
      if (type === "Up") cv.activeTouchIds.delete(1);
    };
    const tap = (x: number, y: number) => { send("Down", x, y); send("Tapped", x, y); send("Up", x, y); frames(2); };
    return { frames, tap };
  };

  /** A templated masonry (Split 2, Spacing 0, recycled) as the content of a W x H scroll. */
  const templated = (items: readonly unknown[], W = 200, H = 200) => {
    let tapped = -1, fired = 0;
    const masonry = new SkiaLayout(); masonry.Type = "Masonry"; masonry.Split = 2; masonry.Spacing = 0; masonry.HorizontalOptions = "Fill";
    masonry.RecyclingTemplate = "Enabled";
    masonry.ItemTemplate = () => { const c = new HeightCell(); c.Tapped = (s) => { tapped = s.ContextIndex; }; return c; };
    masonry.ItemsSource = items;
    const scroll = new SkiaScroll(); scroll.HorizontalOptions = "Fill"; scroll.VerticalOptions = "Fill"; scroll.Bounces = false;
    scroll.WidthRequest = W; scroll.HeightRequest = H; scroll.LoadMoreOffset = 50;
    scroll.LoadMoreCommand = () => { fired++; onLoadMore?.(); };
    let onLoadMore: (() => void) | undefined;
    scroll.Content = masonry;
    const h = host(scroll, W, H);
    const drawn = h.frames(8);
    return { ...h, masonry, scroll, drawn, tapped: () => tapped, fired: () => fired, setLoadMore: (f: () => void) => { onLoadMore = f; } };
  };
  /** Every item placed as a fresh layout of these heights would place it, and the content that tall. */
  const placedAsFresh = (masonry: SkiaLayout, heights: readonly number[]) => {
    const e = expected(heights), top0 = masonry.DrawingRect.Top, left0 = masonry.DrawingRect.Left;
    let wrong = 0;
    heights.forEach((h, i) => {
      const r = masonry.GetMasonryItemRect(i);
      if (!r || Math.abs(r.Left - left0 - e.at[i].left) > 1 || Math.abs(r.Top - top0 - e.at[i].top) > 1 || Math.abs(r.Height - h) > 1) wrong++;
    });
    return { ok: wrong === 0 && Math.abs(masonry.MeasuredSize.Units.Height - e.height) < 1, detail: `${wrong} misplaced, content ${masonry.MeasuredSize.Units.Height} vs ${e.height}` };
  };

  {
    const make = (type: LayoutType) => {
      const l = new SkiaLayout(); l.Type = type; l.Split = 2; l.Spacing = 0; l.HorizontalOptions = "Fill";
      for (const h of HEIGHTS) { const s = new SkiaShape(); s.BackgroundColor = "#483D8B"; s.HorizontalOptions = "Fill"; s.HeightRequest = h; l.AddSubView(s); }
      return l;
    };
    const wrap = make("Wrap"), masonry = make("Masonry");
    const root = new SkiaLayer(); root.WidthRequest = 200; root.HeightRequest = 400; root.VerticalOptions = "Fill";
    root.AddSubView(wrap); root.AddSubView(masonry);
    const h = host(root, 200, 400);
    h.frames(6);
    const e = expected(HEIGHTS);
    const placed = HEIGHTS.every((hh, i) => {
      const r = masonry.Views[i].DrawingRect;
      return Math.abs(r.Left - masonry.DrawingRect.Left - e.at[i].left) < 1 && Math.abs(r.Top - masonry.DrawingRect.Top - e.at[i].top) < 1 && Math.abs(r.Width - 100) < 1 && Math.abs(r.Height - hh) < 1;
    });
    check("Children: every item goes to the shortest column (wrap 300 tall, masonry 200)", wrap.MeasuredSize.Units.Height === 300 && masonry.MeasuredSize.Units.Height === 200 && placed,
      `wrap ${wrap.MeasuredSize.Units.Height}, masonry ${masonry.MeasuredSize.Units.Height}`);

    const heights = [...HEIGHTS]; heights[1] = 80;
    masonry.Views[1].HeightRequest = 80; masonry.Views[1].Update();
    h.frames(6);
    const e2 = expected(heights);
    const placed2 = heights.every((hh, i) => {
      const r = masonry.Views[i].DrawingRect;
      return Math.abs(r.Left - masonry.DrawingRect.Left - e2.at[i].left) < 1 && Math.abs(r.Top - masonry.DrawingRect.Top - e2.at[i].top) < 1 && Math.abs(r.Height - hh) < 1;
    });
    check("Children: a child that grows, the layout follows", placed2 && Math.abs(masonry.MeasuredSize.Units.Height - e2.height) < 1, `content ${masonry.MeasuredSize.Units.Height} vs ${e2.height}`);
  }

  const thirty = Array.from({ length: 30 }, (_, i) => HEIGHTS[i % HEIGHTS.length]);
  {
    const t = templated(thirty);
    const p = placedAsFresh(t.masonry, thirty);
    check("Templated: the same placement as Children, cells drawn", p.ok && t.drawn > 0.9, `${p.detail}, ${(t.drawn * 100).toFixed(0)}% drawn`);
  }
  {
    const t = templated(thirty);
    t.scroll.ViewportOffsetY = -720; // the end: 920 - 200
    t.frames(10);
    check("Templated: LoadMore fires at the end", t.fired() > 0, `fired ${t.fired()}`);
  }
  {
    const t = templated(thirty);
    const top = expected(thirty).at[15].top; // 400, a right column item
    t.scroll.ScrollToIndex(15, false, "Start");
    t.frames(20);
    check("Templated: ScrollToIndex arrives at an item not shown", Math.abs(t.scroll.ViewportOffsetY + top) < 1, `offset ${t.scroll.ViewportOffsetY}, want ${-top}`);
  }
  {
    const t = templated(thirty);
    t.tap(150, 90); // right column, y 40..140 = item 3
    const first = t.tapped();
    t.tap(50, 150); // left column, y 100..200 = item 4
    check("Templated: a tap hits the cell under the finger", first === 3 && t.tapped() === 4, `tapped ${first}, ${t.tapped()}`);
  }
  {
    const items = Array.from({ length: 12 }, (_, i) => new Item(HEIGHTS[i % HEIGHTS.length]));
    const t = templated(items, 200, 400);
    items[1].Height = 80; // right column, 20 -> 80
    let overlaps = 0;
    for (let f = 0; f < 8; f++) {
      t.frames(1);
      // no two cells of one column overlap, on any frame
      const rects = items.map((_, i) => t.masonry.GetMasonryItemRect(i)).filter((r): r is SKRect => !!r);
      for (const a of rects) for (const b of rects) if (a !== b && a.Left === b.Left && a.Top < b.Top && a.Bottom > b.Top + 0.5) overlaps++;
    }
    measures = 0;
    const p = placedAsFresh(t.masonry, items.map((i) => i.Height));
    check("Templated: a cell that grows, the items are placed again (no overlap on any frame)", p.ok && overlaps === 0, `${p.detail}, overlaps ${overlaps}`);

    let ok = true;
    for (let round = 0; round < 6; round++) {
      items[2].Height += 20; // on screen, right column
      t.frames(4);
      if (!placedAsFresh(t.masonry, items.map((i) => i.Height)).ok) ok = false;
    }
    check("Templated: a shown cell growing again and again, placed again every time", ok, placedAsFresh(t.masonry, items.map((i) => i.Height)).detail);
  }
  {
    const t = templated(thirty);
    const reversed = Array.from({ length: 30 }, (_, i) => HEIGHTS[(29 - i) % HEIGHTS.length]);
    t.masonry.ItemsSource = reversed;
    t.frames(8);
    const p = placedAsFresh(t.masonry, reversed);
    check("Templated: a new ItemsSource of the same count lays out fresh", p.ok, p.detail);
  }
  {
    const t = templated(thirty);
    const more = [...thirty, 140, 20, 60, 90, 30, 110, 50, 20, 80, 40, 130, 70];
    measures = 0;
    t.masonry.ItemsSource = more;
    t.frames(8);
    const p = placedAsFresh(t.masonry, more);
    check("Templated: an appended page is placed under the columns, measuring only the new items", p.ok && measures <= 12 && t.frames(1) > 0.9, `${p.detail}, ${measures} items measured`);

    const inserted = [...more]; inserted.splice(5, 0, 140);
    t.masonry.ItemsSource = inserted;
    t.frames(8);
    const p1 = placedAsFresh(t.masonry, inserted);
    const removed = inserted.slice(1); removed.push(90); // a remove and an append before one measure
    t.masonry.ItemsSource = removed;
    t.frames(8);
    const p2 = placedAsFresh(t.masonry, removed);
    check("Templated: insert and remove lay out fresh", p1.ok && p2.ok, `${p1.detail}; ${p2.detail}`);
  }
  {
    const t = templated(thirty);
    let page = 0;
    t.setLoadMore(() => {
      page++;
      const add = Array.from({ length: 10 }, (_, i) => HEIGHTS[(i + page) % HEIGHTS.length] + 10 * page);
      t.masonry.ItemsSource = [...(t.masonry.ItemsSource as number[]), ...add];
    });
    for (let round = 0; round < 3; round++) {
      t.scroll.ViewportOffsetY = -(t.masonry.MeasuredSize.Units.Height - 200); // the end
      t.frames(12);
    }
    const all = t.masonry.ItemsSource as number[];
    const p = placedAsFresh(t.masonry, all);
    check("Templated: LoadMore pages keep the layout", t.fired() >= 3 && p.ok, `fired ${t.fired()}, ${all.length} items, ${p.detail}`);
  }
  {
    const big = Array.from({ length: 2100 }, (_, i) => HEIGHTS[i % HEIGHTS.length]);
    const t = templated(big);
    const p = placedAsFresh(t.masonry, big);
    check("Templated: a big source lays out every item", p.ok, p.detail);
  }

  {
    // C# Children_PaddingAndSpacing_PlaceItemsInsideThePadding / Templated_PaddingAndSpacing_SameAsChildren (edfb8e24):
    // 200 wide, Split 2, Spacing 4, Padding 10,20,30,40; then Padding={10} as a plain number
    const W = 200, H = 400;
    const run = (templatedMode: boolean, padding: Thickness | number) => {
      const m = new SkiaLayout(); m.Type = "Masonry"; m.Split = 2; m.Spacing = 4; m.Padding = padding; m.HorizontalOptions = "Fill";
      if (templatedMode) { m.RecyclingTemplate = "Enabled"; m.ItemTemplate = () => new HeightCell(); m.ItemsSource = HEIGHTS; }
      else for (const h of HEIGHTS) { const c = new HeightCell(); c.BindingContext = h; m.AddSubView(c); }
      const root = new SkiaLayer(); root.WidthRequest = W; root.HeightRequest = H; root.AddSubView(m);
      root._superview = new FakeCanvas() as unknown as Canvas;
      let px: Uint8Array = new Uint8Array();
      for (let f = 0; f < 4; f++) {
        const surface = CK.MakeSurface(W, H); surface.getCanvas().clear(CK.BLACK);
        root.Measure(W, H, 1); root.Arrange(new SKRect(0, 0, W, H), W, H, 1);
        root.Render({ Context: { Canvas: surface.getCanvas(), Surface: surface }, Destination: new SKRect(0, 0, W, H), Scale: 1 });
        px = surface.makeImageSnapshot().readPixels(0, 0, { width: W, height: H, colorType: CK.ColorType.RGBA_8888, alphaType: CK.AlphaType.Unpremul, colorSpace: CK.ColorSpace.SRGB }) as Uint8Array;
        surface.delete();
      }
      const lit = (x: number, y: number) => { const i = (Math.round(y) * W + Math.round(x)) * 4; return px[i] + px[i + 1] + px[i + 2] > 30; };
      const rects = HEIGHTS.map((_, i) => { const r = templatedMode ? m.GetMasonryItemRect(i) : m.Views[i].DrawingRect; return r ? new SKRect(r.Left - m.DrawingRect.Left, r.Top - m.DrawingRect.Top, r.Right - m.DrawingRect.Left, r.Bottom - m.DrawingRect.Top) : undefined; });
      return { m, rects, lit };
    };
    const want = [[10, 20, 78, 100], [92, 20, 78, 20], [92, 44, 78, 20], [92, 68, 78, 100], [10, 124, 78, 100], [92, 172, 78, 20]];
    for (const templatedMode of [false, true]) {
      const r = run(templatedMode, new Thickness(10, 20, 30, 40));
      const placed = want.every(([x, y, w, h], i) => { const q = r.rects[i]; return !!q && Math.abs(q.Left - x) < 0.5 && Math.abs(q.Top - y) < 0.5 && Math.abs(q.Width - w) < 0.5 && Math.abs(q.Height - h) < 0.5; });
      const centers = r.rects.every((q) => !!q && r.lit(q.Left + q.Width / 2, q.Top + q.Height / 2));
      const gaps = [[5, 60], [40, 10], [90, 60], [185, 60], [40, 122]].every(([x, y]) => !r.lit(x, y));
      check(`${templatedMode ? "Templated" : "Children"}: Padding 10,20,30,40 and Spacing 4 place every item inside the padding`, placed && centers && gaps && Math.abs(r.m.MeasuredSize.Units.Height - 264) < 0.5,
        `height ${r.m.MeasuredSize.Units.Height}, rects ${placed ? "ok" : r.rects.map((q) => q && `${q.Left},${q.Top} ${q.Width}x${q.Height}`).join(" ")}, centers ${centers}, gaps ${gaps}`);
    }
    {
      // Padding={10}: the column width is round((180 - 4) / 2) = 88, columns at 10 and 102, content 204 + 20
      const r = run(false, 10);
      const bottoms = [0, 0], ok = HEIGHTS.every((h, i) => {
        const col = bottoms[1] < bottoms[0] ? 1 : 0, x = 10 + col * 92, y = 10 + bottoms[col] + (bottoms[col] > 0 ? 4 : 0);
        bottoms[col] = y - 10 + h;
        const q = r.rects[i]; return !!q && Math.abs(q.Left - x) < 0.5 && Math.abs(q.Top - y) < 0.5 && Math.abs(q.Width - 88) < 0.5 && Math.abs(q.Height - h) < 0.5;
      });
      check("Padding={10} as a number: the same placement as Thickness(10)", ok && Math.abs(r.m.MeasuredSize.Units.Height - 224) < 0.5, `height ${r.m.MeasuredSize.Units.Height}`);
    }
  }

  console.log(failures ? `FAIL: ${failures} checks` : "OK: masonry");
  process.exit(failures ? 1 : 0);
})();
