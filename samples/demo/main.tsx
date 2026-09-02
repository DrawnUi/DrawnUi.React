import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { Canvas, Colors, SkiaShell, Super } from "drawnui-react";
import type { Canvas as CanvasView } from "drawnui-react/core";
import { CanvasViewContext } from "./pages/canvasView";
import { RootPage } from "./pages/RootPage";
import { ImagesPage } from "./pages/ImagesPage";
import { SvgPage } from "./pages/SvgPage";
import { CellsPage } from "./pages/CellsPage";

// Same startup shape as DrawnUi.Net / OpenTK: Super.UseDrawnUi().ConfigureFonts(...).BuildAsync()
await Super.UseDrawnUi()
  .ConfigureFonts((fonts) => fonts.AddFont("fonts/OpenSans-Regular.ttf", "FontText"))
  .BuildAsync();

const ROUTES = {
  images: () => <ImagesPage />,
  svg: () => <SvgPage />,
  cells: () => <CellsPage />,
};
const TITLES = { images: "Images", svg: "SVG", cells: "Recycled cells" };

function App() {
  const [view, setView] = useState<CanvasView | null>(null);
  return (
    <Canvas ref={setView} BackgroundColor={Colors.DarkSlateBlue} RenderingMode="Accelerated" Gestures="Enabled" style={{ height: "100vh" }}>
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
