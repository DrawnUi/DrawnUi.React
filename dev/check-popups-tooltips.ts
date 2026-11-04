// Tooltips (drawnui-cross 6ar) and popup windows (6at) on a real engine Canvas in Node (`npm run check:popups-tooltips`):
// the DOM is stubbed (a software surface, no WebGL) and input goes through the Canvas' own pointer, wheel, context-menu
// and key handlers. Also: a span without a color draws its underline in the label's color (C# a0ca2cbc).
import { readFileSync } from "node:fs";
import {
  Super, SKRect, SKPoint, Canvas, SkiaLayer, SkiaShape, SkiaButton, SkiaLabel, TextSpan, TooltipStyle, Thickness, SkiaStack, SkiaRow, SkiaAccessibilityManager, SkiaEditor,
  type SkiaControl,
} from "../src/index.ts";

declare const CanvasKitInit: (o: { locateFile: () => string }) => Promise<any>;
const ROOT = process.cwd();
const W = 600, H = 400;
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
  canvas.Gestures = "Lock";
  canvas.TooltipStyle = new TooltipStyle({ ShowDelayMs: 40 });
  const frame = () => (canvas as unknown as { DrawNow(): void }).DrawNow();
  const pixels = () => canvas.Surface!.makeImageSnapshot().readPixels(0, 0, { width: W, height: H, colorType: CK.ColorType.RGBA_8888, alphaType: CK.AlphaType.Unpremul, colorSpace: CK.ColorSpace.SRGB }) as Uint8Array;
  const pointer = (type: string, x: number, y: number, button = 0) =>
    fire(`el:${type}`, { type, pointerId: 1, pointerType: "mouse", offsetX: x, offsetY: y, clientX: x, clientY: y, button, buttons: type === "pointerup" ? 0 : 1 });
  const move = (x: number, y: number) => pointer("pointermove", x, y);
  const click = (x: number, y: number) => { pointer("pointerdown", x, y); frame(); pointer("pointerup", x, y); frame(); };
  const key = (code: string) => fire("keydown", { code, key: code, target: {}, preventDefault() {} });
  /** The box of a color on screen (r, g, b within 6), or undefined. */
  const boxOf = (rgb: [number, number, number]) => {
    const px = pixels();
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (Math.abs(px[i] - rgb[0]) < 6 && Math.abs(px[i + 1] - rgb[1]) < 6 && Math.abs(px[i + 2] - rgb[2]) < 6) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    }
    return x1 < 0 ? undefined : new SKRect(x0, y0, x1 + 1, y1 + 1);
  };
  const BG: [number, number, number] = [0x2B, 0x2D, 0x31];

  const box = (x: number, y: number, w: number, h: number, color: string) => {
    const s = new SkiaShape(); s.BackgroundColor = color; s.WidthRequest = w; s.HeightRequest = h; s.Margin = new Thickness(x, y, 0, 0); return s;
  };
  const root = new SkiaLayer(); root.WidthRequest = W; root.HeightRequest = H; root.BackgroundColor = "#101010";
  const save = box(250, 150, 100, 40, "#405060"); save.Tooltip = "Save the document";
  const share = box(370, 150, 100, 40, "#406050"); share.Tooltip = "Share it";
  const top = box(250, 2, 100, 30, "#504060"); top.Tooltip = "At the top";
  const icon = box(40, 150, 40, 40, "#605040"); icon.AccessibilityLabel = "Settings";
  const captioned = new SkiaButton(); captioned.Text = "Publish"; captioned.AccessibilityLabel = "Publish now"; captioned.Margin = new Thickness(40, 260, 0, 0);
  const hinted = box(120, 150, 40, 40, "#604050"); hinted.AccessibilityLabel = "Gear"; hinted.AccessibilityHint = "Opens the settings";
  let belowTaps = 0;
  const below = box(40, 330, 200, 50, "#304030"); below.Tapped = () => { belowTaps++; };
  for (const c of [save, share, top, icon, captioned, hinted, below]) root.AddSubView(c);
  canvas.Content = root;
  frame();

  // ---- tooltips ----
  move(300, 170); frame();
  check("no tooltip before the delay", canvas.ShownTooltip === undefined);
  await sleep(80); frame();
  const tip = boxOf(BG);
  check("after resting on the control its tooltip shows", canvas.ShownTooltip === "Save the document");
  check("attached to the control: centered on it, 6 pt above it", !!tip && Math.abs((tip.Left + tip.Right) / 2 - 300) <= 2 && Math.abs(tip.Bottom - 144) <= 2,
    `box ${tip?.Left},${tip?.Top}..${tip?.Right},${tip?.Bottom}`);
  move(320, 180); frame();
  const tip2 = boxOf(BG);
  check("it stays in place while the mouse moves over the control", !!tip2 && !!tip && tip2.Left === tip.Left && tip2.Top === tip.Top);
  move(400, 170); frame();
  check("the next control shows its tooltip at once", canvas.ShownTooltip === "Share it");
  fire("el:pointerleave", { pointerType: "mouse" }); frame();
  check("leaving the canvas closes it", canvas.ShownTooltip === undefined && !boxOf(BG));
  await sleep(600);
  move(300, 170); frame(); await sleep(80); frame();
  click(300, 170);
  check("a press closes it", canvas.ShownTooltip === undefined);
  move(305, 172); frame(); await sleep(80); frame();
  check("after a press it stays closed while the mouse is on the same control", canvas.ShownTooltip === undefined);
  move(400, 170); frame(); await sleep(80); frame();
  check("it shows again on another control", canvas.ShownTooltip === "Share it");
  key("KeyA"); frame();
  check("a key closes it", canvas.ShownTooltip === undefined);
  move(300, 170); frame(); await sleep(80); frame();
  fire("el:wheel", { clientX: 300, clientY: 170, deltaX: 0, deltaY: 100, deltaMode: 0, preventDefault() {} }); frame();
  check("the wheel closes it", canvas.ShownTooltip === undefined);
  move(10, 10); frame(); await sleep(600);
  move(300, 15); frame(); await sleep(80); frame();
  const below1 = boxOf(BG);
  check("no room above: below the control", canvas.ShownTooltip === "At the top" && !!below1 && Math.abs(below1.Top - 38) <= 2, `top ${below1?.Top}`);
  fire("blur", {}); frame();
  check("window blur closes it", canvas.ShownTooltip === undefined);
  move(10, 10); frame(); await sleep(600);
  canvas.TooltipStyle = new TooltipStyle({ ShowDelayMs: 40, AtCursor: true });
  move(300, 170); frame(); await sleep(80); frame();
  const atCursor = boxOf(BG);
  check("AtCursor: 4 pt right of and 20 pt below the pointer", !!atCursor && Math.abs(atCursor.Left - 304) <= 2 && Math.abs(atCursor.Top - 190) <= 2, `box ${atCursor?.Left},${atCursor?.Top}`);
  canvas.TooltipStyle = new TooltipStyle({ ShowDelayMs: 40 });
  move(10, 10); frame(); await sleep(600);

  // accessibility fallback
  move(60, 170); frame(); await sleep(80); frame();
  check("without the fallback an accessibility label is no tooltip", canvas.ShownTooltip === undefined);
  Super.TooltipsFromAccessibility = true;
  move(62, 172); frame(); await sleep(80); frame();
  check("TooltipsFromAccessibility: an icon shows its accessibility label", canvas.ShownTooltip === "Settings", `${canvas.ShownTooltip}`);
  move(140, 170); frame();
  check("an accessibility hint wins over the label", canvas.ShownTooltip === "Opens the settings", `${canvas.ShownTooltip}`);
  const c = captioned.DrawingRect;
  move((c.Left + c.Right) / 2, (c.Top + c.Bottom) / 2); frame(); await sleep(80); frame();
  check("a control that shows its own text makes no tooltip from its label", canvas.ShownTooltip === undefined, `${canvas.ShownTooltip}`);
  Super.TooltipsFromAccessibility = false;
  move(300, 170); frame(); await sleep(80); frame();
  const nodes = (canvas.AccessibilityManager as unknown as { nodes: Set<SkiaControl> }).nodes;
  check("the tooltip has no accessibility node and does not turn hover on", ![...nodes].some((n) => (n as SkiaLabel).Text === "Save the document") && !save.IsHovered);
  move(10, 10); frame(); await sleep(600);

  // ---- popup windows ----
  const menu = (items: string[], picked: (s: string) => void) => {
    const panel = new SkiaLayer(); panel.WidthRequest = 160; panel.BackgroundColor = "#262B3B";
    items.forEach((t, i) => { const it = box(0, i * 30, 160, 30, i % 2 ? "#303850" : "#343B52"); it.Tapped = () => picked(t); panel.AddSubView(it); });
    panel.HeightRequest = items.length * 30;
    return panel;
  };
  let picked = "";
  let closed = 0;
  canvas.PopupWindowClosed.add(() => { closed++; });
  const p1 = canvas.OpenPopupWindow(menu(["Cut", "Copy", "Paste"], (s) => { picked = s; }), new SKPoint(100, 100));
  frame();
  const m1 = boxOf([0x34, 0x3B, 0x52]);
  check("a popup at a point: its top-left corner there", !!m1 && m1.Left === 100 && m1.Top === 100, `${m1?.Left},${m1?.Top}`);
  click(150, 145);
  check("a tap on a popup item reaches it", picked === "Copy");
  click(100, 350);
  check("a press outside closes the popup and that press goes nowhere", !canvas.IsPopupWindowOpen(p1) && belowTaps === 0 && closed === 1, `open ${canvas.IsPopupWindowOpen(p1)}, below taps ${belowTaps}`);
  click(100, 350);
  check("the next press reaches the controls again", belowTaps === 1);
  canvas.OpenPopupWindow(menu(["A", "B", "C"], () => {}), new SKPoint(560, 380));
  frame();
  const m2 = boxOf([0x34, 0x3B, 0x52]);
  check("no room at the corner: opens to the left of and above the point", !!m2 && m2.Right === 560 && m2.Bottom <= 380, `${m2?.Left},${m2?.Top}..${m2?.Right},${m2?.Bottom}`);
  key("Escape"); frame();
  check("Escape closes the popup", !canvas.HasPopupWindows);
  canvas.OpenPopupWindow(menu(["One", "Two"], () => {}), save);
  frame();
  const m3 = boxOf([0x34, 0x3B, 0x52]);
  check("a popup at a control: below it, left edges together", !!m3 && m3.Left === 250 && m3.Top === 190, `${m3?.Left},${m3?.Top}`);
  fire("el:wheel", { clientX: 50, clientY: 50, deltaX: 0, deltaY: 100, deltaMode: 0, preventDefault() {} }); frame();
  check("the wheel outside closes it", !canvas.HasPopupWindows);
  canvas.OpenPopupWindow(menu(["One"], () => {}), below);
  frame();
  const m4 = boxOf([0x34, 0x3B, 0x52]);
  check("a popup at a control near the bottom: above it", !!m4 && m4.Bottom === 330, `${m4?.Top}..${m4?.Bottom}`);
  fire("blur", {}); frame();
  check("window blur closes it", !canvas.HasPopupWindows);
  move(300, 170); frame(); await sleep(80); frame();
  const p5 = canvas.OpenPopupWindow(menu(["X"], () => {}), new SKPoint(20, 20));
  frame();
  check("a menu opening closes the tooltip", canvas.ShownTooltip === undefined);
  // hover reaches popup items
  const item = canvas.TopPopupWindow as SkiaLayer;
  (item.Views[0] as SkiaShape).ReceivesHover = true; frame();
  move(40, 30); frame();
  check("hover reaches a popup's items", (item.Views[0] as SkiaShape).IsHovered);
  // a right click elsewhere closes it and the request goes on to the content
  let contextAt: SKPoint | undefined;
  canvas.ContextMenu = (_s, e) => { contextAt = e.Location; return true; };
  fire("el:contextmenu", { clientX: 300, clientY: 300, button: 2, pointerType: "mouse", preventDefault() {} });
  check("a right click elsewhere closes the menu and the request gives its canvas point", !canvas.IsPopupWindowOpen(p5) && !!contextAt && contextAt.X === 300 && contextAt.Y === 300);
  frame();
  // a look change inside an open popup is drawn (a menu's highlight under a shape's default Operations cache)
  {
    const panel = new SkiaShape(); panel.WidthRequest = 100; panel.HeightRequest = 60; panel.BackgroundColor = "#262B3B";
    const row = box(0, 0, 100, 30, "#262B3B"); panel.AddSubView(row);
    const id = canvas.OpenPopupWindow(panel, new SKPoint(400, 300)); frame();
    // a color set from code is a field: UpdateDraw() is what a prop change does after it
    row.BackgroundColor = "#7A3B52"; row.UpdateDraw(); frame();
    check("a change inside an open popup is drawn", !!boxOf([0x7A, 0x3B, 0x52]));
    canvas.ClosePopupWindow(id); frame();
  }
  // a closed popup leaves the accessibility tree in the frame that follows (no ghost menu for screen readers)
  {
    const panel = new SkiaShape(); panel.WidthRequest = 100; panel.HeightRequest = 60; panel.BackgroundColor = "#262B3B";
    panel.AccessibilityRole = "menu"; panel.AccessibilityLabel = "Ghost";
    const id = canvas.OpenPopupWindow(panel, new SKPoint(400, 300)); frame();
    const inTree = () => canvas.AccessibilityManager.Snapshot.some((n) => n.Label === "Ghost");
    canvas.AccessibilityManager.ForceRebuildOnNextFrame(); frame();
    const before = inTree();
    canvas.ClosePopupWindow(id); frame();
    check("a closed popup leaves the accessibility tree at once", before && !inTree(), `open ${before}, closed ${inTree()}`);
  }
  // keyboard in popup menus (drawnui-cross 6ao): an opening menu takes the keyboard on its first line, the arrows move
  // through lines held by a column inside the menu's shape, and a closing menu gives the keyboard back to its opener
  {
    const mgr = canvas.AccessibilityManager;
    const opener = box(40, 150, 60, 30, "#405060"); opener.AccessibilityRole = "button"; opener.AccessibilityLabel = "Opener"; opener.Tapped = () => {};
    const r = new SkiaLayer(); r.WidthRequest = W; r.HeightRequest = H; r.BackgroundColor = "#000000"; r.AddSubView(opener);
    canvas.Content = r; frame();
    const panel = new SkiaShape(); panel.WidthRequest = 120; panel.AccessibilityRole = "menu"; panel.AccessibilityLabel = "Menu";
    const column = new SkiaStack(); column.Spacing = 0; panel.AddSubView(column);
    const lines = ["One", "Two", "Three"].map((t) => { const l = new SkiaShape(); l.HeightRequest = 30; l.HorizontalOptions = "Fill"; l.AccessibilityRole = "menuitem"; l.AccessibilityLabel = t; l.Tapped = () => {}; column.AddSubView(l); return l; });
    // opened with the mouse (no keyboard focus, no key being handled): the keyboard is left alone
    const byMouse = canvas.OpenPopupWindow(panel, opener); frame();
    check("a menu opened with the mouse leaves the keyboard alone", mgr.FocusedNode === undefined, `${mgr.FocusedNode?.AccessibilityLabel}`);
    check("while a menu is open, controls outside it are no Tab stops", !mgr.IsTabStop(opener));
    canvas.ClosePopupWindow(byMouse); frame();
    check("closing it moves no keyboard focus", mgr.FocusedNode === undefined, `${mgr.FocusedNode?.AccessibilityLabel}`);
    // opened from the keyboard (Enter on the focused opener)
    const panel2 = new SkiaShape(); panel2.WidthRequest = 120; panel2.AccessibilityRole = "menu"; panel2.AccessibilityLabel = "Menu";
    const column2 = new SkiaStack(); column2.Spacing = 0; panel2.AddSubView(column2);
    const lines2 = ["One", "Two", "Three"].map((t) => { const l = new SkiaShape(); l.HeightRequest = 30; l.HorizontalOptions = "Fill"; l.AccessibilityRole = "menuitem"; l.AccessibilityLabel = t; l.Tapped = () => {}; column2.AddSubView(l); return l; });
    opener.NotifyAccessibilityFocused(true);
    const id = canvas.OpenPopupWindow(panel2, opener); frame();
    check("a menu opened from the keyboard takes it on its first line", mgr.FocusedNode === lines2[0], `${mgr.FocusedNode?.AccessibilityLabel}`);
    SkiaAccessibilityManager.Key(lines2[0], "ArrowDown"); frame();
    check("Down moves to the next line of a column inside the menu's shape", mgr.FocusedNode === lines2[1], `${mgr.FocusedNode?.AccessibilityLabel}`);
    check("Tab stays inside the open menu (one stop: the focused line)", mgr.NextTabStop(lines2[1], true) === lines2[1] && mgr.NextTabStop(lines2[1], false) === lines2[1],
      `${mgr.NextTabStop(lines2[1], true)?.AccessibilityLabel}`);
    canvas.ClosePopupWindow(id); frame();
    check("a closing menu gives the keyboard back to the control it opened from", mgr.FocusedNode === opener, `${mgr.FocusedNode?.AccessibilityLabel}`);
    check("with no menu open, Tab reaches the page again", mgr.IsTabStop(opener));
  }

  // ---- focus on a completed tap (drawnui-cross 6ap) ----
  {
    const r = new SkiaLayer(); r.WidthRequest = W; r.HeightRequest = H; r.BackgroundColor = "#000000";
    const editor = new SkiaEditor(); editor.WidthRequest = 200; editor.HeightRequest = 40; editor.Margin = new Thickness(40, 40, 0, 0); editor.Text = "Hello";
    let sends = 0;
    const send = box(300, 40, 80, 40, "#405060"); send.Tapped = () => { sends++; };
    const card = box(40, 200, 200, 100, "#304030"); card.CanBeFocused = true; card.BlockGesturesBelow = true;
    for (const c of [editor, send, card]) r.AddSubView(c);
    canvas.Content = r; frame();
    click(100, 60); frame();
    check("a tap on an editor focuses it and the canvas focus follows", editor.IsFocused && canvas.FocusedChild === editor);
    click(340, 60); frame();
    check("a tap on a button that cannot be focused keeps the editor focused", sends === 1 && editor.IsFocused);
    click(500, 350); frame();
    check("a tap on nothing ends the editing", !editor.IsFocused && canvas.FocusedChild === undefined);
    click(100, 60); frame(); click(140, 250); frame();
    check("a tap on a container with CanBeFocused takes the focus from the editor", !editor.IsFocused && canvas.FocusedChild === card);
    click(100, 60); frame(); editor.LockFocus = true; click(500, 350); frame();
    check("LockFocus keeps the editor focused", editor.IsFocused && canvas.FocusedChild === editor);
    editor.LockFocus = false; editor.IsFocused = false; frame();
    check("an editor letting go itself clears the canvas focus", canvas.FocusedChild === undefined);

    // controls that leave the canvas are not kept by it (C# 4cb28ab6): a focused editor removed with its page, a
    // button pressed under its tooltip
    click(100, 60); frame();
    r.RemoveSubView(editor); editor.Dispose(); frame();
    check("a removed focused editor is let go by the canvas focus", canvas.FocusedChild === undefined);
    send.Tooltip = "Send it"; move(340, 60); frame(); await sleep(80); frame(); click(340, 60); frame();
    r.RemoveSubView(send); send.Dispose(); frame();
    const tips = (canvas as unknown as { tooltipController: { owner?: SkiaControl; suppressed?: SkiaControl } }).tooltipController;
    check("a removed pressed control is let go by the tooltips", tips.owner !== send && tips.suppressed !== send);
    check("the gesture dispatch keeps no removed control", (canvas as unknown as { gestureOwner: SkiaControl | null }).gestureOwner !== send);
  }

  // ---- modal accessibility scope (drawnui-cross 6av) and arrows that start keyboard navigation ----
  {
    const mgr = canvas.AccessibilityManager;
    mgr.MinUpdateIntervalMs = 0;
    const button = (x: number, y: number, label: string) => { const b = box(x, y, 80, 30, "#405060"); b.AccessibilityRole = "button"; b.AccessibilityLabel = label; b.Tapped = () => {}; return b; };
    const r = new SkiaLayer(); r.WidthRequest = W; r.HeightRequest = H; r.BackgroundColor = "#000000";
    const behind = button(20, 20, "Behind"), after = button(120, 20, "After");
    const dialog = new SkiaLayer(); dialog.WidthRequest = 300; dialog.HeightRequest = 200; dialog.Margin = new Thickness(100, 100, 0, 0);
    dialog.AccessibilityModal = true; dialog.AccessibilityLabel = "Settings"; dialog.IsVisible = false;
    const title = new SkiaLabel(); title.Text = "Settings"; title.AccessibilityRole = "heading"; title.AccessibilityLabel = "Settings";
    const ok = button(20, 60, "OK"), cancel = button(120, 60, "Cancel");
    for (const c of [title, ok, cancel]) dialog.AddSubView(c);
    for (const c of [behind, after, dialog]) r.AddSubView(c);
    canvas.Content = r; frame(); frame();
    const labels = () => mgr.Snapshot.map((n) => `${n.Role}:${n.Label ?? ""}`);
    check("no modal shown: the page is in the snapshot", labels().includes("button:Behind") && mgr.ActiveModal === undefined);
    behind.NotifyAccessibilityFocused(true); // the keyboard is on Behind
    dialog.IsVisible = true; dialog.Update(); frame(); frame();
    check("a shown modal is active and only its nodes stay", mgr.ActiveModal === dialog && !labels().includes("button:Behind") && labels().includes("button:OK"), labels().join(", "));
    check("it reads as a dialog and keeps its name though its title says it", labels().includes("dialog:Settings"), labels().join(", "));
    check("the keyboard moves into it when it appears", mgr.FocusedNode === ok, `${mgr.FocusedNode?.AccessibilityLabel}`);
    check("Tab goes round inside it", mgr.NextTabStop(cancel, true) === ok && mgr.NextTabStop(ok, false) === cancel);
    const pid = canvas.OpenPopupWindow(button(0, 0, "In popup"), new SKPoint(20, 300)); frame(); frame();
    check("a popup window over the modal stays readable", labels().includes("button:In popup"), labels().join(", "));
    canvas.ClosePopupWindow(pid); frame(); frame();
    dialog.IsVisible = false; dialog.Update(); frame(); frame();
    check("when it goes, the page is back and the keyboard returns where it was", mgr.ActiveModal === undefined && labels().includes("button:Behind") && mgr.FocusedNode === behind, `${mgr.FocusedNode?.AccessibilityLabel}`);
    behind.NotifyAccessibilityFocused(false); frame();
    // arrows start keyboard navigation (off by default)
    key("ArrowDown"); frame();
    check("off by default: an arrow with nothing focused moves no focus", mgr.FocusedNode === undefined);
    canvas.ArrowsStartKeyboardNavigation = true;
    key("ArrowDown"); frame();
    check("on: ArrowDown with nothing focused goes to the first Tab stop", mgr.FocusedNode === behind, `${mgr.FocusedNode?.AccessibilityLabel}`);
    mgr.FocusedNode?.NotifyAccessibilityFocused(false); frame();
    key("ArrowUp"); frame();
    check("on: ArrowUp goes to the last Tab stop", mgr.FocusedNode === after, `${mgr.FocusedNode?.AccessibilityLabel}`);
    mgr.FocusedNode?.NotifyAccessibilityFocused(false); frame();
    dialog.IsVisible = true; dialog.Update(); frame(); frame(); behind.NotifyAccessibilityFocused(true); frame();
    key("ArrowDown"); frame();
    check("a control behind the active modal is no focus: the arrow starts inside the dialog", mgr.FocusedNode === ok, `${mgr.FocusedNode?.AccessibilityLabel}`);
    canvas.ArrowsStartKeyboardNavigation = false; dialog.IsVisible = false; dialog.Update(); frame(); frame();
    mgr.MinUpdateIntervalMs = 1000;
  }

  // ---- a menu whose items sit in several layouts (drawnui-cross 6ao rule 1b): the arrows walk them all in reading order ----
  {
    const mgr = canvas.AccessibilityManager;
    mgr.MinUpdateIntervalMs = 0;
    const item = (label: string) => { const b = new SkiaShape(); b.HeightRequest = 30; b.WidthRequest = 100; b.AccessibilityRole = "menuitem"; b.AccessibilityLabel = label; b.Tapped = () => {}; return b; };
    const column = (labels: string[]) => { const c = new SkiaStack(); c.Spacing = 4; for (const l of labels) c.AddSubView(item(l)); return c; };
    const panel = new SkiaLayer(); panel.AccessibilityRole = "menu"; panel.AccessibilityLabel = "Panel"; panel.WidthRequest = 260; panel.Margin = new Thickness(20, 20, 0, 0);
    const inner = new SkiaStack(); inner.Spacing = 6;
    const heading = new SkiaLabel(); heading.Text = "Recent"; heading.AccessibilityRole = "heading";
    const divider = new SkiaShape(); divider.HeightRequest = 1; divider.HorizontalOptions = "Fill"; divider.BackgroundColor = "#444444";
    const columns = new SkiaRow(); columns.Spacing = 20;
    const left = column(["A1", "A2"]), right = column(["B1", "B2"]);
    columns.AddSubView(left); columns.AddSubView(right);
    for (const c of [heading, divider, columns]) inner.AddSubView(c);
    panel.AddSubView(inner);
    const r = new SkiaLayer(); r.WidthRequest = W; r.HeightRequest = H; r.AddSubView(panel);
    canvas.Content = r; frame(); frame();
    const at = (label: string) => mgr.Snapshot.find((n) => n.Label === label)!.Source;
    const walk: string[] = [];
    at("A1").NotifyAccessibilityFocused(true);
    for (const k of ["ArrowDown", "ArrowDown", "ArrowDown", "ArrowUp", "End", "Home"]) {
      SkiaAccessibilityManager.Key(mgr.FocusedNode, k); frame(); frame();
      walk.push(mgr.FocusedNode?.AccessibilityLabel ?? "none");
    }
    // reading order: A1 and B1 share the first row, A2 and B2 the second
    check("a menu with items in several layouts: the arrows walk all of them in reading order", walk.join(" ") === "B1 A2 B2 A2 B2 A1", walk.join(" "));
    mgr.FocusedNode?.NotifyAccessibilityFocused(false);
    mgr.MinUpdateIntervalMs = 1000;
  }

  // ---- surfaces with their own pixels give them back (CanvasKit: dispose(), delete() keeps them) ----
  {
    const rss = () => (process as unknown as { memoryUsage(): { rss: number } }).memoryUsage().rss;
    canvas.TakeScreenShot();
    const before = rss();
    for (let i = 0; i < 100; i++) canvas.TakeScreenShot(); // 100 x 600 x 400 x 4 = 96 MB if each kept its pixels
    const grown = (rss() - before) / 1e6;
    check("screenshots give their surface's pixels back", grown < 30, `${grown.toFixed(0)} MB more`);
  }

  // ---- span underline in the label's color ----
  {
    const l = new SkiaLabel(); l.FontSize = 40; l.TextColor = "#FF0000"; l.Margin = new Thickness(10, 20, 0, 0);
    const s = new TextSpan(); s.Text = "File"; s.Underline = true; s.UnderlineWidth = 4; l.AddSubView(s);
    const r = new SkiaLayer(); r.WidthRequest = W; r.HeightRequest = H; r.BackgroundColor = "#000000"; r.AddSubView(l);
    canvas.Content = r; frame();
    const px = pixels();
    let red = 0, other = 0;
    // red letters and underline; anything with green or blue in it is another hue (C# drew the underline green-yellow)
    for (let i = 0; i < px.length; i += 4) { if (px[i] > 200 && px[i + 1] < 60 && px[i + 2] < 60) red++; else if (px[i + 1] > 80 || px[i + 2] > 80) other++; }
    check("a span without a color draws its underline in the label's color", red > 200 && other < 50, `red ${red}, other ${other}`);
  }

  canvas.Dispose();
  console.log(failures ? `FAIL: ${failures} checks` : "OK: tooltips and popup windows");
  process.exit(failures ? 1 : 0);
})();
