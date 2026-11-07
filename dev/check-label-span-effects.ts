// An outline or drop shadow adds its room once per line, never per span (DrawnUi.Net 6dcfcfce: every span got the room,
// a gap opened before the second span, "BRICKS BREAKER !"), checked in Node (`npm run check:label-span-effects`): the same
// text as one label and as two spans, with a stroke and a shadow, measures the same width and draws the same ink.
import { readFileSync } from "node:fs";
import { Super, SKRect, SkiaAccessibilityManager, HoverManager, SkiaLayer, SkiaLabel, TextSpan, type AnimatorBase, type Canvas } from "../src/index.ts";

declare const CanvasKitInit: (o: { locateFile: () => string }) => Promise<any>;
const ROOT = process.cwd();
const W = 600, H = 120;
let failures = 0;
const check = (name: string, ok: boolean, detail = "") => { if (!ok) failures++; console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`); };

class FakeCanvas {
  readonly AccessibilityManager = new SkiaAccessibilityManager();
  readonly Hover = new HoverManager();
  readonly AnimatingControls = new Map<number, AnimatorBase>();
  RenderingScale = 1;
  GpuEpoch = 0;
  Update(): void {}
  DisposeObject(o: { Dispose(): void }): void { o.Dispose(); }
  RegisterAnimator(a: AnimatorBase): boolean { this.AnimatingControls.set(a.Uid, a); return true; }
  UnregisterAnimator(uid: number): void { this.AnimatingControls.delete(uid); }
}

(async () => {
  const CK = await CanvasKitInit({ locateFile: () => `${ROOT}/node_modules/canvaskit-wasm/bin/full/canvaskit.wasm` });
  (Super as unknown as { CK: unknown }).CK = CK;
  const face = Super.LoadFace(readFileSync(`${ROOT}/samples/public/fonts/OpenSans-Regular.ttf`))!;
  Super.Fonts.set("FontText", new Map([[400, face]])); Super.DefaultTypeface = face; Super.DefaultFontAlias = "FontText";

  /** A label with an outline and a shadow; `parts` > 1 splits the text into spans. Returns its width and its ink's right edge. */
  const draw = (parts: string[], scale: number) => {
    const root = new SkiaLayer(); root.WidthRequest = W; root.HeightRequest = H; root.BackgroundColor = "#000000";
    const label = new SkiaLabel(); label.FontSize = 32; label.TextColor = "#FFFFFF";
    label.StrokeColor = "#FF0000"; label.StrokeWidth = 3; label.DropShadowColor = "#00FF00"; label.DropShadowSize = 4; label.DropShadowOffsetX = 3; label.DropShadowOffsetY = 3;
    if (parts.length === 1) label.Text = parts[0];
    else for (const p of parts) { const s = new TextSpan(); s.Text = p; label.AddSubView(s); }
    root.AddSubView(label);
    root._superview = new FakeCanvas() as unknown as Canvas;
    const surface = CK.MakeSurface(W * scale, H * scale);
    root.Measure(W * scale, H * scale, scale); root.Arrange(new SKRect(0, 0, W * scale, H * scale), -1, -1, scale);
    root.Render({ Context: { Canvas: surface.getCanvas(), Surface: surface }, Destination: new SKRect(0, 0, W * scale, H * scale), Scale: scale });
    const pw = W * scale, ph = H * scale;
    const px = surface.makeImageSnapshot().readPixels(0, 0, { width: pw, height: ph, colorType: CK.ColorType.RGBA_8888, alphaType: CK.AlphaType.Unpremul, colorSpace: CK.ColorSpace.SRGB }) as Uint8Array;
    surface.delete();
    let right = -1, ink = 0;
    for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) { const i = (y * pw + x) * 4; if (px[i] > 60 || px[i + 1] > 60) { ink++; if (x > right) right = x; } }
    return { width: Math.round(label.MeasuredSize.Pixels.Width * 100) / 100, right, ink };
  };

  for (const scale of [1, 2]) {
    const one = draw(["BRICKS BREAKER !"], scale), two = draw(["BRICKS BREAKER ", "!"], scale), three = draw(["BRICKS ", "BREAKER", " !"], scale);
    check(`scale ${scale}: two spans measure as one label`, two.width === one.width && three.width === one.width, `${one.width} / ${two.width} / ${three.width} px`);
    check(`scale ${scale}: and draw the same ink, ending at the same place`, Math.abs(two.right - one.right) <= 1 && Math.abs(three.right - one.right) <= 1 && Math.abs(two.ink - one.ink) <= one.ink * 0.01,
      `right ${one.right} / ${two.right} / ${three.right}, ink ${one.ink} / ${two.ink} / ${three.ink}`);
  }

  console.log(failures ? `FAIL: ${failures} checks` : "OK: outline and shadow room once per line");
  process.exit(failures ? 1 : 0);
})();
