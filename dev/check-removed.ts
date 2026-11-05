// A control removed from a live canvas WITHOUT Dispose is released by the canvas (`npm run check:removed`, Rust 44c718f):
// a page whose grandchild runs a looping rotation (running, then paused), a page holding a focused SkiaEditor, a page
// holding a DrawnGame. After RemoveSubView, a few frames and forced garbage collections, every removed object must be
// collected; whatever still holds it is reported. Then what runs for a removed or disposed control: a removed page's
// animation pauses and goes on when it is added back, a disposed control's animator neither ticks nor asks for frames,
// a removed focused editor loses the focus, a game gets keys only while it is on a canvas.
import { readFileSync } from "node:fs";
import v8 from "node:v8";
import vm from "node:vm";
import { Super, Canvas, Thickness, SkiaLayer, SkiaShape, SkiaEditor, SkiaValueAnimator, DrawnGame, type SkiaControl } from "../src/index.ts";

declare const CanvasKitInit: (o: { locateFile: () => string }) => Promise<any>;
v8.setFlagsFromString("--expose_gc");
const gc = vm.runInNewContext("gc") as () => void;
const ROOT = process.cwd();
const W = 600, H = 400;
let failures = 0;
const check = (name: string, ok: boolean, detail = "") => { if (!ok) failures++; console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// a DOM stub whose listeners really come off
const listenersOf = () => new Map<string, Set<(e: unknown) => void>>();
const target = () => {
  const map = listenersOf();
  return {
    map,
    addEventListener: (t: string, f: (e: unknown) => void) => { if (!map.has(t)) map.set(t, new Set()); map.get(t)!.add(f); },
    removeEventListener: (t: string, f: (e: unknown) => void) => { map.get(t)?.delete(f); },
    fire: (t: string, e: unknown) => { for (const f of [...(map.get(t) ?? [])]) f(e); },
  };
};
const style = () => ({}) as Record<string, string>;
const win = target();
const g = globalThis as unknown as Record<string, unknown>;
g.window = Object.assign(g.window ?? {}, {
  devicePixelRatio: 1, addEventListener: win.addEventListener, removeEventListener: win.removeEventListener, focus() {},
  setTimeout, clearTimeout, setInterval, clearInterval, requestAnimationFrame: () => 1, cancelAnimationFrame() {}, self: g, top: g,
});
g.requestAnimationFrame = () => 1;
g.cancelAnimationFrame = () => {};
g.document = {
  documentElement: { style: style() }, body: { style: style(), appendChild() {}, removeChild() {} },
  createElement: () => ({ style: style(), dataset: {}, setAttribute() {}, ...target(), setSelectionRange() {}, focus() {}, blur() {}, remove() {}, value: "" }),
  activeElement: null, addEventListener() {}, removeEventListener() {},
};
g.ResizeObserver = class { observe() {} disconnect() {} };
g.getComputedStyle = () => ({ overflowX: "visible", overflowY: "visible" });

(async () => {
  const CK = await CanvasKitInit({ locateFile: () => `${ROOT}/node_modules/canvaskit-wasm/bin/full/canvaskit.wasm` });
  (Super as unknown as { CK: unknown }).CK = CK;
  CK.MakeSWCanvasSurface = () => CK.MakeSurface(W, H);
  const face = Super.LoadFace(readFileSync(`${ROOT}/samples/public/fonts/OpenSans-Regular.ttf`))!;
  Super.Fonts.set("FontText", new Map([[400, face]])); Super.DefaultTypeface = face; Super.DefaultFontAlias = "FontText";

  const collected = new Set<string>();
  const registry = new FinalizationRegistry<string>((name) => collected.add(name));
  const results: string[] = [];

  const element = { clientWidth: W, clientHeight: H, width: 0, height: 0, style: style(), ...target(), setPointerCapture() {}, releasePointerCapture() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: W, height: H }) } as unknown as HTMLCanvasElement;
  const canvas = new Canvas(element, (c) => { c.RenderingMode = "Default"; });
  const frame = () => (canvas as unknown as { DrawNow(): void }).DrawNow();
  const root = new SkiaLayer(); root.WidthRequest = W; root.HeightRequest = H;
  canvas.Content = root; frame();

  type Case = { name: string; build: (page: SkiaLayer) => () => void };
  const cases: Case[] = [
    { name: "page with a looping rotation running two levels down", build: (page) => {
      const inner = new SkiaLayer(); const child = new SkiaShape(); child.WidthRequest = 40; child.HeightRequest = 40;
      inner.AddSubView(child); page.AddSubView(inner);
      const a = new SkiaValueAnimator(child); a.mMinValue = 0; a.mMaxValue = 360; a.Speed = 1000; a.Repeat = -1; a.OnUpdated = (v) => { child.Rotation = v; };
      return () => a.Start();
    } },
    { name: "page with a looping rotation paused two levels down", build: (page) => {
      const inner = new SkiaLayer(); const child = new SkiaShape(); child.WidthRequest = 40; child.HeightRequest = 40;
      inner.AddSubView(child); page.AddSubView(inner);
      const a = new SkiaValueAnimator(child); a.mMinValue = 0; a.mMaxValue = 360; a.Speed = 1000; a.Repeat = -1; a.OnUpdated = (v) => { child.Rotation = v; };
      return () => { a.Start(); frame(); frame(); a.Pause(); };
    } },
    { name: "page with a focused SkiaEditor", build: (page) => {
      const editor = new SkiaEditor(); editor.WidthRequest = 200; editor.HeightRequest = 40; editor.Text = "Hello"; page.AddSubView(editor);
      return () => { editor.IsFocused = true; };
    } },
    { name: "page with a DrawnGame", build: (page) => {
      const game = new DrawnGame(); game.WidthRequest = 100; game.HeightRequest = 100; page.AddSubView(game);
      return () => {};
    } },
  ];

  for (const c of cases) {
    const before = canvas.AnimatingControls.size;
    // made and dropped inside a function, so nothing on the test's stack keeps it
    const mount = () => {
      const page = new SkiaLayer(); page.WidthRequest = W; page.HeightRequest = H;
      const start = c.build(page);
      root.AddSubView(page); frame(); frame();
      start(); frame(); frame();
      registry.register(page, c.name);
      root.RemoveSubView(page); // removed from the live canvas, no Dispose
      frame(); frame();
    };
    mount();
    await sleep(1200); // the overlay's rate-limit timer holds the tree up to a second
    for (let i = 0; i < 12 && !collected.has(c.name); i++) { frame(); gc(); await sleep(50); }
    const left = canvas.AnimatingControls.size - before;
    results.push(`${collected.has(c.name) ? "collected" : "ALIVE    "} ${c.name}${left ? ` (canvas animators left: ${left})` : ""}`);
  }
  for (const r of results) console.log(r);
  const alive = results.filter((r) => r.startsWith("ALIVE")).length;

  // ---- what keeps running for a removed or disposed control ----
  let updates = 0;
  const update = canvas.Update.bind(canvas);
  canvas.Update = () => { updates++; update(); };
  const spinner = () => {
    const page = new SkiaLayer(); page.WidthRequest = W; page.HeightRequest = H;
    const child = new SkiaShape(); child.WidthRequest = 40; child.HeightRequest = 40; page.AddSubView(child);
    const a = new SkiaValueAnimator(child); a.mMinValue = 0; a.mMaxValue = 360; a.Speed = 1000; a.Repeat = -1; a.OnUpdated = (v) => { child.Rotation = v; };
    root.AddSubView(page); frame(); frame();
    a.Start(); frame(); await0(); frame();
    return { page, child, a };
  };
  const await0 = () => { const t = performance.now(); while (performance.now() - t < 20) { /* frames 20 ms apart */ } };
  const ticks = (n: number) => { for (let i = 0; i < n; i++) { await0(); frame(); } };

  {
    const { page, child, a } = spinner();
    root.RemoveSubView(page); frame();
    const at = child.Rotation; updates = 0;
    ticks(5);
    check("a removed page's animation does not tick", child.Rotation === at, `${at} -> ${child.Rotation}`);
    check("it asks for no frames", updates === 0, `${updates} updates`);
    check("it leaves the canvas' animators", ![...canvas.AnimatingControls.values()].includes(a));
    root.AddSubView(page); frame(); frame();
    ticks(5);
    check("added back, it goes on", child.Rotation !== at && a.IsRunning && !a.IsPaused, `${at} -> ${child.Rotation}`);
    check("from where it was: the time off the canvas is not counted", Math.abs(child.Rotation - at) < 360 * 0.5, `${at} -> ${child.Rotation}`);
    root.RemoveSubView(page); page.Dispose(); frame();
    check("removed, then disposed: it stops", !a.IsRunning && ![...canvas.AnimatingControls.values()].includes(a));
  }
  {
    const { page, child, a } = spinner();
    child.Dispose(); frame();
    const at = child.Rotation; updates = 0;
    ticks(5);
    check("a disposed control's animator does not tick", child.Rotation === at, `${at} -> ${child.Rotation}`);
    check("it asks for no frames", updates === 0, `${updates} updates`);
    check("it is stopped and gone from the canvas", !a.IsRunning && ![...canvas.AnimatingControls.values()].includes(a));
    root.RemoveSubView(page); page.Dispose(); frame();
  }
  {
    const page = new SkiaLayer(); page.WidthRequest = W; page.HeightRequest = H;
    const editor = new SkiaEditor(); editor.WidthRequest = 200; editor.HeightRequest = 40; page.AddSubView(editor);
    root.AddSubView(page); frame(); frame();
    editor.IsFocused = true; frame();
    root.RemoveSubView(page); frame();
    check("a removed focused editor loses the focus", !editor.IsFocused && SkiaEditor.Focused !== editor);
    page.Dispose();
  }
  {
    let keys = 0;
    class Game extends DrawnGame { override OnKeyDown(): void { keys++; } }
    const key = () => win.fire("keydown", { code: "KeyA", key: "a", target: null, preventDefault() {}, stopPropagation() {} });
    const game = new Game(); game.WidthRequest = 100; game.HeightRequest = 100;
    key();
    check("a game not on a canvas gets no keys", keys === 0, `${keys}`);
    root.AddSubView(game); frame(); frame();
    key();
    check("on a canvas it gets them", keys === 1, `${keys}`);
    root.RemoveSubView(game); frame();
    key();
    check("removed, it gets none", keys === 1, `${keys}`);
    root.AddSubView(game); frame(); frame();
    key();
    check("added back, it gets them again", keys === 2, `${keys}`);
    root.RemoveSubView(game); game.Dispose();
  }

  canvas.Dispose();
  console.log(alive ? `FAIL: ${alive} of ${cases.length} removed pages stay in memory` : "OK: removed pages are released");
  console.log(failures ? `FAIL: ${failures} checks` : "OK: removed and disposed controls stop what they ran");
  process.exit(alive || failures ? 1 : 0);
})();
