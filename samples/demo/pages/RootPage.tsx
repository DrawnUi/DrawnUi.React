import { Colors, SkiaLabel, SkiaLayer, SkiaScroll, SkiaStack, SkiaSvg, Thickness, useShell } from "drawnui-react";

const SAMPLES: { route: string; title: string; text: string }[] = [
  { route: "cells", title: "Recycled cells", text: "100 000 items in a SkiaScroll, RecyclingTemplate + MeasureFirst, UseCache=Image" },
  { route: "images", title: "Images", text: "SkiaImage — every TransformAspect, alignment, clipping" },
  { route: "svg", title: "SVG", text: "SkiaSvg — file and inline sources, TintColor, LockRatio" },
];

/** Root menu styled after drawnui.net: dark body, logo + bold title, sample cards below. */
export function RootPage() {
  const shell = useShell();
  return (
    <SkiaScroll Orientation="Vertical">
      <SkiaStack Spacing={24} Padding={new Thickness(24, 24, 24, 40)} HorizontalOptions="Center" WidthRequest={820}>
        <SkiaSvg Source="images/drawnui.svg" WidthRequest={120} LockRatio={1} HorizontalOptions="Center" Margin={new Thickness(0, 16, 0, 0)} />
        <SkiaLabel Text="DrawnUI for React" FontSize={48} FontFamily="FontTextBold" TextColor={Colors.White} HorizontalOptions="Center" />

        {/* samples */}
        <SkiaLabel Text="Snippets" FontSize={32} TextColor="#DEE2E6" Margin={new Thickness(0, 8, 0, 0)} />
        {SAMPLES.map((s) => (
          <SkiaLayer key={s.route} BackgroundColor="#2B3035" AnimationTapped="Ripple" Tapped={() => void shell.GoToAsync(s.route)}>
            <SkiaStack Spacing={6} Padding={new Thickness(24, 20)}>
              <SkiaLabel Text={s.title} FontSize={24} FontFamily="FontTextBold" TextColor={Colors.White} />
              <SkiaLabel Text={s.text} FontSize={14} TextColor="#ADB5BD" />
            </SkiaStack>
            <SkiaLabel Text="›" FontSize={28} TextColor="#6EA8FE" HorizontalOptions="End" VerticalOptions="Center" Margin={new Thickness(0, 0, 24, 0)} />
          </SkiaLayer>
        ))}

        <SkiaLabel Text="helloreact.drawnui.net · github.com/DrawnUi/DrawnUi.React · MIT" FontSize={12} TextColor="#6C757D" HorizontalOptions="Center" Margin={new Thickness(0, 16, 0, 0)} />
      </SkiaStack>
    </SkiaScroll>
  );
}
