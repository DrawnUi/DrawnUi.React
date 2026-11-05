// One key routing order (drawnui-cross 6az, C# KeyboardManager.IsKeyHandled) on a real engine Canvas in Node
// (`npm run check:key-routing`): the canvas keyboard navigation gets a key first (an overlay node's keydown, a popup
// window's Escape, arrows starting navigation), then the app's KeyDown runs with IsKeyHandled; an app's
// SetAccessibilityFocus in the same frame wins over a closed popup window giving the keyboard back to its opener, and
// undefined keeps the focus from moving.
import { readFileSync } from "node:fs";
import { Super, Canvas, SkiaLayer, SkiaStack, SkiaButton, Aria, KeyboardManager, SKPoint, type SkiaControl } from "../src/index.ts";

declare const CanvasKitInit: (o: { locateFile: () => string }) => Promise<any>;
const ROOT = process.cwd();
const W = 400, H = 400;
let failures = 0;
const check = (name: string, ok: boolean, detail = "") => { if (!ok) failures++; console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`); };

// ---- a window that dispatches like a browser: capture listeners, the target's own handler, then bubble listeners ----
type Listener = { f: (e: unknown) => void; capture: boolean };
const listeners = new Map<string, Listener[]>();
const on = (t: string, f: (e: unknown) => void, capture?: boolean) => { if (!listeners.has(t)) listeners.set(t, []); listeners.get(t)!.push({ f, capture: !!capture }); };
const dispatch = (t: string, e: unknown, atTarget?: () => void) => {
  for (const l of listeners.get(t) ?? []) if (l.capture) l.f(e);
  atTarget?.();
  for (const l of listeners.get(t) ?? []) if (!l.capture) l.f(e);
};
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

const HOST = { tagName: "DIV", dataset: { drawnuiHost: "1" } };       // the canvas host: no drawn control has the DOM focus
const NODE = { tagName: "DIV", dataset: { a11yId: "7" } };            // an accessibility overlay node in DOM focus
const keyEvent = (type: string, code: string, target: unknown) => ({ type, code, key: code, target, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {} });

(async () => {
  const CK = await CanvasKitInit({ locateFile: () => `${ROOT}/node_modules/canvaskit-wasm/bin/full/canvaskit.wasm` });
  (Super as unknown as { CK: unknown }).CK = CK;
  CK.MakeSWCanvasSurface = () => CK.MakeSurface(W, H);
  const face = Super.LoadFace(readFileSync(`${ROOT}/samples/public/fonts/OpenSans-Regular.ttf`))!;
  Super.Fonts.set("FontText", new Map([[400, face]])); Super.DefaultTypeface = face; Super.DefaultFontAlias = "FontText";

  const canvas = new Canvas(element, (c) => { c.RenderingMode = "Default"; });
  canvas.AccessibilityManager.MinUpdateIntervalMs = 0;
  const frame = () => (canvas as unknown as { DrawNow(): void }).DrawNow();
  const button = (text: string) => { const b = new SkiaButton(); b.Text = text; b.AccessibilityRole = Aria.RoleButton; b.HeightRequest = 40; b.Tapped = () => {}; return b; };
  const opener = button("Open"), other = button("Other");
  const root = new SkiaLayer(); root.WidthRequest = W; root.HeightRequest = H;
  const column = new SkiaStack(); column.AddSubView(opener); column.AddSubView(other); root.AddSubView(column);
  canvas.Content = root;
  frame(); frame();

  // the app's global key handler: records what it saw
  let seen: { key: string; handled: boolean; popupOpen: boolean }[] = [];
  let popup = 0;
  let onAppKey: ((key: string) => void) | undefined;
  KeyboardManager.Subscribe((key) => { seen.push({ key, handled: KeyboardManager.IsKeyHandled, popupOpen: canvas.IsPopupWindowOpen(popup) }); onAppKey?.(key); }, () => {});
  const press = (code: string, target: unknown, atTarget?: () => void) => {
    seen = [];
    dispatch("keydown", keyEvent("keydown", code, target), atTarget);
    dispatch("keyup", keyEvent("keyup", code, target));
    frame(); frame();
    return seen[0];
  };

  // ---- 2: the app's KeyDown comes after the navigation and says whether it used the key ----
  check("a key no navigation used: handled false", press("KeyA", HOST)?.handled === false);
  let order: string[] = [];
  KeyboardManager.Subscribe((key) => { if (key === "Enter") order.push("app"); }, () => {});
  const enter = press("Enter", NODE, () => { order.push("node"); KeyboardManager.MarkKeyHandled("Enter"); });
  check("an overlay node's key reaches the app after the node's own keydown", order.join() === "node,app", order.join());
  check("Enter the node used (activated): handled true", enter?.handled === true);
  check("a node key the node did not use: handled false", press("KeyB", NODE)?.handled === false);
  check("the flag is only for that press", press("Enter", HOST)?.handled === false);
  KeyboardManager.MarkKeyHandled("Space");
  dispatch("keyup", keyEvent("keyup", "Space", HOST));
  check("a key's release forgets a mark it did not use", press("Space", HOST)?.handled === false);

  const menu = () => { const m = new SkiaStack(); m.AccessibilityRole = Aria.RoleMenu; m.AddSubView(button("Item 1")); m.AddSubView(button("Item 2")); return m; };
  popup = canvas.OpenPopupWindow(menu(), new SKPoint(200, 200)); frame(); frame();
  const esc = press("Escape", HOST);
  check("Escape closing a popup window: handled true", esc?.handled === true);
  check("the popup is closed before the app's KeyDown runs", esc?.popupOpen === false);
  check("Escape with no popup: handled false", press("Escape", HOST)?.handled === false);

  canvas.ArrowsStartKeyboardNavigation = true;
  const down = press("ArrowDown", HOST);
  check("an arrow starting keyboard navigation: handled true", down?.handled === true && canvas.KeyboardFocusNode === opener, canvas.KeyboardFocusNode?.AccessibilityLabel);
  canvas.ArrowsStartKeyboardNavigation = false;

  // ---- 3: an app's SetAccessibilityFocus in the same frame wins over a closed popup's return to its opener ----
  const openFromKeyboard = () => {
    canvas.SetAccessibilityFocus(opener); frame(); frame();
    popup = canvas.OpenPopupWindow(menu(), opener); frame(); frame(); frame();
    const inside = canvas.KeyboardFocusNode;
    return !!inside && inside !== opener;
  };
  check("a popup opened with the keyboard on its opener takes the keyboard", openFromKeyboard(), canvas.KeyboardFocusNode?.AccessibilityLabel);
  press("Escape", NODE);
  check("closed with the keyboard inside, it gives the keyboard back to its opener", canvas.KeyboardFocusNode === opener, canvas.KeyboardFocusNode?.AccessibilityLabel);

  openFromKeyboard();
  onAppKey = (key) => { if (key === "Escape") canvas.SetAccessibilityFocus(other); };
  press("Escape", NODE);
  check("the app's SetAccessibilityFocus in that frame wins", canvas.KeyboardFocusNode === other, canvas.KeyboardFocusNode?.AccessibilityLabel);

  openFromKeyboard();
  const item = canvas.KeyboardFocusNode;
  onAppKey = (key) => { if (key === "Escape") canvas.SetAccessibilityFocus(undefined); };
  press("Escape", NODE);
  check("SetAccessibilityFocus(undefined) keeps the focus from moving to the opener", canvas.KeyboardFocusNode !== opener && canvas.KeyboardFocusNode !== other, canvas.KeyboardFocusNode === item ? "stays on the closed item" : canvas.KeyboardFocusNode?.AccessibilityLabel ?? "none");
  onAppKey = undefined;

  canvas.SetAccessibilityFocus(other); frame(); frame();
  canvas.KeyboardFocusNode = undefined; frame();
  check("KeyboardFocusNode = undefined: no drawn control keeps the focus", canvas.KeyboardFocusNode === undefined, canvas.KeyboardFocusNode?.AccessibilityLabel);

  console.log(failures ? `FAIL: ${failures} checks` : "OK: one key routing order");
  process.exit(failures ? 1 : 0);
})();
