// A replaced FadeToAsync / ScaleToAsync / TranslateToAsync / RotateToAsync is quiet when nothing waits on it (as a
// cancelled, unobserved Task in .NET), checked in Node (`npm run check:quiet-animations`) on a real engine Canvas: code
// that awaits the replaced animation still gets its AbortError; a fire-and-forget call raises no unhandled rejection.
import { Super, Canvas, SkiaLayer, SkiaShape } from "../src/index.ts";

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
  const unhandled: unknown[] = [];
  process.on("unhandledRejection", (e) => { unhandled.push(e); });
  const CK = await CanvasKitInit({ locateFile: () => `${ROOT}/node_modules/canvaskit-wasm/bin/full/canvaskit.wasm` });
  (Super as unknown as { CK: unknown }).CK = CK;
  CK.MakeSWCanvasSurface = () => CK.MakeSurface(W, H);
  const canvas = new Canvas(element, (c) => { c.RenderingMode = "Default"; });
  const frames = async (n: number) => { for (let i = 0; i < n; i++) { await sleep(16); (canvas as unknown as { DrawNow(): void }).DrawNow(); } };
  const root = new SkiaLayer(); root.WidthRequest = W; root.HeightRequest = H;
  const shape = new SkiaShape(); shape.WidthRequest = 50; shape.HeightRequest = 50; shape.BackgroundColor = "#FFFFFF";
  root.AddSubView(shape);
  canvas.Content = root;
  await frames(1);

  // fire and forget, each replaced by the next one
  void shape.FadeToAsync(0.2, 200); void shape.ScaleToAsync(2, 2, 200); void shape.TranslateToAsync(10, 10, 200); void shape.RotateToAsync(45, 200);
  await frames(2);
  void shape.FadeToAsync(1, 100); void shape.ScaleToAsync(1, 1, 100); void shape.TranslateToAsync(0, 0, 100); void shape.RotateToAsync(0, 100);
  await frames(12); await sleep(50);
  check("fire-and-forget calls replaced by new ones: no unhandled rejection", unhandled.length === 0, `${unhandled.length} unhandled`);
  check("the replacing animations finish", Math.abs(shape.Opacity - 1) < 0.01 && Math.abs(shape.ScaleX - 1) < 0.01 && Math.abs(shape.Rotation) < 0.01, `${shape.Opacity} ${shape.ScaleX} ${shape.Rotation}`);

  // awaited, then replaced: the caller still gets the AbortError
  const waited = shape.FadeToAsync(0.5, 300);
  await frames(1);
  void shape.FadeToAsync(1, 50);
  let reason: unknown;
  try { await waited; } catch (e) { reason = e; }
  check("an awaited animation that gets replaced still rejects with AbortError", (reason as DOMException)?.name === "AbortError", `${(reason as Error)?.name}`);
  await frames(6); await sleep(50);
  check("and still nothing unhandled", unhandled.length === 0, `${unhandled.length} unhandled`);

  canvas.Dispose();
  console.log(failures ? `FAIL: ${failures} checks` : "OK: replaced animations are quiet unless awaited");
  process.exit(failures ? 1 : 0);
})();
