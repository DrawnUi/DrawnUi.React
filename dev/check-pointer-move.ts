// A mouse moving with nothing pressed reaches the control under it as a "Pointer" gesture (C# TouchActionResult.Pointer),
// checked in Node on a real engine Canvas (`npm run check:pointer-move`): a control that follows the pointer reads it in
// ProcessGestures (the 3D add-on's TiltToPointer), the one beside it does not get it, a touch move without a press sends
// none, and a mouse move never makes a gesture owner (the next press goes where it lands).
import { Super, SKRect, Canvas, SkiaLayer, SkiaShape, type SkiaGesturesInfo } from "../src/index.ts";

declare const CanvasKitInit: (o: { locateFile: () => string }) => Promise<any>;
const ROOT = process.cwd();
const W = 400, H = 300;
let failures = 0;
const check = (name: string, ok: boolean, detail = "") => { if (!ok) failures++; console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const listeners = new Map<string, ((e: unknown) => void)[]>();
const on = (t: string, f: (e: unknown) => void) => { if (!listeners.has(t)) listeners.set(t, []); listeners.get(t)!.push(f); };
const fire = (t: string, e: unknown) => { for (const f of [...(listeners.get(t) ?? [])]) f(e); };
const style = () => ({}) as Record<string, string>;
const g = globalThis as unknown as Record<string, unknown>;
g.window = Object.assign(g.window ?? {}, { devicePixelRatio: 1, addEventListener: on, removeEventListener() {}, focus() {}, setTimeout, clearTimeout, setInterval, clearInterval, requestAnimationFrame: () => 1, cancelAnimationFrame() {}, self: g, top: g, innerHeight: H, innerWidth: W });
g.requestAnimationFrame = () => 1;
g.cancelAnimationFrame = () => {};
g.document = { documentElement: { style: style() }, body: { style: style(), appendChild() {} }, createElement: () => ({ style: style(), dataset: {}, setAttribute() {}, addEventListener() {}, removeEventListener() {}, focus() {}, blur() {}, remove() {}, value: "" }), activeElement: null, addEventListener() {}, removeEventListener() {} };
g.ResizeObserver = class { observe() {} disconnect() {} };
g.getComputedStyle = () => ({ overflowX: "visible", overflowY: "visible" });
g.PointerEvent = class { constructor(public type: string, o: object) { Object.assign(this, o); } };
g.MouseEvent = g.PointerEvent;
const element = {
  clientWidth: W, clientHeight: H, width: 0, height: 0, style: style(),
  addEventListener: (t: string, f: (e: unknown) => void) => on(`el:${t}`, f), removeEventListener() {}, setPointerCapture() {},
  getBoundingClientRect: () => ({ left: 0, top: 0, width: W, height: H, right: W, bottom: H }),
} as unknown as HTMLCanvasElement;

(async () => {
  const CK = await CanvasKitInit({ locateFile: () => `${ROOT}/node_modules/canvaskit-wasm/bin/full/canvaskit.wasm` });
  (Super as unknown as { CK: unknown }).CK = CK;
  CK.MakeSWCanvasSurface = () => CK.MakeSurface(W, H);
  const canvas = new Canvas(element, (c) => { c.RenderingMode = "Default"; c.Gestures = "Lock"; });
  const frame = () => (canvas as unknown as { DrawNow(): void }).DrawNow();
  const settle = async () => { for (let i = 0; i < 30; i++) { await sleep(15); frame(); } };

  const left: string[] = [], right: string[] = [];
  const shape = (x: number, log: string[]) => {
    const s = new SkiaShape(); s.WidthRequest = 150; s.HeightRequest = 150; s.TranslationX = 0; s.Margin = `${x},50,0,0`;
    s.ConsumeGestures = (_, info: SkiaGesturesInfo) => { log.push(info.Args.Type); if (info.Args.Type === "Pointer") (log as unknown as { at?: number[] }).at = [Math.round(info.Args.Event.Location.X), Math.round(info.Args.Event.Location.Y)]; };
    return s;
  };
  const root = new SkiaLayer(); root.HorizontalOptions = "Fill"; root.VerticalOptions = "Fill";
  root.AddSubView(shape(20, left)); root.AddSubView(shape(220, right));
  canvas.Content = root;
  await settle();
  const move = (x: number, y: number, pointerType = "mouse", buttons = 0) => fire("el:pointermove", { type: "pointermove", pointerId: 1, pointerType, clientX: x, clientY: y, offsetX: x, offsetY: y, button: -1, buttons });
  move(90, 120);
  await settle();
  check("a mouse move with nothing pressed reaches the control under it as Pointer", left.includes("Pointer"), left.join(","));
  check("the control beside it gets nothing", right.length === 0, right.join(","));
  left.length = 0;
  move(100, 130, "touch");
  await settle();
  check("a touch move without a press sends no Pointer", !left.includes("Pointer"), left.join(","));
  // a press on the right control after hovering the left one goes to the right one
  move(90, 120); await settle(); right.length = 0;
  for (const t of ["pointerdown", "pointerup"]) fire(`el:${t}`, { type: t, pointerId: 2, pointerType: "mouse", clientX: 290, clientY: 120, offsetX: 290, offsetY: 120, button: 0, buttons: t === "pointerdown" ? 1 : 0 });
  await settle();
  check("a mouse move makes no gesture owner: the next press goes where it lands", right.includes("Down") && right.includes("Up"), right.join(","));

  console.log(failures ? `FAIL: ${failures} checks` : "OK: a mouse moving with nothing pressed reaches the controls as Pointer");
  process.exit(failures ? 1 : 0);
})();
