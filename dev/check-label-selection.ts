// Text selection drawn by the label, as every DrawnUI engine (drawnui-cross 6cb / 6cc), checked in Node
// (`npm run check:label-selection`) on a real engine Canvas fed DOM pointer, key and contextmenu events. Ports of the
// DrawnUi.Net LabelTextSelectionTests, PageTextSelectionTests and TouchLongPressContextMenuTests (text case):
// mouse drag and double click select (also when processed a frame late), a right click keeps the selection, a drag across
// the wrap copies the space it dropped, Ctrl+C copies through Super.SetClipboardText (not for a key owned by a page
// element), a click on empty space drops it, touch long press selects a word (a touch drag does not) and keeps a
// selection it lands on, a label without AccessibilityTextSelectable ignores all of it; a page drag from beside a label
// selects from its start, across labels in reading order (copy joined by new lines, a click elsewhere clears all), a touch
// drag still scrolls, a scroll without selectable text keeps mouse-drag scrolling, a scroll with selectable text selects
// on a mouse drag and follows the pointer past its edge; a browser context menu before the long press selects the word
// first; an app that takes the touch menu hides the drawn Copy button, the Copy button copies.
import { readFileSync } from "node:fs";
import { Super, SKRect, Canvas, SkiaLayer, SkiaStack, SkiaScroll, SkiaLabel, Thickness, type SkiaControl } from "../src/index.ts";

declare const CanvasKitInit: (o: { locateFile: () => string }) => Promise<any>;
const ROOT = process.cwd();
const W = 420, H = 400;
let failures = 0;
const check = (name: string, ok: boolean, detail = "") => { if (!ok) failures++; console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const listeners = new Map<string, ((e: unknown) => void)[]>();
const on = (t: string, f: (e: unknown) => void) => { if (!listeners.has(t)) listeners.set(t, []); listeners.get(t)!.push(f); };
const off = (t: string, f: (e: unknown) => void) => { const l = listeners.get(t); if (l) l.splice(l.indexOf(f) >>> 0, 1); };
const fire = (t: string, e: unknown) => { for (const f of [...(listeners.get(t) ?? [])]) f(e); };
const style = () => ({}) as Record<string, string>;
const g = globalThis as unknown as Record<string, unknown>;
g.window = Object.assign(g.window ?? {}, {
  devicePixelRatio: 1, addEventListener: on, removeEventListener: off, focus() {}, setTimeout, clearTimeout, setInterval, clearInterval,
  requestAnimationFrame: () => 1, cancelAnimationFrame() {}, self: g, top: g,
});
g.requestAnimationFrame = () => 1;
g.cancelAnimationFrame = () => {};
g.document = { documentElement: { style: style() }, body: { style: style(), appendChild() {} }, createElement: () => ({ style: style(), dataset: {}, setAttribute() {}, addEventListener() {}, removeEventListener() {}, setSelectionRange() {}, focus() {}, blur() {}, remove() {}, value: "" }), activeElement: null, addEventListener() {}, removeEventListener() {} };
g.ResizeObserver = class { observe() {} disconnect() {} };
g.getComputedStyle = () => ({ overflowX: "visible", overflowY: "visible" });
g.PointerEvent = class { constructor(public type: string, o: object) { Object.assign(this, o); } };
g.MouseEvent = g.PointerEvent;
const element = {
  clientWidth: W, clientHeight: H, width: 0, height: 0, style: style(),
  addEventListener: (t: string, f: (e: unknown) => void) => on(`el:${t}`, f), removeEventListener: (t: string, f: (e: unknown) => void) => off(`el:${t}`, f), setPointerCapture() {},
  getBoundingClientRect: () => ({ left: 0, top: 0, width: W, height: H }),
} as unknown as HTMLCanvasElement;

(async () => {
  const CK = await CanvasKitInit({ locateFile: () => `${ROOT}/node_modules/canvaskit-wasm/bin/full/canvaskit.wasm` });
  (Super as unknown as { CK: unknown }).CK = CK;
  CK.MakeSWCanvasSurface = () => CK.MakeSurface(W, H);
  const face = CK.Typeface.MakeFreeTypeFaceFromData(readFileSync(`${ROOT}/samples/public/fonts/OpenSans-Regular.ttf`).buffer);
  Super.Fonts.set("FontText", new Map([[400, face]])); Super.DefaultTypeface = face; Super.DefaultFontAlias = "FontText";
  let copied: string | undefined;
  Super.SetClipboardText = (t) => { copied = t; };

  const canvas = new Canvas(element, (c) => { c.RenderingMode = "Default"; c.Gestures = "Lock"; });
  const frame = () => (canvas as unknown as { DrawNow(): void }).DrawNow();
  const frames = (n: number) => { for (let i = 0; i < n; i++) frame(); };
  const show = (content: SkiaControl) => { canvas.Content = content; frames(3); };

  type Device = "mouse" | "touch";
  let device: Device = "mouse";
  let button = 0;
  let pointerId = 1;
  let down = false;
  const ptr = (type: string, x: number, y: number) => fire(`el:${type}`, {
    type, pointerId, pointerType: device, clientX: x, clientY: y, offsetX: x, offsetY: y, button: type === "pointermove" ? -1 : button, buttons: down ? (button === 2 ? 2 : 1) : 0, isTrusted: true,
  });
  const press = (x: number, y: number) => { down = true; ptr("pointerdown", x, y); frame(); };
  const move = (x: number, y: number) => { ptr("pointermove", x, y); frame(); };
  const release = (x: number, y: number) => { down = false; ptr("pointerup", x, y); frame(); pointerId++; };
  const drag = (x1: number, y1: number, x2: number, y2: number) => { press(x1, y1); move((x1 + x2) / 2, (y1 + y2) / 2); move(x2, y2); release(x2, y2); };
  const tap = (x: number, y: number) => { press(x, y); release(x, y); };
  const key = (code: string, ctrl: boolean, target: object = { tagName: "BODY", dataset: {} }) =>
    fire("keydown", { code, key: code.replace("Key", "").toLowerCase(), ctrlKey: ctrl, metaKey: false, altKey: false, shiftKey: false, target, preventDefault() {} });
  const keyUp = (code: string) => fire("keyup", { code, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, target: { tagName: "BODY", dataset: {} } });
  const ctrlC = (target?: object) => { key("ControlLeft", true, target); key("KeyC", true, target); keyUp("KeyC"); keyUp("ControlLeft"); };
  const longPress = async (x: number, y: number) => { device = "touch"; press(x, y); await sleep(Canvas.LongPressTimeMs + 80); frame(); };
  const lift = (x: number, y: number) => { release(x, y); device = "mouse"; };

  /** Canvas point at the left edge of a character, mid-height of its line (+1 px, as the C# tests). */
  const at = (label: SkiaLabel, index: number) => {
    const r = label.GetAccessibilityPixelRect();
    const boxes = label.GetGlyphBoxes(), lines = label.GetLineBoxes();
    const box = boxes.find((b) => b.Index === index);
    if (box) return { x: r.Left + box.Left + 1, y: r.Top + box.Top + box.Height / 2 };
    const line = lines.find((l) => index <= l.End) ?? lines[lines.length - 1];
    return { x: r.Left + line.Left + line.Width + 1, y: r.Top + line.Top + line.Height / 2 };
  };

  // ---- LabelTextSelectionTests ----
  const TEXT = "Hello wonderful world, this text wraps onto a second line here";
  const single = (selectable: boolean) => {
    const label = new SkiaLabel(); label.Text = TEXT; label.FontSize = 20; label.WidthRequest = 300; label.Margin = new Thickness(20); label.AccessibilityTextSelectable = selectable;
    const root = new SkiaLayer(); root.VerticalOptions = "Fill"; root.HorizontalOptions = "Fill"; root.AddSubView(label);
    show(root);
    return label;
  };
  {
    const label = single(true);
    const a = at(label, 6), b = at(label, 15);
    drag(a.x, a.y, b.x, b.y);
    check("a mouse drag selects the dragged range", label.SelectedText === "wonderful", label.SelectedText);
    button = 2;
    const mid = at(label, 10);
    tap(mid.x, mid.y);
    button = 0;
    check("a right click keeps the selection", label.SelectedText === "wonderful", label.SelectedText);
  }
  {
    const label = single(true);
    const lines = label.GetLineBoxes();
    const second = lines[1]?.Start ?? 0;
    const a = at(label, second - 6), b = at(label, second + 4);
    drag(a.x, a.y, b.x, b.y);
    check("a drag across the wrap copies the space it dropped", lines.length >= 2 && label.SelectedText === TEXT.substr(second - 6, 10), JSON.stringify(label.SelectedText));
  }
  {
    const label = single(true);
    const p = at(label, 9);
    tap(p.x, p.y); tap(p.x, p.y);
    check("a double click selects the word", label.SelectedText === "wonderful", label.SelectedText);
  }
  {
    const label = single(true);
    const p = at(label, 9);
    // two quick clicks, processed only after a long frame: judged by when they happened
    for (let i = 0; i < 2; i++) { down = true; ptr("pointerdown", p.x, p.y); down = false; ptr("pointerup", p.x, p.y); pointerId++; }
    await sleep(600); frame();
    check("a double click processed late still selects the word", label.SelectedText === "wonderful", label.SelectedText);
  }
  {
    const label = single(true);
    const p = at(label, 2);
    tap(p.x, p.y); tap(p.x, p.y);
    copied = undefined; ctrlC();
    check("Ctrl+C copies through Super.SetClipboardText", copied === "Hello", String(copied));
    copied = undefined; ctrlC({ tagName: "INPUT", dataset: {} });
    check("Ctrl+C for a page input does not copy the drawn selection", copied === undefined, String(copied));
  }
  {
    const label = single(true);
    const p = at(label, 9);
    tap(p.x, p.y); tap(p.x, p.y);
    tap(400, 380);
    check("a click on empty space drops the selection", label.SelectedText === "", label.SelectedText);
  }
  {
    const label = single(true);
    const a = at(label, 6), b = at(label, 15);
    device = "touch"; drag(a.x, a.y, b.x, b.y); device = "mouse";
    check("a touch drag selects nothing", label.SelectedText === "", label.SelectedText);
    const p = at(label, 9);
    await longPress(p.x, p.y);
    check("a touch long press selects the word", label.SelectedText === "wonderful", label.SelectedText);
    lift(p.x, p.y);
  }
  {
    const label = single(true);
    const a = at(label, 6), b = at(label, 21);
    drag(a.x, a.y, b.x, b.y);
    const before = label.SelectedText;
    const p = at(label, 18);
    await longPress(p.x, p.y); lift(p.x, p.y);
    check("a touch long press on the selection keeps it", before === "wonderful world" && label.SelectedText === "wonderful world", `${before} -> ${label.SelectedText}`);
    const o = at(label, 2);
    await longPress(o.x, o.y); lift(o.x, o.y);
    check("a touch long press outside it selects the word there", label.SelectedText === "Hello", label.SelectedText);
  }
  {
    const label = single(false);
    const a = at(label, 6), b = at(label, 15);
    drag(a.x, a.y, b.x, b.y);
    check("a label that is not selectable ignores the pointer", label.SelectedText === "", label.SelectedText);
  }

  // ---- the drawn Copy button and the app's own touch menu (6cb) ----
  {
    const label = single(true);
    const p = at(label, 9);
    await longPress(p.x, p.y); lift(p.x, p.y);
    const button = (label as unknown as { copyButton: SKRect }).copyButton;
    const shown = button.Width > 0;
    copied = undefined;
    const r = label.GetAccessibilityPixelRect();
    device = "touch"; tap(r.Left + (button.Left + button.Right) / 2, r.Top + (button.Top + button.Bottom) / 2); device = "mouse";
    check("a touch selection shows the drawn Copy button; a tap on it copies and clears", shown && copied === "wonderful" && label.SelectedText === "", `shown ${shown}, copied ${copied}, left ${label.SelectedText}`);
    const root = label.Parent!;
    let seen: string | undefined;
    root.ContextMenu = () => { seen = label.SelectedText; return true; };
    await longPress(p.x, p.y);
    frame();
    const hidden = (label as unknown as { copyButton: SKRect }).copyButton.Width === 0 && !(label as unknown as { touchSelection: boolean }).touchSelection;
    check("an app that takes the touch menu sees the word, the Copy button steps aside, the selection stays", seen === "wonderful" && hidden && label.SelectedText === "wonderful", `seen ${seen}, hidden ${hidden}`);
    lift(p.x, p.y);
    root.ContextMenu = undefined;
  }
  {
    // Android Chrome's menu (about 0.5 s) before the engine's long press: the word is selected before the menu
    const label = single(true);
    let seen: string | undefined, longPresses = 0;
    const root = label.Parent!;
    root.ContextMenu = () => { seen = label.SelectedText; return true; };
    root.LongPressing = () => { longPresses++; };
    const p = at(label, 9);
    device = "touch"; press(p.x, p.y);
    let prevented = false;
    fire("el:contextmenu", { pointerType: "touch", pointerId, clientX: p.x, clientY: p.y, button: 0, preventDefault() { prevented = true; } });
    await sleep(Canvas.LongPressTimeMs + 80); frame();
    check("a browser menu before the long press: the word is selected first, one long press, the browser menu suppressed", seen === "wonderful" && label.SelectedText === "wonderful" && longPresses <= 1 && prevented, `seen ${seen}, ${longPresses} long presses`);
    lift(p.x, p.y);
  }

  // ---- PageTextSelectionTests ----
  const text = (t: string) => { const l = new SkiaLabel(); l.Text = t; l.FontSize = 20; l.WidthRequest = 300; l.Margin = new Thickness(20, 10); l.AccessibilityTextSelectable = true; return l; };
  const afterFirstWord = (label: SkiaLabel) => { const r = label.GetAccessibilityPixelRect(); const space = label.Text.indexOf(" "); const box = label.GetGlyphBoxes().find((b) => b.Index === space)!; return { x: r.Left + box.Left, y: (r.Top + r.Bottom) / 2 }; };
  {
    const label = text("Alpha bravo charlie");
    const stack = new SkiaStack(); stack.AddSubView(label); show(stack);
    const r = label.GetAccessibilityPixelRect(), end = afterFirstWord(label);
    press(r.Left - 3, (r.Top + r.Bottom) / 2); move((r.Left + end.x) / 2, end.y); move(end.x, end.y); release(end.x, end.y);
    check("a drag from beside a label selects from its start", label.SelectedText === "Alpha", label.SelectedText);
    copied = undefined; ctrlC();
    check("Ctrl+C copies a page selection of one label", copied === "Alpha", String(copied));
  }
  {
    const a = text("Alpha bravo charlie"), b = text("Delta echo foxtrot"), c = text("Golf hotel india");
    const stack = new SkiaStack(); stack.AddSubView(a); stack.AddSubView(b); stack.AddSubView(c); show(stack);
    const top = a.GetAccessibilityPixelRect(), end = afterFirstWord(c), rb = b.GetAccessibilityPixelRect();
    press(top.Left + 10, top.Top - 6); move((top.Left + top.Right) / 2, (rb.Top + rb.Bottom) / 2); move(end.x, end.y); release(end.x, end.y);
    check("a drag across labels selects them in reading order", a.SelectedText === "Alpha bravo charlie" && b.SelectedText === "Delta echo foxtrot" && c.SelectedText === "Golf", `${a.SelectedText} | ${b.SelectedText} | ${c.SelectedText}`);
    check("Canvas.SelectedText joins them with new lines", canvas.SelectedText === "Alpha bravo charlie\nDelta echo foxtrot\nGolf", JSON.stringify(canvas.SelectedText));
    copied = undefined;
    check("CopyTextSelection copies that through Super.SetClipboardText", canvas.CopyTextSelection() && copied === "Alpha bravo charlie\nDelta echo foxtrot\nGolf", JSON.stringify(copied));
    copied = undefined; ctrlC();
    check("Ctrl+C copies the page selection", copied === "Alpha bravo charlie\nDelta echo foxtrot\nGolf", JSON.stringify(copied));
    // the app's menu from a right click (Windows order: press, release, then the browser's contextmenu): it stays open, and
    // its Copy item copies the page selection (a press on the menu keeps it)
    const { SkiaShape } = await import("../src/index.ts");
    const item = new SkiaShape(); item.WidthRequest = 120; item.HeightRequest = 40; item.BackgroundColor = "#333333";
    item.Tapped = () => { canvas.CopyTextSelection(); };
    b.ContextMenu = (_, e) => { canvas.OpenPopupWindow(item, e.Location); return true; };
    const rbMid = { x: (rb.Left + rb.Right) / 2, y: (rb.Top + rb.Bottom) / 2 };
    button = 2; down = true; ptr("pointerdown", rbMid.x, rbMid.y); down = false; ptr("pointerup", rbMid.x, rbMid.y); button = 0;
    fire("el:contextmenu", { pointerType: "mouse", pointerId, clientX: rbMid.x, clientY: rbMid.y, button: 2, preventDefault() {} }); pointerId++;
    frames(2);
    const popups = (canvas as unknown as { popups: { HasInteractive: boolean } }).popups;
    check("a right click's menu stays open (its press is processed first)", popups.HasInteractive);
    copied = undefined;
    const ir = item.GetAccessibilityPixelRect();
    tap((ir.Left + ir.Right) / 2, (ir.Top + ir.Bottom) / 2); frames(2);
    check("a click on the menu's Copy item copies the page selection", copied === "Alpha bravo charlie\nDelta echo foxtrot\nGolf", JSON.stringify(copied));
    b.ContextMenu = undefined;
    tap(400, 390); frames(2);
    tap(400, 390); frames(2);
    check("a click elsewhere clears all of it", a.SelectedText === "" && b.SelectedText === "" && c.SelectedText === "" && canvas.SelectedText === "", JSON.stringify(canvas.SelectedText));
  }
  const scrollOf = (lines: SkiaLabel[]) => { const content = new SkiaStack(); for (const l of lines) content.AddSubView(l); const s = new SkiaScroll(); s.HeightRequest = 300; s.HorizontalOptions = "Fill"; s.Content = content; return s; };
  {
    const lines = Array.from({ length: 30 }, (_, i) => text(`Line ${i} of selectable text`));
    const scroll = scrollOf(lines); show(scroll);
    device = "touch";
    press(200, 250); for (let y = 240; y >= 100; y -= 12) move(200, y); release(200, 100);
    device = "mouse"; frames(30);
    check("a touch drag still scrolls and selects nothing", scroll.ViewportOffsetY < -50 && lines.every((l) => l.SelectedText === ""), `offset ${scroll.ViewportOffsetY}`);
  }
  {
    const lines = Array.from({ length: 30 }, (_, i) => { const l = new SkiaLabel(); l.Text = `Line ${i}`; l.FontSize = 20; l.Margin = new Thickness(20, 10); return l; });
    const scroll = scrollOf(lines); show(scroll);
    press(200, 250); for (let y = 240; y >= 100; y -= 10) move(200, y); release(200, 100); frames(30);
    check("a scroll without selectable text keeps mouse-drag scrolling", scroll.ViewportOffsetY < -50, `offset ${scroll.ViewportOffsetY}`);
  }
  {
    const lines = Array.from({ length: 30 }, (_, i) => text(`Line ${i} of selectable text`));
    const scroll = scrollOf(lines);
    const stack = new SkiaStack(); stack.AddSubView(scroll); show(stack);
    press(8, 20); for (let y = 30; y <= 200; y += 10) move(200, y);
    check("a mouse drag in a scroll holding selectable text selects, the scroll stays", Math.abs(scroll.ViewportOffsetY) < 1 && lines[0].SelectedText === lines[0].Text && lines[2].SelectedText !== "", `offset ${scroll.ViewportOffsetY}, first ${lines[0].SelectedText}`);
    move(200, 340); for (let i = 0; i < 60; i++) frame();
    check("held past the bottom edge the scroll follows and the selection grows", scroll.ViewportOffsetY < -50 && lines[10].SelectedText !== "", `offset ${scroll.ViewportOffsetY}`);
    release(200, 340); frames(5);
    const offset = scroll.ViewportOffsetY; frames(30);
    check("and it stops once the button is up", Math.abs(scroll.ViewportOffsetY - offset) < 1, `${offset} -> ${scroll.ViewportOffsetY}`);
  }

  console.log(failures ? `FAIL: ${failures} checks` : "OK: text selection drawn by the label, as every DrawnUI engine");
  process.exit(failures ? 1 : 0);
})();
