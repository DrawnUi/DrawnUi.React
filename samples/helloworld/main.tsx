import { StrictMode, useCallback, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Canvas, Colors, SkiaButton, SkiaImage, SkiaLabel, SkiaLayer, SkiaRow, SkiaScroll, SkiaStack, SkiaSvg, Super, Thickness,
} from "drawnui-react";
import {
  SkiaDynamicDrawnCell, SkiaLabel as SkiaLabelCtrl, SkiaLayout as SkiaLayoutCtrl, SkiaScroll as SkiaScrollCtrl,
} from "drawnui-react/core";

// Same startup shape as DrawnUi.Net / OpenTK: Super.UseDrawnUi().ConfigureFonts(...).BuildAsync()
await Super.UseDrawnUi()
  .ConfigureFonts((fonts) => fonts.AddFont("fonts/OpenSans-Regular.ttf", "FontText"))
  .BuildAsync();

// Huge data source, like the "Cells" fiddle: 100 000 items, only the visible cells exist.
const ITEMS = Array.from({ length: 100_000 }, (_, i) => i + 1);
const HEADER_HEIGHT = 250;

/** Recycled cell, the DrawnUi way: visuals built once in the ctor, SetContent runs on every rebind. */
class ContactCell extends SkiaDynamicDrawnCell {
  private readonly initials = new SkiaLabelCtrl();
  private readonly title = new SkiaLabelCtrl();
  private readonly subtitle = new SkiaLabelCtrl();

  constructor(onTap: (item: number) => void) {
    super();
    this.Type = "Row";
    this.Spacing = 12;
    this.Padding = new Thickness(12, 10);
    this.BackgroundColor = "#111827";
    this.AnimationTapped = "Ripple";
    this.Tapped = () => onTap(this.BindingContext as number);

    const avatar = new SkiaLayoutCtrl();
    avatar.WidthRequest = 42;
    avatar.LockRatio = 1;
    avatar.BackgroundColor = "#1F2937";
    this.initials.FontSize = 14;
    this.initials.TextColor = "#67E8F9";
    this.initials.HorizontalOptions = "Center";
    this.initials.VerticalOptions = "Center";
    avatar.AddSubView(this.initials);

    const column = new SkiaLayoutCtrl();
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

function App() {
  const [count, setCount] = useState(0);
  const [lastTapped, setLastTapped] = useState(0);
  const [debug, setDebug] = useState("");
  const scroll = useRef<SkiaScrollCtrl>(null);
  const feed = useRef<SkiaLayoutCtrl>(null);
  // ItemTemplate must be a stable reference: a new function on every render would rebuild the whole cell pool.
  const template = useCallback(() => new ContactCell(setLastTapped), []);
  const jump = (index: number, option: "Start" | "End" = "Start") => scroll.current?.ScrollToIndex(index, true, option);

  return (
    <Canvas BackgroundColor={Colors.DarkSlateBlue} RenderingMode="Accelerated" Gestures="Enabled" style={{ height: "100vh" }}>
      <SkiaLayer VerticalOptions="Fill">
        {/* header above the list (no Grid yet: fixed height + matching scroll margin) */}
        <SkiaStack Spacing={8} Padding={new Thickness(16, 12)} HeightRequest={HEADER_HEIGHT}>
          <SkiaRow Spacing={16} HorizontalOptions="Center">
            <SkiaSvg Source="images/drawnui.svg" WidthRequest={80} LockRatio={1} />
            <SkiaImage Source="images/baboon.jpg" WidthRequest={128} HeightRequest={80} Aspect="AspectCover" BackgroundColor={Colors.Black} />
            <SkiaImage Source="images/baboon.jpg" WidthRequest={128} HeightRequest={80} Aspect="AspectFit" BackgroundColor={Colors.Black} />
          </SkiaRow>
          <SkiaLabel Text="Hello World" FontSize={28} TextColor={Colors.White} HorizontalOptions="Center" />
          <SkiaLabel Text={`button tapped ${count} times · last cell tapped: ${lastTapped || "-"}`} FontSize={14} TextColor={Colors.LightGray} HorizontalOptions="Center" />
          <SkiaButton Text="Tap me" ApplyEffect="Ripple" HorizontalOptions="Center" Tapped={() => setCount((c) => c + 1)} />
        </SkiaStack>

        {/* recycled cells: the templated layout is the scroll's ONLY content, like DrawnUi */}
        <SkiaScroll ref={scroll} Orientation="Vertical" Margin={new Thickness(0, HEADER_HEIGHT, 0, 0)} Scrolled={() => setDebug(feed.current?.DebugString ?? "")}>
          <SkiaStack
            ref={feed}
            ItemsSource={ITEMS}
            ItemTemplate={template}
            RecyclingTemplate="Enabled"
            MeasureItemsStrategy="MeasureFirst"
            Spacing={8}
            Padding={new Thickness(16, 8)}
          />
        </SkiaScroll>

        <SkiaStack Spacing={8} Margin={new Thickness(8, 8)} HorizontalOptions="End" VerticalOptions="Center" WidthRequest={120}>
          <SkiaButton Text="HOME" BackgroundColor="#DC143C" HorizontalOptions="Fill" Tapped={() => jump(0)} />
          <SkiaButton Text="BACKWARD" BackgroundColor="#DC143C" HorizontalOptions="Fill" Tapped={() => jump((feed.current?.FirstVisibleIndex ?? 0) - 5)} />
          <SkiaButton Text="MIDDLE" BackgroundColor="#DC143C" HorizontalOptions="Fill" Tapped={() => jump(ITEMS.length / 2)} />
          <SkiaButton Text="FORWARD" BackgroundColor="#DC143C" HorizontalOptions="Fill" Tapped={() => jump((feed.current?.FirstVisibleIndex ?? 0) + 5)} />
          <SkiaButton Text="END" BackgroundColor="#DC143C" HorizontalOptions="Fill" Tapped={() => jump(ITEMS.length, "End")} />
        </SkiaStack>

        <SkiaLabel Text={debug} FontSize={12} TextColor="#00FF00" BackgroundColor="#AA000000" InputTransparent Margin={new Thickness(8)} HorizontalOptions="End" VerticalOptions="End" />
      </SkiaLayer>
    </Canvas>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
