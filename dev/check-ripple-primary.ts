// Tap and press animations play for a finger, a pen or the LEFT mouse button only (C# SkiaControl.IsPrimaryPointer),
// checked in Node (`npm run check:ripple-primary`) on a real engine Canvas through its pointer handlers: a right click
// on a SkiaButton, on a control with AnimationTapped Ripple and on a tappable span raises the same events as before
// and starts no ripple; a left click starts one.
import { readFileSync } from "node:fs";
import { Super, Canvas, SkiaLayer, SkiaButton, SkiaShape, SkiaLabel, TextSpan, Thickness, type SkiaControl } from "../src/index.ts";

declare const CanvasKitInit: (o: { locateFile: () => string }) => Promise<any>;
const ROOT = process.cwd();
const W = 400, H = 300;
let failures = 0;
const check = (name: string, ok: boolean, detail = "") => { if (!ok) failures++; console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`); };

// ---- the DOM the Canvas touches, stubbed ----
const listeners = new Map<string, ((e: unknown) => void)[]>();
const on = (t: string, f: (e: unknown) => void) => { if (!listeners.has(t)) listeners.set(t, []); listeners.get(t)!.push(f); };
const fire = (t: string, e: unknown) => { for (const f of listeners.get(t) ?? []) f(e); };
const style = () => ({}) as Record<string, string>;
const g = globalThis as unknown as Record<string, unknown>;
g.window = Object.assign(g.window ?? {}, {
  devicePixelRatio: 1, addEventListener: on, removeEventListener() {}, focus() {}, setTimeout, clearTimeout, setInterval, clearInterval,
  requestAnimationFrame: () => 1, cancelAnimationFrame() {}, self: g, top: g,
});
g.requestAnimationFrame = () => 1;
g.cancelAnimationFrame = () => {};
g.document = { documentElement: { style: style() }, body: { style: style(), appendChild() {} }, createElement: () => ({ style: style(), dataset: {}, setAttribute() {}, addEventListener() {}, removeEventListener() {}, setSelectionRange() {}, focus() {}, blur() {}, remove() {}, value: "" }), activeElement: null };
g.ResizeObserver = class { observe() {} disconnect() {} };
g.getComputedStyle = () => ({ overflowX: "visible", overflowY: "visible" });
const element = {
  clientWidth: W, clientHeight: H, width: 0, height: 0, style: style(),
  addEventListener: (t: string, f: (e: unknown) => void) => on(`el:${t}`, f), removeEventListener() {}, setPointerCapture() {}, releasePointerCapture() {},
  getBoundingClientRect: () => ({ left: 0, top: 0, width: W, height: H }),
} as unknown as HTMLCanvasElement;

(async () => {
  const CK = await CanvasKitInit({ locateFile: () => `${ROOT}/node_modules/canvaskit-wasm/bin/full/canvaskit.wasm` });
  (Super as unknown as { CK: unknown }).CK = CK;
  CK.MakeSWCanvasSurface = () => CK.MakeSurface(W, H);
  const face = Super.LoadFace(readFileSync(`${ROOT}/samples/public/fonts/OpenSans-Regular.ttf`))!;
  Super.Fonts.set("FontText", new Map([[400, face]])); Super.DefaultTypeface = face; Super.DefaultFontAlias = "FontText";

  const canvas = new Canvas(element, (c) => { c.RenderingMode = "Default"; });
  canvas.Gestures = "Lock";
  const frame = () => (canvas as unknown as { DrawNow(): void }).DrawNow();
  // a mouse click with `button` (0 left, 2 right), pressed and released at the same place
  const click = (x: number, y: number, button: number) => {
    const ev = (type: string) => ({ type, pointerId: 1, pointerType: "mouse", offsetX: x, offsetY: y, clientX: x, clientY: y, button, buttons: type === "pointerup" ? 0 : 1 << (button === 2 ? 1 : 0), preventDefault() {} });
    fire("el:pointerdown", ev("pointerdown")); frame();
    fire("el:pointerup", ev("pointerup")); frame();
  };

  const root = new SkiaLayer(); root.WidthRequest = W; root.HeightRequest = H;
  let buttonTaps = 0, shapeTaps = 0, spanTaps = 0;
  const button = new SkiaButton(); button.Text = "Button"; button.Margin = new Thickness(20, 20, 0, 0); button.Tapped = () => { buttonTaps++; };
  const shape = new SkiaShape(); shape.WidthRequest = 120; shape.HeightRequest = 60; shape.BackgroundColor = "#405060"; shape.Margin = new Thickness(200, 20, 0, 0);
  shape.AnimationTapped = "Ripple"; shape.Tapped = () => { shapeTaps++; };
  const label = new SkiaLabel(); label.Margin = new Thickness(20, 150, 0, 0); label.FontSize = 30;
  const span = new TextSpan(); span.Text = "Tap this span"; span.Tapped = () => { spanTaps++; };
  label.AddSubView(span);
  for (const c of [button, shape, label]) root.AddSubView(c);
  canvas.Content = root;
  frame(); frame();
  const ripples = (c: SkiaControl) => c.PostAnimators.length;
  const centerOf = (c: SkiaControl) => ({ x: (c.DrawingRect.Left + c.DrawingRect.Right) / 2, y: (c.DrawingRect.Top + c.DrawingRect.Bottom) / 2 });

  const b = centerOf(button), s = centerOf(shape), l = { x: label.DrawingRect.Left + 30, y: (label.DrawingRect.Top + label.DrawingRect.Bottom) / 2 };
  click(b.x, b.y, 2); click(s.x, s.y, 2); click(l.x, l.y, 2);
  check("right click on a SkiaButton: no press ripple", ripples(button) === 0, `${ripples(button)} ripples, ${buttonTaps} taps`);
  check("right click on AnimationTapped Ripple: no ripple", ripples(shape) === 0, `${ripples(shape)} ripples, ${shapeTaps} taps`);
  check("right click on a tappable span: no ripple", ripples(label) === 0, `${ripples(label)} ripples, ${spanTaps} taps`);
  const rightTaps = [buttonTaps, shapeTaps, spanTaps].join();
  click(b.x, b.y, 0); click(s.x, s.y, 0); click(l.x, l.y, 0);
  check("left click: the ripples play", ripples(button) > 0 && ripples(shape) > 0 && ripples(label) > 0, `${ripples(button)} / ${ripples(shape)} / ${ripples(label)}`);
  check("Tapped is raised for both buttons as before", [buttonTaps, shapeTaps, spanTaps].join() === rightTaps.split(",").map((n) => Number(n) + 1).join(), `after right ${rightTaps}, after left ${[buttonTaps, shapeTaps, spanTaps].join()}`);

  console.log(failures ? `FAIL: ${failures} checks` : "OK: tap animations for the primary pointer only");
  process.exit(failures ? 1 : 0);
})();
