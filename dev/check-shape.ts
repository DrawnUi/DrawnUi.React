// Shape strokes as C# / DrawnUi.Rust (shape_rules.rs), checked in Node (`npm run check:shape`): StrokePath dashes the
// stroke; thin strokes cover the same pixels as upstream (a rounded rectangle's thin stroke through pixel centers at
// 0.55 of its width, a plain one as wide as asked); StrokeBlendMode applies.
import { readFileSync } from "node:fs";
import { Super, SKRect, Thickness, SkiaAccessibilityManager, HoverManager, SkiaLayer, SkiaShape, type SkiaControl, type AnimatorBase, type Canvas } from "../src/index.ts";

declare const CanvasKitInit: (o: { locateFile: () => string }) => Promise<any>;
const ROOT = process.cwd();
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
  const face = CK.Typeface.MakeFreeTypeFaceFromData(readFileSync(`${ROOT}/samples/public/fonts/OpenSans-Regular.ttf`).buffer);
  Super.Fonts.set("FontText", new Map([[400, face]])); Super.DefaultTypeface = face; Super.DefaultFontAlias = "FontText";

  /** A blue 100 x 100 shape at (50, 50) on a white canvas of 200 points at `scale`; returns a pixel reader (ARGB hex). */
  const shot = (scale: number, setup: (s: SkiaShape) => void) => {
    const fake = new FakeCanvas(); fake.RenderingScale = scale;
    const root = new SkiaLayer(); root.VerticalOptions = "Fill"; root.HorizontalOptions = "Fill";
    const shape = new SkiaShape(); shape.Margin = new Thickness(50, 50, 0, 0); shape.WidthRequest = 100; shape.HeightRequest = 100; shape.BackgroundColor = "#0000FF";
    shape.HorizontalOptions = "Start"; shape.VerticalOptions = "Start"; shape.UseCache = "None";
    setup(shape);
    root.AddSubView(shape);
    (root as SkiaControl)._superview = fake as unknown as Canvas;
    const n = Math.round(200 * scale);
    const surface = CK.MakeSurface(n, n);
    const canvas = surface.getCanvas();
    canvas.clear(CK.WHITE);
    root.Measure(n, n, scale); root.Arrange(new SKRect(0, 0, n, n), -1, -1, scale);
    root.Render({ Context: { Canvas: canvas, Surface: surface }, Destination: new SKRect(0, 0, n, n), Scale: scale });
    const px = canvas.readPixels(0, 0, { width: n, height: n, colorType: CK.ColorType.RGBA_8888, alphaType: CK.AlphaType.Unpremul, colorSpace: CK.ColorSpace.SRGB }) as Uint8Array;
    surface.delete();
    return (x: number, y: number) => { const i = (y * n + x) * 4; return [255, px[i], px[i + 1], px[i + 2]]; };
  };
  const hex = (c: number[]) => c.map((v) => v.toString(16).toUpperCase().padStart(2, "0")).join("");
  /**
   * Pixels against expected ARGB hex, each channel within `tolerance`: CanvasKit's Skia covers a fractional edge a few
   * levels differently from upstream's build (the fill a third of a pixel into a 1 px plain stroke: A0 where upstream has AA).
   */
  const same = (got: number[][], want: string, tolerance = 12) => {
    const w = want.split(" ").map((h) => [0, 2, 4, 6].map((i) => parseInt(h.slice(i, i + 2), 16)));
    return got.length === w.length && got.every((c, i) => c.every((v, k) => Math.abs(v - w[i][k]) <= tolerance));
  };
  const row = (p: (x: number, y: number) => number[], y: number, from: number, to: number, step: number) => { const out = []; for (let x = from; x <= to; x += step) out.push(p(x, y)); return out; };
  const column = (p: (x: number, y: number) => number[], x: number, from: number, to: number, step: number) => { const out = []; for (let y = from; y <= to; y += step) out.push(p(x, y)); return out; };

  // StrokePath dashes the stroke (Rust stroke_path_dashes_the_stroke)
  {
    const p = shot(1, (s) => { s.StrokeWidth = 4; s.StrokeColor = "#FF0000"; s.StrokePath = [10, 5]; s.StrokeCap = "Butt"; });
    const got = row(p, 52, 50, 110, 2);
    const want = "FFFF0000 FFFF0000 FFFF0000 FFFF0000 FFFF0000 FFFF0000 FFFFFFFF FFFFFFFF FFFFFFFF FFFF0000 FFFF0000 FFFF0000 FFFF0000 FFFF0000 FFFFFFFF FFFFFFFF FFFF0000 FFFF0000 FFFF0000 FFFF0000 FFFF0000 FFFFFFFF FFFFFFFF FFFFFFFF FFFF0000 FFFF0000 FFFF0000 FFFF0000 FFFF0000 FFFFFFFF FFFFFFFF";
    check("StrokePath [10, 5] dashes the top edge", same(got, want, 0), got.map(hex).join(" "));
  }

  // thin strokes against upstream (Rust one_pixel_strokes_cover_the_same_pixels_as_upstream; left edges held to the right's mirror)
  const cases: [number, number, number, string, string, string, string][] = [
    [1, 1, 0, "FFFFFFFF FFFF7F7F FFA92A80 FF0000FF FF0000FF FF0000FF", "FFFFFFFF FFFF8080 FFAA2A7F FF0000FF FF0000FF FF0000FF", "FF0000FF FF0000FF FF0000FF FFA92A80 FFFF7F7F FFFFFFFF", "FF0000FF FF0000FF FF0000FF FFA92A80 FFFF7F7F FFFFFFFF"],
    [1, 1, 12, "FFFFFFFF FFFFFFFF FFB22774 FF0000FF FF0000FF FF0000FF", "FFFFFFFF FFFFFFFF FFA81D74 FF0000FF FF0000FF FF0000FF", "FF0000FF FF0000FF FF0000FF FFB22774 FFFFFFFF FFFFFFFF", "FF0000FF FF0000FF FF0000FF FFA81D74 FFFFFFFF FFFFFFFF"],
    [1, 0.5, 12, "FFFFFFFF FFFFFFFF FF641FBA FF0000FF FF0000FF FF0000FF", "FFFFFFFF FFFFFFFF FF732EBA FF0000FF FF0000FF FF0000FF", "FF0000FF FF0000FF FF0000FF FF6520BA FFFFFFFF FFFFFFFF", "FF0000FF FF0000FF FF0000FF FF732EBA FFFFFFFF FFFFFFFF"],
    [1, 2, 0, "FFFFFFFF FFFF0000 FFFF0000 FF0000FF FF0000FF FF0000FF", "FFFFFFFF FFFF0000 FFFF0000 FF0000FF FF0000FF FF0000FF", "FF0000FF FF0000FF FF0000FF FFFF0000 FFFF0000 FFFFFFFF", "FF0000FF FF0000FF FF0000FF FFFF0000 FFFF0000 FFFFFFFF"],
    [2, 1, 12, "FFFFFFFF FFFFF2F2 FFFF0000 FF0C00F3 FF0000FF FF0000FF", "FFFFFFFF FFFFFFFF FFFF0000 FF0000FF FF0000FF FF0000FF", "FF0000FF FF0000FF FF0D00F2 FFFF0000 FFFFF3F3 FFFFFFFF", "FF0000FF FF0000FF FF0000FF FFFF0000 FFFFFFFF FFFFFFFF"],
    [2, 2, 0, "FFFFFFFF FFFF0000 FFFF0000 FFFF0000 FFFF0000 FF0000FF", "FFFFFFFF FFFF0000 FFFF0000 FFFF0000 FFFF0000 FF0000FF", "FF0000FF FFFF0000 FFFF0000 FFFF0000 FFFF0000 FFFFFFFF", "FF0000FF FFFF0000 FFFF0000 FFFF0000 FFFF0000 FFFFFFFF"],
  ];
  for (const [scale, width, radius, , top, right, bottom] of cases) {
    const p = shot(scale, (s) => { s.StrokeWidth = width; s.StrokeColor = "#FF0000"; s.CornerRadius = radius; });
    const l = 50 * scale, m = 100 * scale, r = 150 * scale;
    const t = column(p, m, l - 1, l + 4, 1), rr = row(p, m, r - 5, r, 1), b = column(p, m, r - 5, r, 1);
    check(`scale ${scale} stroke ${width} radius ${radius}: top, right, bottom as upstream`, same(t, top) && same(rr, right) && same(b, bottom),
      `top ${t.map(hex).join(" ")} | right ${rr.map(hex).join(" ")} | bottom ${b.map(hex).join(" ")}`);
  }

  // StrokeBlendMode: Clear cuts the stroke out of the shape
  {
    const p = shot(1, (s) => { s.StrokeWidth = 4; s.StrokeColor = "#FF0000"; s.StrokeBlendMode = "Clear"; });
    check("StrokeBlendMode Clear leaves no red on the edge", hex(p(100, 51)) !== "FFFF0000", hex(p(100, 51)));
  }

  console.log(failures ? `FAIL: ${failures} checks` : "OK: shape strokes");
  process.exit(failures ? 1 : 0);
})();
