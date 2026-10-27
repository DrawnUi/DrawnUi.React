// Thickness-typed properties (Padding, Margin), checked in Node (`npm run check:thickness`): a number means the same
// thickness on every side, as C# XAML `Padding="12"`, and so do the C# string forms "12", "12,6", "l,t,r,b"; each draws
// exactly what the Thickness value draws, on every layout type and on a label. A value that is no thickness at all
// never blanks the control: it is 0, with a console warning.
import {
  Super, SKRect, Thickness, SkiaAccessibilityManager, HoverManager, SkiaLayout, SkiaStack, SkiaRow, SkiaLayer, SkiaWrap,
  SkiaGrid, SkiaMasonry, SkiaShape, SkiaLabel, type Canvas, type AnimatorBase, type SkiaControl,
} from "../src/index.ts";
import { readFileSync } from "node:fs";

declare const CanvasKitInit: (o: { locateFile: () => string }) => Promise<any>;
const ROOT = process.cwd();
const W = 240, H = 240;
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

  /** Draws a control alone on a black canvas and returns its pixels. */
  const draw = (control: SkiaControl) => {
    const root = new SkiaLayer(); root.WidthRequest = W; root.HeightRequest = H; root.AddSubView(control);
    root._superview = new FakeCanvas() as unknown as Canvas;
    const surface = CK.MakeSurface(W, H);
    surface.getCanvas().clear(CK.BLACK);
    root.Measure(W, H, 1); root.Arrange(new SKRect(0, 0, W, H), W, H, 1);
    root.Render({ Context: { Canvas: surface.getCanvas(), Surface: surface }, Destination: new SKRect(0, 0, W, H), Scale: 1 });
    const px = surface.makeImageSnapshot().readPixels(0, 0, { width: W, height: H, colorType: CK.ColorType.RGBA_8888, alphaType: CK.AlphaType.Unpremul, colorSpace: CK.ColorSpace.SRGB }) as Uint8Array;
    surface.delete();
    let lit = 0; for (let i = 0; i < px.length; i += 4) if (px[i] + px[i + 1] + px[i + 2] > 30) lit++;
    return { px, lit };
  };
  const same = (a: Uint8Array, b: Uint8Array) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; };
  const tile = (h: number, color: string) => { const s = new SkiaShape(); s.BackgroundColor = color; s.WidthRequest = 40; s.HeightRequest = h; s.HorizontalOptions = "Fill"; return s; };

  const layouts: [string, () => SkiaLayout][] = [
    ["SkiaLayout", () => new SkiaLayout()], ["SkiaStack", () => new SkiaStack()], ["SkiaRow", () => new SkiaRow()],
    ["SkiaLayer", () => new SkiaLayer()], ["SkiaWrap", () => new SkiaWrap()], ["SkiaGrid", () => new SkiaGrid()],
    ["SkiaMasonry", () => new SkiaMasonry()], ["SkiaShape", () => new SkiaShape()],
  ];
  /** The layout with a background, Padding set to `padding`, and three tiles. */
  const build = (make: () => SkiaLayout, padding: unknown) => {
    const l = make(); l.BackgroundColor = "#333333"; l.Spacing = 4;
    (l as unknown as { Padding: unknown }).Padding = padding;
    for (const [h, c] of [[60, "#E63946"], [30, "#457B9D"], [45, "#2A9D8F"]] as const) l.AddSubView(tile(h, c));
    return l;
  };

  for (const [name, make] of layouts) {
    const want = draw(build(make, new Thickness(12)));
    const num = draw(build(make, 12)), str = draw(build(make, "12"));
    check(`${name} Padding={12} draws what Padding={new Thickness(12)} draws`, want.lit > 0 && same(num.px, want.px) && same(str.px, want.px),
      `${num.lit} lit pixels, Thickness ${want.lit}`);
  }

  {
    const a = draw(build(() => new SkiaMasonry(), "12,6")), b = draw(build(() => new SkiaMasonry(), new Thickness(12, 6)));
    const c = draw(build(() => new SkiaMasonry(), "1,2,3,4")), d = draw(build(() => new SkiaMasonry(), new Thickness(1, 2, 3, 4)));
    check("the C# string forms \"12,6\" and \"1,2,3,4\" read as Thickness(12, 6) and Thickness(1, 2, 3, 4)", same(a.px, b.px) && same(c.px, d.px));
  }

  {
    const child = (margin: unknown) => { const s = tile(50, "#E63946"); s.HorizontalOptions = "Start"; (s as unknown as { Margin: unknown }).Margin = margin; return s; };
    const host = (margin: unknown) => { const l = new SkiaStack(); l.BackgroundColor = "#333333"; l.AddSubView(child(margin)); return l; };
    const want = draw(host(new Thickness(16, 8))), num = draw(host(16)), wantNum = draw(host(new Thickness(16))), str = draw(host("16,8"));
    check("Margin={16} and Margin=\"16,8\" draw what the Thickness values draw", want.lit > 0 && same(num.px, wantNum.px) && same(str.px, want.px));
  }

  {
    const label = (padding: unknown) => { const l = new SkiaLabel(); l.Text = "Padding"; l.FontSize = 20; l.TextColor = "#FFFFFF"; l.BackgroundColor = "#333333"; (l as unknown as { Padding: unknown }).Padding = padding; return l; };
    const want = draw(label(new Thickness(10))), num = draw(label(10));
    check("SkiaLabel Padding={10} draws what Padding={new Thickness(10)} draws", want.lit > 0 && same(num.px, want.px));
  }

  {
    const warn = console.warn; let warned = 0;
    console.warn = () => { warned++; };
    const bad = draw(build(() => new SkiaMasonry(), { nope: true })), zero = draw(build(() => new SkiaMasonry(), Thickness.Zero));
    const nan = draw(build(() => new SkiaStack(), Number.NaN)), stackZero = draw(build(() => new SkiaStack(), Thickness.Zero));
    console.warn = warn;
    check("a value that is no thickness draws as Padding 0 (never blank) and warns", same(bad.px, zero.px) && same(nan.px, stackZero.px) && bad.lit > 0 && warned >= 2, `${warned} warnings`);
  }

  console.log(failures ? `FAIL: ${failures} checks` : "OK: thickness values");
  process.exit(failures ? 1 : 0);
})();
