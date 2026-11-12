// Dungeon Run in the browser: DrawnUI for React on CanvasKit. React hosts the canvas and its accessibility tree; the
// game's tree is built with the engine API, the same way as the .NET and Rust heads build theirs.
import { createRoot } from "react-dom/client";
import { Canvas, SkiaLayer, Super } from "drawnui-react";
import { Aria, SkiaLabel, type SkiaLayout } from "drawnui-react/core";
import { DungeonApp } from "./app/DungeonApp";
import { HideLoader, TrackDownloads } from "./loader";

TrackDownloads();

await Super.UseDrawnUi()
  .ConfigureFonts((fonts) => fonts
    .AddFont("fonts/Orbitron-Regular.ttf", "FontGame") // the first font is the default one, as in DrawnUI for Rust
    .AddFont("fonts/Orbitron-Black.ttf", "FontScore")
    .AddFont("fonts/NotoSansMathSymbols-Subset.ttf", DungeonApp.SYMBOLS))
  .ConfigureStyles((styles) => styles.AddStyle({ TargetType: SkiaLabel, ApplyToDerivedTypes: true, Setters: { FontFamily: "FontGame" } }))
  .BuildAsync();

// Every label is text to a screen reader.
SkiaLabel.DefaultAccessibilityRole = Aria.RoleText;
// The title and the help name the framework: "DRAWNUI FOR REACT SAMPLE".
DungeonApp.Framework = "React";

const app = new DungeonApp();
const game = app.Build();

/** The canvas and one layer: the game's tree, built with the engine API, goes into that layer. */
function Game() {
  return (
    <Canvas
      RenderingMode="Accelerated"
      Gestures="Lock" // a game: every touch is its own, no pull-down or rubber band of the page takes a drag
      BackgroundColor="#000000"
      WasDrawn={HideLoader}
      style={{ width: "100%", height: "100%" }}
    >
      <SkiaLayer HorizontalOptions="Fill" VerticalOptions="Fill" ref={(layer: SkiaLayout | null) => { if (layer && !layer.Children.includes(game)) layer.AddSubView(game); }} />
    </Canvas>
  );
}

createRoot(document.getElementById("root")!).render(<Game />);
