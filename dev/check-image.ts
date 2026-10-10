// SkiaImage sizing as C# OnMeasuring / DrawnUi.Rust (image_aspect.rs), checked in Node (`npm run check:image`): an
// auto-sized image (no request, not Fill) takes the bitmap scaled by its Aspect into the box, never more than the box;
// with nothing loaded it takes the box; an unbounded side follows the bitmap's aspect; bitmap pixels are device pixels.
import { Super, SKRect, SkiaAccessibilityManager, HoverManager, SkiaImage, SkiaLayer, type AnimatorBase, type Canvas, type TransformAspect } from "../src/index.ts";

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
  const bitmap = (w: number, h: number) => { const s = CK.MakeSurface(w, h); s.getCanvas().clear(CK.RED); const img = s.makeImageSnapshot(); s.delete(); return img; };
  const small = bitmap(40, 20), big = bitmap(400, 100);

  /** A 300 x 200 point box (layer Fill) holding one auto-sized image; returns its size in points. */
  const size = (img: unknown, aspect: TransformAspect, scale = 1, scroll = false) => {
    const fake = new FakeCanvas(); fake.RenderingScale = scale;
    const root = new SkiaLayer(); root.HorizontalOptions = "Fill"; root.VerticalOptions = "Fill";
    const image = new SkiaImage(); image.Aspect = aspect;
    (image as unknown as { LoadedSource: unknown }).LoadedSource = img;
    root.AddSubView(image);
    root._superview = fake as unknown as Canvas;
    const W = 300 * scale, H = scroll ? Infinity : 200 * scale;
    root.Measure(W, H, scale); root.Arrange(new SKRect(0, 0, W, isFinite(H) ? H : 2000), -1, -1, scale);
    return `${Math.round(image.DrawingRect.Width / scale)}x${Math.round(image.DrawingRect.Height / scale)}`;
  };

  check("nothing loaded: the box it is offered", size(undefined, "AspectCover") === "300x200", size(undefined, "AspectCover"));
  const cases: [string, unknown, TransformAspect, string][] = [
    ["small", small, "AspectCover", "300x200"], ["small", small, "AspectFit", "300x150"], ["small", small, "None", "40x20"],
    ["small", small, "Fit", "40x20"], ["small", small, "Fill", "300x200"], ["big", big, "Fit", "300x100"],
    ["big", big, "AspectFit", "300x75"], ["big", big, "AspectFill", "300x100"], ["big", big, "AspectCover", "300x200"],
  ];
  for (const [name, img, aspect, want] of cases) check(`${aspect} ${name}: ${want}`, size(img, aspect) === want, size(img, aspect));
  check("bitmap pixels are device pixels: 40 x 20 at scale 2 = 20 x 10 points", size(small, "None", 2) === "20x10", size(small, "None", 2));
  check("an unbounded side follows the bitmap aspect: 300 x 150", size(small, "AspectFit", 1, true) === "300x150", size(small, "AspectFit", 1, true));

  console.log(failures ? `FAIL: ${failures} checks` : "OK: image sizing");
  process.exit(failures ? 1 : 0);
})();
