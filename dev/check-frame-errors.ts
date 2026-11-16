// One exception never stops the frame loop (drawnui-cross 6ch, DrawnUi.Net 3db4eba3), checked in Node
// (`npm run check:frame-errors`) on a real engine Canvas whose requestAnimationFrame is driven by hand: a game loop runs;
// a WasDrawn listener throws on the 3rd frame, a Tapped handler throws, WillFirstTimeDraw throws. Each error is logged once,
// the other listeners of that frame still run, the frame is still shown (flushed), and the next frames keep coming.
import { Super, Canvas, DrawnGame, SkiaShape, SkiaLayer, Thickness } from "../src/index.ts";

declare const CanvasKitInit: (o: { locateFile: () => string }) => Promise<any>;
const ROOT = process.cwd();
const W = 300, H = 200;
let failures = 0;
const check = (name: string, ok: boolean, detail = "") => { if (!ok) failures++; console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`); };

const listeners = new Map<string, ((e: unknown) => void)[]>();
const on = (t: string, f: (e: unknown) => void) => { if (!listeners.has(t)) listeners.set(t, []); listeners.get(t)!.push(f); };
const fire = (t: string, e: unknown) => { for (const f of [...(listeners.get(t) ?? [])]) f(e); };
let raf: (() => void)[] = [];
const style = () => ({}) as Record<string, string>;
const g = globalThis as unknown as Record<string, unknown>;
const requestAnimationFrame = (f: () => void) => { raf.push(f); return raf.length; };
g.window = Object.assign(g.window ?? {}, {
  devicePixelRatio: 1, addEventListener: on, removeEventListener() {}, focus() {}, setTimeout, clearTimeout, setInterval, clearInterval,
  requestAnimationFrame, cancelAnimationFrame() {}, self: g, top: g,
});
g.requestAnimationFrame = requestAnimationFrame;
g.cancelAnimationFrame = () => {};
g.document = { documentElement: { style: style() }, body: { style: style(), appendChild() {} }, createElement: () => ({ style: style(), dataset: {}, setAttribute() {}, addEventListener() {}, removeEventListener() {}, focus() {}, blur() {}, remove() {}, value: "" }), activeElement: null, addEventListener() {}, removeEventListener() {}, timeline: undefined };
g.ResizeObserver = class { observe() {} disconnect() {} };
g.getComputedStyle = () => ({ overflowX: "visible", overflowY: "visible" });
const element = {
  clientWidth: W, clientHeight: H, width: 0, height: 0, style: style(),
  addEventListener: (t: string, f: (e: unknown) => void) => on(`el:${t}`, f), removeEventListener() {}, setPointerCapture() {},
  getBoundingClientRect: () => ({ left: 0, top: 0, width: W, height: H }),
} as unknown as HTMLCanvasElement;

(async () => {
  const CK = await CanvasKitInit({ locateFile: () => `${ROOT}/node_modules/canvaskit-wasm/bin/full/canvaskit.wasm` });
  (Super as unknown as { CK: unknown }).CK = CK;
  let flushes = 0;
  CK.MakeSWCanvasSurface = () => { const s = CK.MakeSurface(W, H); const flush = s.flush.bind(s); s.flush = () => { flushes++; flush(); }; return s; };
  const errors: unknown[][] = [];
  console.error = (...a: unknown[]) => { errors.push(a); };

  let firstDraw = 0;
  const canvas = new Canvas(element, (c) => { c.RenderingMode = "Default"; c.Gestures = "Lock"; c.WillFirstTimeDraw = () => { firstDraw++; throw new Error("first draw"); }; });
  /** Runs the frames the canvas asked for (one requestAnimationFrame each), as the browser does. */
  const frames = (n: number) => { for (let i = 0; i < n && raf.length; i++) { const f = raf.shift()!; f(); } };

  let ticks = 0;
  class Game extends DrawnGame { override GameLoop(): void { ticks++; } }
  const game = new Game(); game.HorizontalOptions = "Fill"; game.VerticalOptions = "Fill";
  const button = new SkiaShape(); button.WidthRequest = 80; button.HeightRequest = 40; button.Margin = new Thickness(10);
  let tapped = 0;
  button.Tapped = () => { tapped++; throw new Error("tap handler"); };
  const root = new SkiaLayer(); root.HorizontalOptions = "Fill"; root.VerticalOptions = "Fill"; root.AddSubView(game); root.AddSubView(button);
  canvas.Content = root;
  let frame = 0, after = 0;
  canvas.WasDrawnListeners.add(() => { if (++frame === 3) throw new Error("listener"); });
  canvas.WasDrawnListeners.add(() => { after++; });
  canvas.Update();
  frames(2);
  game.StartLoop();
  frames(10);
  check("WillFirstTimeDraw threw: logged, the first frame was still shown", firstDraw === 1 && errors.some((e) => String(e[1] ?? e[0]).includes("first draw")) && flushes >= 1, `${flushes} flushes`);
  check("a WasDrawn listener threw on its 3rd frame: the next listener ran every frame, the game loop kept ticking", after >= 10 && ticks >= 8 && raf.length > 0, `listener after it ${after}, game ticks ${ticks}, next frame asked ${raf.length > 0}`);
  check("every frame was shown, also the one that threw", flushes >= 12, `${flushes} flushes`);

  // a Tapped handler that throws: the gesture after it still goes through, the loop goes on
  const tap = (id: number) => { for (const t of ["pointerdown", "pointerup"]) fire(`el:${t}`, { type: t, pointerId: id, pointerType: "mouse", clientX: 30, clientY: 25, offsetX: 30, offsetY: 25, button: 0, buttons: t === "pointerdown" ? 1 : 0, isTrusted: true }); };
  const before = ticks;
  tap(11); tap(12);
  frames(5);
  check("a Tapped handler threw: the next tap still reached it, the frames go on", tapped === 2 && ticks > before && raf.length > 0, `tapped ${tapped}, ticks ${ticks - before}`);
  const logged = errors.map((e) => String(e[1] ?? e[0]));
  check("each error logged once", logged.filter((x) => x.includes("listener")).length === 1 && logged.filter((x) => x.includes("tap handler")).length === 1, logged.join(" | ").slice(0, 200));

  // a control whose drawing throws once: the frame is still shown, the canvas state is reset, the game goes on
  let thrown = 0;
  class Faulty extends SkiaShape { protected override Paint(ctx: Parameters<SkiaShape["Paint"]>[0]): void { if (thrown++ === 0) { (ctx.Context.Canvas as unknown as { save(): void }).save(); throw new Error("paint"); } super.Paint(ctx); } }
  const faulty = new Faulty(); faulty.WidthRequest = 20; faulty.HeightRequest = 20; faulty.UseCache = "None"; faulty.BackgroundColor = "#FF0000";
  root.AddSubView(faulty);
  const ticksBefore = ticks, flushBefore = flushes;
  frames(5);
  check("a control's drawing threw: logged, that frame shown, the next frames come", thrown >= 2 && ticks - ticksBefore >= 4 && flushes - flushBefore >= 5 && errors.some((e) => String(e[1] ?? e[0]).includes("paint")), `painted ${thrown}x, ticks ${ticks - ticksBefore}, flushes ${flushes - flushBefore}`);

  console.log(failures ? `FAIL: ${failures} checks` : "OK: one exception never stops the frame loop");
  process.exit(failures ? 1 : 0);
})();
