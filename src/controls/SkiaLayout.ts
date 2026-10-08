import { type DrawingContext, SkiaControl } from "../core/SkiaControl";
import { ViewsAdapter } from "../core/ViewsAdapter";
import { type GridLength, type LayoutOptions, type LayoutType, type MeasuringStrategy, type RecyclingTemplate, SKRect, ScaledSize, type ShapeType, Thickness } from "../core/Types";
import { SkiaGridStructure } from "./GridStructure";

/**
 * The place of one item in a recycled templated Row / Wrap / Grid / split Column. C# measures the structure on one
 * template instance bound to each item in turn: Measure here binds a pooled view to the item, keeps its size, the
 * constraints and what the template decided for that item, then gives the view back unless the item is on screen.
 * The same item measured again with the same constraints keeps its size without a rebind (as the list keeps its item
 * heights: a new ItemsSource array is how content changes). Arrange only records the slot; the drawing pass binds a
 * view to each slot it draws.
 */
class TemplatedSlot {
  IsVisible = true;
  Row = 0;
  Column = 0;
  RowSpan = 1;
  ColumnSpan = 1;
  HorizontalOptions: LayoutOptions = "Start";
  VerticalOptions: LayoutOptions = "Start";
  Margin = Thickness.Zero;
  WidthRequest = -1;
  HeightRequest = -1;
  MinimumWidthRequest = -1;
  MinimumHeightRequest = -1;
  MeasuredSize = ScaledSize.Default;
  WidthConstraint = Infinity;
  HeightConstraint = Infinity;
  /** The rect the layout arranged this slot in (pixels). */
  Destination = SKRect.Empty;
  /** The view last arranged in this slot and the Destination it got, so an unchanged view is not arranged twice. */
  ArrangedView?: SkiaControl;
  ArrangedFor?: SKRect;
  private measuredItem: unknown;
  private measuredScale = 0;

  constructor(readonly Index: number, private readonly factory: ViewsAdapter) {}

  Measure(widthConstraint: number, heightConstraint: number, scale: number): ScaledSize {
    const shown = this.factory.GetViewForIndex(this.Index), item = this.factory.Items[this.Index];
    if (!shown && item === this.measuredItem && scale === this.measuredScale
      && Object.is(widthConstraint, this.WidthConstraint) && Object.is(heightConstraint, this.HeightConstraint)) return this.MeasuredSize;
    const view = shown ?? this.factory.GetOrCreateViewForIndex(this.Index, true);
    if (!view) return (this.MeasuredSize = ScaledSize.Default);
    this.MeasuredSize = view.Measure(widthConstraint, heightConstraint, scale);
    this.measuredItem = item;
    this.measuredScale = scale;
    this.WidthConstraint = widthConstraint;
    this.HeightConstraint = heightConstraint;
    this.IsVisible = view.IsVisible;
    this.RowSpan = view.RowSpan;
    this.ColumnSpan = view.ColumnSpan;
    this.HorizontalOptions = view.HorizontalOptions;
    this.VerticalOptions = view.VerticalOptions;
    this.Margin = view.Margin;
    this.WidthRequest = view.WidthRequest;
    this.HeightRequest = view.HeightRequest;
    this.MinimumWidthRequest = view.MinimumWidthRequest;
    this.MinimumHeightRequest = view.MinimumHeightRequest;
    if (!shown) this.factory.ReleaseViewAt(this.Index);
    return this.MeasuredSize;
  }

  Arrange(destination: SKRect, _widthRequest?: number, _heightRequest?: number, _scale?: number): void { this.Destination = destination; }
}

/** What a layout pass measures and arranges: a control, or the slot of a recycled templated item. */
type LayoutChild = SkiaControl | TemplatedSlot;

/**
 * Mirrors DrawnUi SkiaLayout (Absolute / Column / Row / Wrap / Grid).
 * Column/Row give children an infinite main axis (MAUI stack semantics: Fill on the main axis = auto-sized).
 *
 * Templated mode (ItemsSource + ItemTemplate): a single-column Column is the virtualized list, cells are created through
 * the ViewsAdapter for the indexes inside the visible viewport (+ VirtualisationInflated), everything else is arithmetic —
 * MeasureAll (default) measures every item once, MeasureFirst measures one cell and assumes uniform size. A templated
 * Row / Wrap / Grid / split Column follows RecyclingTemplate: Enabled measures every item on pooled views and binds views
 * only to the slots drawn, Disabled keeps one view per item.
 */
export class SkiaLayout extends SkiaControl {
  /** Layout type. SkiaShape redeclares it as ShapeType (any shape value lays out as Absolute), like the C# hidden Type. */
  Type: LayoutType | ShapeType = "Absolute";
  Spacing = 0;
  Padding: Thickness = Thickness.Zero;

  // ---- grid (same names as DrawnUi; definitions as "*, 2*, Auto, 100" or an array) ----
  ColumnDefinitions?: string | GridLength[];
  RowDefinitions?: string | GridLength[];
  /** Track used for columns/rows a child references but no definition declares (C# default: Auto). */
  DefaultColumnDefinition: GridLength = "Auto";
  DefaultRowDefinition: GridLength = "Auto";
  ColumnSpacing = 0;
  RowSpacing = 0;
  /** Structure computed by the last measure; cells are arranged from it. */
  GridStructure?: SkiaGridStructure;

  // ---- templated children (same names as DrawnUi) ----
  private recyclingTemplate: RecyclingTemplate = "Enabled";
  /** Enabled: views come from a pool and are bound to the items being drawn; Disabled: one view per item, never rebound. */
  get RecyclingTemplate(): RecyclingTemplate { return this.recyclingTemplate; }
  set RecyclingTemplate(value: RecyclingTemplate) {
    if (this.recyclingTemplate === value) return;
    this.recyclingTemplate = value;
    if (this.itemTemplate) this.ApplyItemsSource(); // the pool follows the mode
  }
  /** Column count for Column / Wrap content and a templated Grid (0 = free flow); C# Split. */
  Split = 0;
  /** Split > 0: every slot keeps the same width (true) or the cell keeps its measured width (C# SplitAlign). */
  SplitAlign = true;
  /** A short last row spreads over the whole width instead of keeping empty Split slots (C# DynamicColumns). */
  DynamicColumns = false;
  /** Templated Grid: fill column-major (top to bottom, then next column) instead of row-major (C# Invert). */
  Invert = false;
  /** Default MeasureAll (DrawnUi 1.10.6.20): every item keeps its own size; MeasureFirst is explicit uniform rows. */
  MeasureItemsStrategy: MeasuringStrategy = "MeasureAll";
  /** Realized views per item (Disabled) or a recycled pool for the visible range (Enabled). */
  readonly ChildrenFactory = new ViewsAdapter(this);
  FirstVisibleIndex = -1;
  LastVisibleIndex = -1;

  private itemsSource?: readonly unknown[];
  private itemTemplate?: () => SkiaControl;
  private structureDirty = true;
  /** Per-item heights in pixels (MeasureAll, the default) or a single uniform height (MeasureFirst). */
  private itemHeights: number[] = [];
  private uniformHeight = 0;
  private measuredWidthPx = 0;

  // ---- MeasureVisible (DrawnUi experimental strategy): measured prefix + average estimate for the rest ----
  /** Items measured per idle slice before the estimate is refreshed (DrawnUi BackgroundMeasurementBatchSize). */
  BackgroundMeasurementBatchSize = 10;
  /** Pixel heights of measured items (0 = not measured yet), any order: visible cells are measured on demand. */
  private mvHeights = new Float64Array(0);
  /** mvPrefix[i] = offset of item i (inside padding, gaps included) for i <= mvMeasured; items 0..mvMeasured-1 are exact. */
  private mvPrefix = new Float64Array(1);
  private mvMeasured = 0;
  private mvSum = 0;
  private mvCount = 0;
  private mvIdle = 0;
  /** Index of the last item measured by the background pass (DrawnUi LastMeasuredIndex); -1 = none. */
  get LastMeasuredIndex(): number { return this.mvMeasured - 1; }

  get ItemsSource(): readonly unknown[] | undefined { return this.itemsSource; }
  set ItemsSource(value: readonly unknown[] | undefined) {
    if (this.itemsSource === value) return;
    const old = this.itemsSource;
    this.itemsSource = value;
    if (value && old && this.IsTemplated && !this.structureDirty && this.ApplyIncrementalChange(old, value)) { this.InvalidateMeasure(); return; }
    if (value && this.IsTemplated) this.ChildrenFactory.UpdateItems(value);
    this.structureDirty = true;
    this.InvalidateMeasure();
  }

  /**
   * Raised after items were inserted at the head and measured, with the inserted extent in pixels; SkiaScroll uses it to
   * keep the visible rows where they are (DrawnUi head-insert rebase).
   */
  ItemsInsertedAtStart?: (sender: SkiaLayout, insertedPx: number) => void;

  /**
   * DrawnUi keeps the structure on ObservableCollection Add/Insert; React apps replace the array, so the relation is
   * detected instead: same items appended (page loaded) or prepended (chat history) keep every measured height,
   * anything else rebuilds. Returns false when a full rebuild is needed.
   */
  private ApplyIncrementalChange(old: readonly unknown[], items: readonly unknown[]): boolean {
    const n = items.length, o = old.length;
    if (o === 0) return false;
    if (n === o) return this.ApplyReorderChange(old, items);
    if (n < o) return false;
    const k = n - o;
    const scale = this.RenderingScale, gap = this.Spacing * scale, w = this.measuredWidthPx;
    if (this.MeasureItemsStrategy === "MeasureFirst" && this.uniformHeight <= 0) return false;
    const sameAt = (offset: number) => old[0] === items[offset] && old[o - 1] === items[offset + o - 1] && old[o >> 1] === items[offset + (o >> 1)];
    if (sameAt(0)) {
      // append: heights of the new tail are measured lazily (MeasureAll now, MeasureVisible on demand / in idle time)
      this.ChildrenFactory.UpdateItems(items);
      if (this.MeasureItemsStrategy === "MeasureAll") for (let i = o; i < n; i++) this.itemHeights.push(this.MeasureItem(i, w, scale));
      else if (this.MeasureItemsStrategy === "MeasureVisible") {
        const heights = new Float64Array(n); heights.set(this.mvHeights);
        const prefix = new Float64Array(n + 1); prefix.set(this.mvPrefix);
        this.mvHeights = heights; this.mvPrefix = prefix;
      }
      return true;
    }
    if (sameAt(k)) {
      // prepend: shift indices, measure the new head synchronously (bounded), report the inserted extent
      this.ChildrenFactory.ShiftIndices(k, items);
      let insertedPx = 0;
      if (this.MeasureItemsStrategy === "MeasureAll") {
        const head: number[] = [];
        for (let i = 0; i < k; i++) head.push(this.MeasureItem(i, w, scale));
        this.itemHeights.unshift(...head);
        for (const h of head) insertedPx += h + gap;
      } else if (this.MeasureItemsStrategy === "MeasureVisible") {
        const heights = new Float64Array(n); heights.set(this.mvHeights, k);
        this.mvHeights = heights;
        this.mvPrefix = new Float64Array(n + 1);
        this.mvMeasured = 0;
        const sync = Math.min(k, Math.max(this.BackgroundMeasurementBatchSize, 200));
        for (let i = 0; i < sync; i++) insertedPx += this.MvMeasure(i, w, scale, true) + gap;
        if (sync < k) insertedPx += (k - sync) * this.MvStride(gap); // the rest is estimated until the idle pass reaches it
        this.MvExtendPrefix(gap);
      } else {
        insertedPx = k * (this.uniformHeight + gap);
      }
      this.ItemsInsertedAtStart?.(this, insertedPx);
      return true;
    }
    return false;
  }

  /**
   * Same items in another order — a drag-to-reorder, or any code writing a permuted array. DrawnUi handles the
   * matching `ObservableCollection.Move` by keeping the structure and only rebinding the contexts, because its
   * arrange re-flows each row from its bound view (`HandleStructurePreservingMove` / `ApplyMoveChange`, 2026-09-08).
   * The measured heights here are index-keyed and authoritative, so they travel with their items instead: nothing is
   * remeasured, the extent cannot change, and the scroll keeps its offset. Rebuilding instead would reset
   * `MeasureVisible` to "exact for the first screen, estimated after" and throw a scrolled list back towards the top.
   * Returns false when the two arrays are not a permutation of each other, so a real content change still rebuilds.
   */
  private ApplyReorderChange(old: readonly unknown[], items: readonly unknown[]): boolean {
    const n = items.length;
    if (this.MeasureItemsStrategy === "MeasureAll" && this.itemHeights.length !== n) return false;
    if (this.MeasureItemsStrategy === "MeasureVisible" && this.mvHeights.length !== n) return false;

    const moved: number[] = [];
    for (let i = 0; i < n; i++) if (old[i] !== items[i]) moved.push(i);
    if (moved.length === 0) { this.ChildrenFactory.UpdateItems(items); return true; } // same order, new array reference

    // every slot that changed must hold an item that was in one of those slots before, otherwise this is not a reorder
    const free = new Map<unknown, number[]>();
    for (const i of moved) { const q = free.get(old[i]); if (q) q.push(i); else free.set(old[i], [i]); }
    const from = new Int32Array(n);
    for (let i = 0; i < n; i++) from[i] = i;
    for (const i of moved) {
      const q = free.get(items[i]);
      if (!q || q.length === 0) return false;
      from[i] = q.shift()!;
    }

    if (this.MeasureItemsStrategy === "MeasureAll") {
      const was = this.itemHeights;
      this.itemHeights = Array.from({ length: n }, (_, i) => was[from[i]]);
    } else if (this.MeasureItemsStrategy === "MeasureVisible") {
      const was = this.mvHeights, heights = new Float64Array(n);
      for (let i = 0; i < n; i++) heights[i] = was[from[i]];
      this.mvHeights = heights;
      // an item that was never measured can land inside the exact prefix: rebuild it over the leading measured run
      this.mvPrefix = new Float64Array(n + 1);
      this.mvMeasured = 0;
      this.MvExtendPrefix(this.Spacing * this.RenderingScale);
    }
    // MeasureFirst has one height for every row, so a reorder is a pure rebind there (same as the C# note).

    this.ChildrenFactory.UpdateItems(items);
    return true;
  }

  /** Factory creating one cell (DrawnUi DataTemplate). Cells receive the item as BindingContext. */
  get ItemTemplate(): (() => SkiaControl) | undefined { return this.itemTemplate; }
  set ItemTemplate(value: (() => SkiaControl) | undefined) {
    if (this.itemTemplate === value) return;
    this.itemTemplate = value;
    this.ApplyItemsSource();
  }

  get IsTemplated(): boolean { return !!this.itemTemplate && !!this.itemsSource; }
  /** The virtualized list case: a templated single-column Column. */
  private get IsTemplatedList(): boolean { return this.IsTemplated && this.Type === "Column" && this.Split <= 1; }
  /** A templated Row / Wrap / Grid / split Column with RecyclingTemplate Enabled: slots measured on pooled views, views bound to the slots drawn. */
  private get IsRecycledLayout(): boolean { return this.IsTemplated && !this.IsTemplatedList && this.recyclingTemplate === "Enabled"; }
  /** Slots of a recycled layout, one per item. */
  private slots?: TemplatedSlot[];
  /**
   * What the layout pass measures and arranges: static children; the slots of a recycled templated layout; or, with
   * RecyclingTemplate Disabled, one realized view per item.
   */
  private LayoutViews(): readonly LayoutChild[] {
    if (!this.IsTemplated) return this.views;
    const n = this.itemsSource!.length;
    if (this.IsRecycledLayout) {
      if (this.slots?.length !== n) this.slots = Array.from({ length: n }, (_, i) => new TemplatedSlot(i, this.ChildrenFactory));
      return this.slots;
    }
    const out: SkiaControl[] = [];
    for (let i = 0; i < n; i++) { const v = this.ChildrenFactory.GetOrCreateViewForIndex(i); if (v) out.push(v); }
    return out;
  }

  /** Drops realized cells and rebuilds the structure (DrawnUi ApplyItemsSource). */
  ApplyItemsSource(): void {
    this.ChildrenFactory.Initialize(this.itemTemplate, this.itemsSource ?? [], this.recyclingTemplate);
    this.slots = undefined;
    this.structureDirty = true;
    this.InvalidateMeasure();
  }

  /** Diagnostics like DrawnUi DebugString: visible range, realized views, pool. */
  get DebugString(): string {
    if (!this.IsTemplated) return `views ${this.views.length}`;
    const f = this.ChildrenFactory;
    const measured = this.MeasureItemsStrategy === "MeasureVisible" ? ` measured ${this.mvMeasured}/${this.itemsSource!.length}` : "";
    return `items ${this.itemsSource!.length} visible ${this.FirstVisibleIndex}-${this.LastVisibleIndex}${measured} inuse ${f.InUseCount} pool ${f.PoolSize} created ${f.Created}`;
  }

  /** A layout paints outside its box whatever its children paint outside theirs (C# aggregated effects margin). */
  override ComputeEffectsMargin(scale: number): Thickness {
    let l = 0, t = 0, r = 0, b = 0;
    const mine = this.DrawingRect;
    for (const v of this.views) {
      if (!v.IsVisible) continue;
      const m = v.EffectsMargin(scale);
      if (m.Left === 0 && m.Top === 0 && m.Right === 0 && m.Bottom === 0) continue;
      const cr = v.DrawingRect; // child overflow beyond this box, if already arranged
      l = Math.max(l, m.Left - Math.max(0, cr.Left - mine.Left)); t = Math.max(t, m.Top - Math.max(0, cr.Top - mine.Top));
      r = Math.max(r, m.Right - Math.max(0, mine.Right - cr.Right)); b = Math.max(b, m.Bottom - Math.max(0, mine.Bottom - cr.Bottom));
    }
    return new Thickness(Math.max(0, l), Math.max(0, t), Math.max(0, r), Math.max(0, b));
  }

  // ---- static children ----

  private readonly views: SkiaControl[] = [];
  /** Read-only live children like DrawnUi Views: realized cells when templated, else static children. */
  get Views(): readonly SkiaControl[] { return this.IsTemplated ? this.ChildrenFactory.GetViewsInUse() : this.views; }
  /** Settable children list like DrawnUi Children (ignored while templated). */
  get Children(): readonly SkiaControl[] { return this.views; }
  /**
   * C# Children reset (ChildrenCollectionSync, 66a1eb02): the app's children the new list no longer holds are removed,
   * the ones it gained are added, then all of them take the list's order inside the slots app children occupy, so the
   * parts a control made itself keep their place.
   */
  set Children(value: readonly SkiaControl[]) {
    const keep = new Set(value);
    for (const v of [...this.views]) if (v.IsChildrenItem && !keep.has(v)) this.RemoveSubView(v);
    const inViews = new Set(this.views);
    for (const v of value) { v.IsChildrenItem = true; if (!inViews.has(v)) this.AddSubView(v); }
    this.OrderChildren(value);
  }

  /**
   * C# Insert / Move of a Children collection (the reconciler's appendChild / insertBefore): `child` goes before
   * `before` among the app's children, or last without it. A new child is attached at the end of the views and an
   * append stops there; otherwise the app's children take their new order inside the slots they occupy.
   */
  InsertChild(child: SkiaControl, before?: SkiaControl): void {
    child.IsChildrenItem = true;
    const attached = child.Parent === this && this.views.includes(child);
    if (!attached) this.AddSubView(child);
    if (!attached && !before) return;
    const order = this.views.filter((v) => v.IsChildrenItem && v !== child);
    const at = before ? order.indexOf(before) : -1;
    order.splice(at < 0 ? order.length : at, 0, child);
    this.OrderChildren(order);
  }

  /** C# OrderViews: the given children, in their order, inside the slots they occupy in the views; nothing else moves. */
  private OrderChildren(ordered: readonly SkiaControl[]): void {
    const inViews = new Set(this.views);
    const present = ordered.filter((v) => inViews.delete(v));
    if (present.length < 2) return;
    const isChild = new Set(present);
    let next = 0, changed = false;
    for (let i = 0; i < this.views.length && next < present.length; i++) {
      if (!isChild.has(this.views[i])) continue;
      if (this.views[i] !== present[next]) { this.views[i] = present[next]; changed = true; }
      next++;
    }
    if (changed) { this.orderedViews = undefined; this.InvalidateMeasure(); }
  }

  /** C# ClearChildren: removes every subview, the control's own parts included. */
  ClearChildren(): void {
    for (const v of [...this.views]) this.RemoveSubView(v);
  }

  private orderedViews?: SkiaControl[];
  /** Static children sorted by ZIndex (stable), computed once per change (C# GetOrderedSubviews). */
  protected GetOrderedSubviews(): readonly SkiaControl[] {
    if (this.IsTemplated) return this.Views;
    if (!this.orderedViews) {
      let sorted = false;
      for (let i = 1; i < this.views.length && !sorted; i++) if (this.views[i].ZIndex !== this.views[0].ZIndex) sorted = true;
      this.orderedViews = sorted ? this.views.map((v, i) => ({ v, i })).sort((a, b) => a.v.ZIndex - b.v.ZIndex || a.i - b.i).map((x) => x.v) : this.views;
    }
    return this.orderedViews;
  }
  override InvalidateViewsOrder(): void { this.orderedViews = undefined; }

  protected override GetGestureListeners(): readonly SkiaControl[] { return this.GetOrderedSubviews(); }

  protected override DisposeChildren(): void {
    for (const v of [...this.views]) v.Dispose();
    this.views.length = 0;
    this.orderedViews = undefined;
    this.ChildrenFactory.DisposeAll();
  }

  override AddSubView(control: SkiaControl): void { this.InsertSubView(this.views.length, control); }

  override InsertSubView(index: number, control: SkiaControl): void {
    // already a child: a move (React reorders keyed children by inserting an existing one elsewhere), never a 2nd copy
    const at = control.Parent === this ? this.views.indexOf(control) : -1;
    if (at >= 0) { this.views.splice(at, 1); if (at < index) index--; }
    control.Parent = this;
    this.views.splice(Math.min(Math.max(0, index), this.views.length), 0, control);
    this.orderedViews = undefined;
    this.InvalidateMeasure();
    this.Superview?.Hover?.RequestCheck(); // a popup / page under a still mouse
  }

  override RemoveSubView(control: SkiaControl): void {
    const i = this.views.indexOf(control);
    if (i < 0) return;
    this.views.splice(i, 1);
    this.orderedViews = undefined;
    control.Parent = undefined;
    this.InvalidateMeasure();
    this.Superview?.Hover?.RequestCheck();
  }

  // ---- measure ----

  protected override MeasureAbsolute(widthConstraint: number, heightConstraint: number, scale: number): ScaledSize {
    if (this.IsTemplatedList) return this.MeasureTemplated(widthConstraint, heightConstraint, scale);
    const px = this.Padding.HorizontalThickness * scale;
    const py = this.Padding.VerticalThickness * scale;
    const w = widthConstraint - px;
    const h = heightConstraint - py;
    const gap = this.Spacing * scale;
    let cw = 0, ch = 0, n = 0;

    if (this.IsWrapFlow) { const s = this.MeasureWrap(w, scale); return ScaledSize.FromPixels(s.w + px, s.h + py, scale); }
    if (this.Type === "Grid") { const s = this.MeasureGrid(w, h, scale); return ScaledSize.FromPixels(s.w + px, s.h + py, scale); }

    for (const v of this.LayoutViews()) {
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

  /** Wrap rows computed by the last measure: [childIndex, x, y, w, h] in pixels relative to the padded box. */
  private wrapSlots: { view: LayoutChild; x: number; y: number; w: number; h: number }[] = [];

  /** Wrap, or a Column with Split > 1 (C# lays a multi-column Column out like a wrap with fixed slots). */
  private get IsWrapFlow(): boolean { return this.Type === "Wrap" || (this.Type === "Column" && this.Split > 1); }

  /**
   * Flow children left to right, wrapping when the row overflows; Spacing applies between items and rows.
   * Split > 0: fixed column count with slot width (width - (Split - 1) * gap) / Split (`SplitAlign`), a new row every
   * Split items; `DynamicColumns` lets a short last row spread over the width.
   */
  private MeasureWrap(width: number, scale: number): { w: number; h: number } {
    const gap = this.Spacing * scale;
    const split = this.Split > 0 ? this.Split : 0;
    const slotW = split > 0 && isFinite(width) ? (width - (split - 1) * gap) / split : 0;
    this.wrapSlots = [];
    let x = 0, y = 0, rowH = 0, maxW = 0;
    const row: typeof this.wrapSlots = [];
    const finishRow = (last: boolean) => {
      if (last && split > 0 && this.DynamicColumns && row.length > 0 && row.length < split && isFinite(width)) {
        // C# DynamicColumns: the last short row takes the whole width
        const w = (width - (row.length - 1) * gap) / row.length;
        let rx = 0; rowH = 0;
        for (const s of row) { const m = s.view.Measure(w, Infinity, scale); s.x = rx; s.w = w; s.h = m.Pixels.Height; rowH = Math.max(rowH, s.h); rx += w + gap; }
        maxW = Math.max(maxW, rx - gap);
      }
      for (const s of row) s.h = rowH;
      row.length = 0;
    };
    for (const v of this.LayoutViews()) {
      if (!v.IsVisible) continue;
      const s = v.Measure(split > 0 && slotW > 0 ? slotW : width, Infinity, scale);
      const cw = split > 0 && slotW > 0 && this.SplitAlign ? slotW : s.Pixels.Width, ch = s.Pixels.Height;
      const wrap = split > 0 ? row.length >= split : x > 0 && isFinite(width) && x + cw > width;
      if (wrap) { finishRow(false); y += rowH + gap; x = 0; rowH = 0; }
      const slot = { view: v, x, y, w: cw, h: ch };
      this.wrapSlots.push(slot); row.push(slot);
      x += cw + gap; rowH = Math.max(rowH, ch); maxW = Math.max(maxW, x - gap);
    }
    finishRow(true);
    return { w: maxW, h: this.wrapSlots.length ? y + rowH : 0 };
  }

  /** Port of C# MeasureGrid: build the structure in points, stretch the last track when the grid fills, remeasure at final cells. */
  private MeasureGrid(widthPx: number, heightPx: number, scale: number): { w: number; h: number } {
    const wPts = widthPx / scale, hPts = heightPx / scale;
    if (this.IsTemplated) {
      // C# templated grid: item i goes to (i % Split, i / Split), column-major when Invert
      const views = this.LayoutViews(), split = Math.max(1, this.Split);
      const rowsPerColumn = this.Invert && split > 1 ? Math.ceil(views.length / split) : 0;
      views.forEach((v, i) => {
        if (rowsPerColumn > 0) { v.Column = Math.floor(i / rowsPerColumn); v.Row = i % rowsPerColumn; }
        else { v.Row = Math.floor(i / split); v.Column = i % split; }
      });
    }
    const g = new SkiaGridStructure(this, wPts, hPts, scale, this.LayoutViews());
    g.DecompressStars(wPts, hPts);
    const needAutoWidth = this.WidthRequest < 0 && this.HorizontalOptions !== "Fill";
    const needAutoHeight = this.HeightRequest < 0 && this.VerticalOptions !== "Fill";
    if (!needAutoWidth && g.Columns.length > 0 && isFinite(wPts) && g.GridWidth() < wPts) g.Columns[g.Columns.length - 1].Size += wPts - g.GridWidth();
    if (!needAutoHeight && g.Rows.length > 0 && isFinite(hPts) && g.GridHeight() < hPts) g.Rows[g.Rows.length - 1].Size += hPts - g.GridHeight();
    g.RemeasureChildrenAtFinalCells();
    this.GridStructure = g;
    return { w: g.GridWidth() * scale, h: g.GridHeight() * scale };
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
      this.MvReset(items.length);
      if (items.length > 0) {
        if (this.MeasureItemsStrategy === "MeasureAll") {
          for (let i = 0; i < items.length; i++) this.itemHeights.push(this.MeasureItem(i, w, scale));
        } else if (this.MeasureItemsStrategy === "MeasureVisible") {
          // initial pass: enough items to fill the viewport (at least one batch), the rest is estimated
          const viewportH = this.GetVisibleViewport().Height;
          for (let i = 0; i < items.length; i++) {
            this.MvMeasure(i, w, scale, true);
            this.MvExtendPrefix(gap);
            if (i + 1 >= this.BackgroundMeasurementBatchSize && this.mvPrefix[this.mvMeasured] >= viewportH + this.VirtualisationInflated * scale) break;
          }
        } else {
          this.uniformHeight = this.MeasureItem(0, w, scale);
        }
      }
      this.structureDirty = false;
    }

    let total = 0;
    if (this.MeasureItemsStrategy === "MeasureAll") {
      while (this.itemHeights.length < items.length) this.itemHeights.push(this.MeasureItem(this.itemHeights.length, w, scale));
      for (const h of this.itemHeights) total += h; total += Math.max(0, items.length - 1) * gap;
    }
    else if (this.MeasureItemsStrategy === "MeasureVisible") { total = this.MvContentHeight(gap); this.MvScheduleBackground(); }
    else total = this.uniformHeight * items.length + Math.max(0, items.length - 1) * gap;
    return ScaledSize.FromPixels(w + px, total + py, scale);
  }

  private MvReset(count: number): void {
    if (this.mvIdle) { (window.cancelIdleCallback ?? clearTimeout)(this.mvIdle); this.mvIdle = 0; }
    this.mvHeights = new Float64Array(count);
    this.mvPrefix = new Float64Array(count + 1);
    this.mvMeasured = 0; this.mvSum = 0; this.mvCount = 0;
  }

  /** Average item stride (height + gap) from everything measured so far. */
  private MvStride(gap: number): number { return (this.mvCount > 0 ? this.mvSum / this.mvCount : 0) + gap; }

  /** DrawnUi MeasureList estimate: exact prefix + average × remaining. */
  private MvContentHeight(gap: number): number {
    const n = this.mvHeights.length;
    if (n === 0) return 0;
    return this.mvPrefix[this.mvMeasured] + (n - this.mvMeasured) * this.MvStride(gap) - gap;
  }

  /** Measures one item (binding it through the adapter); release = give the cell back to the pool right away. */
  private MvMeasure(index: number, widthPx: number, scale: number, release: boolean): number {
    const known = this.mvHeights[index];
    if (known > 0) return known;
    const view = this.ChildrenFactory.GetOrCreateViewForIndex(index);
    if (!view) return 0;
    const h = view.Measure(widthPx, Infinity, scale).Pixels.Height;
    if (release && this.RecyclingTemplate === "Enabled") this.ChildrenFactory.ReleaseViewAt(index);
    this.mvHeights[index] = h;
    this.mvSum += h; this.mvCount++;
    return h;
  }

  /** Grows the exact prefix over every already-measured item that follows it. */
  private MvExtendPrefix(gap: number): void {
    const n = this.mvHeights.length;
    while (this.mvMeasured < n && this.mvHeights[this.mvMeasured] > 0) {
      this.mvPrefix[this.mvMeasured + 1] = this.mvPrefix[this.mvMeasured] + this.mvHeights[this.mvMeasured] + gap;
      this.mvMeasured++;
    }
  }

  /** Background measurement in idle time (DrawnUi StartBackgroundMeasurement): time-sliced, then the estimate is refreshed once. */
  private MvScheduleBackground(): void {
    if (this.mvIdle || this.mvMeasured >= this.mvHeights.length || !this.Superview) return;
    const run = (deadline?: IdleDeadline) => {
      this.mvIdle = 0;
      if (this.MeasureItemsStrategy !== "MeasureVisible" || !this.IsTemplated || !this.Superview) return;
      const scale = this.RenderingScale, gap = this.Spacing * scale, w = this.measuredWidthPx;
      const before = this.MvContentHeight(gap);
      const started = performance.now();
      const budget = () => (deadline ? deadline.timeRemaining() > 1 : performance.now() - started < 8);
      let measured = 0;
      while (this.mvMeasured < this.mvHeights.length && (measured < this.BackgroundMeasurementBatchSize || budget())) {
        this.MvMeasure(this.mvMeasured, w, scale, true);
        this.MvExtendPrefix(gap);
        measured++;
      }
      if (Math.abs(this.MvContentHeight(gap) - before) > 0.5) this.InvalidateMeasure(); // parents (the scroll) pick up the new extent
      if (this.mvMeasured < this.mvHeights.length) this.MvScheduleBackground();
    };
    this.mvIdle = window.requestIdleCallback ? window.requestIdleCallback(run, { timeout: 200 }) : window.setTimeout(() => run(), 16);
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
    else if (this.MeasureItemsStrategy === "MeasureVisible") y += index <= this.mvMeasured ? this.mvPrefix[index] : this.mvPrefix[this.mvMeasured] + (index - this.mvMeasured) * this.MvStride(gap);
    else y += index * (this.uniformHeight + gap);
    return y;
  }

  private ItemHeightPixels(index: number): number {
    if (this.MeasureItemsStrategy === "MeasureAll") return this.itemHeights[index] ?? 0;
    if (this.MeasureItemsStrategy === "MeasureVisible") return this.mvHeights[index] || this.MvStride(this.Spacing * this.RenderingScale) - this.Spacing * this.RenderingScale;
    return this.uniformHeight;
  }

  // ---- arrange ----

  protected override OnLayoutChanged(): void {
    if (this.IsTemplatedList) return; // cells are arranged per frame for the visible range only
    this.ArrangeChildren();
    // views on screen follow their slots also when a cache above skips the drawing pass (gestures, accessibility)
    if (this.IsRecycledLayout) {
      const scale = this.RenderingScale;
      for (const v of this.ChildrenFactory.GetViewsInUse()) {
        const s = this.slots?.[v.ContextIndex];
        if (s) { v.Arrange(s.Destination, v.WidthRequest, v.HeightRequest, scale); s.ArrangedView = v; s.ArrangedFor = s.Destination; }
      }
    }
  }

  /** Static children and realized views are arranged; the slots of a recycled layout record where their item goes. */
  private ArrangeChildren(): void {
    const scale = this.RenderingScale;
    const p = this.Padding;
    const r = this.DrawingRect;
    const inner = new SKRect(r.Left + p.Left * scale, r.Top + p.Top * scale, r.Right - p.Right * scale, r.Bottom - p.Bottom * scale);
    const gap = this.Spacing * scale;
    let cursor = this.Type === "Row" ? inner.Left : inner.Top;

    if (this.IsWrapFlow) {
      for (const s of this.wrapSlots) s.view.Arrange(SKRect.Create(inner.Left + s.x, inner.Top + s.y, s.w, s.h), s.view.WidthRequest, s.view.HeightRequest, scale);
      return;
    }
    if (this.Type === "Grid") {
      const g = this.GridStructure;
      if (!g) return;
      for (const v of this.LayoutViews()) {
        if (!v.IsVisible) continue;
        const c = g.GetCellBoundsFor(v, inner.Left / scale, inner.Top / scale);
        v.Arrange(SKRect.Create(c.Left * scale, c.Top * scale, c.Width * scale, c.Height * scale), v.WidthRequest, v.HeightRequest, scale);
      }
      return;
    }

    for (const v of this.LayoutViews()) {
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
    if (this.IsTemplatedList) { this.PaintTemplated(ctx); return; }
    if (this.IsRecycledLayout) { this.PaintSlots(ctx); return; }
    const composing = this.IsRenderingWithComposition;
    // inside a composite that redraws only some areas, a child entirely outside them is not even traversed
    const culling = !composing && SkiaControl.CompositionCulling > 0;
    for (const v of this.GetOrderedSubviews()) {
      if (composing ? !this.DirtyChildrenInternal.has(v) : culling && v.IsVisible && v.OutsideCompositionClip(ctx.Context.Canvas)) continue;
      v.Render(ctx);
    }
  }
  protected override GetCompositeChildren(): readonly SkiaControl[] { return this.IsTemplatedList || this.IsRecycledLayout ? [] : this.GetOrderedSubviews(); }

  private readonly drawnSlots = new Set<number>();

  /**
   * Recycled templated layout (C# DrawStack): a view from the pool is bound to each slot that can be seen and drawn
   * there; the views of the other slots go back to the pool.
   */
  private PaintSlots(ctx: DrawingContext): void {
    const slots = this.slots ?? [], f = this.ChildrenFactory, scale = this.RenderingScale, area = this.SlotsArea();
    const drawn = this.drawnSlots;
    drawn.clear();
    for (const s of slots) {
      const d = s.Destination;
      if (s.IsVisible && d.Right > area.Left && d.Left < area.Right && d.Bottom > area.Top && d.Top < area.Bottom) drawn.add(s.Index);
    }
    f.ReleaseExcept(drawn);
    this.FirstVisibleIndex = this.LastVisibleIndex = -1;
    for (const i of drawn) {
      const s = slots[i], view = f.GetOrCreateViewForIndex(i, true);
      if (!view) continue;
      // a view last measured for another item is measured for this one; the whole size is compared because a Wrap has
      // no main-axis size key (C# 3d7bd78f)
      const has = view.MeasuredSize.Pixels, want = s.MeasuredSize.Pixels;
      if (Math.abs(has.Width - want.Width) > 1 || Math.abs(has.Height - want.Height) > 1) view.NeedMeasure = true;
      const size = view.MeasuredSize;
      view.Measure(s.WidthConstraint, s.HeightConstraint, scale);
      if (s.ArrangedView !== view || s.ArrangedFor !== s.Destination || view.MeasuredSize !== size) {
        view.Arrange(s.Destination, view.WidthRequest, view.HeightRequest, scale);
        s.ArrangedView = view; s.ArrangedFor = s.Destination;
      }
      view.Render(ctx);
      if (this.FirstVisibleIndex < 0) this.FirstVisibleIndex = i;
      this.LastVisibleIndex = i;
    }
  }

  /**
   * Where slots are drawn (C# GetOnScreenVisibleArea): what can be seen, inflated by VirtualisationInflated. Under a
   * cache (this layout's or an ancestor's, below the nearest scroll) every slot, because the cache is blitted later at
   * other offsets.
   */
  private SlotsArea(): SKRect {
    for (let c: SkiaControl | undefined = this; c && !("ViewportOffsetY" in c); c = c.Parent) if (c.UsingCacheType !== "None") return this.DrawingRect;
    const v = this.GetVisibleViewport(), inflate = this.VirtualisationInflated * this.RenderingScale;
    return new SKRect(v.Left - inflate, v.Top - inflate, v.Right + inflate, v.Bottom + inflate);
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

    if (this.MeasureItemsStrategy === "MeasureVisible") { this.PaintMeasureVisible(ctx, visTop, visBottom, left, width); return; }

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

  /**
   * MeasureVisible frame: the first visible index comes from the exact prefix (binary search) or the estimate,
   * then cells are laid out contiguously with their REAL measured heights (measured on demand, kept for the prefix).
   */
  private PaintMeasureVisible(ctx: DrawingContext, visTop: number, visBottom: number, left: number, width: number): void {
    const n = this.mvHeights.length;
    const scale = this.RenderingScale, gap = this.Spacing * scale;
    const top0 = this.DrawingRect.Top + this.Padding.Top * scale;
    let first = -1, last = -1;
    if (n > 0 && visBottom > visTop) {
      const rel = visTop - top0;
      if (rel <= this.mvPrefix[this.mvMeasured]) {
        let lo = 0, hi = this.mvMeasured; // largest i with prefix[i] <= rel
        while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (this.mvPrefix[mid] <= rel) lo = mid; else hi = mid - 1; }
        first = Math.min(lo, n - 1);
      } else {
        const stride = this.MvStride(gap);
        first = Math.min(n - 1, this.mvMeasured + (stride > 0 ? Math.floor((rel - this.mvPrefix[this.mvMeasured]) / stride) : 0));
      }
      first = Math.max(0, first);
    }
    if (first < 0) { this.FirstVisibleIndex = this.LastVisibleIndex = -1; this.ChildrenFactory.ReleaseOutside(1, 0); return; }

    let y = top0 + this.GetItemOffsetPixels(first) - this.Padding.Top * scale;
    const drawn: { view: SkiaControl; top: number; h: number }[] = [];
    for (let i = first; i < n && y <= visBottom; i++) {
      const h = this.MvMeasure(i, width, scale, false);
      const view = this.ChildrenFactory.GetOrCreateViewForIndex(i);
      if (view && y + h >= visTop) drawn.push({ view, top: y, h });
      last = i;
      y += h + gap;
    }
    this.MvExtendPrefix(gap);
    this.FirstVisibleIndex = first;
    this.LastVisibleIndex = last;
    this.ChildrenFactory.ReleaseOutside(first, last);
    for (const d of drawn) {
      d.view.Measure(width, Infinity, scale);
      d.view.Arrange(SKRect.Create(left, d.top, width, d.h), d.view.WidthRequest, d.view.HeightRequest, scale);
      d.view.Render(ctx);
    }
    this.MvScheduleBackground();
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

/** SkiaLayout Type=Grid + HorizontalOptions=Fill (DrawnUi alias): MAUI Grid alternative. */
export class SkiaGrid extends SkiaLayout {
  constructor() { super(); this.Type = "Grid"; this.HorizontalOptions = "Fill"; }
}

/** SkiaLayout Type=Wrap + HorizontalOptions=Fill (DrawnUi alias): responsive flow of fixed-size children. */
export class SkiaWrap extends SkiaLayout {
  constructor() { super(); this.Type = "Wrap"; this.HorizontalOptions = "Fill"; }
}
