import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { Canvas, SkiaLabelFps, SkiaLayer, SkiaShell, Super } from "drawnui-react";
import { type Canvas as CanvasView, SkiaImageManager, Thickness } from "drawnui-react/core";
import { CanvasViewContext } from "./pages/canvasView";
import { RootPage } from "./pages/RootPage";
import { DemoContextMenu, handleContextMenu } from "./pages/DemoContextMenu";
import { SAMPLES } from "./pages/catalog";
import { ImagesPage } from "./pages/ImagesPage";
import { SvgPage } from "./pages/SvgPage";
import { CellsPage } from "./pages/CellsPage";
import { ShapesPage } from "./pages/ShapesPage";
import { TextPage } from "./pages/TextPage";
import { LayoutsPage } from "./pages/LayoutsPage";
import { AccessibilityPage } from "./pages/AccessibilityPage";
import { TransformsPage } from "./pages/TransformsPage";
import { UnevenCellsPage } from "./pages/UnevenCellsPage";
import { LooksPage } from "./pages/LooksPage";
import { SnappingPage } from "./pages/SnappingPage";
import { AnimationsPage } from "./pages/AnimationsPage";
import { ShellPage } from "./pages/ShellPage";
import { EditorPage } from "./pages/EditorPage";
import { KeyboardPage } from "./pages/KeyboardPage";
import { SpritesPage } from "./pages/SpritesPage";
import { ShadersPage } from "./pages/ShadersPage";
import { ScrollPage } from "./pages/ScrollPage";
import { ReorderPage } from "./pages/ReorderPage";
import { PongPage } from "./pages/PongPage";
import { Aria } from "drawnui-react";
import { SkiaButton as SkiaButtonCtrl, SkiaLabel as SkiaLabelCtrl } from "drawnui-react/core";

// Same startup shape as DrawnUi.Net / OpenTK: Super.UseDrawnUi().ConfigureFonts(...).BuildAsync()
await Super.UseDrawnUi()
  .ConfigureFonts((fonts) => fonts
    .AddFont("fonts/OpenSans-Regular.ttf", "FontText")
    .AddFont("fonts/OpenSans-Semibold.ttf", "FontText", 600) // FontAttributes="Bold" / FontWeight={600} pick this face
    .AddFont("fonts/OpenSans-Semibold.ttf", "FontTextBold")
    .AddFont("fonts/Orbitron-Regular.ttf", "FontGame") // Pong score and messages, as in the .NET Pong samples
    .AddSymbols() // FontSymbols / FontSymbols2 (arrows, math, misc) shipped subsets, like DrawnUi.Blazor
    .AddEmojis()) // FontEmoji (Noto Color Emoji faces + hands subset)
  // Same style the .NET Blazor sandbox and the Fiddle register: every label defaults to the app font. Without it a
  // control that leaves FontFamily empty draws in the Skia built-in face, on this engine as on .NET.
  .ConfigureStyles((styles) => styles
    .AddStyle({ TargetType: SkiaLabelCtrl, ApplyToDerivedTypes: true, Setters: { FontFamily: "FontText" } })
    // a button pushes its own FontFamily onto its caption, so the label style above never reaches it: style the button
    .AddStyle({ TargetType: SkiaButtonCtrl, ApplyToDerivedTypes: true, Setters: { FontFamily: "FontText" } }))
  .BuildAsync();

// Accessibility: every label is read as text, every button is a button (React extension; C# opts in per control).
SkiaLabelCtrl.DefaultAccessibilityRole = Aria.RoleText;
SkiaButtonCtrl.DefaultAccessibilityRole = Aria.RoleButton;

const ROUTES = {
  images: () => <ImagesPage />,
  svg: () => <SvgPage />,
  cells: () => <CellsPage />,
  shapes: () => <ShapesPage />,
  text: () => <TextPage />,
  layouts: () => <LayoutsPage />,
  a11y: () => <AccessibilityPage />,
  transforms: () => <TransformsPage />,
  uneven: () => <UnevenCellsPage />,
  looks: () => <LooksPage />,
  snapping: () => <SnappingPage />,
  animations: () => <AnimationsPage />,
  shell: () => <ShellPage />,
  editor: () => <EditorPage />,
  keyboard: () => <KeyboardPage />,
  sprites: () => <SpritesPage />,
  shaders: () => <ShadersPage />,
  scroll: () => <ScrollPage />,
  reorder: () => <ReorderPage />,
  pong: () => <PongPage />,
};
const TITLES = Object.fromEntries(SAMPLES.map((s) => [s.route, s.title]));
const FPS_MARGIN = new Thickness(0, 0, 4, 24);

function App() {
  const [view, setView] = useState<CanvasView | null>(null);
  return (
    <Canvas ref={setView} BackgroundColor="#212529" RenderingMode="Accelerated" Gestures="Enabled" style={{ height: "100%" }} ContextMenu={(_, e) => handleContextMenu(e)}>
      <CanvasViewContext.Provider value={view}>
        <SkiaLayer VerticalOptions="Fill">
          <SkiaShell Routes={ROUTES} Titles={TITLES}>
            <RootPage />
            <DemoContextMenu />
          </SkiaShell>
          {/* dev server only, like the .NET samples' #if DEBUG SkiaLabelFps */}
          {import.meta.env.DEV && <SkiaLabelFps Margin={FPS_MARGIN} VerticalOptions="End" HorizontalOptions="End" Rotation={-45} BackgroundColor="#8B0000" TextColor="#FFFFFF" ZIndex={110} />}
        </SkiaLayer>
      </CanvasViewContext.Provider>
    </Canvas>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// The Images page photo (also the Shell backdrop and the Scroll header), warmed once the first screen is up so the
// first visit to Images shows it at once instead of black tiles.
const preloadPhoto = () => void SkiaImageManager.Instance.PreloadImages(["images/baboon.jpg"], "Low");
if ("requestIdleCallback" in window) requestIdleCallback(preloadPhoto); else setTimeout(preloadPhoto, 1000);
