// KeyboardWrap and Canvas.SetAccessibilityFocus on a real engine Canvas in Node (`npm run check:keyboard-wrap`), as
// DrawnUi.Net KeyboardWrapAndFocusTests (15f38307): on an arrow-key group with KeyboardWrap the arrows go round, without
// it they stop at the ends; app code moves the keyboard and screen-reader focus at the frame end, also to a control
// drawn only later, and gives it back with undefined.
import { readFileSync } from "node:fs";
import { Super, Canvas, SkiaStack, SkiaButton, Aria, SkiaAccessibilityManager, type InputKey } from "../src/index.ts";

declare const CanvasKitInit: (o: { locateFile: () => string }) => Promise<any>;
const ROOT = process.cwd();
const W = 300, H = 300;
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
  addEventListener: (t: string, f: (e: unknown) => void) => on(`el:${t}`, f), removeEventListener() {}, setPointerCapture() {},
  getBoundingClientRect: () => ({ left: 0, top: 0, width: W, height: H }),
} as unknown as HTMLCanvasElement;

(async () => {
  const CK = await CanvasKitInit({ locateFile: () => `${ROOT}/node_modules/canvaskit-wasm/bin/full/canvaskit.wasm` });
  (Super as unknown as { CK: unknown }).CK = CK;
  CK.MakeSWCanvasSurface = () => CK.MakeSurface(W, H);
  const face = Super.LoadFace(readFileSync(`${ROOT}/samples/public/fonts/OpenSans-Regular.ttf`))!;
  Super.Fonts.set("FontText", new Map([[400, face]])); Super.DefaultTypeface = face; Super.DefaultFontAlias = "FontText";

  const canvas = new Canvas(element, (c) => { c.RenderingMode = "Default"; });
  canvas.AccessibilityManager.MinUpdateIntervalMs = 0;
  const frame = () => (canvas as unknown as { DrawNow(): void }).DrawNow();
  // the keys of the node in keyboard focus, as the DOM overlay hands them to the engine
  const key = (k: InputKey) => { SkiaAccessibilityManager.Key(canvas.AccessibilityManager.FocusedNode, k); frame(); frame(); };
  const item = (i: number) => { const b = new SkiaButton(); b.Text = `Item ${i}`; b.AccessibilityRole = Aria.RoleMenuItem; b.AccessibilityLabel = `Item ${i}`; b.HeightRequest = 40; return b; };
  const items = [0, 1, 2].map(item);
  const menu = new SkiaStack(); menu.AccessibilityRole = Aria.RoleMenu;
  for (const b of items) menu.AddSubView(b);
  canvas.Content = menu;
  frame(); frame();
  const focused = () => canvas.AccessibilityManager.FocusedNode;
  const name = () => focused()?.AccessibilityLabel ?? "none";

  check("a control set by the app gets the keyboard and reader focus at the frame end", (canvas.SetAccessibilityFocus(items[2]), frame(), focused() === items[2]), name());
  check("undefined gives the focus back to the app", (canvas.SetAccessibilityFocus(undefined), frame(), focused() === undefined), name());

  canvas.SetAccessibilityFocus(items[0]); frame();
  check("the keyboard on the first item", focused() === items[0], name());
  key("ArrowUp");
  check("without KeyboardWrap Up stops at the first item", focused() === items[0], name());
  key("End");
  key("ArrowDown");
  check("without KeyboardWrap Down stops at the last item", focused() === items[2], name());

  menu.KeyboardWrap = true;
  key("ArrowDown");
  check("with KeyboardWrap Down goes from the last item to the first", focused() === items[0], name());
  key("ArrowUp");
  check("with KeyboardWrap Up goes from the first item to the last", focused() === items[2], name());
  key("Home");
  check("Home still goes to the first item", focused() === items[0], name());

  const late = item(3);
  canvas.SetAccessibilityFocus(late);
  frame(); frame();
  check("a control not drawn yet does not take the focus", focused() !== late, name());
  menu.AddSubView(late);
  frame(); frame();
  check("it gets the focus once it is drawn", focused() === late, name());

  console.log(failures ? `FAIL: ${failures} checks` : "OK: KeyboardWrap and SetAccessibilityFocus");
  process.exit(failures ? 1 : 0);
})();
