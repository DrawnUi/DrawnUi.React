import { Colors, SkiaDynamicDrawnCell, SkiaLabel, SkiaShape, SkiaStack, Thickness } from "drawnui-react/core";
import type { SkiaControl, SkiaGesturesInfo, SkiaScroll } from "drawnui-react/core";

export interface ReorderItem { Id: number; Title: string; Color: string }

/** What the page lends every cell so a drag can move the item and scroll the list under it. */
export interface DragHost {
  Scroll: () => SkiaScroll | undefined;
  IndexOf: (item: ReorderItem) => number;
  /** Writes the new order; false when the target index is outside the list. */
  Move: (from: number, to: number) => boolean;
  /** The item currently being dragged, so every cell can show which row it is. */
  Dragging: () => ReorderItem | undefined;
  SetDragging: (item: ReorderItem | undefined) => void;
  Spacing: number;
}

/** Points from either end of the viewport where a resting pointer keeps the list moving. */
const EDGE_ZONE = 44;
/** Points per frame it moves there. */
const EDGE_STEP = 7;

/**
 * One row of the reorder list: a grip, a caption and the item id.
 *
 * The drag lives on the grip. A vertical pan inside a vertical SkiaScroll belongs to the scroll — it only lets a child
 * take the pan if the child consumes it — so the grip stands the scroll down on Down and gives it back on Up. Travel
 * is counted in CONTENT space: the pointer's own movement plus whatever the list scrolled underneath it, which is what
 * lets a drag reach a position that was off screen when it started. Each step is one `Move` on the items array, which
 * the layout applies to the cells it already has (SkiaLayout.ApplyReorderChange), so heights and the scroll offset
 * survive and the list reorders live under the finger instead of after the drop.
 */
export class ReorderCell extends SkiaDynamicDrawnCell {
  private readonly frame = new SkiaShape();
  private readonly grip = new SkiaStack();
  private readonly title = new SkiaLabel();
  private readonly badge = new SkiaLabel();

  private dragIndex = -1;
  private travel = 0;
  private stride = 0;
  private pointerY = 0;
  private lastOffset = 0;
  private scroll?: SkiaScroll;
  private raf = 0;

  constructor(private readonly host: DragHost) {
    super();
    this.Type = "Absolute";
    this.HeightRequest = 44;
    this.HorizontalOptions = "Fill";

    this.frame.Type = "Rectangle";
    this.frame.CornerRadius = 8;
    this.frame.HorizontalOptions = "Fill";
    this.frame.VerticalOptions = "Fill";

    this.grip.Spacing = 3;
    this.grip.WidthRequest = 26;
    this.grip.HorizontalOptions = "Start"; // a SkiaStack fills by default, and a Fill child is stretched at arrange
    this.grip.VerticalOptions = "Fill";    // the whole row height is grabbable, the bars just sit in the middle
    this.grip.AccessibilityRole = "button";
    this.grip.Margin = new Thickness(10, 0, 0, 0);
    const bars = new SkiaStack();
    bars.Spacing = 3;
    bars.VerticalOptions = "Center";
    bars.HorizontalOptions = "Fill";
    for (let i = 0; i < 3; i++) {
      const bar = new SkiaShape();
      bar.Type = "Rectangle";
      bar.CornerRadius = 1;
      bar.HeightRequest = 2;
      bar.WidthRequest = 16;
      bar.BackgroundColor = "#94A3B8";
      bar.HorizontalOptions = "Center";
      bars.AddSubView(bar);
    }
    this.grip.AddSubView(bars);
    this.grip.ConsumeGestures = (sender, e) => this.OnGrip(sender, e);

    this.title.FontSize = 14;
    this.title.TextColor = Colors.White;
    this.title.VerticalOptions = "Center";
    this.title.Margin = new Thickness(46, 0, 60, 0);

    this.badge.FontSize = 12;
    this.badge.TextColor = "#94A3B8";
    this.badge.HorizontalOptions = "End";
    this.badge.VerticalOptions = "Center";
    this.badge.Margin = new Thickness(0, 0, 14, 0);

    this.AddSubView(this.frame);
    this.AddSubView(this.grip);
    this.AddSubView(this.title);
    this.AddSubView(this.badge);
  }

  protected override SetContent(ctx: unknown): void {
    const item = ctx as ReorderItem;
    const dragged = this.host.Dragging() === item;
    this.grip.AccessibilityLabel = `Reorder ${item.Title}`;
    this.title.Text = item.Title;
    this.badge.Text = `#${item.Id}`;
    this.frame.BackgroundColor = dragged ? "#1D4ED8" : "#111827";
    this.frame.StrokeColor = dragged ? "#93C5FD" : item.Color;
    this.frame.StrokeWidth = dragged ? 2 : 1;
  }

  private OnGrip(_sender: SkiaControl, e: SkiaGesturesInfo): void {
    const type = e.Args.Type;

    if (type === "Down") {
      this.EndDrag(); // a previous drag that never saw its Up
      const item = this.BindingContext as ReorderItem | undefined;
      this.dragIndex = item ? this.host.IndexOf(item) : -1;
      e.Consumed = this.dragIndex >= 0;
      if (!e.Consumed || !item) return;

      this.host.SetDragging(item);
      this.travel = 0;
      this.stride = this.MeasuredSize.Units.Height + this.host.Spacing;
      this.pointerY = e.Args.Event.Location.Y;
      this.scroll = this.host.Scroll();
      this.lastOffset = this.scroll?.ViewportOffsetY ?? 0;
      if (this.scroll) this.scroll.RespondsToGestures = false; // the pan is ours for the whole drag
      if (!this.raf) this.raf = requestAnimationFrame(this.Tick);
      return;
    }

    if (this.dragIndex < 0) return;

    if (type === "Panning") {
      this.pointerY = e.Args.Event.Location.Y;
      this.travel += e.Args.Event.Distance.Delta.Y / this.RenderingScale;
      e.Consumed = true;
      return;
    }

    if (type === "Up" || type === "Touch") this.EndDrag();
  }

  /** One frame of the drag: hold at an edge and the list keeps moving, so the row keeps advancing. */
  private readonly Tick = (): void => {
    this.raf = 0;
    if (this.dragIndex < 0) return;

    const scroll = this.scroll;
    if (scroll) {
      const scale = scroll.RenderingScale || 1;
      const zone = EDGE_ZONE * scale;
      const direction = this.pointerY < scroll.DrawingRect.Top + zone ? 1
        : this.pointerY > scroll.DrawingRect.Bottom - zone ? -1 : 0;
      if (direction !== 0) scroll.ScrollTo(scroll.ViewportOffsetX, scroll.ViewportOffsetY + direction * EDGE_STEP, 0, true);

      const offset = scroll.ViewportOffsetY;
      this.travel += this.lastOffset - offset; // the list moving under the pointer advances the row as well
      this.lastOffset = offset;
    }

    while (this.stride > 0 && Math.abs(this.travel) >= this.stride) {
      const step = Math.sign(this.travel);
      if (!this.host.Move(this.dragIndex, this.dragIndex + step)) { this.travel = 0; break; } // hit an end
      this.dragIndex += step;
      this.travel -= step * this.stride;
    }

    this.raf = requestAnimationFrame(this.Tick);
  };

  /** Ends a drag: stops the ticker and gives the scroll its gestures back. */
  private EndDrag(): void {
    if (this.raf) { cancelAnimationFrame(this.raf); this.raf = 0; }
    if (this.dragIndex >= 0) this.host.SetDragging(undefined);
    this.dragIndex = -1;
    if (this.scroll) { this.scroll.RespondsToGestures = true; this.scroll = undefined; }
  }

  override Dispose(): void {
    this.EndDrag();
    super.Dispose();
  }
}
