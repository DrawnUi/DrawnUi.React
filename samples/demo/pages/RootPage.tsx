import { Colors, SkiaButton, SkiaLabel, SkiaLayer, SkiaRow, SkiaScroll, SkiaStack, SkiaSvg, Thickness, useShell } from "drawnui-react";

const SAMPLES: { route: string; title: string; text: string }[] = [
  { route: "images", title: "Images", text: "SkiaImage — every TransformAspect, alignment, clipping" },
  { route: "svg", title: "SVG", text: "SkiaSvg — file and inline sources, TintColor, LockRatio" },
  { route: "cells", title: "Recycled cells", text: "100 000 items in a SkiaScroll, RecyclingTemplate + MeasureFirst, UseCache=Image" },
];

/** Root menu styled after drawnui.net: dark body, navy hero card with bold title and pill buttons, sample cards below. */
export function RootPage() {
  const shell = useShell();
  return (
    <SkiaScroll Orientation="Vertical">
      <SkiaStack Spacing={24} Padding={new Thickness(24, 24, 24, 40)} HorizontalOptions="Center" WidthRequest={820}>
        {/* hero */}
        <SkiaLayer FillGradient={{ Type: "Linear", Colors: ["#0B1F4B", "#112A6E", "#0A1433"], StartXRatio: 0, StartYRatio: 0, EndXRatio: 1, EndYRatio: 1 }}>
          <SkiaStack Spacing={16} Padding={new Thickness(32, 40)}>
            <SkiaSvg Source="images/drawnui.svg" WidthRequest={72} LockRatio={1} HorizontalOptions="Center" TintColor={Colors.White} />
            <SkiaLabel Text="DrawnUI for React" FontSize={48} FontFamily="FontTextBold" TextColor={Colors.White} HorizontalOptions="Center" />
            <SkiaLabel Text="Hardware-accelerated rendering engine for React, powered by CanvasKit" FontSize={18} TextColor="#DEE2E6" HorizontalOptions="Center" />
            <SkiaRow Spacing={16} HorizontalOptions="Center" Margin={new Thickness(0, 12, 0, 0)}>
              <SkiaButton Text="Recycled cells" FontSize={16} FontFamily="FontTextBold" BackgroundColor="#0D6EFD" TextColor={Colors.White} WidthRequest={190} ApplyEffect="Ripple" Tapped={() => void shell.GoToAsync("cells")} />
              <SkiaButton Text="GitHub MIT" FontSize={16} FontFamily="FontTextBold" BackgroundColor="#33FFFFFF" TextColor={Colors.White} WidthRequest={190} ApplyEffect="Ripple" Tapped={() => window.open("https://github.com/DrawnUi/DrawnUi.React", "_blank")} />
            </SkiaRow>
          </SkiaStack>
        </SkiaLayer>

        {/* samples */}
        <SkiaLabel Text="Samples" FontSize={32} TextColor="#DEE2E6" Margin={new Thickness(0, 8, 0, 0)} />
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
