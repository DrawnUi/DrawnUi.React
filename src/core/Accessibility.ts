import type { InputKey } from "./KeyboardManager";
import type { SkiaControl } from "./SkiaControl";
import { SKRect } from "./Types";

/** ARIA role constants (DrawnUi.Models.Aria) for `AccessibilityRole`. */
export const Aria = {
  // interactive widgets
  RoleButton: "button", RoleLink: "link", RoleCheckbox: "checkbox", RoleRadio: "radio", RoleSwitch: "switch",
  RoleSlider: "slider", RoleSpinButton: "spinbutton", RoleTextBox: "textbox", RoleSearchBox: "searchbox",
  RoleComboBox: "combobox", RoleListBox: "listbox", RoleOption: "option", RoleTab: "tab", RoleTabPanel: "tabpanel",
  RoleTabList: "tablist", RoleMenu: "menu", RoleMenuItem: "menuitem", RoleMenuItemCheckbox: "menuitemcheckbox",
  RoleMenuItemRadio: "menuitemradio", RoleScrollBar: "scrollbar",
  // structure & landmarks
  RoleText: "text", RoleHeading: "heading", RoleImg: "img", RoleList: "list", RoleListItem: "listitem",
  RoleSeparator: "separator", RoleProgressBar: "progressbar", RoleTooltip: "tooltip", RoleDialog: "dialog",
  RoleAlertDialog: "alertdialog", RoleStatus: "status", RoleAlert: "alert", RoleGroup: "group", RoleRegion: "region",
  RoleNavigation: "navigation", RoleMain: "main",
  // containers of items: with one of these roles a layout is an arrow-key group (IsCompositeRole)
  RoleGrid: "grid", RoleToolbar: "toolbar", RoleRadioGroup: "radiogroup", RoleMenuBar: "menubar",
  /** Removes the control from the accessibility tree even when a default role would apply (inner label of a button). */
  RolePresentation: "presentation",
  // live regions
  LivePolite: "polite", LiveAssertive: "assertive",
  /**
   * Container roles whose items the arrow keys walk (C# Aria.IsCompositeRole): a layout with one of them is one Tab stop,
   * its current item, and the arrow keys move between its items.
   */
  IsCompositeRole(role?: string): boolean {
    return role === "list" || role === "listbox" || role === "grid" || role === "toolbar" || role === "radiogroup"
      || role === "tablist" || role === "menu" || role === "menubar";
  },
  /**
   * Roles a user operates (C# Aria.IsInteractiveRole, as DrawnUi.Rust is_control_role): a node with one of them that
   * cannot take input is read as disabled (aria-disabled). C# also lists listbox and scrollbar; here a listbox is an
   * arrow-key group and groups are never disabled.
   */
  IsInteractiveRole(role?: string): boolean {
    return role === "button" || role === "link" || role === "checkbox" || role === "radio" || role === "switch"
      || role === "slider" || role === "spinbutton" || role === "textbox" || role === "searchbox" || role === "combobox"
      || role === "option" || role === "tab" || role === "menuitem" || role === "menuitemcheckbox" || role === "menuitemradio";
  },
} as const;

/** What the group logic reads from a layout and a scroll, by shape: core modules never import the controls (load order). */
interface GroupLayout { Type: string; Split: number; IsTemplated: boolean; ItemsSource?: readonly unknown[]; ChildrenFactory: { GetViewForIndex(index: number): SkiaControl | undefined } }
interface GroupScroll { Content?: SkiaControl; ScrollToIndex(index: number, animate: boolean, option?: "Start" | "End"): void }
const asLayout = (c: SkiaControl): GroupLayout | undefined => ("ChildrenFactory" in c && "Split" in c ? c as unknown as GroupLayout : undefined);
const asScroll = (c: SkiaControl): GroupScroll | undefined => ("ScrollToIndex" in c && "ViewportOffsetY" in c ? c as unknown as GroupScroll : undefined);

/** One laid-out text line exposed for native selection (AccessibilityTextSelectable): CSS px relative to the node. */
export interface AccessibilityTextLine { Text: string; Left: number; Top: number; Width: number; Height: number; FontFamily: string; FontWeight: number; FontSize: number }

/**
 * The value of a range control (a slider, a progress bar): what a screen reader reads and adjusts (drawnui-cross 6c,
 * C# AccessibilityValue): aria-valuenow / min / max, and aria-valuetext when Text is not empty ("65%", "20 – 80").
 */
export interface AccessibilityValue { Now: number; Min: number; Max: number; Step: number; Text: string }

/** One entry of the accessibility snapshot (DrawnUi AccessibilityNode). Rect is CSS pixels relative to the canvas. */
export interface AccessibilityNode {
  Id: number;
  Label?: string;
  Hint?: string;
  Role: string;
  Rect: SKRect;
  CanInteract: boolean;
  /** A role a user operates (Aria.IsInteractiveRole) that cannot take input: aria-disabled, no tab stop. */
  Disabled: boolean;
  IsPressed?: boolean;
  Live?: string;
  Source: SkiaControl;
  /** A range control's value (aria-valuenow / min / max / valuetext); its name stays the app's label. */
  Value?: AccessibilityValue;
  /** Real text lines rendered into the overlay so the browser can select / copy them (opt-in per control). */
  TextLines?: AccessibilityTextLine[];
}

/**
 * Mirrors DrawnUi SkiaAccessibilityManager: registry of accessible controls + a rate-limited snapshot
 * (at most one rebuild per MinUpdateIntervalMs, taken at frame end) that the DOM overlay renders.
 * Detached / hidden / far-off-canvas controls drop out of the snapshot on the next rebuild, so nothing has
 * to unregister explicitly; positions follow scrolling because rects are read from the arranged DrawingRect.
 */
export class SkiaAccessibilityManager {
  private readonly nodes = new Set<SkiaControl>();
  private dirty = false;
  private lastRebuild = -Infinity;
  private pending = 0;
  private readonly changed = new Set<() => void>();
  private readonly liveUpdated = new Set<(node: SkiaControl) => void>();
  private readonly keyboardFocusRequested = new Set<(node: SkiaControl) => void>();

  /** Minimum milliseconds between snapshot rebuilds. */
  MinUpdateIntervalMs = 1000;
  Snapshot: AccessibilityNode[] = [];
  FocusedNode?: SkiaControl;

  /** Subscribes to snapshot changes; returns the unsubscribe function. */
  OnChanged(cb: () => void): () => void { this.changed.add(cb); return () => this.changed.delete(cb); }
  /** Fired immediately (bypassing the rate limit) when a live-region node's value changes. */
  OnLiveRegionUpdated(cb: (node: SkiaControl) => void): () => void { this.liveUpdated.add(cb); return () => this.liveUpdated.delete(cb); }

  /**
   * Keyboard focus moved by the manager itself (arrow keys in a group): the overlay moves DOM focus to that node's
   * element (C# KeyboardFocusRequested). Returns the unsubscribe function.
   */
  OnKeyboardFocusRequested(cb: (node: SkiaControl) => void): () => void { this.keyboardFocusRequested.add(cb); return () => this.keyboardFocusRequested.delete(cb); }

  NotifyFocused(node?: SkiaControl): void {
    if (this.FocusedNode === node) return;
    this.NoteFocus(node);
    this.FocusedNode = node;
  }

  /**
   * Enter / Space from keyboard navigation or a screen reader: activates the node only while a tap could reach it
   * (AccessibilityCanInteract), the rule every head applies.
   */
  static Activate(node?: SkiaControl): boolean {
    if (!node || !node.AccessibilityCanInteract) return false;
    node.OnAccessibilityActivated();
    node.Superview?.AccessibilityManager.ForceRebuildOnNextFrame(); // a screen reader reads the new state right back
    return true;
  }

  /**
   * Arrow keys, Home / End, PageUp / PageDown for the node in keyboard focus: the control gets them first, only while a
   * pan could reach it (a slider steps its value); keys it does not use move keyboard focus between the items of the
   * group around it (MoveInGroup). True when the key was used.
   */
  static Key(node: SkiaControl | undefined, key: InputKey): boolean {
    if (!node) return false;
    if (node.CanReceiveGesture("Panning") && node.OnAccessibilityKey(key)) {
      node.Superview?.AccessibilityManager.ForceRebuildOnNextFrame(); // the new value is read right back, not a second later
      return true;
    }
    return node.Superview?.AccessibilityManager.MoveInGroup(node, key) ?? false;
  }

  // ---- arrow-key groups (C# SkiaAccessibilityManager, "Arrow-key groups") ----

  /** Last focused node of each group: where Tab enters the group. */
  private readonly groupFocus = new WeakMap<SkiaControl, SkiaControl>();
  private groupRequest?: { Group: SkiaControl; Scroll?: GroupScroll; Index: number; Step: number; Deadline: number; ScrollIssued: boolean };

  /**
   * The arrow-key group around `control`: its nearest ancestor with a composite role (Aria.IsCompositeRole, e.g.
   * Aria.RoleList on a SkiaStack), and the item of that group holding the control (one of its children, a cell).
   */
  static TryFindGroup(control: SkiaControl): { Group: SkiaControl; Item: SkiaControl } | undefined {
    for (let child = control, parent = control.Parent; parent; child = parent, parent = parent.Parent) {
      if (Aria.IsCompositeRole(parent.AccessibilityRole)) return { Group: parent, Item: child };
    }
    return undefined;
  }

  /** Remembers where keyboard focus is inside its group, so the next Tab into the group lands there. */
  private NoteFocus(node?: SkiaControl): void {
    const found = node && SkiaAccessibilityManager.TryFindGroup(node);
    if (found) this.groupFocus.set(found.Group, node!);
  }

  /**
   * Whether Tab / Shift+Tab stop on this node. A group of items is one Tab stop, like a native list: its current item
   * (the one keyboard focus last had there, else the group's first usable node) plus the controls inside that same
   * item; the arrow keys move between items. Every node outside a group is a stop.
   */
  IsTabStop(node: SkiaControl): boolean {
    const found = SkiaAccessibilityManager.TryFindGroup(node);
    if (!found) return true;
    let stopItem: SkiaControl | undefined;
    const remembered = this.groupFocus.get(found.Group);
    const current = remembered && !remembered.IsDisposed && remembered.AccessibilityCanInteract && this.Snapshot.some((n) => n.Source === remembered)
      ? SkiaAccessibilityManager.TryFindGroup(remembered) : undefined;
    if (current && current.Group === found.Group) stopItem = current.Item;
    else {
      for (const n of this.Snapshot) {
        if (!n.Source.AccessibilityCanInteract) continue;
        const g = SkiaAccessibilityManager.TryFindGroup(n.Source);
        if (g && g.Group === found.Group) { stopItem = g.Item; break; }
      }
    }
    return !stopItem || stopItem === found.Item;
  }

  /**
   * Moves keyboard focus between the items of the group around `focused`, by item index like a native list: Down / Up in
   * a Column, Right / Left in a Row, all four in a Wrap, a Grid or a Split layout (Up / Down by one row), Home / End to the
   * first / last item, PageDown / PageUp by one viewport of the scroll around it. No wrap at the ends. The target is the
   * item itself when it is an interactive node, else its first interactive node; items the pointer cannot use are
   * skipped. An item not realized (recycled cells) is scrolled in with ScrollToIndex when the group is the scroll's
   * content, and focused once drawn. True when the key belongs to the group.
   */
  MoveInGroup(focused: SkiaControl, key: InputKey): boolean {
    const found = SkiaAccessibilityManager.TryFindGroup(focused);
    if (!found) return false;
    const { Group: group, Item: item } = found;
    const scroll = FindScroll(group), axis = AxisOf(group), count = ItemCount(group);
    const current = this.groupRequest?.Group === group ? this.groupRequest.Index : IndexOf(group, item);
    if (current < 0 || count < 1) return false;
    const row = axis === "Both" ? RowLength(group) : 1;
    const vertical = axis !== "Horizontal";
    const page = () => PageSize(scroll!, item, vertical) * row;
    let target: number, step: number;
    if ((key === "ArrowDown" && axis === "Vertical") || (key === "ArrowRight" && axis !== "Vertical")) { target = current + 1; step = 1; }
    else if ((key === "ArrowUp" && axis === "Vertical") || (key === "ArrowLeft" && axis !== "Vertical")) { target = current - 1; step = -1; }
    else if (key === "ArrowDown" && axis === "Both") { target = Math.min(count - 1, current + row); step = 1; }
    else if (key === "ArrowUp" && axis === "Both") { target = Math.max(0, current - row); step = -1; }
    else if (key === "Home") { target = 0; step = 1; }
    else if (key === "End") { target = count - 1; step = -1; }
    else if (key === "PageDown" && scroll) { target = Math.min(count - 1, current + page()); step = 1; }
    else if (key === "PageUp" && scroll) { target = Math.max(0, current - page()); step = -1; }
    else return false;
    if (target < 0 || target >= count || target === current) return true; // at the end of the group nothing happens, the key still belongs to it
    this.groupRequest = { Group: group, Scroll: scroll, Index: target, Step: step, Deadline: performance.now() + 3000, ScrollIssued: false };
    group.Superview?.Update(); // resolved at the end of the next frame, together with the snapshot
    return true;
  }

  /** Frame end: focus the requested item once it is drawn, skipping items that cannot take input. */
  private ProcessGroupFocus(scale: number, w: number, h: number, requestFrame: () => void): void {
    const request = this.groupRequest;
    if (!request) return;
    const cell = ItemAt(request.Group, request.Index);
    if (cell && IsDrawn(cell)) {
      const node = FindTarget(cell);
      if (node) { this.groupRequest = undefined; this.FocusFromKeyboard(node, scale, w, h); return; }
      // this item cannot take input: go on to the next one in the same direction
      request.Index += request.Step;
      if (request.Index < 0 || request.Index >= ItemCount(request.Group)) { this.groupRequest = undefined; return; }
      request.Deadline = performance.now() + 3000;
      request.ScrollIssued = false;
    } else if (performance.now() > request.Deadline || request.Group.IsDisposed) { this.groupRequest = undefined; return; }
    if (!request.ScrollIssued) {
      request.ScrollIssued = true;
      const next = ItemAt(request.Group, request.Index);
      if ((!next || !IsDrawn(next)) && request.Scroll && request.Scroll.Content === request.Group) {
        request.Scroll.ScrollToIndex(request.Index, true, request.Step > 0 ? "End" : "Start");
      }
    }
    requestFrame(); // keep frames coming until the item is drawn
  }

  private FocusFromKeyboard(node: SkiaControl, scale: number, w: number, h: number): void {
    this.Rebuild(scale, w, h); // the overlay looks the node up in the snapshot: make sure it is there now
    this.NoteFocus(node);
    this.FocusedNode = node;
    for (const cb of this.keyboardFocusRequested) cb(node);
  }

  Register(node: SkiaControl): void { this.nodes.add(node); this.dirty = true; }

  NotifyUpdated(node: SkiaControl): void {
    if (!this.nodes.has(node)) return;
    this.dirty = true;
    if (node.AccessibilityLive) for (const cb of this.liveUpdated) cb(node);
  }

  ForceRebuildOnNextFrame(): void { this.lastRebuild = -Infinity; this.dirty = true; }

  Unregister(node: SkiaControl): void {
    if (this.nodes.delete(node)) { node.OnAccessibilityUnregistered(); this.dirty = true; }
  }

  UnregisterSubtree(root: SkiaControl): void {
    for (const n of Array.from(this.nodes)) {
      let c: SkiaControl | undefined = n;
      while (c && c !== root) c = c.Parent;
      if (c) this.Unregister(n);
    }
  }

  /**
   * Called by Canvas at the end of every drawn frame. Rebuilds when something was invalidated, and at most once
   * per MinUpdateIntervalMs otherwise (keeps rects in sync with scrolling); notifies only when the snapshot differs.
   */
  OnFrameEnd(scale: number, canvasWidthPx: number, canvasHeightPx: number, requestFrame: () => void): void {
    this.ProcessGroupFocus(scale, canvasWidthPx, canvasHeightPx, requestFrame);
    if (this.nodes.size === 0 && this.Snapshot.length === 0) return;
    const now = performance.now();
    const wait = this.MinUpdateIntervalMs - (now - this.lastRebuild);
    if (wait > 0) {
      // rate-limited: rendering is on demand, so make sure a frame comes back once the interval has passed
      if (!this.pending) this.pending = window.setTimeout(() => { this.pending = 0; requestFrame(); }, wait);
      return;
    }
    this.Rebuild(scale, canvasWidthPx, canvasHeightPx);
  }

  private Rebuild(scale: number, canvasWidthPx: number, canvasHeightPx: number): void {
    this.dirty = false;
    this.lastRebuild = performance.now();

    let list: AccessibilityNode[] = [];
    for (const n of this.nodes) {
      if (!n.Superview) { this.nodes.delete(n); n.OnAccessibilityUnregistered(); continue; } // detached from the tree
      if (!n.IsVisible || !n.IsAccessibilityElement || n.AccessibilityRole === Aria.RolePresentation) continue;
      if (AccessibilityManagerHiddenByAncestor(n)) continue; // e.g. the root page kept mounted under a pushed shell page
      const px = n.GetAccessibilityPixelRect();
      if (px.Width <= 0 || px.Height <= 0) continue;
      // nodes beyond the canvas stay in the tree (scroll content reachable with Tab, the overlay scrolls them into view);
      // only what is entirely outside a clipped canvas by more than a screen is dropped to keep the DOM small
      if (px.Right < -canvasWidthPx || px.Bottom < -canvasHeightPx || px.Left > 2 * canvasWidthPx || px.Top > 2 * canvasHeightPx) continue;
      list.push({
        Id: n.AccessibilityId, Label: n.AccessibilityLabel, Hint: n.AccessibilityHint, Role: n.AccessibilityRole!, Value: n.AccessibilityValue,
        Rect: new SKRect(px.Left / scale, px.Top / scale, px.Right / scale, px.Bottom / scale),
        CanInteract: n.AccessibilityCanInteract, IsPressed: n.AccessibilityIsPressed, Live: n.AccessibilityLive, Source: n,
        Disabled: !n.AccessibilityCanInteract && Aria.IsInteractiveRole(n.AccessibilityRole),
        TextLines: n.AccessibilityTextSelectable ? n.GetAccessibilityTextLines(scale) : undefined,
      });
    }
    list = SayNamesOnce(list);
    list.sort((a, b) => a.Rect.Top - b.Rect.Top || a.Rect.Left - b.Rect.Left);
    // reading order: nodes whose tops are within half the smaller height form one row, read left to right, so a row of
    // vertically centered controls of different heights keeps its visual order (C# RectComparer + LeftComparer)
    for (let start = 0, i = 1; i <= list.length; i++) {
      if (i < list.length) {
        const first = list[start].Rect, next = list[i].Rect;
        if (next.Top - first.Top < Math.min(first.Height, next.Height) / 2) continue;
      }
      if (i - start > 1) {
        const row = list.slice(start, i).sort((a, b) => a.Rect.Left - b.Rect.Left);
        for (let k = 0; k < row.length; k++) list[start + k] = row[k];
      }
      start = i;
    }
    if (SkiaAccessibilityManager.Same(list, this.Snapshot)) return;
    this.Snapshot = list;
    for (const cb of this.changed) cb();
  }

  private static Same(a: AccessibilityNode[], b: AccessibilityNode[]): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      const x = a[i], y = b[i];
      if (x.Source !== y.Source || x.Label !== y.Label || x.Hint !== y.Hint || x.Role !== y.Role || x.CanInteract !== y.CanInteract || x.Disabled !== y.Disabled
        || x.IsPressed !== y.IsPressed || x.Live !== y.Live || !SameValue(x.Value, y.Value)
        || Math.abs(x.Rect.Left - y.Rect.Left) > 0.5 || Math.abs(x.Rect.Top - y.Rect.Top) > 0.5
        || Math.abs(x.Rect.Right - y.Rect.Right) > 0.5 || Math.abs(x.Rect.Bottom - y.Rect.Bottom) > 0.5) return false;
      const tx = x.TextLines, ty = y.TextLines;
      if (!!tx !== !!ty) return false;
      if (tx && ty) {
        if (tx.length !== ty.length) return false;
        for (let j = 0; j < tx.length; j++) if (tx[j].Text !== ty[j].Text || Math.abs(tx[j].Left - ty[j].Left) > 0.5 || Math.abs(tx[j].Top - ty[j].Top) > 0.5 || tx[j].FontSize !== ty[j].FontSize) return false;
      }
    }
    return true;
  }
}

/**
 * Each name is said once in the flat overlay (DrawnUi.Rust said_by_child): a text or a heading whose label repeats the
 * label of the node it is in (its nearest ancestor node) is said by one of them. Under an interactive node (a card
 * button) the child is left out, the button keeps its name; under any other node (a group card and its title) the
 * node loses its name and the heading says it. Selectable text (TextLines) always stays.
 */
function SayNamesOnce(list: AccessibilityNode[]): AccessibilityNode[] {
  const bySource = new Map<SkiaControl, AccessibilityNode>(list.map((x) => [x.Source, x]));
  const said = new Set<AccessibilityNode>();
  for (const x of list) {
    if (!x.Label || x.TextLines || (x.Role !== Aria.RoleText && x.Role !== Aria.RoleHeading)) continue;
    let owner: AccessibilityNode | undefined;
    for (let p = x.Source.Parent; p && !owner; p = p.Parent) owner = bySource.get(p);
    if (!owner || owner.Label !== x.Label) continue;
    if (owner.CanInteract) said.add(x);
    else owner.Label = undefined;
  }
  return said.size ? list.filter((x) => !said.has(x)) : list;
}

function SameValue(a?: AccessibilityValue, b?: AccessibilityValue): boolean {
  return a === b || (!!a && !!b && a.Now === b.Now && a.Min === b.Min && a.Max === b.Max && a.Step === b.Step && a.Text === b.Text);
}

// ---- group helpers (duck-typed layouts and scrolls) ----

/** Children of a control (a layout's Views, a scroll's Content). */
function ViewsOf(c: SkiaControl): readonly SkiaControl[] {
  if ("Views" in c) return (c as unknown as { Views: readonly SkiaControl[] }).Views;
  const content = (c as unknown as { Content?: SkiaControl }).Content;
  return content ? [content] : [];
}

function FindScroll(group: SkiaControl): GroupScroll | undefined {
  for (let p = group.Parent; p; p = p.Parent) { const s = asScroll(p); if (s) return s; }
  return undefined;
}

/** Down / Up in a Column, Right / Left in a Row, all four in a Wrap, a Grid or a Split layout. */
function AxisOf(group: SkiaControl): "Vertical" | "Horizontal" | "Both" {
  const l = asLayout(group);
  if (!l) return "Vertical";
  if (l.Type === "Column") return l.Split <= 1 ? "Vertical" : "Both";
  if (l.Type === "Row") return "Horizontal";
  if (l.Type === "Absolute") return "Vertical";
  return "Both";
}

/** Items per row of a 2D group: Split when set, else the items sharing the row of `item`. */
/**
 * Items per row of a 2D group: the Split, else the items on the row of the group's first item. C# counts the focused
 * item's row, which the short last row of a wrap leaves short (Up from it skipped items); DrawnUi.Rust afef66f.
 */
function RowLength(group: SkiaControl): number {
  const l = asLayout(group);
  if (l && l.Split > 1) return l.Split;
  const first = ItemAt(group, 0) ?? FirstRealized(group);
  if (!first) return 1;
  const top = first.GetAccessibilityPixelRect();
  if (top.Height <= 0) return 1;
  const mid = (top.Top + top.Bottom) / 2;
  let count = 0;
  for (const child of ViewsOf(group)) { const r = child.GetAccessibilityPixelRect(); if (r.Height > 0 && Math.abs((r.Top + r.Bottom) / 2 - mid) < top.Height / 2) count++; }
  return Math.max(1, count);
}

function ItemCount(group: SkiaControl): number {
  const l = asLayout(group);
  return l?.IsTemplated ? l.ItemsSource?.length ?? 0 : ViewsOf(group).length;
}

function IndexOf(group: SkiaControl, item: SkiaControl): number {
  const l = asLayout(group);
  return l?.IsTemplated ? item.ContextIndex : ViewsOf(group).indexOf(item);
}

/** The view of an item: the realized cell of a templated layout (none when its cell is not in use), else the child. */
function ItemAt(group: SkiaControl, index: number): SkiaControl | undefined {
  const l = asLayout(group);
  if (l?.IsTemplated) { const v = l.ChildrenFactory.GetViewForIndex(index); return v && v.ContextIndex === index ? v : undefined; }
  return index >= 0 && index < ViewsOf(group).length ? ViewsOf(group)[index] : undefined;
}

/** The realized item with the lowest index (item 0 of a scrolled recycled group may not be realized). */
function FirstRealized(group: SkiaControl): SkiaControl | undefined {
  let best: SkiaControl | undefined;
  for (const v of ViewsOf(group)) if (!best || IndexOf(group, v) < IndexOf(group, best)) best = v;
  return best;
}

/** Arranged on the canvas: realized and laid out (a templated layout keeps only the cells it draws in use). */
function IsDrawn(control: SkiaControl): boolean {
  const r = control.GetAccessibilityPixelRect();
  return !!control.Superview && r.Width > 0 && r.Height > 0;
}

/** Items per viewport of the scroll around the group. */
function PageSize(scroll: GroupScroll, item: SkiaControl, vertical: boolean): number {
  const v = (scroll as unknown as SkiaControl).DrawingRect, size = item.MeasuredSize.Pixels;
  const viewport = vertical ? v.Height : v.Width, s = vertical ? size.Height : size.Width;
  return s > 0 ? Math.max(1, Math.floor(viewport / s)) : 1;
}

/** The item itself when it is an interactive node, else its first interactive node in tree order. */
function FindTarget(item: SkiaControl): SkiaControl | undefined {
  if (item.IsAccessibilityElement && item.AccessibilityCanInteract) return item;
  for (const child of ViewsOf(item)) { const found = FindTarget(child); if (found) return found; }
  return undefined;
}

/** True when any ancestor is hidden (IsVisible false or Opacity 0): the subtree is not drawn, so it gets no nodes. */
function AccessibilityManagerHiddenByAncestor(control: { Parent?: { IsVisible: boolean; Opacity: number; Parent?: unknown } }): boolean {
  let p = control.Parent as { IsVisible: boolean; Opacity: number; Parent?: unknown } | undefined;
  while (p) { if (!p.IsVisible || p.Opacity <= 0) return true; p = p.Parent as typeof p; }
  return false;
}
