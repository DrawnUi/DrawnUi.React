// Label text placed where DrawnUi.Net puts it (drawnui-cross, Nick "text - match .net if possible"), checked in Node
// (`npm run check:label-baseline`): a line is round((ascent + descent) * LineHeight) pixels high and its baseline sits at
// the line's bottom minus the descent, LineHeight's extra space split above and below the text. Pinned with Orbitron
// Black 38 (ascent 38.418, descent 9.234: lines of 48 px): "GAME OVER" in a 256 x 160 layout, centered vertically,
// draws "GAME" on rows 44-70 (baseline 70.766, as .NET).
import { readFileSync } from "node:fs";
import { Super, SKRect, SkiaAccessibilityManager, HoverManager, SkiaLabel, SkiaLayer, type AnimatorBase, type Canvas } from "../src/index.ts";

declare const CanvasKitInit: (o: { locateFile: () => string }) => Promise<any>;
const ROOT = process.cwd();
const W = 256, H = 160;
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
  const face = CK.Typeface.MakeFreeTypeFaceFromData(readFileSync(`${ROOT}/dev/fonts/Orbitron-Black.ttf`).buffer);
  Super.Fonts.set("Orbitron", new Map([[400, face]])); Super.DefaultTypeface = face; Super.DefaultFontAlias = "Orbitron";

  /** Lit rows (white text on black, red > 128) between y0 and y1, as "first-last", and the label. */
  const draw = (setup: (l: SkiaLabel) => void, y0 = 0, y1 = H) => {
    const root = new SkiaLayer(); root.WidthRequest = W; root.HeightRequest = H; root.BackgroundColor = "#000000";
    const label = new SkiaLabel(); label.FontFamily = "Orbitron"; label.FontSize = 38; label.TextColor = "#FFFFFF";
    label.HorizontalOptions = "Fill"; label.HorizontalTextAlignment = "Center"; label.UseCache = "None";
    setup(label);
    root.AddSubView(label);
    root._superview = new FakeCanvas() as unknown as Canvas;
    const surface = CK.MakeSurface(W, H);
    for (let i = 0; i < 2; i++) {
      surface.getCanvas().clear(CK.BLACK);
      root.Measure(W, H, 1); root.Arrange(new SKRect(0, 0, W, H), W, H, 1);
      root.Render({ Context: { Canvas: surface.getCanvas(), Surface: surface }, Destination: new SKRect(0, 0, W, H), Scale: 1 });
    }
    const px = surface.makeImageSnapshot().readPixels(0, 0, { width: W, height: H, colorType: CK.ColorType.RGBA_8888, alphaType: CK.AlphaType.Unpremul, colorSpace: CK.ColorSpace.SRGB }) as Uint8Array;
    surface.delete();
    let first = -1, last = -1;
    for (let y = y0; y < y1; y++) for (let x = 0; x < W; x++) if (px[(y * W + x) * 4] > 128) { if (first < 0) first = y; last = y; break; }
    return { rows: `${first}-${last}`, label };
  };

  const over = draw((l) => { l.Text = "GAME OVER"; l.VerticalOptions = "Center"; }, 0, 80);
  check('"GAME OVER" centered in 256 x 160: "GAME" on rows 44-70, as .NET', over.rows === "44-70", over.rows);
  check("two lines of 48 px", over.label.MeasuredSize.Pixels.Height === 96 && over.label.MeasuredLineHeight === 48, `${over.label.MeasuredSize.Pixels.Height}, line ${over.label.MeasuredLineHeight}`);
  const top = draw((l) => { l.Text = "GAME"; });
  check("one line at the top: baseline 48 - 9.234 = 38.766, rows 12-38", top.rows === "12-38", top.rows);
  check("one line is 48 px high (rounded)", top.label.MeasuredSize.Pixels.Height === 48, `${top.label.MeasuredSize.Pixels.Height}`);
  const tall = draw((l) => { l.Text = "GAME"; l.LineHeight = 1.5; });
  // a line of round(47.652 * 1.5) = 71 px; the text's own 47.33 px centered in it: baseline 71 - 11.83 - 9.234 = 49.93
  check("LineHeight 1.5: the extra space split above and below, rows 23-49", tall.rows === "23-49" && tall.label.MeasuredSize.Pixels.Height === 71, `${tall.rows}, height ${tall.label.MeasuredSize.Pixels.Height}`);

  console.log(failures ? `FAIL: ${failures} checks` : "OK: label lines and baselines as .NET");
  process.exit(failures ? 1 : 0);
})();
