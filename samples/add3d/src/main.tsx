// M1 probe page of the 3D add-on: models from files in a scrolling page.
import { createRoot } from "react-dom/client";
import { Canvas, SkiaLabel, SkiaScroll, SkiaStack, Super } from "drawnui-react";
import { Look, SkiaModel3D } from "drawnui-react-add3d";

await Super.UseDrawnUi().ConfigureFonts((f) => f.AddFont("fonts/OpenSans-Regular.ttf", "FontText")).BuildAsync();

function App() {
  return (
    <Canvas RenderingMode="Accelerated" Gestures="Lock" BackgroundColor="#F4F1EC" style={{ width: "100%", height: "100%" }}>
      <SkiaScroll HorizontalOptions="Fill" VerticalOptions="Fill">
        <SkiaStack HorizontalOptions="Fill" Spacing={16} Padding={16}>
          <SkiaLabel Text="3D add-on, M1" FontSize={20} TextColor="#2B2540" />
          <SkiaModel3D Source="assets/avatar.glb" HorizontalOptions="Fill" HeightRequest={320} />
          <SkiaModel3D Source="assets/dragon.glb" HorizontalOptions="Fill" HeightRequest={320} Look={Look.Toon} OutlineWidth={2} OutlineColor="#2B2540" />
          <SkiaModel3D Source="assets/sofa.glb" HorizontalOptions="Fill" HeightRequest={320} Antialias PinchZoom ResetOnDoubleTap />
          <SkiaModel3D Source="assets/gift.glb" HorizontalOptions="Fill" HeightRequest={320} Look={Look.Flat} OutlineWidth={2} />
        </SkiaStack>
      </SkiaScroll>
    </Canvas>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
