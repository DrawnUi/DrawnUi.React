// A page for the Tab checks of scrolls (dev/check-tab-scroll.mjs), mounted over the demo by the check through the dev
// server: header Back / Home, a scroll 280 pt tall, a Footer button. In the scroll, by mode: "plain" 30 buttons, "recycled"
// 200 recycled cells (only the cells near the viewport exist), "cards" three cards 600 pt tall with a button at the top
// and at the bottom (the first cached as an image, the second as operations, the third not cached). Exposes the scroll as
// window.__tabScroll.
import { createRoot } from "react-dom/client";
import { Aria, Canvas, SkiaButton, SkiaRow, SkiaScroll, SkiaShape, SkiaStack, Thickness } from "drawnui-react";
import { SkiaButton as SkiaButtonCtrl, SkiaDynamicDrawnCell, type SkiaScroll as SkiaScrollCtrl } from "drawnui-react/core";

/** A recycled cell that is one button named after its item. */
class ItemCell extends SkiaDynamicDrawnCell {
  private readonly button = new SkiaButtonCtrl();
  constructor() {
    super();
    this.HorizontalOptions = "Fill";
    this.button.HeightRequest = 36;
    this.button.HorizontalOptions = "Fill";
    this.AddSubView(this.button);
  }
  protected override SetContent(ctx: unknown): void {
    this.button.Text = `Item ${ctx as number}`;
    this.button.AccessibilityLabel = `Item ${ctx as number}`;
  }
}
const ITEMS = Array.from({ length: 200 }, (_, i) => i);
const template = () => new ItemCell();

export function Mount(mode: "plain" | "recycled" | "cards"): void {
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:0;top:0;width:500px;height:600px;z-index:10000;background:#111";
  document.body.appendChild(host);
  const button = (text: string) => <SkiaButton Text={text} AccessibilityRole={Aria.RoleButton} AccessibilityLabel={text} WidthRequest={120} HeightRequest={36} />;
  const content =
    mode === "plain" ? (
      <SkiaStack Spacing={8} Padding={new Thickness(10)} HorizontalOptions="Fill">
        {Array.from({ length: 30 }, (_, i) => <SkiaButton key={i} Text={`Item ${i}`} AccessibilityRole={Aria.RoleButton} AccessibilityLabel={`Item ${i}`} HeightRequest={36} HorizontalOptions="Fill" />)}
      </SkiaStack>
    ) : mode === "recycled" ? (
      <SkiaStack ItemsSource={ITEMS} ItemTemplate={template} RecyclingTemplate="Enabled" MeasureItemsStrategy="MeasureFirst" Spacing={8} Padding={new Thickness(10)} HorizontalOptions="Fill" />
    ) : (
      <SkiaStack Spacing={12} Padding={new Thickness(10)} HorizontalOptions="Fill">
        {(["Image", "Operations", "None"] as const).map((cache, i) => (
          <SkiaShape key={i} HeightRequest={600} HorizontalOptions="Fill" BackgroundColor="#2A2A3A" CornerRadius={10} UseCache={cache}>
            <SkiaButton Text={`Top ${i}`} AccessibilityRole={Aria.RoleButton} AccessibilityLabel={`Top ${i}`} WidthRequest={140} HeightRequest={36} Margin={new Thickness(10)} VerticalOptions="Start" />
            <SkiaButton Text={`Bottom ${i}`} AccessibilityRole={Aria.RoleButton} AccessibilityLabel={`Bottom ${i}`} WidthRequest={140} HeightRequest={36} Margin={new Thickness(10)} VerticalOptions="End" />
          </SkiaShape>
        ))}
      </SkiaStack>
    );
  createRoot(host).render(
    <Canvas BackgroundColor="#111111" Gestures="Enabled" style={{ width: "500px", height: "600px" }}>
      <SkiaStack Spacing={10} Padding={new Thickness(16)} HorizontalOptions="Fill">
        <SkiaRow Spacing={10}>{button("Back")}{button("Home")}</SkiaRow>
        <SkiaScroll ref={(s: SkiaScrollCtrl | null) => { (window as unknown as { __tabScroll?: SkiaScrollCtrl | null }).__tabScroll = s; }}
          HeightRequest={280} HorizontalOptions="Fill" BackgroundColor="#1B1B24">
          {content}
        </SkiaScroll>
        {button("Footer")}
      </SkiaStack>
    </Canvas>,
  );
}
