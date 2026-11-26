// A page for dev/check-fps-label.mjs, mounted over the demo through the dev server: a scroll of plain rows with an FPS
// label on top. Exposes the label as window.__fps.
import { createRoot } from "react-dom/client";
import { Canvas, SkiaLabelFps, SkiaLayer, SkiaScroll, SkiaShape, SkiaStack } from "drawnui-react";
import type { SkiaLabelFps as Fps } from "drawnui-react/core";

export function Mount(): void {
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:0;top:0;width:400px;height:500px;z-index:10000;background:#111";
  document.body.appendChild(host);
  createRoot(host).render(
    <Canvas RenderingMode="Accelerated" Gestures="Lock" BackgroundColor="#111111" style={{ width: "400px", height: "500px" }}>
      <SkiaLayer HorizontalOptions="Fill" VerticalOptions="Fill">
        <SkiaScroll HorizontalOptions="Fill" VerticalOptions="Fill">
          <SkiaStack Spacing={8}>
            {Array.from({ length: 40 }, (_, i) => <SkiaShape key={i} HeightRequest={60} HorizontalOptions="Fill" BackgroundColor={i % 2 ? "#333355" : "#335533"} />)}
          </SkiaStack>
        </SkiaScroll>
        <SkiaLabelFps ref={(v: Fps | null) => { (window as unknown as { __fps?: Fps }).__fps = v ?? undefined; }} HorizontalOptions="End" VerticalOptions="End" />
      </SkiaLayer>
    </Canvas>,
  );
}
