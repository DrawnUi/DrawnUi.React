import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { Colors, Super, Thickness } from "../drawnui";
import { Canvas, SkiaButton, SkiaLabel, SkiaLayer, SkiaStack } from "../drawnui/react";

// Same startup shape as DrawnUi.Net / OpenTK: Super.UseDrawnUi().ConfigureFonts(...).BuildAsync()
await Super.UseDrawnUi()
  .ConfigureFonts((fonts) => fonts.AddFont("fonts/OpenSans-Regular.ttf", "FontText"))
  .BuildAsync();

function App() {
  const [count, setCount] = useState(0);
  return (
    <Canvas BackgroundColor={Colors.DarkSlateBlue} RenderingMode="Accelerated" Gestures="Enabled" style={{ height: "100vh" }}>
      <SkiaLayer VerticalOptions="Fill">
        <SkiaStack Spacing={8} Padding={new Thickness(16)} VerticalOptions="Center" Margin={new Thickness(0, 0, 0, 140)}>
          <SkiaLabel Text="Hello World" FontSize={32} TextColor={Colors.White} HorizontalOptions="Center" />
          <SkiaLabel Text={`DrawnUi.React · button tapped ${count} times`} FontSize={16} TextColor={Colors.LightGray} HorizontalOptions="Center" />
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
