import { StrictMode, useState } from "react";
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

// Same startup shape as DrawnUi.Net / OpenTK: Super.UseDrawnUi().ConfigureFonts(...).BuildAsync()
await Super.UseDrawnUi()
  .ConfigureFonts((fonts) => fonts
    .AddFont("fonts/OpenSans-Regular.ttf", "FontText")
    .AddFont("fonts/OpenSans-Semibold.ttf", "FontText", 600) // FontAttributes="Bold" / FontWeight={600} pick this face
    .AddFont("fonts/OpenSans-Semibold.ttf", "FontTextBold"))
  .BuildAsync();

const ROUTES = {
  images: () => <ImagesPage />,
  svg: () => <SvgPage />,
  cells: () => <CellsPage />,
  shapes: () => <ShapesPage />,
  text: () => <TextPage />,
};
const TITLES = { images: "Images", svg: "SVG", cells: "Recycled cells", shapes: "Shapes", text: "Text" };

function App() {
  const [view, setView] = useState<CanvasView | null>(null);
  return (
    <Canvas ref={setView} BackgroundColor="#212529" RenderingMode="Accelerated" Gestures="Enabled" style={{ height: "100vh" }}>
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
