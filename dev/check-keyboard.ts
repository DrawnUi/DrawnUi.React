// Keyboard and accessibility contract of DrawnUi.Net (drawnui-cross 6c), checked in Node without a browser
// (`npm run check:keyboard`): reading order by rows, input eligibility (CanReceiveGesture), arrow-key groups (one Tab
// stop, arrows by index across recycled cells scrolled in on demand, a toolbar of buttons skipping a disabled one),
// keys to the focused control first (slider steps), Up / Down in a Wrap without Split by the first row's length,
// each name said once (a group card and its heading, a card button and its title), aria-disabled for a control role
// that takes no input, a drawn editor leaving the keys of other elements and of the input method alone (C# 845b26e9).
// The DOM overlay itself (roving tabindex, Tab out of an editor) needs the browser.
import { readFileSync } from "node:fs";
import {
  Super, SkiaScroll, SkiaStack, SkiaWrap, SkiaLayer, SkiaRow, SkiaButton, SkiaSlider, SkiaDynamicDrawnCell, SkiaLabel,
  SkiaAccessibilityManager, Aria, SKRect, Thickness, SkiaEditor, KeyboardManager, type SkiaControl, type AnimatorBase,
} from "../src/index.ts";

declare const CanvasKitInit: (o: { locateFile: () => string }) => Promise<any>;
const ROOT = process.cwd();
const W = 400, H = 900, SCALE = 1;

/** Stands in for the engine Canvas: what controls and animators call on their Superview. */
class FakeCanvas {
  readonly AccessibilityManager = new SkiaAccessibilityManager();
  readonly AnimatingControls = new Map<number, AnimatorBase>();
  RenderingScale = SCALE;
  Update(): void {}
  /** Skia objects are deleted after the frame, as the canvas does. */
  readonly disposeQueue: { Dispose(): void }[] = [];
  DisposeObject(o: { Dispose(): void }): void { this.disposeQueue.push(o); }
  RegisterAnimator(a: AnimatorBase): boolean { this.AnimatingControls.set(a.Uid, a); return true; }
  UnregisterAnimator(uid: number): void { this.AnimatingControls.delete(uid); }
}

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => { if (!ok) failures++; console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`); };

class Cell extends SkiaDynamicDrawnCell {
  private readonly label = new SkiaLabel();
  constructor() {
    super();
    this.HeightRequest = 40; this.AccessibilityRole = Aria.RoleButton; this.Tapped = () => {};
    this.label.AccessibilityRole = Aria.RolePresentation; this.AddSubView(this.label);
  }
  protected override SetContent(ctx: unknown): void { this.label.Text = `Item ${ctx}`; this.AccessibilityLabel = `Item ${ctx}`; }
}

(async () => {
  const CK = await CanvasKitInit({ locateFile: () => `${ROOT}/node_modules/canvaskit-wasm/bin/full/canvaskit.wasm` });
  (Super as any).CK = CK;
  const face = CK.Typeface.MakeFreeTypeFaceFromData(readFileSync(`${ROOT}/samples/public/fonts/OpenSans-Regular.ttf`).buffer);
  Super.Fonts.set("FontText", new Map([[400, face]]));
  Super.DefaultTypeface = face; Super.DefaultFontAlias = "FontText";

  // page: a row of buttons of different heights (reading order), a toolbar group, a slider, a recycled list group
  const page = new SkiaLayer();
  const fake = new FakeCanvas();
  (page as any)._superview = fake;
  const mgr = fake.AccessibilityManager;
  mgr.MinUpdateIntervalMs = 0;
  let focusRequested: SkiaControl | undefined;
  mgr.OnKeyboardFocusRequested((n) => { focusRequested = n; });

  const button = (text: string, h: number, tapped = true) => { const b = new SkiaButton(); b.Text = text; b.HeightRequest = h; b.WidthRequest = 80; b.VerticalOptions = "Center"; b.AccessibilityRole = Aria.RoleButton; if (tapped) b.Tapped = () => {}; return b; };
  const row = new SkiaRow(); row.Spacing = 8; row.HeightRequest = 60;
  const tall = button("Tall", 40), short1 = button("Short", 24), mid = button("Mid", 32); // tops 10 / 18 / 14: one row (C# rule), plain top order would read Tall, Mid, Short
  for (const b of [tall, short1, mid]) row.AddSubView(b);
  const toolbar = new SkiaWrap(); toolbar.AccessibilityRole = Aria.RoleToolbar; toolbar.Spacing = 6; toolbar.Margin = new Thickness(0, 70, 0, 0);
  const tools = ["HOME", "BACK", "OFF", "NEXT", "END"].map((t) => button(t, 30));
  tools[2].IsDisabled = true;
  for (const b of tools) toolbar.AddSubView(b);
  const slider = new SkiaSlider(); slider.Margin = new Thickness(0, 120, 0, 0); slider.WidthRequest = 300; slider.Min = 0; slider.Max = 50; slider.Step = 0; slider.End = 10;
  const locked = new SkiaLayer(); locked.Margin = new Thickness(0, 170, 0, 0); locked.HeightRequest = 30; locked.LockChildrenGestures = "PassNone";
  const lockedButton = button("Locked", 30); locked.AddSubView(lockedButton);
  const scroll = new SkiaScroll(); scroll.Orientation = "Vertical"; scroll.Margin = new Thickness(0, 220, 0, 0); scroll.HeightRequest = 300;
  const list = new SkiaStack(); list.AccessibilityRole = Aria.RoleList; list.RecyclingTemplate = "Enabled"; list.MeasureItemsStrategy = "MeasureFirst"; list.Spacing = 4;
  list.ItemTemplate = () => new Cell(); list.ItemsSource = Array.from({ length: 1000 }, (_, i) => i);
  scroll.Content = list;
  // a recycled templated Wrap, Split 3: a 2D group (all four arrows, Up / Down by one row)
  const grid = new SkiaWrap(); grid.AccessibilityRole = Aria.RoleGrid; grid.Split = 3; grid.Spacing = 4; grid.Margin = new Thickness(0, 530, 0, 0);
  grid.ItemTemplate = () => new Cell(); grid.ItemsSource = Array.from({ length: 9 }, (_, i) => 100 + i);
  // a Wrap without Split: 12 tiles, 10 per row
  const tiles = new SkiaWrap(); tiles.AccessibilityRole = Aria.RoleGrid; tiles.Spacing = 4; tiles.Margin = new Thickness(0, 670, 0, 0);
  const tileButtons = Array.from({ length: 12 }, (_, i) => { const b = button(`${i + 1}`, 20); b.WidthRequest = 36; return b; });
  for (const b of tileButtons) tiles.AddSubView(b);
  // names said once: a group card and its heading, a card button and its title text, a card button and a selectable title
  const text = (t: string, role: string, selectable = false) => { const l = new SkiaLabel(); l.Text = t; l.AccessibilityRole = role; l.AccessibilityTextSelectable = selectable; return l; };
  const card = (label: string, top: number, role: string, child: SkiaLabel) => {
    const c = new SkiaStack(); c.AccessibilityRole = role; c.AccessibilityLabel = label; c.Margin = new Thickness(0, top, 0, 0);
    if (role === Aria.RoleButton) c.Tapped = () => {};
    c.AddSubView(child); return c;
  };
  const groupTitle = text("Group card", Aria.RoleHeading), buttonTitle = text("Button card", Aria.RoleText), selectTitle = text("Select card", Aria.RoleText, true);
  const groupCard = card("Group card", 730, Aria.RoleGroup, groupTitle), buttonCard = card("Button card", 780, Aria.RoleButton, buttonTitle);
  const selectCard = card("Select card", 830, Aria.RoleButton, selectTitle);
  for (const c of [row, toolbar, slider, locked, scroll, grid, tiles, groupCard, buttonCard, selectCard]) page.AddSubView(c);

  const frame = () => {
    for (const a of [...fake.AnimatingControls.values()]) a.TickFrame(performance.now() * 1e6);
    const surface = CK.MakeSurface(W, H), canvas = surface.getCanvas();
    page.Measure(W, H, SCALE);
    page.Arrange(new SKRect(0, 0, W, H), page.WidthRequest, page.HeightRequest, SCALE);
    page.Render({ Context: { Canvas: canvas, Surface: surface }, Destination: new SKRect(0, 0, W, H), Scale: SCALE });
    surface.delete();
    for (const o of fake.disposeQueue.splice(0)) o.Dispose();
    mgr.OnFrameEnd(SCALE, W, H, () => {});
  };
  const frames = async (n: number) => { for (let i = 0; i < n; i++) { frame(); await new Promise((r) => setTimeout(r, 16)); } };
  await frames(3);

  // 4. reading order: a row of centered buttons of different heights reads left to right
  const order = mgr.Snapshot.map((n) => n.Label).filter((l) => l === "Tall" || l === "Short" || l === "Mid");
  check("reading order of a row of centered buttons", order.join() === "Tall,Short,Mid", order.join());

  // 3. eligibility: a disabled button and a button under LockChildrenGestures PassNone cannot interact
  check("disabled button is not interactive", !tools[2].AccessibilityCanInteract);
  check("PassNone ancestor locks the child", !lockedButton.AccessibilityCanInteract);
  page.InputTransparent = true;
  check("InputTransparent ancestor blocks", !tall.AccessibilityCanInteract);
  page.InputTransparent = false;
  check("plain button is interactive", tall.AccessibilityCanInteract);

  // 1. groups: one Tab stop per group
  const cells = () => mgr.Snapshot.filter((n) => SkiaAccessibilityManager.TryFindGroup(n.Source)?.Group === list);
  check("list: first item is the only Tab stop", cells().filter((n) => mgr.IsTabStop(n.Source)).map((n) => n.Label).join() === "Item 0", cells().filter((n) => mgr.IsTabStop(n.Source)).map((n) => n.Label).join());
  check("toolbar: one Tab stop", tools.filter((b) => mgr.IsTabStop(b)).map((b) => b.Text).join() === "HOME");
  check("buttons outside groups are Tab stops", mgr.IsTabStop(tall) && mgr.IsTabStop(mid));

  // arrows in the toolbar (a Wrap: all four), skipping the disabled button
  const press = async (node: SkiaControl, key: string) => { focusRequested = undefined; const used = SkiaAccessibilityManager.Key(node, key); await frames(4); if (focusRequested) mgr.NotifyFocused(focusRequested); return used; };
  mgr.NotifyFocused(tools[0]);
  await press(tools[0], "ArrowRight");
  check("toolbar ArrowRight -> BACK", (focusRequested as SkiaButton | undefined)?.Text === "BACK");
  await press(tools[1], "ArrowRight");
  check("toolbar ArrowRight skips the disabled button -> NEXT", (focusRequested as SkiaButton | undefined)?.Text === "NEXT");
  check("toolbar Tab stop follows focus", tools.filter((b) => mgr.IsTabStop(b)).map((b) => b.Text).join() === "NEXT");
  const atEnd = await press(tools[4], "ArrowRight");
  check("no wrap at the end (key still belongs to the group)", atEnd && !focusRequested);

  // 2. keys to the focused control first: the slider steps by a hundredth of its range (Step 0)
  SkiaAccessibilityManager.Key(slider, "ArrowRight");
  check("slider ArrowRight steps by range/100", Math.abs(slider.End - 10.5) < 1e-9, `${slider.End}`);
  SkiaAccessibilityManager.Key(slider, "PageUp");
  check("slider PageUp steps by range/10", Math.abs(slider.End - 15.5) < 1e-9, `${slider.End}`);
  SkiaAccessibilityManager.Key(slider, "Home");
  check("slider Home -> Min", slider.End === 0);

  // list: arrows by index, across cells not realized (scrolled in, then focused)
  const cellNode = (i: number) => list.ChildrenFactory.GetViewForIndex(i)!;
  mgr.NotifyFocused(cellNode(0));
  await press(cellNode(0), "ArrowDown");
  check("list ArrowDown -> Item 1", focusRequested?.AccessibilityLabel === "Item 1", focusRequested?.AccessibilityLabel);
  await press(focusRequested!, "End");
  await frames(30);
  check("list End -> Item 999 (scrolled in, then focused)", focusRequested?.AccessibilityLabel === "Item 999", `${focusRequested?.AccessibilityLabel}, offset ${scroll.ViewportOffsetY}`);
  const last = focusRequested!;
  await press(last, "PageUp");
  await frames(30);
  const pageItem = Number(focusRequested?.AccessibilityLabel?.slice(5));
  check("list PageUp moves one viewport up", pageItem < 999 && pageItem >= 990, `${focusRequested?.AccessibilityLabel}`);
  await press(focusRequested!, "Home");
  await frames(30);
  check("list Home -> Item 0", focusRequested?.AccessibilityLabel === "Item 0", focusRequested?.AccessibilityLabel);
  check("list Tab stop is the focused item", cells().filter((n) => mgr.IsTabStop(n.Source)).map((n) => n.Label).join() === "Item 0");

  // 2D group: Up / Down move one row (Split), Left / Right one item
  const gridCell = (i: number) => grid.ChildrenFactory.GetViewForIndex(i)!;
  mgr.NotifyFocused(gridCell(4));
  const moves: string[] = [];
  for (const key of ["ArrowDown", "ArrowUp", "ArrowUp", "ArrowLeft", "ArrowRight"]) {
    const from = (focusRequested && SkiaAccessibilityManager.TryFindGroup(focusRequested)?.Group === grid) ? focusRequested : gridCell(4);
    await press(from, key);
    moves.push(focusRequested?.AccessibilityLabel ?? "-");
  }
  check("grid Split 3: Down / Up by a row, Left / Right by an item", moves.join() === "Item 107,Item 104,Item 101,Item 100,Item 101", moves.join());

  // 2D group without Split: Up / Down by the length of the first row, also from the short last row
  mgr.NotifyFocused(tileButtons[11]);
  await press(tileButtons[11], "ArrowUp");
  check("wrap without Split: Up from 12 (short last row) -> 2", (focusRequested as SkiaButton | undefined)?.Text === "2", (focusRequested as SkiaButton | undefined)?.Text);
  await press(tileButtons[1], "ArrowDown");
  check("wrap without Split: Down from 2 -> 12", (focusRequested as SkiaButton | undefined)?.Text === "12", (focusRequested as SkiaButton | undefined)?.Text);

  // each name said once in the flat overlay
  const node = (c: SkiaControl) => mgr.Snapshot.find((n) => n.Source === c);
  check("group card has no name, its heading says it", !!node(groupCard) && node(groupCard)!.Label === undefined && node(groupTitle)?.Label === "Group card");
  check("card button keeps its name, its title text is left out", node(buttonCard)?.Label === "Button card" && !node(buttonTitle));
  check("selectable title text stays", node(selectCard)?.Label === "Select card" && !!node(selectTitle));

  // aria-disabled: a control role that takes no input, never a group or a text
  check("disabled button is Disabled and no Tab stop", node(tools[2])?.Disabled === true && !mgr.IsTabStop(tools[2]));
  check("enabled button, group and text are not Disabled", node(tools[0])?.Disabled === false && node(groupCard)?.Disabled === false && node(groupTitle)?.Disabled === false);

  // a drawn editor acts only on keys nothing else owns: the page or the canvas (its hidden textarea's keys arrive as
  // input events), never a page control's keys or an input method's (C# 845b26e9, GitHub #231)
  const editor = new SkiaEditor();
  let submitted = 0; editor.TextSubmitted = () => { submitted++; };
  const key = (code: string, tagName: string, extra: Partial<KeyboardEvent> = {}) => {
    const e = { code, key: code === "Space" ? " " : code, target: { tagName }, isComposing: false, keyCode: 0, defaultPrevented: false, ...extra } as KeyboardEvent & { defaultPrevented: boolean };
    (e as { preventDefault(): void }).preventDefault = () => { e.defaultPrevented = true; };
    return e;
  };
  const down = (e: KeyboardEvent) => { (editor as unknown as { OnKeyDown(k: string, e: KeyboardEvent): void }).OnKeyDown(e.code, e); return e.defaultPrevented; };
  const char = (ch: string, e: KeyboardEvent) => { (editor as unknown as { onKeyChar(c: string, e: KeyboardEvent): void }).onKeyChar(ch, e); return e.defaultPrevented; };
  editor.Text = "abc"; editor.CursorPosition = 3;
  check("page keys: Backspace deletes and is taken", down(key("Backspace", "BODY")) && editor.Text === "ab", editor.Text);
  check("a page button keeps Enter (no submit, not taken)", !down(key("Enter", "BUTTON")) && submitted === 0);
  check("a page input keeps Backspace", !down(key("Backspace", "INPUT")) && editor.Text === "ab", editor.Text);
  check("an overlay node keeps its arrows", !down(key("ArrowLeft", "DIV")) && editor.CursorPosition === 2, `${editor.CursorPosition}`);
  check("a page select keeps a typed character", !char("x", key("KeyX", "SELECT")) && editor.Text === "ab", editor.Text);
  check("a canvas key types", char("x", key("KeyX", "CANVAS")) && editor.Text === "abx", editor.Text);
  check("an IME composition keeps its arrows", !down(key("ArrowLeft", "TEXTAREA", { isComposing: true })) && editor.CursorPosition === 3, `${editor.CursorPosition}`);
  check("an IME composition keeps Escape (editor stays focused)", !down(key("Escape", "BODY", { keyCode: 229 } as Partial<KeyboardEvent>)));
  check("a soft keyboard's Unidentified key is not acted on", !down(key("Backspace", "BODY", { key: "Unidentified" })) && editor.Text === "abx", editor.Text);
  check("Backspace is Backspace, Delete is Delete", KeyboardManager.IsOwnedByElement(key("Backspace", "HTML")) === false
    && (editor.CursorPosition = 1, down(key("Delete", "BODY")) && editor.Text === "ax"), editor.Text);

  console.log(failures ? `FAIL: ${failures} checks` : "OK: keyboard contract");
  process.exit(failures ? 1 : 0);
})();
