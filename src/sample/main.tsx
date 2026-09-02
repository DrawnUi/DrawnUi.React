import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { Colors, Super, Thickness } from "../drawnui";
import { Canvas, SkiaLabel, SkiaStack } from "../drawnui/react";

// Same startup shape as DrawnUi.Net / OpenTK: Super.UseDrawnUi().ConfigureFonts(...).BuildAsync()
await Super.UseDrawnUi()
  .ConfigureFonts((fonts) => fonts.AddFont("fonts/OpenSans-Regular.ttf", "FontText"))
  .BuildAsync();

function App() {
  const [count, setCount] = useState(0);
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <button style={{ alignSelf: "flex-start", margin: 8 }} onClick={() => setCount((c) => c + 1)}>
        DOM button: {count}
      </button>
      <Canvas BackgroundColor={Colors.DarkSlateBlue} RenderingMode="Accelerated" style={{ flex: 1 }}>
        <SkiaStack Spacing={8} Padding={new Thickness(16)} VerticalOptions="Center">
          <SkiaLabel Text="Hello World" FontSize={32} TextColor={Colors.White} HorizontalOptions="Center" />
          <SkiaLabel Text={`DrawnUi.React · button clicked ${count} times`} FontSize={16} TextColor={Colors.LightGray} HorizontalOptions="Center" />
        </SkiaStack>
      </Canvas>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
