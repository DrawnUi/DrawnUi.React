import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Canvas, SkiaShell, Super } from "drawnui-react";
import type { Canvas as CanvasView } from "drawnui-react/core";
import { CanvasViewContext } from "./pages/canvasView";
import { RootPage } from "./pages/RootPage";
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
import { Aria } from "drawnui-react";
import { SkiaButton as SkiaButtonCtrl, SkiaLabel as SkiaLabelCtrl } from "drawnui-react/core";

// Same startup shape as DrawnUi.Net / OpenTK: Super.UseDrawnUi().ConfigureFonts(...).BuildAsync()
await Super.UseDrawnUi()
  .ConfigureFonts((fonts) => fonts
    .AddFont("fonts/OpenSans-Regular.ttf", "FontText")
    .AddFont("fonts/OpenSans-Semibold.ttf", "FontText", 600) // FontAttributes="Bold" / FontWeight={600} pick this face
    .AddFont("fonts/OpenSans-Semibold.ttf", "FontTextBold")
    .AddSymbols() // FontSymbols / FontSymbols2 (arrows, math, misc) shipped subsets, like DrawnUi.Blazor
    .AddEmojis()) // FontEmoji (Noto Color Emoji faces + hands subset)
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
};
const TITLES = { images: "Images", svg: "SVG", cells: "Recycled cells", shapes: "Shapes", text: "Text", layouts: "Layouts", a11y: "Accessibility", transforms: "Transforms", uneven: "Uneven cells", looks: "Common Controls", snapping: "Carousel & Drawer", animations: "Lottie & GIF", shell: "Shell", editor: "Editor", keyboard: "Keyboard Input", sprites: "Sprites", shaders: "Shaders", scroll: "SkiaScroll" };

function App() {
  const [view, setView] = useState<CanvasView | null>(null);
  // The served index.html carries the sample list as real HTML (crawlers, no-JS fallback); it is the pre-hydration
  // state of the page and is removed once the canvas has drawn its first frame. Same catalog draws both, so a human
  // sees the cards once. If the app never draws, the list stays as the fallback.
  useEffect(() => {
    if (!view) return;
    let raf = 0;
    const check = () => { if (view.FrameIndex > 0) document.querySelector(".site-samples")?.remove(); else raf = requestAnimationFrame(check); };
    check();
    return () => cancelAnimationFrame(raf);
  }, [view]);
  return (
    <Canvas ref={setView} BackgroundColor="#212529" RenderingMode="Accelerated" Gestures="Enabled" style={{ height: "100%" }}>
      <CanvasViewContext.Provider value={view}>
        <SkiaShell Routes={ROUTES} Titles={TITLES}>
          <RootPage />
        </SkiaShell>
      </CanvasViewContext.Provider>
    </Canvas>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
