// Templated Row / Wrap / Grid / split Column follow RecyclingTemplate (`npm run check:recycling`, Node + CanvasKit, no
// browser). The same tree drawn with Enabled and Disabled must give identical pixels at every scroll offset, also after
// the items change; every view on screen must sit where its Disabled twin sits (hit testing, also under a cached card
// that is not repainted while scrolling). Enabled binds views only to the slots drawn (all of them under a cache),
// Disabled keeps one view per item. Prints the view counts and the cost of a 1000-item wrap in both modes.
import { readFileSync } from "node:fs";
import {
  Super, SkiaScroll, SkiaStack, SkiaWrap, SkiaRow, SkiaGrid, SkiaDecoratedGrid, SkiaLayer, SkiaShape, SkiaLabel,
  SkiaDynamicDrawnCell, SKRect, Thickness, type SkiaLayout, type RecyclingTemplate,
} from "../src/index.ts";

declare const CanvasKitInit: (o: { locateFile: () => string }) => Promise<any>;
const ROOT = process.cwd(); // npm scripts run at the package root

class ChipCell extends SkiaDynamicDrawnCell {
  private readonly shape = new SkiaShape();
  private readonly label = new SkiaLabel();
  constructor() {
    super();
    this.shape.Type = "Rectangle"; this.shape.CornerRadius = 10; this.shape.HorizontalOptions = "Fill";
    this.label.FontSize = 13; this.label.TextColor = "#DEE2E6"; this.label.Padding = new Thickness(12, 8); this.label.HorizontalOptions = "Center";
    this.shape.AddSubView(this.label);
    this.AddSubView(this.shape);
    this.HorizontalOptions = "Fill";
  }
  protected override SetContent(ctx: unknown): void {
    const item = ctx as { text: string; color: string };
    this.label.Text = item.text; this.shape.BackgroundColor = item.color;
  }
}
const PALETTE = ["#0F3460", "#533483", "#1B4332", "#7B2D26", "#495057", "#0D6EFD", "#D63384", "#2D6A4F"];
const WORDS = ["Item", "A longer item", "Mid item", "X", "The longest item of all", "Item two", "Short"];
const items = Array.from({ length: 23 }, (_, i) => ({ text: `${WORDS[i % WORDS.length]} ${i + 1}`, color: PALETTE[i % PALETTE.length] }));
const template = () => new ChipCell();

const W = 420, H = 360, SCALE = 1.5;

function build(mode: RecyclingTemplate) {
  const layouts: Record<string, SkiaLayout> = {};
  const add = <T extends SkiaLayout>(name: string, l: T): T => { l.RecyclingTemplate = mode; l.ItemTemplate = template; layouts[name] = l; return l; };
  const wrap3 = add("wrap3", new SkiaWrap()); wrap3.Spacing = 8; wrap3.Split = 3; wrap3.ItemsSource = items;
  const wrap0 = add("wrap0", new SkiaWrap()); wrap0.Spacing = 8; wrap0.ItemsSource = items;
  const wrapDyn = add("wrapDyn", new SkiaWrap()); wrapDyn.Spacing = 8; wrapDyn.Split = 4; wrapDyn.DynamicColumns = true; wrapDyn.ItemsSource = items.slice(0, 10);
  const row = add("row", new SkiaRow()); row.Spacing = 8; row.ItemsSource = items.slice(0, 5);
  const grid = add("gridInvert", new SkiaGrid()); grid.Split = 3; grid.Invert = true; grid.ColumnDefinitions = "*,*,*"; grid.ColumnSpacing = 8; grid.RowSpacing = 8; grid.ItemsSource = items;
  const dec = add("decorated", new SkiaDecoratedGrid()); dec.Split = 4; dec.ColumnDefinitions = "*,*,*,*"; dec.ColumnSpacing = 1; dec.RowSpacing = 1; dec.ItemsSource = items.slice(0, 12);
  const col2 = add("column2", new SkiaStack()); col2.Split = 2; col2.Spacing = 6; col2.ItemsSource = items.slice(0, 9);
  // the same wrap inside a cached card (SkiaShape caches Operations by default)
  const card = new SkiaShape(); card.Type = "Rectangle"; card.CornerRadius = 8; card.BackgroundColor = "#2B3035"; card.HorizontalOptions = "Fill";
  const cardStack = new SkiaStack(); cardStack.Padding = new Thickness(16, 12);
  const cardWrap = add("cardWrap", new SkiaWrap()); cardWrap.Spacing = 8; cardWrap.Split = 3; cardWrap.ItemsSource = items;
  cardStack.AddSubView(cardWrap); card.AddSubView(cardStack);

  const stack = new SkiaStack(); stack.Spacing = 12; stack.Padding = new Thickness(10);
  const spacer = new SkiaLayer(); spacer.HeightRequest = 180; spacer.BackgroundColor = "#333333";
  for (const c of [spacer, wrap3, wrap0, wrapDyn, row, grid, dec, col2, card]) stack.AddSubView(c);
  const scroll = new SkiaScroll(); scroll.Orientation = "Vertical"; scroll.BackgroundColor = "#111111";
  scroll.Content = stack;
  return { scroll, layouts };
}

function frame(CK: any, root: SkiaScroll) {
  const w = Math.round(W * SCALE), h = Math.round(H * SCALE);
  const surface = CK.MakeSurface(w, h);
  const canvas = surface.getCanvas();
  canvas.clear(CK.BLACK);
  root.Measure(w, h, SCALE);
  root.Arrange(new SKRect(0, 0, w, h), root.WidthRequest, root.HeightRequest, SCALE);
  root.Render({ Context: { Canvas: canvas, Surface: surface }, Destination: new SKRect(0, 0, w, h), Scale: SCALE });
  surface.flush();
  const px = surface.makeImageSnapshot().readPixels(0, 0, { width: w, height: h, colorType: CK.ColorType.RGBA_8888, alphaType: CK.AlphaType.Unpremul, colorSpace: CK.ColorSpace.SRGB }) as Uint8Array;
  surface.delete();
  return px;
}

const stats = (layouts: Record<string, SkiaLayout>) => Object.fromEntries(Object.entries(layouts).map(([k, l]) => [k, `inuse ${l.ChildrenFactory.InUseCount} pool ${l.ChildrenFactory.PoolSize} created ${l.ChildrenFactory.Created} drawn ${l.FirstVisibleIndex}-${l.LastVisibleIndex}`]));

(async () => {
  const CK = await CanvasKitInit({ locateFile: () => `${ROOT}/node_modules/canvaskit-wasm/bin/full/canvaskit.wasm` });
  (Super as any).CK = CK;
  const face = CK.Typeface.MakeFreeTypeFaceFromData(readFileSync(`${ROOT}/samples/public/fonts/OpenSans-Regular.ttf`).buffer);
  Super.Fonts.set("FontText", new Map([[400, face]]));
  Super.DefaultTypeface = face; Super.DefaultFontAlias = "FontText";

  const enabled = build("Enabled"), disabled = build("Disabled");
  const offsets = [0, -300, -700, -1100, -1500, -1900, -2300, -2700, -3100, -3500, -1200, 0];
  const out: unknown[] = [];
  let failures = 0;
  for (const y of offsets) {
    let a!: Uint8Array, b!: Uint8Array;
    for (const pass of [0, 1, 2]) { // a scroll offset applies after a measure; then two settled frames
      if (pass === 1) { enabled.scroll.ScrollTo(0, y, 0); disabled.scroll.ScrollTo(0, y, 0); }
      a = frame(CK, enabled.scroll); b = frame(CK, disabled.scroll);
    }
    let diff = 0;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff++;
    if (diff) failures++;
    out.push({ offset: y, viewport: enabled.scroll.ViewportOffsetY, differingBytes: diff, enabled: stats(enabled.layouts), disabled: stats(disabled.layouts) });
  }
  // mutations: a new items array (reversed, shorter), Split change, RecyclingTemplate flip and back
  for (const b of [enabled, disabled]) {
    const w = b.layouts.wrap3; w.ItemsSource = items.slice(0, 20).reverse(); w.Split = 2; w.InvalidateMeasure();
    b.layouts.gridInvert.ItemsSource = items.slice(3);
    b.layouts.wrap0.ItemsSource = [...items, { text: "Appended item", color: "#FFC107" }];
  }
  enabled.layouts.row.RecyclingTemplate = "Disabled"; enabled.layouts.row.RecyclingTemplate = "Enabled";
  for (const y of [-300, -1000, -1800]) {
    let a!: Uint8Array, b!: Uint8Array;
    for (const pass of [0, 1, 2]) { if (pass === 1) { enabled.scroll.ScrollTo(0, y, 0); disabled.scroll.ScrollTo(0, y, 0); } a = frame(CK, enabled.scroll); b = frame(CK, disabled.scroll); }
    let diff = 0;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff++;
    if (diff) failures++;
    // hit testing: every view on screen sits where its Disabled twin sits (the cached card is not repainted while scrolling)
    let rectMismatch = 0, checked = 0;
    for (const k of Object.keys(enabled.layouts)) for (const v of enabled.layouts[k].Views) {
      const twin = disabled.layouts[k].ChildrenFactory.GetViewForIndex(v.ContextIndex)!, r1 = v.DrawingRect, r2 = twin.DrawingRect;
      checked++;
      if (Math.abs(r1.Left - r2.Left) + Math.abs(r1.Top - r2.Top) + Math.abs(r1.Width - r2.Width) + Math.abs(r1.Height - r2.Height) > 0.01) rectMismatch++;
    }
    if (rectMismatch) failures++;
    out.push({ mutated: true, offset: y, differingBytes: diff, rects: `${checked - rectMismatch}/${checked} views on screen at their Disabled twin's rect`, enabled: stats(enabled.layouts) });
  }
  // timing: a 1000-item Split=3 wrap in a scroll, per mode
  const big = Array.from({ length: 1000 }, (_, i) => ({ text: `${WORDS[i % WORDS.length]} ${i + 1}`, color: PALETTE[i % PALETTE.length] }));
  const timing: Record<string, unknown> = {};
  for (const mode of ["Enabled", "Disabled"] as RecyclingTemplate[]) {
    const wrap = new SkiaWrap(); wrap.RecyclingTemplate = mode; wrap.ItemTemplate = template; wrap.Spacing = 8; wrap.Split = 3; wrap.ItemsSource = big;
    const sc = new SkiaScroll(); sc.Orientation = "Vertical"; sc.Content = wrap;
    const t0 = performance.now(); frame(CK, sc); const first = performance.now() - t0;
    const t1 = performance.now(); wrap.InvalidateMeasure(); frame(CK, sc); const remeasure = performance.now() - t1;
    const t2 = performance.now(); for (let k = 1; k <= 30; k++) { sc.ScrollTo(0, -k * 40, 0); frame(CK, sc); } const scroll = (performance.now() - t2) / 30;
    timing[mode] = { firstFrameMs: +first.toFixed(1), invalidatedFrameMs: +remeasure.toFixed(1), scrollFrameMs: +scroll.toFixed(2), views: `inuse ${wrap.ChildrenFactory.InUseCount} pool ${wrap.ChildrenFactory.PoolSize} created ${wrap.ChildrenFactory.Created}` };
  }
  console.log("TIMING " + JSON.stringify(timing));
  console.log(JSON.stringify(out, null, 1));
  console.log(failures ? `FAIL: ${failures} offsets differ` : "OK: Enabled and Disabled draw identical pixels at every offset");
  process.exit(failures ? 1 : 0);
})();
