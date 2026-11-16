// A page for the soft-keyboard checks (dev/check-editor-keyboard.mjs), mounted over the demo by the check through the dev
// server: a text field at the top of a scroll taller than the page (a drag elsewhere scrolls) and one in its lower half.
// Exposes the canvas and the editors as window.__ed (Editor, Lower).
import { createRoot } from "react-dom/client";
import { Canvas, SkiaEditor, SkiaScroll, SkiaShape, SkiaStack, Thickness } from "drawnui-react";
import type { Canvas as CanvasView, SkiaEditor as Editor } from "drawnui-react/core";

export function Mount(): void {
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:0;top:0;width:400px;height:600px;z-index:10000;background:#111";
  document.body.appendChild(host);
  const ed: { Canvas?: CanvasView; Editor?: Editor; Lower?: Editor } = {};
  (window as unknown as { __ed: typeof ed }).__ed = ed;
  createRoot(host).render(
    <Canvas ref={(v: CanvasView | null) => { ed.Canvas = v ?? undefined; }} BackgroundColor="#111111" Gestures="Lock" style={{ width: "400px", height: "600px" }}>
      <SkiaScroll HorizontalOptions="Fill" VerticalOptions="Fill">
        <SkiaStack Padding={new Thickness(20)} Spacing={20}>
          <SkiaEditor ref={(v: Editor | null) => { ed.Editor = v ?? undefined; }} WidthRequest={300} HeightRequest={44} MaxLines={1} Text="" BackgroundColor="#222222" TextColor="#FFFFFF" />
          {Array.from({ length: 3 }, (_, i) => <SkiaShape key={i} HeightRequest={120} HorizontalOptions="Fill" BackgroundColor={i % 2 ? "#333355" : "#335533"} />)}
          <SkiaEditor ref={(v: Editor | null) => { ed.Lower = v ?? undefined; }} WidthRequest={300} HeightRequest={44} MaxLines={1} Text="" BackgroundColor="#222222" TextColor="#FFFFFF" />
          {Array.from({ length: 9 }, (_, i) => <SkiaShape key={`b${i}`} HeightRequest={120} HorizontalOptions="Fill" BackgroundColor={i % 2 ? "#333355" : "#335533"} />)}
        </SkiaStack>
      </SkiaScroll>
    </Canvas>,
  );
}
