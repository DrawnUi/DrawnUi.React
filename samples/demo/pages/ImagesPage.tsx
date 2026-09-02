import { Colors, SkiaImage, SkiaLabel, SkiaRow, SkiaScroll, SkiaStack, Thickness } from "drawnui-react";
import type { TransformAspect } from "drawnui-react/core";

const ASPECTS: TransformAspect[] = ["AspectCover", "AspectFit", "Fill", "AspectFill", "Fit", "None"];

/** SkiaImage: one source, every TransformAspect side by side (default is AspectCover = crop to fill). */
export function ImagesPage() {
  return (
    <SkiaScroll Orientation="Vertical">
      <SkiaStack Spacing={16} Padding={new Thickness(16)}>
        <SkiaLabel Text="SkiaImage · Aspect" FontSize={24} TextColor={Colors.White} HorizontalOptions="Center" />
        <SkiaLabel Text="Same 512×512 photo in a 220×120 box. Overflow is clipped to the box." FontSize={13} TextColor={Colors.LightGray} HorizontalOptions="Center" />
        {ASPECTS.map((aspect) => (
          <SkiaRow key={aspect} Spacing={16} HorizontalOptions="Center">
            <SkiaImage Source="images/baboon.jpg" WidthRequest={220} HeightRequest={120} Aspect={aspect} BackgroundColor={Colors.Black} />
            <SkiaStack Spacing={4} VerticalOptions="Center" WidthRequest={160}>
              <SkiaLabel Text={aspect} FontSize={16} TextColor={Colors.White} />
              <SkiaLabel Text={`Aspect="${aspect}"`} FontSize={12} TextColor="#94A3B8" />
            </SkiaStack>
          </SkiaRow>
        ))}
        <SkiaLabel Text="Alignment inside the box" FontSize={20} TextColor={Colors.White} HorizontalOptions="Center" Margin={new Thickness(0, 12, 0, 0)} />
        <SkiaRow Spacing={16} HorizontalOptions="Center">
          <SkiaImage Source="images/baboon.jpg" WidthRequest={120} HeightRequest={120} Aspect="AspectFit" HorizontalAlignment="Start" VerticalAlignment="Start" BackgroundColor={Colors.Black} />
          <SkiaImage Source="images/baboon.jpg" WidthRequest={120} HeightRequest={120} Aspect="Fit" HorizontalAlignment="Center" VerticalAlignment="Center" BackgroundColor={Colors.Black} />
          <SkiaImage Source="images/baboon.jpg" WidthRequest={120} HeightRequest={120} Aspect="Fit" HorizontalAlignment="End" VerticalAlignment="End" BackgroundColor={Colors.Black} />
        </SkiaRow>
      </SkiaStack>
    </SkiaScroll>
  );
}
