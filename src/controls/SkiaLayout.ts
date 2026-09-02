import { type DrawingContext, SkiaControl } from "../core/SkiaControl";
import { ViewsAdapter } from "../core/ViewsAdapter";
import { type LayoutType, type MeasuringStrategy, type RecyclingTemplate, SKRect, ScaledSize, type ShapeType, Thickness } from "../core/Types";

/**
 * Mirrors DrawnUi SkiaLayout (Absolute / Column / Row).
 * Column/Row give children an infinite main axis (MAUI stack semantics: Fill on the main axis = auto-sized).
 *
 * Templated mode (ItemsSource + ItemTemplate) is a Column only: cells are created through the ViewsAdapter for
 * the indexes inside the visible viewport (+ VirtualisationInflated), everything else is arithmetic —
 * MeasureFirst measures one cell and assumes uniform size, MeasureAll measures every item once.
 */
export class SkiaLayout extends SkiaControl {
  /** Layout type. SkiaShape redeclares it as ShapeType (any shape value lays out as Absolute), like the C# hidden Type. */
  Type: LayoutType | ShapeType = "Absolute";
  Spacing = 0;
  Padding: Thickness = Thickness.Zero;

  // ---- templated children (same names as DrawnUi) ----
  RecyclingTemplate: RecyclingTemplate = "Enabled";
  MeasureItemsStrategy: MeasuringStrategy = "MeasureFirst";
  /** Realized views per item (Disabled) or a recycled pool for the visible range (Enabled). */
  readonly ChildrenFactory = new ViewsAdapter(this);
  FirstVisibleIndex = -1;
  LastVisibleIndex = -1;

  private itemsSource?: readonly unknown[];
  private itemTemplate?: () => SkiaControl;
  private structureDirty = true;
  /** Per-item heights in pixels (MeasureAll) or a single uniform height (MeasureFirst). */
  private itemHeights: number[] = [];
  private uniformHeight = 0;
  private measuredWidthPx = 0;

  get ItemsSource(): readonly unknown[] | undefined { return this.itemsSource; }
  set ItemsSource(value: readonly unknown[] | undefined) {
    if (this.itemsSource === value) return;
    this.itemsSource = value;
    if (value && this.IsTemplated) this.ChildrenFactory.UpdateItems(value);
    this.structureDirty = true;
    this.InvalidateMeasure();
  }

  /** Factory creating one cell (DrawnUi DataTemplate). Cells receive the item as BindingContext. */
  get ItemTemplate(): (() => SkiaControl) | undefined { return this.itemTemplate; }
  set ItemTemplate(value: (() => SkiaControl) | undefined) {
    if (this.itemTemplate === value) return;
    this.itemTemplate = value;
    this.ApplyItemsSource();
  }

  get IsTemplated(): boolean { return !!this.itemTemplate && !!this.itemsSource; }

  /** Drops realized cells and rebuilds the structure (DrawnUi ApplyItemsSource). */
  ApplyItemsSource(): void {
    this.ChildrenFactory.Initialize(this.itemTemplate, this.itemsSource ?? [], this.RecyclingTemplate);
    this.structureDirty = true;
    this.InvalidateMeasure();
  }

  /** Diagnostics like DrawnUi DebugString: visible range, realized views, pool. */
  get DebugString(): string {
    if (!this.IsTemplated) return `views ${this.views.length}`;
    const f = this.ChildrenFactory;
    return `items ${this.itemsSource!.length} visible ${this.FirstVisibleIndex}-${this.LastVisibleIndex} inuse ${f.InUseCount} pool ${f.PoolSize} created ${f.Created}`;
  }

  // ---- static children ----

  private readonly views: SkiaControl[] = [];
  /** Read-only live children like DrawnUi Views: realized cells when templated, else static children. */
  get Views(): readonly SkiaControl[] { return this.IsTemplated ? this.ChildrenFactory.GetViewsInUse() : this.views; }
  /** Settable children list like DrawnUi Children (ignored while templated). */
  get Children(): readonly SkiaControl[] { return this.views; }
  set Children(value: readonly SkiaControl[]) {
    for (const v of [...this.views]) this.RemoveSubView(v);
    for (const v of value) this.AddSubView(v);
  }

  protected override GetGestureListeners(): readonly SkiaControl[] { return this.Views; }

  override AddSubView(control: SkiaControl): void { this.InsertSubView(this.views.length, control); }

  override InsertSubView(index: number, control: SkiaControl): void {
    control.Parent = this;
    this.views.splice(index, 0, control);
    this.InvalidateMeasure();
  }

  override RemoveSubView(control: SkiaControl): void {
    const i = this.views.indexOf(control);
    if (i < 0) return;
    this.views.splice(i, 1);
    control.Parent = undefined;
    this.InvalidateMeasure();
  }

  // ---- measure ----

  protected override MeasureAbsolute(widthConstraint: number, heightConstraint: number, scale: number): ScaledSize {
    if (this.IsTemplated) return this.MeasureTemplated(widthConstraint, heightConstraint, scale);
    const px = this.Padding.HorizontalThickness * scale;
    const py = this.Padding.VerticalThickness * scale;
    const w = widthConstraint - px;
    const h = heightConstraint - py;
    const gap = this.Spacing * scale;
    let cw = 0, ch = 0, n = 0;

    for (const v of this.views) {
      if (!v.IsVisible) continue;
      let s: ScaledSize;
      if (this.Type === "Column") { s = v.Measure(w, Infinity, scale); cw = Math.max(cw, s.Pixels.Width); ch += s.Pixels.Height; }
      else if (this.Type === "Row") { s = v.Measure(Infinity, h, scale); cw += s.Pixels.Width; ch = Math.max(ch, s.Pixels.Height); }
      else { s = v.Measure(w, h, scale); cw = Math.max(cw, s.Pixels.Width); ch = Math.max(ch, s.Pixels.Height); }
      n++;
    }
    const gaps = Math.max(0, n - 1) * gap;
    if (this.Type === "Column") ch += gaps;
    if (this.Type === "Row") cw += gaps;
    return ScaledSize.FromPixels(cw + px, ch + py, scale);
  }

  /** Templated Column: content = padding + sum of item heights + gaps; width = the constraint (cells fill). */
  private MeasureTemplated(widthConstraint: number, _heightConstraint: number, scale: number): ScaledSize {
    const items = this.itemsSource!;
    const px = this.Padding.HorizontalThickness * scale;
    const py = this.Padding.VerticalThickness * scale;
    const w = isFinite(widthConstraint) ? widthConstraint - px : 0;
    const gap = this.Spacing * scale;

    if (this.structureDirty || this.measuredWidthPx !== w) {
      this.measuredWidthPx = w;
      this.itemHeights = [];
      this.uniformHeight = 0;
      if (items.length > 0) {
        if (this.MeasureItemsStrategy === "MeasureAll") {
          for (let i = 0; i < items.length; i++) this.itemHeights.push(this.MeasureItem(i, w, scale));
        } else {
          this.uniformHeight = this.MeasureItem(0, w, scale);
        }
      }
      this.structureDirty = false;
    }

    let total = 0;
    if (this.MeasureItemsStrategy === "MeasureAll") for (const h of this.itemHeights) total += h;
    else total = this.uniformHeight * items.length;
    total += Math.max(0, items.length - 1) * gap;
    return ScaledSize.FromPixels(w + px, total + py, scale);
  }

  /** Binds a cell to items[index] (through the adapter, so MeasureFirst's cell 0 stays realized) and measures it. */
  private MeasureItem(index: number, widthPx: number, scale: number): number {
    const view = this.ChildrenFactory.GetOrCreateViewForIndex(index);
    if (!view) return 0;
    const h = view.Measure(widthPx, Infinity, scale).Pixels.Height;
    if (this.MeasureItemsStrategy === "MeasureAll" && this.RecyclingTemplate === "Enabled") this.ChildrenFactory.ReleaseViewAt(index);
    return h;
  }

  /** Pixel offset of item index from the top of the layout content (inside padding). */
  GetItemOffsetPixels(index: number): number {
    const scale = this.RenderingScale;
    const gap = this.Spacing * scale;
    let y = this.Padding.Top * scale;
    if (this.MeasureItemsStrategy === "MeasureAll") for (let i = 0; i < index && i < this.itemHeights.length; i++) y += this.itemHeights[i] + gap;
    else y += index * (this.uniformHeight + gap);
    return y;
  }

  private ItemHeightPixels(index: number): number {
    return this.MeasureItemsStrategy === "MeasureAll" ? this.itemHeights[index] ?? 0 : this.uniformHeight;
  }

  // ---- arrange ----

  protected override OnLayoutChanged(): void {
    if (this.IsTemplated) return; // cells are arranged per frame for the visible range only
    const scale = this.RenderingScale;
    const p = this.Padding;
    const r = this.DrawingRect;
    const inner = new SKRect(r.Left + p.Left * scale, r.Top + p.Top * scale, r.Right - p.Right * scale, r.Bottom - p.Bottom * scale);
    const gap = this.Spacing * scale;
    let cursor = this.Type === "Row" ? inner.Left : inner.Top;

    for (const v of this.views) {
      if (!v.IsVisible) continue;
      if (this.Type === "Column") {
        const h = v.MeasuredSize.Pixels.Height;
        v.Arrange(new SKRect(inner.Left, cursor, inner.Right, cursor + h), v.WidthRequest, v.HeightRequest, scale);
        cursor += h + gap;
      } else if (this.Type === "Row") {
        const w = v.MeasuredSize.Pixels.Width;
        v.Arrange(new SKRect(cursor, inner.Top, cursor + w, inner.Bottom), v.WidthRequest, v.HeightRequest, scale);
        cursor += w + gap;
      } else {
        v.Arrange(inner, v.WidthRequest, v.HeightRequest, scale);
      }
    }
  }

  protected override Paint(ctx: DrawingContext): void {
    if (this.IsTemplated) { this.PaintTemplated(ctx); return; }
    for (const v of this.views) v.Render(ctx);
  }

  /** Realizes, binds, arranges and draws only the cells intersecting the visible viewport (+ inflation). */
  private PaintTemplated(ctx: DrawingContext): void {
    const items = this.itemsSource!;
    const scale = this.RenderingScale;
    const r = this.DrawingRect;
    const p = this.Padding;
    const gap = this.Spacing * scale;
    const left = r.Left + p.Left * scale;
    const width = r.Width - p.HorizontalThickness * scale;
    const viewport = this.GetVisibleViewport();
    const inflate = this.VirtualisationInflated * scale;
    const visTop = viewport.Top - inflate, visBottom = viewport.Bottom + inflate;

    let first = -1, last = -1;
    if (items.length > 0 && visBottom > visTop) {
      if (this.MeasureItemsStrategy === "MeasureAll") {
        let y = r.Top + p.Top * scale;
        for (let i = 0; i < items.length; i++) {
          const h = this.itemHeights[i] ?? 0;
          if (y + h >= visTop && y <= visBottom) { if (first < 0) first = i; last = i; } else if (first >= 0) break;
          y += h + gap;
        }
      } else {
        const stride = this.uniformHeight + gap;
        if (stride > 0) {
          first = Math.max(0, Math.floor((visTop - (r.Top + p.Top * scale)) / stride));
          last = Math.min(items.length - 1, Math.floor((visBottom - (r.Top + p.Top * scale)) / stride));
        }
      }
    }
    this.FirstVisibleIndex = first;
    this.LastVisibleIndex = last;
    if (first < 0) { this.ChildrenFactory.ReleaseOutside(1, 0); return; }

    this.ChildrenFactory.ReleaseOutside(first, last);
    for (let i = first; i <= last; i++) {
      const view = this.ChildrenFactory.GetOrCreateViewForIndex(i);
      if (!view) continue;
      const top = r.Top + this.GetItemOffsetPixels(i);
      const h = this.ItemHeightPixels(i);
      view.Measure(width, Infinity, scale); // recycled cells carry new content; height stays the structure's
      view.Arrange(SKRect.Create(left, top, width, h), view.WidthRequest, view.HeightRequest, scale);
      view.Render(ctx);
    }
  }
}

/** SkiaLayout Type=Column + HorizontalOptions=Fill (DrawnUi alias). */
export class SkiaStack extends SkiaLayout {
  constructor() { super(); this.Type = "Column"; this.HorizontalOptions = "Fill"; }
}

/** SkiaLayout Type=Row (DrawnUi alias). */
export class SkiaRow extends SkiaLayout {
  constructor() { super(); this.Type = "Row"; }
}

/** SkiaLayout Type=Absolute + HorizontalOptions=Fill (DrawnUi alias). */
export class SkiaLayer extends SkiaLayout {
  constructor() { super(); this.Type = "Absolute"; this.HorizontalOptions = "Fill"; }
}
