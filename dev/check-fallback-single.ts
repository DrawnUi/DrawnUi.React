// FontFamilyFallback runs of one character between primary-font characters are drawn (arkanoid repro), checked in Node
// (`npm run check:fallback-single`): OpenSans has no "→", the symbols font has it. A label "a→b" must show the arrow's ink
// (as "a→→b" shows two), not only reserve its room; the arrow is also drawn first, last and alone.
import { readFileSync } from "node:fs";
import { Super, SKRect, SkiaAccessibilityManager, HoverManager, SkiaLayer, SkiaLabel, type AnimatorBase, type Canvas } from "../src/index.ts";

declare const CanvasKitInit: (o: { locateFile: () => string }) => Promise<any>;
const ROOT = process.cwd();
const W = 400, H = 80;
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
  const load = (file: string) => Super.LoadFace(readFileSync(`${ROOT}/samples/public/fonts/${file}`))!;
  Super.Fonts.set("FontText", new Map([[400, load("OpenSans-Regular.ttf")]]));
  Super.Fonts.set("FontSymbols", new Map([[400, load("NotoSansMathSymbols-Subset.ttf")]]));
  Super.DefaultTypeface = Super.Fonts.get("FontText")!.get(400)!; Super.DefaultFontAlias = "FontText";

  /** Draws `text` in white on black; returns its ink (lit pixels) and its measured width. */
  const draw = (text: string) => {
    const root = new SkiaLayer(); root.WidthRequest = W; root.HeightRequest = H; root.BackgroundColor = "#000000";
    const label = new SkiaLabel(); label.Text = text; label.FontSize = 40; label.TextColor = "#FFFFFF"; label.FontFamily = "FontText"; label.FontFamilyFallback = "FontSymbols";
    root.AddSubView(label);
    root._superview = new FakeCanvas() as unknown as Canvas;
    const surface = CK.MakeSurface(W, H);
    root.Measure(W, H, 1); root.Arrange(new SKRect(0, 0, W, H), W, H, 1);
    root.Render({ Context: { Canvas: surface.getCanvas(), Surface: surface }, Destination: new SKRect(0, 0, W, H), Scale: 1 });
    const px = surface.makeImageSnapshot().readPixels(0, 0, { width: W, height: H, colorType: CK.ColorType.RGBA_8888, alphaType: CK.AlphaType.Unpremul, colorSpace: CK.ColorSpace.SRGB }) as Uint8Array;
    surface.delete();
    let ink = 0;
    for (let i = 0; i < px.length; i += 4) if (px[i] > 128) ink++;
    return { ink, width: label.MeasuredSize.Pixels.Width };
  };

  const ab = draw("ab"), arrow = draw("→"), one = draw("a→b"), two = draw("a→→b");
  check("the arrow alone is drawn", arrow.ink > 50, `${arrow.ink} px of ink`);
  check("a→b: room is reserved for the arrow", one.width > ab.width + 10, `${ab.width} -> ${one.width}`);
  check("a→b: the arrow between two primary characters is drawn", one.ink - ab.ink > arrow.ink * 0.8, `ink ab ${ab.ink}, a→b ${one.ink}, arrow ${arrow.ink}`);
  check("a→→b: both arrows are drawn", two.ink - ab.ink > arrow.ink * 1.6, `ink a→→b ${two.ink}`);
  const first = draw("→ab"), last = draw("ab→");
  check("the arrow first or last is drawn", first.ink - ab.ink > arrow.ink * 0.8 && last.ink - ab.ink > arrow.ink * 0.8, `→ab ${first.ink}, ab→ ${last.ink}`);

  console.log(failures ? `FAIL: ${failures} checks` : "OK: one-character fallback runs are drawn");
  process.exit(failures ? 1 : 0);
})();
