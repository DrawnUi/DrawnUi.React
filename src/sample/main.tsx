import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { Colors, Super, Thickness } from "../drawnui";
import { Canvas, SkiaButton, SkiaHotspot, SkiaLabel, SkiaLayer, SkiaStack } from "../drawnui/react";

// Same startup shape as DrawnUi.Net / OpenTK: Super.UseDrawnUi().ConfigureFonts(...).BuildAsync()
await Super.UseDrawnUi()
  .ConfigureFonts((fonts) => fonts.AddFont("fonts/OpenSans-Regular.ttf", "FontText"))
  .BuildAsync();

function App() {
  const [count, setCount] = useState(0);
  const [background, setBackground] = useState(0);
  return (
    <Canvas BackgroundColor={Colors.DarkSlateBlue} RenderingMode="Accelerated" Gestures="Enabled" style={{ height: "100vh" }}>
      <SkiaLayer VerticalOptions="Fill">
        <SkiaHotspot AnimationTapped="Ripple" TouchEffectColor={Colors.White} Tapped={() => setBackground((c) => c + 1)} />
        <SkiaStack Spacing={8} Padding={new Thickness(16)} VerticalOptions="Center" Margin={new Thickness(0, 0, 0, 140)} InputTransparent>
          <SkiaLabel Text="Hello World" FontSize={32} TextColor={Colors.White} HorizontalOptions="Center" />
          <SkiaLabel Text={`button tapped ${count} · background tapped ${background}`} FontSize={16} TextColor={Colors.LightGray} HorizontalOptions="Center" />
        </SkiaStack>
        <SkiaButton Text="Tap me" ApplyEffect="Ripple" HorizontalOptions="Center" VerticalOptions="Center" Tapped={() => setCount((c) => c + 1)} />
      </SkiaLayer>
    </Canvas>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
