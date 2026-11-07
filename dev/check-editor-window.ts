// A focused SkiaEditor while the browser window is inactive (C# DrawnUi 232b37be: DrawnView.IsWindowActive,
// WindowActiveChanged), checked in Node (`npm run check:editor-window`) on a real engine Canvas with the window's
// blur / focus events: the editor keeps its focus, its caret hides and stops blinking (no redraws asked) while the window
// is inactive, and shows again in the same field when the window gets the keyboard back.
import { readFileSync } from "node:fs";
import { Super, Canvas, SkiaLayer, SkiaEditor } from "../src/index.ts";

declare const CanvasKitInit: (o: { locateFile: () => string }) => Promise<any>;
const ROOT = process.cwd();
const W = 400, H = 200;
let failures = 0;
const check = (name: string, ok: boolean, detail = "") => { if (!ok) failures++; console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const listeners = new Map<string, ((e: unknown) => void)[]>();
const on = (t: string, f: (e: unknown) => void) => { if (!listeners.has(t)) listeners.set(t, []); listeners.get(t)!.push(f); };
const fire = (t: string, e: unknown = {}) => { for (const f of listeners.get(t) ?? []) f(e); };
const style = () => ({}) as Record<string, string>;
const g = globalThis as unknown as Record<string, unknown>;
g.window = Object.assign(g.window ?? {}, {
  devicePixelRatio: 1, addEventListener: on, removeEventListener() {}, focus() {}, setTimeout, clearTimeout, setInterval, clearInterval,
  requestAnimationFrame: () => 1, cancelAnimationFrame() {}, self: g, top: g,
});
g.requestAnimationFrame = () => 1;
g.cancelAnimationFrame = () => {};
g.document = { documentElement: { style: style() }, body: { style: style(), appendChild() {}, removeChild() {} }, createElement: () => ({ style: style(), dataset: {}, setAttribute() {}, addEventListener() {}, removeEventListener() {}, setSelectionRange() {}, focus() {}, blur() {}, remove() {}, value: "" }), activeElement: null, hasFocus: () => true, addEventListener() {}, removeEventListener() {} };
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
  const frame = () => (canvas as unknown as { DrawNow(): void }).DrawNow();
  const root = new SkiaLayer(); root.WidthRequest = W; root.HeightRequest = H;
  const editor = new SkiaEditor(); editor.WidthRequest = 300; editor.HeightRequest = 40; editor.Text = "Hello";
  root.AddSubView(editor);
  canvas.Content = root;
  frame(); frame();
  editor.IsFocused = true; frame();
  const state = () => editor as unknown as { caretVisible: boolean; blinkTimer: number };
  check("focused, window active: the caret shows and blinks", canvas.IsWindowActive && state().caretVisible && state().blinkTimer !== 0);

  fire("blur");
  let redraws = 0;
  const repaint = editor.RepaintComposition.bind(editor);
  editor.RepaintComposition = () => { redraws++; repaint(); };
  await sleep(1300); // more than two blink periods
  check("window inactive: the editor keeps its focus", editor.IsFocused && SkiaEditor.Focused === editor && !canvas.IsWindowActive);
  check("its caret hides and stops blinking", !state().caretVisible && state().blinkTimer === 0, `visible ${state().caretVisible}, timer ${state().blinkTimer}`);
  check("no redraws while the window is inactive", redraws === 0, `${redraws} redraws`);

  fire("focus");
  check("the window gets the keyboard back: the caret shows again in the same field", canvas.IsWindowActive && editor.IsFocused && state().caretVisible && state().blinkTimer !== 0);
  editor.IsFocused = false;
  fire("blur"); fire("focus");
  check("unfocused, the window events leave the editor alone", !editor.IsFocused && state().blinkTimer === 0);

  canvas.Dispose();
  console.log(failures ? `FAIL: ${failures} checks` : "OK: the caret rests while the window is inactive");
  process.exit(failures ? 1 : 0);
})();
