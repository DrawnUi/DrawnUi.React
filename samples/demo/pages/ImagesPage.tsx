import { Colors, SkiaImage, SkiaLabel, SkiaScroll, SkiaStack, SkiaWrap, Thickness } from "drawnui-react";
import type { TransformAspect } from "drawnui-react/core";

const ASPECTS: TransformAspect[] = ["AspectCover", "AspectFit", "AspectFill", "AspectFitFill", "Fill", "Fit", "FitFill", "Cover", "None"];

/** SkiaImage: one source, every TransformAspect side by side (default is AspectCover = crop to fill). */
export function ImagesPage() {
  return (
    <SkiaScroll Orientation="Vertical">
      <SkiaStack Spacing={16} Padding={new Thickness(16)}>
        <SkiaLabel Text="SkiaImage · Aspect" FontSize={24} TextColor={Colors.White} HorizontalOptions="Center" />
        <SkiaLabel Text="Same 512×512 photo in a 220×120 box. Overflow is clipped to the box." FontSize={13} TextColor={Colors.LightGray} HorizontalOptions="Center" />
        <SkiaWrap Spacing={16} HorizontalOptions="Center" MaximumWidthRequest={720}>
          {ASPECTS.map((aspect) => (
            <SkiaStack key={aspect} Spacing={4} WidthRequest={220}>
              <SkiaImage Source="images/baboon.jpg" WidthRequest={220} HeightRequest={120} Aspect={aspect} BackgroundColor={Colors.Black} />
              <SkiaLabel Text={aspect} FontSize={15} TextColor={Colors.White} />
              <SkiaLabel Text={`Aspect="${aspect}"`} FontSize={12} TextColor="#94A3B8" />
            </SkiaStack>
          ))}
        </SkiaWrap>
        <SkiaLabel Text="Alignment inside the box" FontSize={20} TextColor={Colors.White} HorizontalOptions="Center" Margin={new Thickness(0, 12, 0, 0)} />
        <SkiaWrap Spacing={16} HorizontalOptions="Center" MaximumWidthRequest={720}>
          <SkiaImage Source="images/baboon.jpg" WidthRequest={120} HeightRequest={120} Aspect="AspectFit" HorizontalAlignment="Start" VerticalAlignment="Start" BackgroundColor={Colors.Black} />
          <SkiaImage Source="images/baboon.jpg" WidthRequest={120} HeightRequest={120} Aspect="Fit" HorizontalAlignment="Center" VerticalAlignment="Center" BackgroundColor={Colors.Black} />
          <SkiaImage Source="images/baboon.jpg" WidthRequest={120} HeightRequest={120} Aspect="Fit" HorizontalAlignment="End" VerticalAlignment="End" BackgroundColor={Colors.Black} />
        </SkiaWrap>
      </SkiaStack>
    </SkiaScroll>
  );
}
