// The system light / dark appearance (drawnui-cross 6bb2, DrawnUi.Rust preview.34), checked in Node
// (`npm run check:system-theme`) on a real engine Canvas with a `prefers-color-scheme` media query: SystemThemeChanged
// is raised once when the canvas learns the theme (a handler set in its init), then once per change; a repeated value
// is not raised; no handler, no call; a theme change asks for no frame.
import { Super, Canvas, type SystemTheme } from "../src/index.ts";

declare const CanvasKitInit: (o: { locateFile: () => string }) => Promise<any>;
const ROOT = process.cwd();
const W = 200, H = 100;
let failures = 0;
const check = (name: string, ok: boolean, detail = "") => { if (!ok) failures++; console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`); };

// a media query the check can switch, firing `change` as a browser does
const query = { matches: true, listeners: new Set<() => void>(), addEventListener(_: string, f: () => void) { this.listeners.add(f); }, removeEventListener(_: string, f: () => void) { this.listeners.delete(f); } };
const setDark = (dark: boolean) => { query.matches = dark; for (const f of [...query.listeners]) f(); };
const style = () => ({}) as Record<string, string>;
const g = globalThis as unknown as Record<string, unknown>;
g.window = Object.assign(g.window ?? {}, {
  devicePixelRatio: 1, addEventListener() {}, removeEventListener() {}, focus() {}, setTimeout, clearTimeout, setInterval, clearInterval,
  requestAnimationFrame: () => 1, cancelAnimationFrame() {}, self: g, top: g,
  matchMedia: (q: string) => { if (q !== "(prefers-color-scheme: dark)") throw new Error(q); return query; },
});
g.requestAnimationFrame = () => 1;
g.cancelAnimationFrame = () => {};
g.document = { documentElement: { style: style() }, body: { style: style(), appendChild() {} }, createElement: () => ({ style: style(), dataset: {}, setAttribute() {}, addEventListener() {}, removeEventListener() {}, setSelectionRange() {}, focus() {}, blur() {}, remove() {}, value: "" }), activeElement: null };
g.ResizeObserver = class { observe() {} disconnect() {} };
g.getComputedStyle = () => ({ overflowX: "visible", overflowY: "visible" });
const element = {
  clientWidth: W, clientHeight: H, width: 0, height: 0, style: style(), addEventListener() {}, removeEventListener() {}, setPointerCapture() {},
  getBoundingClientRect: () => ({ left: 0, top: 0, width: W, height: H }),
} as unknown as HTMLCanvasElement;

(async () => {
  const CK = await CanvasKitInit({ locateFile: () => `${ROOT}/node_modules/canvaskit-wasm/bin/full/canvaskit.wasm` });
  (Super as unknown as { CK: unknown }).CK = CK;
  CK.MakeSWCanvasSurface = () => CK.MakeSurface(W, H);

  const seen: SystemTheme[] = [];
  const canvas = new Canvas(element, (c) => { c.RenderingMode = "Default"; c.SystemThemeChanged = (t) => seen.push(t); });
  check("learned at creation: raised once with Dark", seen.join() === "Dark" && canvas.SystemTheme === "Dark", seen.join());
  let frames = 0;
  const update = canvas.Update.bind(canvas);
  canvas.Update = () => { frames++; update(); };
  setDark(true);
  check("the same value again: not raised", seen.join() === "Dark", seen.join());
  setDark(false);
  check("a change to light: raised once with Light", seen.join() === "Dark,Light" && canvas.SystemTheme === "Light", seen.join());
  check("a theme change asks for no frame", frames === 0, `${frames} frames`);
  canvas.SystemThemeChanged = undefined;
  setDark(true);
  check("no handler: no call, the theme still followed", seen.join() === "Dark,Light" && canvas.SystemTheme === "Dark", `${seen.join()} / ${canvas.SystemTheme}`);
  canvas.Dispose();
  check("disposed: the media query is let go", query.listeners.size === 0, `${query.listeners.size} listeners`);

  console.log(failures ? `FAIL: ${failures} checks` : "OK: system light / dark appearance");
  process.exit(failures ? 1 : 0);
})();
