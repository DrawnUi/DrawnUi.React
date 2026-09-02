import { Colors, SkiaDynamicDrawnCell, SkiaLabel, SkiaLayout, SkiaShape, Thickness } from "drawnui-react/core";

/** Recycled cell, the DrawnUi way: visuals built once in the ctor, SetContent runs on every rebind. */
export class ContactCell extends SkiaDynamicDrawnCell {
  private readonly initials = new SkiaLabel();
  private readonly title = new SkiaLabel();
  private readonly subtitle = new SkiaLabel();

  constructor(onTap: (item: number) => void) {
    super();
    this.Type = "Row";
    this.Spacing = 12;
    this.Padding = new Thickness(12, 10);
    this.BackgroundColor = "#111827";
    this.UseCache = "Image"; // the DrawnUi cell recipe: one bitmap per cell, blitted while scrolling
    this.AnimationTapped = "Ripple";
    this.Tapped = () => onTap(this.BindingContext as number);

    const avatar = new SkiaShape();
    avatar.Type = "Circle";
    avatar.WidthRequest = 42;
    avatar.LockRatio = 1;
    avatar.BackgroundColor = "#1F2937";
    this.initials.FontSize = 14;
    this.initials.TextColor = "#67E8F9";
    this.initials.HorizontalOptions = "Center";
    this.initials.VerticalOptions = "Center";
    avatar.AddSubView(this.initials);

    const column = new SkiaLayout();
    column.Type = "Column";
    column.Spacing = 3;
    column.VerticalOptions = "Center";
    this.title.FontSize = 15;
    this.title.TextColor = Colors.White;
    this.subtitle.FontSize = 12;
    this.subtitle.TextColor = "#94A3B8";
    column.AddSubView(this.title);
    column.AddSubView(this.subtitle);

    this.AddSubView(avatar);
    this.AddSubView(column);
  }

  protected override SetContent(ctx: unknown): void {
    const i = ctx as number;
    this.initials.Text = `${i % 100}`;
    this.title.Text = `Contact ${i}`;
    this.subtitle.Text = `Recycled drawn cell #${i} — scroll me fast`;
  }
}
