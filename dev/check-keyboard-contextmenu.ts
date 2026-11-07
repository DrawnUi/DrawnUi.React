// The Menu key / Shift+F10 on the control in keyboard focus (drawnui-cross, every engine), checked in Node
// (`npm run check:keyboard-contextmenu`) on a real engine Canvas: the context menu opens at the focused control's center
// with Source "keyboard", from it or the first control above it with a ContextMenu handler, then the Canvas' own; true
// when one took it (the overlay then prevents the browser menu).
import { Super, SKRect, Canvas, SkiaLayer, SkiaShape, Thickness, type ContextMenuEventArgs } from "../src/index.ts";

declare const CanvasKitInit: (o: { locateFile: () => string }) => Promise<any>;
const ROOT = process.cwd();
const W = 400, H = 300;
let failures = 0;
const check = (name: string, ok: boolean, detail = "") => { if (!ok) failures++; console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`); };

const listeners = new Map<string, ((e: unknown) => void)[]>();
const on = (t: string, f: (e: unknown) => void) => { if (!listeners.has(t)) listeners.set(t, []); listeners.get(t)!.push(f); };
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
  addEventListener: (t: string, f: (e: unknown) => void) => on(`el:${t}`, f), removeEventListener() {}, setPointerCapture() {},
  getBoundingClientRect: () => ({ left: 0, top: 0, width: W, height: H }),
} as unknown as HTMLCanvasElement;

(async () => {
  const CK = await CanvasKitInit({ locateFile: () => `${ROOT}/node_modules/canvaskit-wasm/bin/full/canvaskit.wasm` });
  (Super as unknown as { CK: unknown }).CK = CK;
  CK.MakeSWCanvasSurface = () => CK.MakeSurface(W, H);

  const canvas = new Canvas(element, (c) => { c.RenderingMode = "Default"; });
  const frame = () => (canvas as unknown as { DrawNow(): void }).DrawNow();
  const root = new SkiaLayer(); root.WidthRequest = W; root.HeightRequest = H;
  // a card with a context menu, holding a button-like shape without one
  const card = new SkiaLayer(); card.WidthRequest = 200; card.HeightRequest = 120; card.Margin = new Thickness(20, 20, 0, 0);
  const inner = new SkiaShape(); inner.WidthRequest = 80; inner.HeightRequest = 40; inner.Margin = new Thickness(100, 60, 0, 0); inner.Tapped = () => {};
  card.AddSubView(inner);
  const lone = new SkiaShape(); lone.WidthRequest = 50; lone.HeightRequest = 50; lone.Margin = new Thickness(300, 200, 0, 0); lone.Tapped = () => {};
  root.AddSubView(card); root.AddSubView(lone);
  canvas.Content = root;
  frame(); frame();
  let got: { by: string; e: ContextMenuEventArgs } | undefined;
  card.ContextMenu = (_, e) => { got = { by: "card", e }; return true; };
  const native = { preventDefault() {} } as unknown as MouseEvent;

  const took = canvas.OpenContextMenuFromKeyboard(inner, native);
  check("Shift+F10 on a control without a menu: its parent card's menu opens", took && got?.by === "card" && got.e.Source === "keyboard", `${got?.by} ${got?.e.Source}`);
  check("at the focused control's center (160, 100), Control = the card", got?.e.Location.X === 160 && got?.e.Location.Y === 100 && got?.e.Control === card, `${got?.e.Location.X},${got?.e.Location.Y}`);
  got = undefined;
  inner.ContextMenu = (_, e) => { got = { by: "inner", e }; return true; };
  canvas.OpenContextMenuFromKeyboard(inner, native);
  check("a control with its own menu opens it first", got?.by === "inner");
  inner.ContextMenu = () => false;
  got = undefined;
  canvas.OpenContextMenuFromKeyboard(inner, native);
  check("a handler that does not take it goes on to the parent", got?.by === "card");
  got = undefined;
  let canvasGot: ContextMenuEventArgs | undefined;
  canvas.ContextMenu = (_, e) => { canvasGot = e; return true; };
  const lonely = canvas.OpenContextMenuFromKeyboard(lone, native);
  check("no control above has one: the Canvas' ContextMenu, with Source keyboard", lonely && canvasGot?.Source === "keyboard" && got === undefined);
  canvas.ContextMenu = undefined;
  check("nobody takes it: false, the browser keeps its menu", canvas.OpenContextMenuFromKeyboard(lone, native) === false);
  // DrawnUi.Rust preview.36 / .NET HandleDesktopContextMenu: only a handler returning true counts as taken
  let asked = 0;
  card.ContextMenu = () => { asked++; };
  inner.ContextMenu = undefined;
  canvas.ContextMenu = () => { asked++; return false; };
  check("handlers that return nothing or false: asked, not taken (false), the key goes on", canvas.OpenContextMenuFromKeyboard(inner, native) === false && asked === 2, `${asked} asked`);

  console.log(failures ? `FAIL: ${failures} checks` : "OK: context menu from the keyboard");
  process.exit(failures ? 1 : 0);
})();
