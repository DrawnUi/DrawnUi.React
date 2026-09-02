import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Canvas, Colors, SkiaShell, Super } from "drawnui-react";
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
  return (
    <Canvas BackgroundColor={Colors.DarkSlateBlue} RenderingMode="Accelerated" Gestures="Enabled" style={{ height: "100vh" }}>
      <SkiaShell Routes={ROUTES} Titles={TITLES}>
        <RootPage />
      </SkiaShell>
    </Canvas>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
