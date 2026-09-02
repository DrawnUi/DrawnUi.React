import { Colors, SkiaLabel, SkiaScroll, SkiaShape, SkiaStack, SkiaWrap, Thickness } from "drawnui-react";

const LOREM = "DrawnUI draws every pixel itself: text is shaped and rasterized by Skia, so a label wraps by words, respects MaxLines with an ellipsis, aligns horizontally and vertically, and never leaves the canvas for a native view. This paragraph is long on purpose so it wraps across several lines at whatever width the layout gives it.";

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <SkiaShape Type="Rectangle" CornerRadius={8} BackgroundColor="#2B3035" HorizontalOptions="Fill">
      <SkiaStack Spacing={8} Padding={new Thickness(16, 12)}>
        <SkiaLabel Text={title} FontSize={12} TextColor="#6EA8FE" FontAttributes="Bold" TextTransform="Uppercase" />
        {children}
      </SkiaStack>
    </SkiaShape>
  );
}

/** SkiaLabel text engine: wrapping, MaxLines, alignment, spacing, weights, transforms. */
export function TextPage() {
  return (
    <SkiaScroll Orientation="Vertical">
      <SkiaStack Spacing={16} Padding={new Thickness(16)} HorizontalOptions="Center" MaximumWidthRequest={720}>
        <SkiaLabel Text="SkiaLabel" FontSize={24} TextColor={Colors.White} HorizontalOptions="Center" />

        <Card title="Word wrap · HorizontalOptions=Fill">
          <SkiaLabel Text={LOREM} FontSize={15} TextColor="#DEE2E6" HorizontalOptions="Fill" />
        </Card>

        <Card title="MaxLines={2} · TailTruncation (default)">
          <SkiaLabel Text={LOREM} FontSize={15} TextColor="#DEE2E6" HorizontalOptions="Fill" MaxLines={2} />
        </Card>

        <Card title="LineSpacing={1.6}">
          <SkiaLabel Text={LOREM} FontSize={14} TextColor="#DEE2E6" HorizontalOptions="Fill" LineSpacing={1.6} MaxLines={3} />
        </Card>

        <Card title="HorizontalTextAlignment Start / Center / End">
          <SkiaWrap Spacing={12}>
            <SkiaLabel Text="Start aligned text wraps inside its own column" FontSize={13} TextColor="#DEE2E6" WidthRequest={215} HorizontalTextAlignment="Start" BackgroundColor="#22FFFFFF" Padding={new Thickness(6)} />
            <SkiaLabel Text="Center aligned text wraps inside its own column" FontSize={13} TextColor="#DEE2E6" WidthRequest={215} HorizontalTextAlignment="Center" BackgroundColor="#22FFFFFF" Padding={new Thickness(6)} />
            <SkiaLabel Text="End aligned text wraps inside its own column" FontSize={13} TextColor="#DEE2E6" WidthRequest={215} HorizontalTextAlignment="End" BackgroundColor="#22FFFFFF" Padding={new Thickness(6)} />
          </SkiaWrap>
        </Card>

        <Card title="VerticalTextAlignment in a 90pt box">
          <SkiaWrap Spacing={12}>
            <SkiaLabel Text="Start" FontSize={14} TextColor="#DEE2E6" WidthRequest={215} HeightRequest={90} VerticalTextAlignment="Start" HorizontalTextAlignment="Center" BackgroundColor="#22FFFFFF" />
            <SkiaLabel Text="Center" FontSize={14} TextColor="#DEE2E6" WidthRequest={215} HeightRequest={90} VerticalTextAlignment="Center" HorizontalTextAlignment="Center" BackgroundColor="#22FFFFFF" />
            <SkiaLabel Text="End" FontSize={14} TextColor="#DEE2E6" WidthRequest={215} HeightRequest={90} VerticalTextAlignment="End" HorizontalTextAlignment="Center" BackgroundColor="#22FFFFFF" />
          </SkiaWrap>
        </Card>

        <Card title="FontFamilyFallback — symbols and emoji the text font lacks">
          <SkiaLabel Text="Arrows ← ↑ → ↓ ⇒ ⇔  math ∑ ∞ ≈ ≠ ≤ ≥ √  misc ♥ ★ ✓ ✗ ⚠ via FontFamilyFallback=&quot;FontSymbols,FontSymbols2&quot;" FontSize={16} TextColor="#DEE2E6" FontFamilyFallback="FontSymbols,FontSymbols2" HorizontalOptions="Fill" />
          <SkiaLabel Text="Emoji 😀 😎 🤖 😂 👍 🙌 via FontFamilyFallback=&quot;FontEmoji&quot; (Noto Color Emoji faces + hands subset)" FontSize={16} TextColor="#DEE2E6" FontFamilyFallback="FontEmoji" HorizontalOptions="Fill" />
          <SkiaLabel Text="Without a fallback the same arrow → and emoji 😀 render as tofu" FontSize={16} TextColor="#ADB5BD" HorizontalOptions="Fill" />
        </Card>

        <Card title="FontAttributes / FontWeight (weights registered via ConfigureFonts)">
          <SkiaLabel Text="Regular 400 — the family default" FontSize={16} TextColor="#DEE2E6" />
          <SkiaLabel Text="FontAttributes=Bold → nearest registered weight (600 Semibold)" FontSize={16} TextColor="#DEE2E6" FontAttributes="Bold" FontFamilyFallback="FontSymbols" />
          <SkiaLabel Text="FontAttributes=Italic → synthetic skew when no italic face" FontSize={16} TextColor="#DEE2E6" FontAttributes="Italic" FontFamilyFallback="FontSymbols" />
          <SkiaLabel Text="FontAttributes=BoldItalic" FontSize={16} TextColor="#DEE2E6" FontAttributes="BoldItalic" />
          <SkiaLabel Text="FontWeight={600} explicit" FontSize={16} TextColor="#DEE2E6" FontWeight={600} />
        </Card>

        <Card title="TextTransform · NoWrap · Padding">
          <SkiaLabel Text="uppercase transform applied at layout time" FontSize={14} TextColor="#DEE2E6" TextTransform="Uppercase" />
          <SkiaLabel Text="Titlecase transform applied at layout time" FontSize={14} TextColor="#DEE2E6" TextTransform="Titlecase" />
          <SkiaLabel Text="LineBreakMode=NoWrap keeps this on one line even when it is far too long for the card width, so it simply runs past the edge" FontSize={14} TextColor="#DEE2E6" LineBreakMode="NoWrap" HorizontalOptions="Fill" />
          <SkiaLabel Text="Padding={new Thickness(12, 6)} + background" FontSize={14} TextColor={Colors.White} BackgroundColor="#0D6EFD" Padding={new Thickness(12, 6)} />
        </Card>

        <Card title="Multiline text with explicit line breaks">
          <SkiaLabel Text={"Line one\nLine two is a bit longer\nLine three"} FontSize={14} TextColor="#DEE2E6" HorizontalTextAlignment="Center" HorizontalOptions="Fill" />
        </Card>
      </SkiaStack>
    </SkiaScroll>
  );
}
