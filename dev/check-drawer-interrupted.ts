// A touch on a drawer moving to a snap (C# DrawerInterruptedSnapTests, 58f4a25c), on a real engine Canvas in Node with
// pointer input (`npm run check:drawer-interrupted`): Down stops the move so a pan can take the drawer from where it
// is; a touch that ends without a pan lets the drawer finish the move to the snap it was sent to, instead of leaving it
// between its snaps. A pan during the move still takes it; a touch on the panel ends with its Up (AutoClose). AutoClose
// tests the content's hit, so a drawer larger than its panel closes on a press outside the panel.
import { readFileSync } from "node:fs";
import { Super, Canvas, SkiaDrawer, SkiaShape } from "../src/index.ts";

declare const CanvasKitInit: (o: { locateFile: () => string }) => Promise<any>;
const ROOT = process.cwd();
const W = 300, H = 600;
let failures = 0;
const check = (name: string, ok: boolean, detail = "") => { if (!ok) failures++; console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

(async () => {
  const CK = await CanvasKitInit({ locateFile: () => `${ROOT}/node_modules/canvaskit-wasm/bin/full/canvaskit.wasm` });
  (Super as unknown as { CK: unknown }).CK = CK;
  CK.MakeSWCanvasSurface = () => CK.MakeSurface(W, H);
  const face = Super.LoadFace(readFileSync(`${ROOT}/samples/public/fonts/OpenSans-Regular.ttf`))!;
  Super.Fonts.set("FontText", new Map([[400, face]])); Super.DefaultTypeface = face; Super.DefaultFontAlias = "FontText";

  const element = {
    clientWidth: W, clientHeight: H, width: 0, height: 0, style: style(),
    addEventListener: (t: string, f: (e: unknown) => void) => on(`el:${t}`, f), removeEventListener() {}, setPointerCapture() {}, releasePointerCapture() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: W, height: H }),
  } as unknown as HTMLCanvasElement;
  const canvas = new Canvas(element, (c) => { c.RenderingMode = "Default"; });
  canvas.Gestures = "Lock";
  const frame = () => (canvas as unknown as { DrawNow(): void }).DrawNow();
  const frames = async (n: number) => { for (let i = 0; i < n; i++) { await sleep(16); frame(); } };
  const pointer = (type: string, x: number, y: number) =>
    fire(`el:${type}`, { type, pointerId: 1, pointerType: "touch", offsetX: x, offsetY: y, clientX: x, clientY: y, button: 0, buttons: type === "pointerup" ? 0 : 1, preventDefault() {} });
  const tap = async (x: number, y: number) => { pointer("pointerdown", x, y); await frames(2); pointer("pointerup", x, y); await frames(2); };

  /** An open FromBottom drawer filling the canvas (or a 150 pt drawer at the bottom). */
  const openDrawer = async (height = -1, autoClose = false) => {
    const drawer = new SkiaDrawer();
    drawer.Direction = "FromBottom"; drawer.AutoClose = autoClose; drawer.HorizontalOptions = "Fill";
    if (height > 0) { drawer.HeightRequest = height; drawer.VerticalOptions = "End"; } else drawer.VerticalOptions = "Fill";
    const panel = new SkiaShape(); panel.BackgroundColor = "#808080"; panel.HorizontalOptions = "Fill"; panel.VerticalOptions = "Fill";
    drawer.AddSubView(panel);
    canvas.Content = drawer;
    await frames(4);
    drawer.IsOpen = true;
    await frames(60);
    return drawer;
  };
  const hidden = (d: SkiaDrawer) => d.SnapPoints[1].Y;
  const between = (d: SkiaDrawer) => d.TranslationY >= 1 && d.TranslationY <= hidden(d) - 1;
  /** Frames until the move to the hidden snap is about a tenth of the way, so a touch lands well inside it. */
  const intoTheMove = async (d: SkiaDrawer, at = 30) => { for (let i = 0; i < 60 && d.TranslationY < at; i++) { await sleep(2); frame(); } return between(d); };
  const closed = async (d: SkiaDrawer) => { await frames(60); return !d.IsOpen && Math.abs(d.TranslationY - hidden(d)) <= 1 && !d.InTransition; };
  const where = (d: SkiaDrawer) => `IsOpen ${d.IsOpen}, y ${d.TranslationY.toFixed(1)}, InTransition ${d.InTransition}`;

  {
    const d = await openDrawer();
    check("the drawer opens", d.IsOpen && Math.abs(d.TranslationY) <= 1, where(d));
    d.IsOpen = false;
    const mid = await intoTheMove(d);
    await tap(150, H - 10);
    check("closed in code, a tap during the move: it ends closed", mid && await closed(d), where(d));
  }
  {
    const d = await openDrawer();
    d.IsOpen = false;
    const mid = await intoTheMove(d);
    pointer("pointerdown", 150, H - 10); await frames(20); pointer("pointerup", 150, H - 10);
    check("closed in code, a hold during the move: it ends closed on release", mid && await closed(d), where(d));
  }
  {
    const d = await openDrawer();
    pointer("pointerdown", 150, 100);
    for (let i = 1; i <= 4; i++) { await sleep(8); pointer("pointermove", 150, 100 + i * 25); } // a fast flick down
    pointer("pointerup", 150, 200);
    const mid = await intoTheMove(d);
    await tap(150, H - 10);
    check("swiped closed, a tap during the move: it ends closed", mid && await closed(d), where(d));
  }
  {
    const d = await openDrawer();
    d.IsOpen = false;
    await intoTheMove(d, 300); // deep enough that a 200 pt drag up does not reach the open edge
    const caughtAt = d.TranslationY;
    let y = H - 10;
    pointer("pointerdown", 150, y); frame();
    for (let i = 0; i < 20; i++) { y -= 10; pointer("pointermove", 150, y); await sleep(4); frame(); }
    const followed = d.TranslationY < caughtAt - 100;
    await frames(19); pointer("pointerup", 150, y);
    await frames(60);
    check("a pan during the move takes the drawer: dragged back up, it opens", followed && d.IsOpen && Math.abs(d.TranslationY) <= 1, `caught at ${caughtAt.toFixed(1)}, ${where(d)}`);
  }
  {
    // a drawer the size of its panel: a press above it is outside (React tests the drawer's own box)
    const d = await openDrawer(150, true);
    await tap(150, H - 50); await frames(4);
    const stillOpen = d.IsOpen;
    await tap(150, 50);
    check("AutoClose: after a touch on the panel, a press outside closes it", stillOpen && await closed(d), where(d));
  }

  {
    // AutoClose with a drawer filling the screen and a smaller panel at its bottom (C# tests the content's hit)
    const drawer = new SkiaDrawer();
    drawer.Direction = "FromBottom"; drawer.AutoClose = true; drawer.HorizontalOptions = "Fill"; drawer.VerticalOptions = "Fill";
    const panel = new SkiaShape(); panel.BackgroundColor = "#808080"; panel.HorizontalOptions = "Fill"; panel.HeightRequest = 150; panel.VerticalOptions = "End";
    drawer.AddSubView(panel);
    canvas.Content = drawer;
    await frames(4); drawer.IsOpen = true; await frames(60);
    await tap(150, H - 50); await frames(4);
    const stillOpen = drawer.IsOpen;
    await tap(150, 50);
    check("AutoClose, a Fill drawer with a smaller panel: a press above the panel closes it", stillOpen && await closed(drawer), where(drawer));
  }

  canvas.Dispose();
  console.log(failures ? `FAIL: ${failures} checks` : "OK: a drawer finishes a move a touch interrupted");
  process.exit(failures ? 1 : 0);
})();
