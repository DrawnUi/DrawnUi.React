// A page for dev/check-tiles-thin-lines.mjs, mounted over the demo through the dev server: a 512 px pattern (white, a 2 px
// black vertical line every 32 px) drawn by an accelerated canvas as 64 px tiles (an eighth of its size) on the left,
// and once shrunk to 64 px by a plain SkiaImage on the right.
import { createRoot } from "react-dom/client";
import { Canvas, SkiaImage, SkiaImageTiles, SkiaLayer, Super } from "drawnui-react";

export function Mount(): void {
  const CK = Super.CK;
  const s = CK.MakeSurface(512, 512)!, c = s.getCanvas(), p = new CK.Paint();
  c.clear(CK.WHITE); p.setColor(CK.BLACK);
  for (let x = 0; x < 512; x += 32) c.drawRect(CK.LTRBRect(x + 15, 0, x + 17, 512), p);
  const pattern = s.makeImageSnapshot(); p.delete(); s.delete();
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:0;top:0;width:256px;height:64px;z-index:10000;background:#fff";
  document.body.appendChild(host);
  createRoot(host).render(
    <Canvas RenderingMode="Accelerated" BackgroundColor="#FFFFFF" style={{ width: "256px", height: "64px" }}>
      <SkiaLayer HorizontalOptions="Fill" VerticalOptions="Fill">
        <SkiaImageTiles ImageBitmap={pattern} TileWidth={64} TileHeight={64} TileAspect="AspectCover" WidthRequest={128} HeightRequest={64} />
        <SkiaImage ImageBitmap={pattern} Aspect="AspectCover" WidthRequest={64} HeightRequest={64} Margin="160,0,0,0" />
      </SkiaLayer>
    </Canvas>,
  );
}
