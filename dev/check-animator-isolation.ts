// Animators in one frame (drawnui-cross 6bg, DrawnUi.Net c5528d6f: a replaced FadeToAsync threw in its stop handler and
// the exception left the frame's animator pass, freezing the view), checked in Node (`npm run check:animator-isolation`)
// on a real engine Canvas: a control re-animated many times inside an animator tick (a game loop) throws nothing and keeps
// animating; an animator whose callback throws does not stop the other animators of that frame or the frames after it.
import { Super, Canvas, SkiaLayer, SkiaShape, SkiaValueAnimator, ActionOnTickAnimator } from "../src/index.ts";

declare const CanvasKitInit: (o: { locateFile: () => string }) => Promise<any>;
const ROOT = process.cwd();
const W = 200, H = 200;
let failures = 0;
const check = (name: string, ok: boolean, detail = "") => { if (!ok) failures++; console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const style = () => ({}) as Record<string, string>;
const g = globalThis as unknown as Record<string, unknown>;
g.window = Object.assign(g.window ?? {}, {
  devicePixelRatio: 1, addEventListener() {}, removeEventListener() {}, focus() {}, setTimeout, clearTimeout, setInterval, clearInterval,
  requestAnimationFrame: () => 1, cancelAnimationFrame() {}, self: g, top: g,
});
g.requestAnimationFrame = () => 1;
g.cancelAnimationFrame = () => {};
g.document = { documentElement: { style: style() }, body: { style: style(), appendChild() {} }, createElement: () => ({ style: style(), dataset: {}, setAttribute() {}, addEventListener() {}, removeEventListener() {}, setSelectionRange() {}, focus() {}, blur() {}, remove() {}, value: "" }), activeElement: null };
g.ResizeObserver = class { observe() {} disconnect() {} };
g.getComputedStyle = () => ({ overflowX: "visible", overflowY: "visible" });
const element = { clientWidth: W, clientHeight: H, width: 0, height: 0, style: style(), addEventListener() {}, removeEventListener() {}, setPointerCapture() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: W, height: H }) } as unknown as HTMLCanvasElement;

(async () => {
  const CK = await CanvasKitInit({ locateFile: () => `${ROOT}/node_modules/canvaskit-wasm/bin/full/canvaskit.wasm` });
  (Super as unknown as { CK: unknown }).CK = CK;
  CK.MakeSWCanvasSurface = () => CK.MakeSurface(W, H);
  const canvas = new Canvas(element, (c) => { c.RenderingMode = "Default"; });
  const frameErrors: unknown[] = [];
  const frame = () => { try { (canvas as unknown as { DrawNow(): void }).DrawNow(); } catch (e) { frameErrors.push(e); } };
  const frames = async (n: number) => { for (let i = 0; i < n; i++) { await sleep(16); frame(); } };
  const root = new SkiaLayer(); root.WidthRequest = W; root.HeightRequest = H;
  const label = new SkiaShape(); label.WidthRequest = 50; label.HeightRequest = 20; label.BackgroundColor = "#FFFFFF";
  const other = new SkiaShape(); other.WidthRequest = 50; other.HeightRequest = 20; other.BackgroundColor = "#FF0000";
  root.AddSubView(label); root.AddSubView(other);
  canvas.Content = root;
  frame();

  // 1. a game loop re-animates the same control many times within one tick (Bricks Breaker)
  const rejections: unknown[] = [];
  let ticks = 0;
  const loop = new ActionOnTickAnimator(root, () => {
    ticks++;
    for (let i = 0; i < 20; i++) label.FadeToAsync(i % 2 ? 0.2 : 1, 200).catch((e) => rejections.push(e));
  });
  loop.Start();
  await frames(10);
  loop.Stop();
  await frames(20);
  check("a control re-animated 20 times per tick: no exception leaves the frame", frameErrors.length === 0, `${frameErrors.length} errors`);
  check("the game loop kept ticking", ticks >= 8, `${ticks} ticks`);
  check("each replaced animation ends with an AbortError for its caller, nothing else", rejections.every((e) => (e as DOMException).name === "AbortError"), `${rejections.length} rejections`);
  check("the last one given finishes (opacity 0.2)", Math.abs(label.Opacity - 0.2) < 0.01, `${label.Opacity}`);

  // 2. one animator's callback throws: the others of the frame and the next frames go on
  let otherTicks = 0;
  const bad = new SkiaValueAnimator(label); bad.mMinValue = 0; bad.mMaxValue = 1; bad.Speed = 2000; bad.OnUpdated = () => { throw new Error("app bug"); };
  const good = new SkiaValueAnimator(other); good.mMinValue = 0; good.mMaxValue = 1; good.Speed = 2000; good.OnUpdated = () => { otherTicks++; };
  const logged: unknown[] = [];
  const error = console.error; console.error = (...a: unknown[]) => { logged.push(a); };
  bad.Start(); good.Start();
  frameErrors.length = 0;
  await frames(6);
  console.error = error;
  check("an animator that throws: the other animator still ticks every frame", otherTicks >= 5, `${otherTicks} ticks`);
  check("no exception leaves the frame; the error is reported on the console once", frameErrors.length === 0 && logged.length === 1, `${frameErrors.length} frame errors, ${logged.length} console errors`);
  bad.Stop(); good.Stop();

  canvas.Dispose();
  console.log(failures ? `FAIL: ${failures} checks` : "OK: one animator never stops the frame");
  process.exit(failures ? 1 : 0);
})();
