// DrawnUI 3D Demo in the browser: DrawnUI for React on CanvasKit with the 3D add-on. React hosts the canvas and its
// accessibility tree; the gallery's tree is built with the engine API, the same way as the .NET and Rust heads build theirs.
import { createRoot } from "react-dom/client";
import { Canvas, SkiaLayer, Super } from "drawnui-react";
import { Aria, SkiaLabel, type SkiaLayout } from "drawnui-react/core";
import { GalleryRoot } from "./app/GalleryRoot";
import { Theme } from "./app/Theme";
import { HideLoader, TrackDownloads } from "./loader";

TrackDownloads();

await Promise.all([
  Super.UseDrawnUi()
    .ConfigureFonts((fonts) => fonts
      .AddFont("fonts/OpenSans-Regular.ttf", "FontText")
      .AddFont("fonts/OpenSans-Semibold.ttf", Theme.Title))
    .ConfigureStyles((styles) => styles.AddStyle({ TargetType: SkiaLabel, ApplyToDerivedTypes: true, Setters: { FontFamily: "FontText" } }))
    .BuildAsync(),
  Theme.Load(),
]);

// Every label is text to a screen reader.
SkiaLabel.DefaultAccessibilityRole = Aria.RoleText;

const root = new GalleryRoot("Add3D addon to DrawnUI for React");

/** The canvas and one layer: the gallery's tree, built with the engine API, goes into that layer. */
function App() {
  return (
    <Canvas RenderingMode="Accelerated" Gestures="Lock" BackgroundColor={Theme.Page} WasDrawn={HideLoader} style={{ width: "100%", height: "100%" }}>
      <SkiaLayer HorizontalOptions="Fill" VerticalOptions="Fill" ref={(layer: SkiaLayout | null) => { if (layer && !layer.Children.includes(root)) layer.AddSubView(root); }} />
    </Canvas>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
