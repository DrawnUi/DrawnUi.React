// A page for the mouse text-selection checks (drawnui-cross 6cc, dev/check-text-selection.mjs), mounted over the demo by
// the check through the dev server: three selectable labels in a column with padding around them, a button, and a scroll
// 200 pt tall that holds ten selectable labels (more than it shows). Exposes the canvas as window.__selCanvas.
import { createRoot } from "react-dom/client";
import { Canvas, SkiaButton, SkiaLabel, SkiaScroll, SkiaStack, Thickness } from "drawnui-react";
import type { Canvas as CanvasView } from "drawnui-react/core";

export function Mount(): void {
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:0;top:0;width:600px;height:700px;z-index:10000;background:#111";
  document.body.appendChild(host);
  const label = (text: string) => <SkiaLabel AccessibilityTextSelectable Text={text} FontSize={16} TextColor="#FFFFFF" />;
  createRoot(host).render(
    <Canvas ref={(v: CanvasView | null) => { (window as unknown as { __selCanvas?: CanvasView | null }).__selCanvas = v; }}
      BackgroundColor="#111111" Gestures="Enabled" style={{ width: "600px", height: "700px" }}>
      <SkiaStack Padding={new Thickness(40, 30)} Spacing={24} HorizontalOptions="Fill">
        {label("Alpha label one")}
        {label("Bravo label two")}
        <SkiaLabel AccessibilityTextSelectable Text="Delta link" FontSize={16} TextColor="#FFD06E" AccessibilityRole="link" AccessibilityLabel="Delta link"
          Tapped={() => { (window as unknown as { __linkTaps: number }).__linkTaps = ((window as unknown as { __linkTaps?: number }).__linkTaps ?? 0) + 1; }} />
        {label("Charlie label three")}
        <SkiaButton Text="Button" WidthRequest={120} />
        <SkiaScroll HeightRequest={200} HorizontalOptions="Fill" BackgroundColor="#222222">
          <SkiaStack Spacing={12} Padding={new Thickness(10)}>
            {Array.from({ length: 10 }, (_, i) => <SkiaLabel key={i} AccessibilityTextSelectable Text={`Scroll line ${i}`} FontSize={16} TextColor="#FFFFFF" />)}
          </SkiaStack>
        </SkiaScroll>
      </SkiaStack>
    </Canvas>,
  );
}
