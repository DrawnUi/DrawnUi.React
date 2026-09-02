import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { Canvas, Colors, SkiaButton, SkiaImage, SkiaLabel, SkiaRow, SkiaScroll, SkiaStack, SkiaSvg, Super, Thickness } from "drawnui-react";

// Same startup shape as DrawnUi.Net / OpenTK: Super.UseDrawnUi().ConfigureFonts(...).BuildAsync()
await Super.UseDrawnUi()
  .ConfigureFonts((fonts) => fonts.AddFont("fonts/OpenSans-Regular.ttf", "FontText"))
  .BuildAsync();

const ROWS = Array.from({ length: 40 }, (_, i) => i + 1);

function App() {
  const [count, setCount] = useState(0);
  const [lastRow, setLastRow] = useState(0);
  return (
    <Canvas BackgroundColor={Colors.DarkSlateBlue} RenderingMode="Accelerated" Gestures="Enabled" style={{ height: "100vh" }}>
      <SkiaScroll Orientation="Vertical">
        <SkiaStack Spacing={8} Padding={new Thickness(16)}>
          <SkiaSvg Source="images/drawnui.svg" WidthRequest={150} LockRatio={1} HorizontalOptions="Center" />
          <SkiaRow Spacing={12} HorizontalOptions="Center" Margin={new Thickness(0, 0, 0, 8)}>
            <SkiaImage Source="images/baboon.jpg" WidthRequest={160} HeightRequest={100} Aspect="AspectCover" BackgroundColor={Colors.Black} />
            <SkiaImage Source="images/baboon.jpg" WidthRequest={160} HeightRequest={100} Aspect="AspectFit" BackgroundColor={Colors.Black} />
          </SkiaRow>
          <SkiaLabel Text="Hello World" FontSize={32} TextColor={Colors.White} HorizontalOptions="Center" />
          <SkiaLabel Text={`DrawnUi.React · button tapped ${count} times · last row tapped: ${lastRow || "-"}`} FontSize={16} TextColor={Colors.LightGray} HorizontalOptions="Center" />
          <SkiaButton Text="Tap me" ApplyEffect="Ripple" HorizontalOptions="Center" Margin={new Thickness(0, 12, 0, 16)} Tapped={() => setCount((c) => c + 1)} />
          {ROWS.map((i) => (
            <SkiaRow key={i} Spacing={12} Padding={new Thickness(12, 10)} BackgroundColor={i % 2 ? "#FFFFFF10" : "#00000020"} Tapped={() => setLastRow(i)} AnimationTapped="Ripple">
              <SkiaLabel Text={`Row ${i}`} FontSize={18} TextColor={Colors.White} VerticalOptions="Center" />
              <SkiaLabel Text="scroll me — drag, fling, wheel, overscroll bounce" FontSize={13} TextColor={Colors.LightGray} VerticalOptions="Center" />
            </SkiaRow>
          ))}
        </SkiaStack>
      </SkiaScroll>
    </Canvas>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
