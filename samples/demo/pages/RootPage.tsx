import { Colors, SkiaButton, SkiaLabel, SkiaLayer, SkiaStack, SkiaSvg, Thickness, useShell } from "drawnui-react";

const MENU: { route: string; text: string }[] = [
  { route: "images", text: "Images" },
  { route: "svg", text: "SVG" },
  { route: "cells", text: "Recycled cells" },
];

/** Root menu, in the spirit of the DrawnUI demo's TabThree: gradient page, big title, a stack of buttons. */
export function RootPage() {
  const shell = useShell();
  return (
    <SkiaLayer VerticalOptions="Fill" FillGradient={{ Type: "Linear", Colors: ["#889955", "#886655", "#222222"], StartXRatio: 0, StartYRatio: 0, EndXRatio: 1, EndYRatio: 1 }}>
      <SkiaStack Spacing={20} Padding={new Thickness(16, 32)} VerticalOptions="Center">
        <SkiaSvg Source="images/drawnui.svg" WidthRequest={140} LockRatio={1} HorizontalOptions="Center" />
        <SkiaLabel Text="DrawnUi.React" FontSize={44} TextColor={Colors.White} HorizontalOptions="Center" />
        <SkiaLabel Text="DrawnUI engine in TypeScript on CanvasKit, composed with React" FontSize={14} TextColor="#DDDDDD" HorizontalOptions="Center" Margin={new Thickness(0, 0, 0, 12)} />
        <SkiaStack Spacing={12} HorizontalOptions="Center" WidthRequest={240}>
          {MENU.map((m) => (
            <SkiaButton key={m.route} Text={m.text} FontSize={16} BackgroundColor="#22FFFFFF" TextColor={Colors.White} HorizontalOptions="Fill" ApplyEffect="Ripple" Tapped={() => void shell.GoToAsync(m.route)} />
          ))}
        </SkiaStack>
        <SkiaLabel Text="helloreact.drawnui.net · github.com/DrawnUi/DrawnUi.React" FontSize={12} TextColor="#AAAAAA" HorizontalOptions="Center" Margin={new Thickness(0, 24, 0, 0)} />
      </SkiaStack>
    </SkiaLayer>
  );
}
