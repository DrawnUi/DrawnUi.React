// Nothing global keeps an unmounted canvas alive (`npm run check:release`): a real engine Canvas in Node with a
// SkiaShell page holding radio buttons, a focused SkiaEditor, a control with a tooltip on screen, an open popup window
// and ArrowsStartKeyboardNavigation on is unmounted and disposed the way <Canvas> does it; after forced garbage
// collections every one of those objects must be collected (FinalizationRegistry). The DOM stub really removes the
// listeners, so it holds nothing itself.
import { readFileSync } from "node:fs";
import v8 from "node:v8";
import vm from "node:vm";
import { SkiaShell, SkiaLayer, SkiaStack, SkiaRadioButton, SkiaEditor, SkiaShape, type ShellNavigation } from "../src/react/index.tsx";
import { createDrawnRoot } from "../src/react/reconciler.ts";
import { Super, SKPoint, Canvas, TooltipStyle, Thickness, SkiaShape as SkiaShapeCtrl, type SkiaControl } from "../src/index.ts";

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
  const watched: string[] = [];
  const watch = (name: string, o: object | undefined) => { if (o) { registry.register(o, name); watched.push(name); } };

  // everything is made and dropped inside this function, so nothing on the test's own stack keeps it
  const mountAndUnmount = async () => {
    const element = { clientWidth: W, clientHeight: H, width: 0, height: 0, style: style(), ...target(), setPointerCapture() {}, releasePointerCapture() {},
      getBoundingClientRect: () => ({ left: 0, top: 0, width: W, height: H }) } as unknown as HTMLCanvasElement & ReturnType<typeof target>;
    const canvas = new Canvas(element, (c) => { c.RenderingMode = "Default"; });
    canvas.Gestures = "Lock";
    canvas.TooltipStyle = new TooltipStyle({ ShowDelayMs: 20 });
    canvas.ArrowsStartKeyboardNavigation = true;
    const root = createDrawnRoot(canvas);
    const frame = () => (canvas as unknown as { DrawNow(): void }).DrawNow();
    const refs: Record<string, SkiaControl> = {};
    let shell: ShellNavigation | undefined;
    const keep = (name: string) => (c: SkiaControl | null) => { if (c) refs[name] = c; };
    root.render(
      <SkiaShell ref={(s: ShellNavigation | null) => { if (s) shell = s; }} Routes={{}} UseBrowserHistory={false} PagesAnimationSpeed={0} Insets={Thickness.Zero}>
        <SkiaLayer ref={keep("page")} VerticalOptions="Fill" HorizontalOptions="Fill">
          <SkiaStack ref={keep("radios")} Spacing={8}>
            <SkiaRadioButton ref={keep("radio")} Text="One" IsToggled />
            <SkiaRadioButton Text="Two" />
          </SkiaStack>
          <SkiaEditor ref={keep("editor")} WidthRequest={200} HeightRequest={40} Margin={new Thickness(0, 120, 0, 0)} Text="Hello" />
          <SkiaShape ref={keep("tipped")} WidthRequest={80} HeightRequest={40} Margin={new Thickness(300, 120, 0, 0)} BackgroundColor="#405060" Tooltip="A tooltip" />
        </SkiaLayer>
      </SkiaShell>);
    for (let i = 0; i < 6; i++) { await sleep(30); frame(); }
    (refs.editor as SkiaEditor).IsFocused = true; // KeyboardManager + the text input proxy hold it while focused
    element.fire("pointermove", { type: "pointermove", pointerId: 1, pointerType: "mouse", offsetX: 340, offsetY: 140, clientX: 340, clientY: 140, button: 0, buttons: 0 });
    frame(); await sleep(60); frame();
    const popupContent = new SkiaShapeCtrl(); popupContent.WidthRequest = 100; popupContent.HeightRequest = 60; popupContent.AccessibilityRole = "menu";
    canvas.OpenPopupWindow(popupContent, new SKPoint(20, 300)); frame(); frame();
    const states = `editor focused ${(refs.editor as SkiaEditor).IsFocused}, tooltip "${canvas.ShownTooltip}", popup open ${canvas.HasPopupWindows}, shell ${!!shell}`;
    watch("canvas", canvas); watch("shell page", refs.page); watch("radio group parent", refs.radios); watch("radio button", refs.radio);
    watch("editor", refs.editor); watch("control with a tooltip", refs.tipped); watch("popup window content", popupContent);
    // <Canvas> unmount: the React root, then the engine
    root.unmount(); await sleep(30);
    canvas.Dispose();
    return states;
  };

  const states = await mountAndUnmount();
  // the accessibility overlay's rate-limit timer holds the canvas for up to a second after it was disposed, then lets go
  await sleep(1200);
  console.log(`mounted with ${states}`);
  for (let i = 0; i < 12 && collected.size < watched.length; i++) { gc(); await sleep(50); }
  const kept = watched.filter((n) => !collected.has(n));
  check("an unmounted canvas, its shell page, editor, tooltip control, popup and radios are all collected", kept.length === 0, kept.length ? `still alive: ${kept.join(", ")}` : `${watched.length} collected`);
  const left = [...win.map.entries()].filter(([, s]) => s.size > 0).map(([t, s]) => `${t} x${s.size}`);
  console.log(`window listeners left (app-wide singletons): ${left.join(", ") || "none"}`);

  console.log(failures ? `FAIL: ${failures} checks` : "OK: nothing global keeps an unmounted canvas");
  process.exit(failures ? 1 : 0);
})();
