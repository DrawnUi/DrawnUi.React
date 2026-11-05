import { type ReactNode, useEffect, useRef, useState } from "react";
import {
  Aria, Colors, OpenPopupWindow, SkiaLabel, SkiaLayer, SkiaRow, SkiaScroll, SkiaShape, SkiaStack, SkiaSvg, SkiaSwitch,
  SkiaWrap, TextSpan, Thickness,
} from "drawnui-react";
import { type Canvas as CanvasView, type ControlTappedEventArgs, type InputKey, KeyboardManager, type PopupId, Super, type SkiaControl, type SkiaShape as SkiaShapeCtrl } from "drawnui-react/core";

/**
 * Tooltips & Menus (HelloMaui Pages/TooltipsMenusPage.cs): a desktop menu bar, a context menu (right-click anywhere on
 * the page) and a dropdown opened as popup windows, then tooltips on any control, TooltipsFromAccessibility for icon
 * buttons.
 */
const CARD = "#2B3035", BUTTON = "#373B3E", BUTTON_HOVER = "#495057", MUTED = "#ADB5BD", ACCENT = "#6EA8FE";
/** The menus' selected color, and the accent edge of an open menu's title (the keyboard's place gets the focus ring). */
const PANEL = "#262B3B", PANEL_STROKE = "#3B4256", HIGHLIGHT = "#343B52", KEYBOARD_EDGE = "#0D6EFD";

const ICON_NEW = "<svg viewBox='0 0 24 24'><path fill='#fff' d='M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zm4 18H6V4h7v5h5zM11 11h2v3h3v2h-3v3h-2v-3H8v-2h3z'/></svg>";
const ICON_OPEN = "<svg viewBox='0 0 24 24'><path fill='#fff' d='M20 6h-8l-2-2H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2m0 12H4V8h16z'/></svg>";
const ICON_SAVE = "<svg viewBox='0 0 24 24'><path fill='#fff' d='M17 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V7zm2 16H5V5h11.17L19 7.83zM12 12a3 3 0 1 0 0 6 3 3 0 0 0 0-6M6 6h9v4H6z'/></svg>";
const ICON_SETTINGS = "<svg viewBox='0 0 24 24'><path fill='#fff' d='M19.4 13a7.5 7.5 0 0 0 0-2l2.1-1.6-2-3.5-2.5 1a7.6 7.6 0 0 0-1.7-1L15 3h-4l-.4 2.9a7.6 7.6 0 0 0-1.7 1l-2.5-1-2 3.5L6.6 11a7.5 7.5 0 0 0 0 2l-2.1 1.6 2 3.5 2.5-1a7.6 7.6 0 0 0 1.7 1L11 21h4l.4-2.9a7.6 7.6 0 0 0 1.7-1l2.5 1 2-3.5zM13 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7'/></svg>";
const ICON_DELETE = "<svg viewBox='0 0 24 24'><path fill='#fff' d='M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6zm2-10h8v10H8zm7.5-5-1-1h-5l-1 1H5v2h14V4z'/></svg>";
const ICON_INFO = "<svg viewBox='0 0 24 24'><path fill='#fff' d='M11 7h2v2h-2zm0 4h2v6h-2zm1-9a10 10 0 1 0 0 20 10 10 0 0 0 0-20m0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16'/></svg>";

/** One line of a menu bar menu; no Text = a separator. */
interface MenuEntry { Text?: string; Shortcut?: string; Key?: InputKey; Ctrl?: boolean }
interface BarMenu { Title: string; Accelerator: InputKey; Entries: MenuEntry[] }
const entry = (Text: string, Shortcut?: string, Key?: InputKey, Ctrl = true): MenuEntry => ({ Text, Shortcut, Key, Ctrl });
const SEPARATOR: MenuEntry = {};
const MENUS: BarMenu[] = [
  { Title: "File", Accelerator: "KeyF", Entries: [entry("New", "Ctrl+N", "KeyN"), entry("Open…", "Ctrl+O", "KeyO"), entry("Save", "Ctrl+S", "KeyS"), SEPARATOR, entry("Close", "Ctrl+W", "KeyW")] },
  { Title: "Edit", Accelerator: "KeyE", Entries: [entry("Undo", "Ctrl+Z", "KeyZ"), entry("Redo", "Ctrl+Y", "KeyY"), SEPARATOR, entry("Cut", "Ctrl+X", "KeyX"), entry("Copy", "Ctrl+C", "KeyC"), entry("Paste", "Ctrl+V", "KeyV")] },
  { Title: "View", Accelerator: "KeyV", Entries: [entry("Zoom in", "Ctrl+=", "Equal"), entry("Zoom out", "Ctrl+-", "Minus"), SEPARATOR, entry("Full screen", "F11", "F11", false)] },
  { Title: "Help", Accelerator: "KeyH", Entries: [entry("Documentation", "F1", "F1", false), SEPARATOR, entry("About")] },
];

const PAGE_PADDING = new Thickness(16), CARD_PADDING = new Thickness(20, 16), BAR_PADDING = new Thickness(4);
const TITLE_PADDING = new Thickness(12, 6), ITEM_PADDING = new Thickness(12, 7), BUTTON_PADDING = new Thickness(16, 9);
const SEPARATOR_MARGIN = new Thickness(8, 4), ROW_LABEL_MARGIN = new Thickness(12, 0);

/** A card of the page: a caption in the accent color, a note, then its content. */
function Card({ title, note, children }: { title: string; note: string; children: ReactNode }) {
  return (
    <SkiaShape HorizontalOptions="Fill" CornerRadius={12} BackgroundColor={CARD} StrokeColor="#373B3E" StrokeWidth={1} Padding={CARD_PADDING}
      UseCache="Operations" AccessibilityRole={Aria.RoleGroup} AccessibilityLabel={title}>
      <SkiaStack Spacing={12}>
        <SkiaLabel Text={title.toUpperCase()} FontSize={12} FontAttributes="Bold" TextColor={ACCENT} AccessibilityRole={Aria.RoleHeading} />
        <SkiaLabel Text={note} FontSize={13} TextColor={MUTED} HorizontalOptions="Fill" />
        {children}
      </SkiaStack>
    </SkiaShape>
  );
}

/** Every mouse button taps: opening and picking act on the primary one (keys and touch count as primary). */
const primary = (e: ControlTappedEventArgs) => (e.Parameters.Event.Pointer?.Button ?? "Left") === "Left";

const hoverButton = (me: SkiaControl, on: boolean) => { (me as SkiaShapeCtrl).BackgroundColor = on ? BUTTON_HOVER : BUTTON; me.UpdateDraw(); };

/** A text button in the page's colors. */
function TextButton({ text, tooltip, tapped }: { text: string; tooltip?: string; tapped?: (me: SkiaControl) => void }) {
  return (
    <SkiaShape CornerRadius={8} BackgroundColor={BUTTON} Padding={BUTTON_PADDING} AnimationTapped="Ripple" AccessibilityRole={Aria.RoleButton}
      AccessibilityLabel={text} Tooltip={tooltip} HoverChanged={hoverButton} Tapped={(me, e) => { if (primary(e)) tapped?.(me); }}>
      <SkiaLabel Text={text} FontSize={14} TextColor={Colors.White} />
    </SkiaShape>
  );
}

/** An icon button without text: its tooltip is its accessibility label (TooltipsFromAccessibility). */
function IconButton({ svg, label, tooltip, end }: { svg: string; label?: string; tooltip?: string; end?: boolean }) {
  return (
    <SkiaShape WidthRequest={40} HeightRequest={40} CornerRadius={8} BackgroundColor={BUTTON} AnimationTapped="Ripple" AccessibilityRole={Aria.RoleButton}
      AccessibilityLabel={label} Tooltip={tooltip} HorizontalOptions={end ? "End" : "Start"} HoverChanged={hoverButton} Tapped={() => {}}>
      <SkiaSvg SvgString={svg} WidthRequest={20} HeightRequest={20} TintColor={Colors.White} HorizontalOptions="Center" VerticalOptions="Center" />
    </SkiaShape>
  );
}

/** A menu as in DrawnUI for Rust's popups example: a rounded panel of items; picking one closes it. */
function MenuPanel({ name, items, picked }: { name: string; items: string[]; picked: (text: string, me: SkiaControl) => void }) {
  return (
    <SkiaShape CornerRadius={8} BackgroundColor={PANEL} StrokeColor={PANEL_STROKE} StrokeWidth={1.5} WidthRequest={200} Padding={BAR_PADDING}
      AccessibilityRole={Aria.RoleMenu} AccessibilityLabel={name}>
      <SkiaStack Spacing={0}>
        {items.map((text) => (
          <SkiaShape key={text} CornerRadius={6} HorizontalOptions="Fill" Padding={ITEM_PADDING} AccessibilityRole={Aria.RoleMenuItem} AccessibilityLabel={text}
            HoverChanged={(me, on) => { (me as SkiaShapeCtrl).BackgroundColor = on ? HIGHLIGHT : Colors.Transparent; me.UpdateDraw(); }} Tapped={(me, e) => { if (primary(e)) picked(text, me); }}>
            <SkiaLabel Text={text} FontSize={15} TextColor={Colors.White} AccessibilityRole={Aria.RolePresentation} />
          </SkiaShape>
        ))}
      </SkiaStack>
    </SkiaShape>
  );
}

export function MenusPage() {
  const [picked, setPicked] = useState("Nothing picked yet");
  const [command, setCommand] = useState("Last command: none");
  const menu = useRef<PopupId>(0);

  // the page shows icon buttons' accessibility labels as tooltips (switch in the Icon toolbar card)
  useEffect(() => { Super.TooltipsFromAccessibility = true; }, []);

  /** A context menu or the dropdown: picking a line shows it and closes the menu. */
  const pick = (text: string, me: SkiaControl) => { setPicked(`Picked: ${text}`); me.Superview?.ClosePopupWindow(menu.current); };
  const openMenu = (canvas: CanvasView | undefined, name: string, items: string[], anchor: Parameters<typeof OpenPopupWindow>[2]) => {
    if (canvas) menu.current = OpenPopupWindow(canvas, <MenuPanel name={name} items={items} picked={pick} />, anchor);
  };

  // ---- menu bar, as DrawnUI Designer's (ToolBox 3826151 + b793169): Alt alone puts the keyboard on the bar; on the bar
  // Left / Right go round the titles and Down, Enter or Space open one on its first line; in a menu Up / Down / Home / End
  // go round its lines, Right / Left open the next / previous menu, Enter or Space run the line, Escape closes one level;
  // Alt again, or Escape on the bar, gives the keyboard back. The keyboard's place reads selected (the menus' selected
  // color, ringed by the focus ring), an open menu's title is edged in the accent, the mouse keeps its light hover look, and a mouse resting under a menu that opens or
  // closes moves nothing. ----
  const tops = useRef<SkiaShapeCtrl[]>([]);
  const bar = useRef({
    active: false,     // the keyboard drives the menu bar
    title: -1,         // the title the keyboard is on (no menu open)
    open: -1,          // the open menu
    line: -1,          // the line the keyboard lit in the open menu
    hoverTitle: -1, hoverLine: -1,
    back: undefined as SkiaControl | undefined, // where the keyboard was before the bar took it
    closing: false, altAlone: false, keyAt: 0, mouseAt: 0,
    popup: 0 as PopupId, items: [] as { View: SkiaShapeCtrl; Entry: MenuEntry }[], canvas: undefined as CanvasView | undefined,
  });
  const canvasOf = () => tops.current[0]?.Superview;
  const barOpen = () => { const b = bar.current; return b.open >= 0 && !!b.canvas?.IsPopupWindowOpen(b.popup); };
  /** A real mouse move since the last key: a resting mouse under a menu that opened or closed changes nothing. */
  const mouseMoved = () => bar.current.mouseAt > bar.current.keyAt;
  const paintBar = () => {
    const b = bar.current, open = barOpen() ? b.open : -1;
    tops.current.forEach((t, i) => {
      const selected = i === open || (b.active && open < 0 && i === b.title);
      t.BackgroundColor = selected ? HIGHLIGHT : i === b.hoverTitle ? BUTTON_HOVER : Colors.Transparent;
      t.StrokeColor = i === open ? KEYBOARD_EDGE : Colors.Transparent;
      t.AccessibilityExpanded = i === open;
      t.UpdateDraw();
    });
  };
  const paintItems = () => bar.current.items.forEach((it, i) => {
    const b = bar.current, selected = i === b.line;
    it.View.BackgroundColor = selected || i === b.hoverLine ? HIGHLIGHT : Colors.Transparent;
    it.View.UpdateDraw();
  });
  /** The keyboard and the screen reader go to `control` (undefined: back to the canvas, the keys are the app's). */
  const focus = (control?: SkiaControl) => canvasOf()?.SetAccessibilityFocus(control);
  /** The line an arrow moves to: round past either end; Home and End the first and last (every Hello line can act). */
  const step = (count: number, from: number, key: InputKey) =>
    key === "Home" || (key === "ArrowDown" && from < 0) ? 0 : key === "End" || (key === "ArrowUp" && from < 0) ? count - 1
      : key === "ArrowDown" ? (from + 1) % count : (from - 1 + count) % count;
  const isBarControl = (c?: SkiaControl) => !!c && (tops.current.includes(c as SkiaShapeCtrl) || bar.current.items.some((it) => it.View === c));
  /** The keyboard comes to the bar, remembering where it was to give it back. */
  const enterBar = (title: number) => {
    const b = bar.current;
    if (!b.active) {
      const focused = canvasOf()?.AccessibilityManager.FocusedNode;
      b.active = true; b.back = isBarControl(focused) ? undefined : focused;
    }
    b.title = title;
  };
  /** The bar lets go: menus closed, the keyboard back where it was (nowhere before: the keys are the app's again). */
  const leaveBar = () => {
    const b = bar.current;
    closeMenu();
    const back = b.back;
    b.active = false; b.title = -1; b.back = undefined;
    paintBar();
    const canvas = canvasOf();
    canvas?.SetAccessibilityFocus(back); // wins over the canvas' return to the closed menu's title; undefined cancels it
    if (canvas && !back) canvas.KeyboardFocusNode = undefined;
  };
  /**
   * A menu closed by the canvas: Escape (the canvas takes it first) closes one level, the keyboard on its title; a click
   * elsewhere, the wheel or the window losing focus lets the bar go.
   */
  const onClosed = (id: PopupId) => {
    const b = bar.current;
    if (id !== b.popup || b.open < 0 || b.closing) return;
    const t = b.open;
    b.open = -1; b.line = -1; b.hoverLine = -1;
    if (KeyboardManager.IsDispatchingKeyDown) { enterBar(t); paintBar(); focus(tops.current[t]); }
    else if (b.active) leaveBar(); else paintBar();
  };
  const closeMenu = () => {
    const b = bar.current;
    b.closing = true;
    try { b.canvas?.ClosePopupWindow(b.popup); } finally { b.closing = false; }
    b.open = -1; b.line = -1; b.hoverLine = -1;
    paintBar();
  };
  const run = (e: MenuEntry) => {
    const title = MENUS.find((m) => m.Entries.includes(e))!.Title;
    setCommand(e.Shortcut ? `Last command: ${title} › ${e.Text} (${e.Shortcut})` : `Last command: ${title} › ${e.Text}`);
    if (bar.current.active) leaveBar(); else closeMenu();
  };
  const openBarMenu = (index: number, keyboard: boolean) => {
    const b = bar.current, canvas = tops.current[index]?.Superview;
    if (!canvas) return;
    if (b.canvas !== canvas) { b.canvas?.PopupWindowClosed.delete(onClosed); b.canvas = canvas; canvas.PopupWindowClosed.add(onClosed); }
    b.closing = true;
    try { canvas.ClosePopupWindow(b.popup); } finally { b.closing = false; }
    b.items = [];
    b.open = index; b.title = -1; b.hoverLine = -1;
    const m = MENUS[index];
    let item = 0;
    b.popup = OpenPopupWindow(canvas, (
      <SkiaShape CornerRadius={8} BackgroundColor={PANEL} StrokeColor={PANEL_STROKE} StrokeWidth={1.5} WidthRequest={240} Padding={BAR_PADDING}
        AccessibilityRole={Aria.RoleMenu} AccessibilityLabel={m.Title}>
        <SkiaStack Spacing={0}>
          {m.Entries.map((e, k) => {
            if (!e.Text) return <SkiaShape key={k} HeightRequest={1} HorizontalOptions="Fill" BackgroundColor={PANEL_STROKE} Margin={SEPARATOR_MARGIN} />;
            const at = item++;
            return (
              <SkiaShape key={k} CornerRadius={6} HorizontalOptions="Fill" Padding={ITEM_PADDING}
                AccessibilityRole={Aria.RoleMenuItem} AccessibilityLabel={e.Text}
                ref={(v: SkiaShapeCtrl | null) => { if (v) bar.current.items[at] = { View: v, Entry: e }; }}
                HoverChanged={(_, on) => {
                  if (!mouseMoved()) return;
                  const bb = bar.current;
                  bb.hoverLine = on ? at : bb.hoverLine === at ? -1 : bb.hoverLine;
                  paintItems();
                }}
                Tapped={(_, t) => { if (primary(t)) run(e); }}>
                <SkiaLabel Text={e.Text} FontSize={14} TextColor={Colors.White} AccessibilityRole={Aria.RolePresentation} />
                <SkiaLabel Text={e.Shortcut ?? ""} FontSize={13} TextColor={MUTED} HorizontalOptions="End" AccessibilityRole={Aria.RolePresentation} />
              </SkiaShape>
            );
          })}
        </SkiaStack>
      </SkiaShape>
    ), tops.current[index]);
    b.line = keyboard ? step(b.items.length, -1, "Home") : -1;
    paintItems();
    paintBar();
    if (keyboard && b.line >= 0) focus(b.items[b.line].View);
  };

  useEffect(() => {
    const NAV = ["ArrowDown", "ArrowUp", "Home", "End", "ArrowLeft", "ArrowRight", "Enter", "NumpadEnter", "Space", "Escape"];
    const onKey = (key: InputKey, e: KeyboardEvent) => {
      const b = bar.current;
      const isAlt = key === "AltLeft" || key === "AltRight";
      // Alt alone (pressed and let go) puts the keyboard on the bar; anything pressed with it is no "Alt alone"
      b.altAlone = isAlt && !e.ctrlKey && !e.shiftKey && !e.metaKey;
      if (isAlt) return;
      // keys of a page element are not ours; keys of this canvas' own controls in keyboard focus (Tab) are
      const canvas = canvasOf();
      const focused = canvas?.AccessibilityManager.FocusedNode;
      const drawn = !!focused && focused.Superview === canvas;
      if (KeyboardManager.IsOwnedByElement(e) && !drawn) return;
      // the canvas navigation had the key first: Enter / Space it used (activated the focused title or line) are done
      const take = () => { e.preventDefault(); b.keyAt = performance.now(); };
      const handled = KeyboardManager.IsKeyHandled;
      // Alt + the first letter of a menu opens it on its first line
      if (KeyboardManager.IsAltPressed) {
        const index = MENUS.findIndex((m) => m.Accelerator === key);
        if (index >= 0) { take(); enterBar(index); openBarMenu(index, true); }
        return;
      }
      const n = MENUS.length;
      if (!barOpen()) {
        // a title reached with Tab: the arrows, Down, Enter and Space work as on the bar
        const titleFocused = tops.current.findIndex((t) => t === focused);
        if (!b.active && titleFocused >= 0 && NAV.includes(key) && key !== "Escape") { b.active = true; b.back = undefined; b.title = titleFocused; }
        if (b.active && !e.ctrlKey && !e.metaKey) {
          switch (key) {
            case "ArrowLeft": case "ArrowRight":
              take(); b.title = (b.title + (key === "ArrowRight" ? 1 : n - 1)) % n; paintBar(); focus(tops.current[b.title]); return;
            case "ArrowDown": case "Enter": case "NumpadEnter": case "Space":
              take(); if (key === "ArrowDown" || !handled) openBarMenu(b.title, true); return;
            case "Escape": take(); if (!handled) leaveBar(); return; // handled: the canvas closed the menu, one level
            case "Tab": b.active = false; b.title = -1; b.back = undefined; paintBar(); return; // the keyboard moves on: the bar lets go
          }
        }
        // the shortcuts work with the menus closed (the browser keeps a few for itself: Ctrl+N, Ctrl+W, Ctrl+T)
        const ctrl = KeyboardManager.IsControlPressed;
        const found = MENUS.flatMap((m) => m.Entries).find((x) => x.Text && x.Key === key && (x.Ctrl ?? true) === ctrl);
        if (found) { take(); run(found); }
        return;
      }
      if (!NAV.includes(key) || e.ctrlKey || e.metaKey) return;
      take();
      // a menu the mouse opened: the keyboard comes along
      if (!b.active) enterBar(-1);
      switch (key) {
        case "ArrowDown": case "ArrowUp": case "Home": case "End":
          b.line = step(b.items.length, b.line, key); paintItems(); focus(b.items[b.line].View); break;
        case "ArrowRight": openBarMenu((b.open + 1) % n, true); break;
        case "ArrowLeft": openBarMenu((b.open - 1 + n) % n, true); break;
        case "Enter": case "NumpadEnter": case "Space": if (b.line >= 0 && !handled) run(b.items[b.line].Entry); break;
        case "Escape": { const t = b.open; closeMenu(); b.title = t; paintBar(); focus(tops.current[t]); break; } // one level: back on its title
      }
    };
    const onUp = (key: InputKey, e: KeyboardEvent) => {
      const b = bar.current;
      if ((key !== "AltLeft" && key !== "AltRight") || !b.altAlone) return;
      b.altAlone = false;
      const focused = canvasOf()?.AccessibilityManager.FocusedNode;
      if (KeyboardManager.IsOwnedByElement(e) && !(focused && focused.Superview === canvasOf())) return; // a page field keeps its keys
      e.preventDefault(); b.keyAt = performance.now();
      if (b.active || barOpen()) leaveBar();
      else { enterBar(0); paintBar(); focus(tops.current[0]); }
    };
    const onChar = () => {};
    const onMove = () => { bar.current.mouseAt = performance.now(); };
    KeyboardManager.Subscribe(onKey, onChar, onUp);
    window.addEventListener("pointermove", onMove, true);
    return () => {
      KeyboardManager.Unsubscribe(onKey, onChar, onUp);
      window.removeEventListener("pointermove", onMove, true);
      const b = bar.current;
      b.canvas?.PopupWindowClosed.delete(onClosed);
      b.canvas?.ClosePopupWindows();
    };
    // the handlers read refs only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <SkiaLayer HorizontalOptions="Fill" VerticalOptions="Fill"
      ContextMenu={(me, e) => { openMenu(me.Superview, "Edit", ["Cut", "Copy", "Paste", "Select all", "Settings…"], e.Location); return true; }}>
      <SkiaScroll Orientation="Vertical" HorizontalOptions="Fill" VerticalOptions="Fill">
        <SkiaStack Spacing={16} Padding={PAGE_PADDING} HorizontalOptions="Center" MaximumWidthRequest={720}>
          {/* the shell bar says the page name: this title is presentation, so a screen reader reads the name once (hello-app rule) */}
          <SkiaLabel Text="Tooltips & Menus" FontSize={24} TextColor={Colors.White} HorizontalOptions="Fill" HorizontalTextAlignment="Center" AccessibilityRole={Aria.RolePresentation} />
          <SkiaLabel Text="A desktop menu bar, a context menu (right-click anywhere on the page) and a dropdown, then tooltips: rest the mouse on a control, move along a row and the next one shows at once; a click, the wheel or a key closes it."
            FontSize={14} TextColor="#D3D3D3" HorizontalOptions="Fill" HorizontalTextAlignment="Center" />

          <Card title="Menu bar" note="Click a menu, press Alt with its first letter (Alt+F, Alt+E, Alt+V, Alt+H), or press Alt alone to put the keyboard on the bar: Left and Right go round the menus, Down or Enter opens one, Up and Down go round its lines, Enter picks, Escape closes one level, Alt again leaves. The shortcuts (Ctrl+S, Ctrl+O, F1...) work with the menus closed too.">
            <SkiaShape HorizontalOptions="Fill" CornerRadius={8} BackgroundColor={BUTTON} Padding={BAR_PADDING}>
              <SkiaRow Spacing={2} AccessibilityRole={Aria.RoleMenuBar} AccessibilityLabel="Menu bar">
                {MENUS.map((m, index) => (
                  <SkiaShape key={m.Title} CornerRadius={6} Padding={TITLE_PADDING} BackgroundColor={Colors.Transparent} StrokeWidth={1.5} StrokeColor={Colors.Transparent}
                    AccessibilityRole={Aria.RoleMenuItem} AccessibilityLabel={m.Title} AccessibilityExpanded={false}
                    ref={(v: SkiaShapeCtrl | null) => { if (v) tops.current[index] = v; }}
                    HoverChanged={(_, on) => {
                      if (!mouseMoved()) return; // a resting mouse under a menu that opened or closed moves nothing
                      const b = bar.current;
                      b.hoverTitle = on ? index : b.hoverTitle === index ? -1 : b.hoverTitle;
                      if (on && barOpen() && b.open !== index) openBarMenu(index, false); else paintBar();
                    }}
                    Tapped={(_, e) => {
                      if (!primary(e)) return;
                      // Enter / Space of keyboard navigation or a screen reader on the focused title: as on the bar
                      const keyboard = canvasOf()?.KeyboardFocusNode === tops.current[index];
                      if (barOpen() && bar.current.open === index) { closeMenu(); if (keyboard) { enterBar(index); paintBar(); } }
                      else { if (keyboard) enterBar(index); openBarMenu(index, keyboard); }
                    }}>
                    {/* the accelerator letter (Alt + it opens the menu) is underlined, as in desktop menu bars */}
                    <SkiaLabel FontSize={14} TextColor={Colors.White} AccessibilityRole={Aria.RolePresentation}>
                      <TextSpan Text={m.Title.slice(0, 1)} Underline />
                      <TextSpan Text={m.Title.slice(1)} />
                    </SkiaLabel>
                  </SkiaShape>
                ))}
              </SkiaRow>
            </SkiaShape>
            <SkiaLabel Text={command} FontSize={14} TextColor={Colors.White} AccessibilityRole={Aria.RoleStatus} AccessibilityLive={Aria.LivePolite} />
          </Card>

          <Card title="Context menu and dropdown" note="Right-click anywhere on the page: the menu opens where you clicked. The button opens a list below it. A click outside or Escape closes them.">
            <TextButton text="Choose a fruit" tapped={(me) => openMenu(me.Superview, "Fruits", ["Apple", "Banana", "Cherry", "Grape", "Mango", "Orange", "Peach", "Pear"], me)} />
            <SkiaLabel Text={picked} FontSize={14} TextColor={Colors.White} AccessibilityRole={Aria.RoleStatus} AccessibilityLive={Aria.LivePolite} />
          </Card>

          <Card title="Icon toolbar" note="No Tooltip set: the text is each button's AccessibilityLabel (TooltipsFromAccessibility, switch below).">
            <SkiaRow Spacing={6} AccessibilityRole={Aria.RoleToolbar} AccessibilityLabel="File tools">
              <IconButton svg={ICON_NEW} label="New file" />
              <IconButton svg={ICON_OPEN} label="Open" />
              <IconButton svg={ICON_SAVE} label="Save" />
              <IconButton svg={ICON_SETTINGS} label="Settings" />
              <IconButton svg={ICON_DELETE} label="Delete" />
            </SkiaRow>
            <SkiaRow Spacing={12}>
              <SkiaSwitch IsToggled AccessibilityLabel="Tooltips from accessibility text" VerticalOptions="Center"
                ColorFrameOn="#0D6EFD" ColorFrameOff={BUTTON_HOVER} ColorThumbOn={Colors.White} ColorThumbOff={Colors.White}
                Toggled={(_, on) => { Super.TooltipsFromAccessibility = on; }} />
              <SkiaLabel Text="Tooltips from accessibility text" FontSize={14} TextColor={Colors.White} VerticalOptions="Center" AccessibilityRole={Aria.RolePresentation} />
            </SkiaRow>
          </Card>

          <Card title="Explicit tooltips" note="Set with Tooltip=&quot;...&quot;. The last one is long: it wraps at the maximum width.">
            <SkiaWrap Spacing={10}>
              <TextButton text="Publish" tooltip="Uploads the current version" />
              <TextButton text="Preview" tooltip="Opens a live preview" />
              <TextButton text="Share" tooltip="Copies a link to this project" />
              <TextButton text="Long text" tooltip="This tooltip is long on purpose: it wraps at the maximum width of 320 points, so you can see how a tooltip with several lines looks." />
            </SkiaWrap>
          </Card>

          <Card title="Near the window edge" note="Rest on the icon at the right. On Windows the tooltip opens in a window of its own and can go past the edge of the app window; on phones, tablets and in the browser it stays inside the app.">
            <SkiaLayer HorizontalOptions="Fill" HeightRequest={44}>
              <IconButton svg={ICON_INFO} end label="Information" tooltip="This tooltip opens near the right edge of the window and is long enough to reach it" />
            </SkiaLayer>
          </Card>

          <Card title="Scrolling closes it" note="Rest on a row, then scroll this list with the wheel.">
            <SkiaShape HorizontalOptions="Fill" HeightRequest={220} CornerRadius={8} BackgroundColor="#212529" IsClippedToBounds>
              <SkiaScroll Orientation="Vertical" HorizontalOptions="Fill" VerticalOptions="Fill">
                <SkiaStack Spacing={1}>
                  {Array.from({ length: 30 }, (_, k) => k + 1).map((i) => (
                    <SkiaLayer key={i} HeightRequest={36} HorizontalOptions="Fill" BackgroundColor={CARD} Tooltip={`Details of row ${i}`}>
                      <SkiaLabel Text={`Row ${i}`} FontSize={14} TextColor={Colors.White} Margin={ROW_LABEL_MARGIN} VerticalOptions="Center" />
                    </SkiaLayer>
                  ))}
                </SkiaStack>
              </SkiaScroll>
            </SkiaShape>
          </Card>
        </SkiaStack>
      </SkiaScroll>
    </SkiaLayer>
  );
}
