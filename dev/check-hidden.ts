// Hidden controls ask for no frames (C# 329f6c44 HiddenUpdateTests, DrawnUi.Rust hidden_updates.rs), checked in Node
// (`npm run check:hidden`): a live control under a hidden screen changes without waking the frame loop and shows its
// latest state when the screen is shown again (plain and Image-cached screen); its animation pauses, keeps no frames
// coming, and goes on from where it was when shown.
import { readFileSync } from "node:fs";
import { Super, SKRect, Canvas, SkiaAccessibilityManager, HoverManager, SkiaLayer, type AnimatorBase, type SkiaCacheType } from "../src/index.ts";

declare const CanvasKitInit: (o: { locateFile: () => string }) => Promise<any>;
const ROOT = process.cwd();
let failures = 0;
const check = (name: string, ok: boolean, detail = "") => { if (!ok) failures++; console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const CK = await CanvasKitInit({ locateFile: () => `${ROOT}/node_modules/canvaskit-wasm/bin/full/canvaskit.wasm` });
  (Super as unknown as { CK: unknown }).CK = CK;
  const face = CK.Typeface.MakeFreeTypeFaceFromData(readFileSync(`${ROOT}/samples/public/fonts/OpenSans-Regular.ttf`).buffer);
  Super.Fonts.set("FontText", new Map([[400, face]])); Super.DefaultTypeface = face; Super.DefaultFontAlias = "FontText";

  /** The engine Canvas without its DOM: frame requests counted, ExecuteAnimators as in Draw. */
  const host = (cache: SkiaCacheType) => {
    const canvas = Object.create(Canvas.prototype) as Canvas & Record<string, unknown>;
    let asked = 0;
    Object.assign(canvas, {
      AccessibilityManager: new SkiaAccessibilityManager(), Hover: new HoverManager(), AnimatingControls: new Map<number, AnimatorBase>(),
      RenderingScale: 1, GpuEpoch: 0, disposeQueue: [], Update: () => { asked++; },
    });
    const root = new SkiaLayer(); root.HorizontalOptions = "Fill"; root.VerticalOptions = "Fill";
    const screen = new SkiaLayer(); screen.HorizontalOptions = "Fill"; screen.VerticalOptions = "Fill"; screen.UseCache = cache;
    const live = new SkiaLayer(); live.WidthRequest = 20; live.HeightRequest = 20; live.BackgroundColor = "#FF0000";
    screen.AddSubView(live); root.AddSubView(screen);
    root._superview = canvas as unknown as Canvas;
    const surface = CK.MakeSurface(60, 60);
    const frame = (ms = performance.now()) => {
      const executed = (canvas as unknown as { ExecuteAnimators(t: number): number }).ExecuteAnimators(Math.round(ms * 1e6));
      const c = surface.getCanvas(); c.clear(CK.WHITE);
      root.Measure(60, 60, 1); root.Arrange(new SKRect(0, 0, 60, 60), -1, -1, 1);
      root.Render({ Context: { Canvas: c, Surface: surface }, Destination: new SKRect(0, 0, 60, 60), Scale: 1 });
      for (const o of (canvas.disposeQueue as { Dispose(): void }[]).splice(0)) o.Dispose();
      return executed;
    };
    const pixel = (x: number, y: number) => { const p = surface.getCanvas().readPixels(x, y, { width: 1, height: 1, colorType: CK.ColorType.RGBA_8888, alphaType: CK.AlphaType.Unpremul, colorSpace: CK.ColorSpace.SRGB }) as Uint8Array; return `${p[0]},${p[1]},${p[2]}`; };
    return { screen, live, frame, pixel, asked: () => asked, reset: () => { asked = 0; } };
  };

  for (const cache of ["None", "Image"] as SkiaCacheType[]) {
    const h = host(cache);
    h.frame();
    h.reset();
    for (let i = 0; i < 10; i++) { h.live.BackgroundColor = `#${(i * 20).toString(16).padStart(2, "0")}0000`; h.live.Update(); h.frame(); }
    check(`${cache}: visible changes ask for frames`, h.asked() === 10, `${h.asked()}`);
    h.screen.IsVisible = false; h.screen.Update(); h.frame();
    h.reset();
    for (let i = 0; i < 10; i++) { h.live.BackgroundColor = "#0000BE"; h.live.UpdateDraw(); h.live.Update(); }
    check(`${cache}: changes under a hidden screen ask for no frames`, h.asked() === 0, `${h.asked()}`);
    h.screen.IsVisible = true; h.screen.Update();
    check(`${cache}: shown again asks for a frame`, h.asked() > 0);
    h.frame();
    check(`${cache}: the latest change is drawn`, h.pixel(10, 10) === "0,0,190", h.pixel(10, 10));
  }

  // an animation under a hidden screen pauses and goes on when shown
  {
    const h = host("None");
    let value = 0;
    void h.live.AnimateAsync((v) => { value = v; }, undefined, 1000).catch(() => {});
    h.frame(); for (let i = 0; i < 5; i++) { await sleep(40); h.frame(); }
    const before = value;
    h.screen.IsVisible = false; h.screen.Update();
    await sleep(16);
    const ran = h.frame();
    check("hidden: the animation keeps no frames coming", ran === 0, `${ran} executed`);
    await sleep(400); h.frame();
    check("hidden: it did not run", Math.abs(value - before) < 0.02, `${before.toFixed(3)} -> ${value.toFixed(3)}`);
    h.screen.IsVisible = true; h.screen.Update();
    h.frame(); await sleep(40); h.frame();
    check("shown: it goes on from where it was", value > before && value < before + 0.15, `${before.toFixed(3)} -> ${value.toFixed(3)}`);
  }

  console.log(failures ? `FAIL: ${failures} checks` : "OK: hidden controls ask for no frames");
  process.exit(failures ? 1 : 0);
})();
