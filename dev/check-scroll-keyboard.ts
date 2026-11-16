// SkiaScroll and the on-screen keyboard (drawnui-cross 6cj, DECIDED: an opt-in scroll setting, off by default), checked in
// Node (`npm run check:scroll-keyboard`) on a real engine Canvas. Port of DrawnUi.Net ScrollKeyboardRoomTests (exp/keyboard-
// auto dd76ad496): with AdaptToKeyboardAuto the keyboard's cover is room at the content end, so the LAST field rises above
// the keyboard (gap 8) and stays there after a tap; the keyboard closing settles the page at the content end. Without the
// setting the scroll gets no room. A field already above the keyboard does not move.
import { Super, SKRect, Canvas, SkiaScroll, SkiaStack, SkiaShape, SkiaControl } from "../src/index.ts";

declare const CanvasKitInit: (o: { locateFile: () => string }) => Promise<any>;
const ROOT = process.cwd();
const W = 400, H = 800, KEYBOARD = 300;
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

  const form = async (auto: boolean) => {
    const scroll = new SkiaScroll(); scroll.AdaptToKeyboardAuto = auto; scroll.HorizontalOptions = "Fill"; scroll.VerticalOptions = "Fill";
    const stack = new SkiaStack(); stack.Spacing = 0;
    const spacer = new SkiaControl(); spacer.HeightRequest = 860; spacer.HorizontalOptions = "Fill";
    // the last field: content ends at 900, it is at 860..900, the end of the scroll range is -100
    const field = new SkiaShape(); field.HeightRequest = 40; field.HorizontalOptions = "Fill"; field.BackgroundColor = "#FFFFFF";
    stack.AddSubView(spacer); stack.AddSubView(field); scroll.Content = stack;
    canvas.Content = scroll;
    await settle();
    scroll.ScrollTo(0, -100, 0, true);
    await settle();
    return { scroll, field };
  };
  const bottom = (c: SkiaControl) => c.GetAccessibilityPixelRect().Bottom;

  {
    const { scroll, field } = await form(true);
    check("the last field is at the canvas bottom at the content end", Math.abs(bottom(field) - 800) <= 1, `${bottom(field)}`);
    scroll.AdaptToKeyboardFor = field; scroll.AdaptToKeyboardSize = KEYBOARD;
    await sleep(200); await settle();
    check("with AdaptToKeyboardAuto the last field rises above the keyboard, gap 8", Math.abs(bottom(field) - (800 - KEYBOARD - 8)) <= 2, `${bottom(field)}`);
    // a touch on the scroll (the next field's tap) must not bounce the page back past its end
    for (const t of ["pointerdown", "pointerup"]) fire(`el:${t}`, { type: t, pointerId: 9, pointerType: "touch", clientX: 200, clientY: 300, offsetX: 200, offsetY: 300, button: 0, buttons: t === "pointerdown" ? 1 : 0 });
    await settle();
    check("and stays there after a tap", Math.abs(bottom(field) - (800 - KEYBOARD - 8)) <= 2, `${bottom(field)}`);
    scroll.AdaptToKeyboardFor = undefined; scroll.AdaptToKeyboardSize = 0;
    await sleep(200); await settle(); await settle();
    check("the keyboard closing settles the page at the content end", Math.abs(scroll.ViewportOffsetY + 100) <= 1 && Math.abs(bottom(field) - 800) <= 1, `offset ${scroll.ViewportOffsetY}, bottom ${bottom(field)}`);
  }
  {
    const { scroll, field } = await form(false);
    scroll.AdaptToKeyboardFor = field; scroll.AdaptToKeyboardSize = KEYBOARD;
    await sleep(200); await settle();
    check("without AdaptToKeyboardAuto the scroll gets no room: the last field stays at the content end", Math.abs(scroll.ViewportOffsetY + 100) <= 1, `offset ${scroll.ViewportOffsetY}`);
  }
  {
    // a field near the top of a long page: already above the keyboard, nothing moves
    const scroll = new SkiaScroll(); scroll.AdaptToKeyboardAuto = true; scroll.HorizontalOptions = "Fill"; scroll.VerticalOptions = "Fill";
    const stack = new SkiaStack(); stack.Spacing = 0;
    const head = new SkiaControl(); head.HeightRequest = 100; head.HorizontalOptions = "Fill";
    const first = new SkiaShape(); first.HeightRequest = 40; first.HorizontalOptions = "Fill"; first.BackgroundColor = "#FFFFFF";
    const rest = new SkiaControl(); rest.HeightRequest = 1200; rest.HorizontalOptions = "Fill";
    stack.AddSubView(head); stack.AddSubView(first); stack.AddSubView(rest); scroll.Content = stack;
    canvas.Content = scroll; await settle();
    const before = bottom(first);
    scroll.AdaptToKeyboardFor = first; scroll.AdaptToKeyboardSize = KEYBOARD;
    await sleep(200); await settle();
    check("a field already above the keyboard does not move", Math.abs(before - 140) <= 1 && Math.abs(bottom(first) - before) <= 1, `${before} -> ${bottom(first)}`);
  }

  console.log(failures ? `FAIL: ${failures} checks` : "OK: a scroll set to follow the keyboard lifts its fields above it");
  process.exit(failures ? 1 : 0);
})();
