import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { Canvas, Colors, SkiaButton, SkiaImage, SkiaLabel, SkiaRow, SkiaStack, SkiaSvg, Super, Thickness } from "drawnui-react";

// Same startup shape as DrawnUi.Net / OpenTK: Super.UseDrawnUi().ConfigureFonts(...).BuildAsync()
await Super.UseDrawnUi()
  .ConfigureFonts((fonts) => fonts.AddFont("fonts/OpenSans-Regular.ttf", "FontText"))
  .BuildAsync();

function App() {
  const [count, setCount] = useState(0);
  return (
    <Canvas BackgroundColor={Colors.DarkSlateBlue} RenderingMode="Accelerated" Gestures="Enabled" style={{ height: "100vh" }}>
      <SkiaStack Spacing={8} Padding={new Thickness(16)} VerticalOptions="Center">
        <SkiaSvg Source="images/drawnui.svg" WidthRequest={150} LockRatio={1} HorizontalOptions="Center" />
        <SkiaRow Spacing={12} HorizontalOptions="Center" Margin={new Thickness(0, 0, 0, 8)}>
          <SkiaImage Source="images/baboon.jpg" WidthRequest={160} HeightRequest={100} Aspect="AspectCover" BackgroundColor={Colors.Black} />
          <SkiaImage Source="images/baboon.jpg" WidthRequest={160} HeightRequest={100} Aspect="AspectFit" BackgroundColor={Colors.Black} />
        </SkiaRow>
        <SkiaLabel Text="Hello World" FontSize={32} TextColor={Colors.White} HorizontalOptions="Center" />
        <SkiaLabel Text={`DrawnUi.React · button tapped ${count} times`} FontSize={16} TextColor={Colors.LightGray} HorizontalOptions="Center" />
        <SkiaButton Text="Tap me" ApplyEffect="Ripple" HorizontalOptions="Center" Margin={new Thickness(0, 12, 0, 0)} Tapped={() => setCount((c) => c + 1)} />
      </SkiaStack>
    </Canvas>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
