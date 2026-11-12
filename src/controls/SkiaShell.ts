import { Colors, Thickness } from "../core/Types";
import { Super } from "../core/Super";
import { Easing } from "../core/Easing";
import { SkiaControl } from "../core/SkiaControl";
import { ApplyProps, type ControlProps } from "../core/Props";
import type { ControlTappedEventArgs } from "../core/Gestures";
import { SkiaGrid, SkiaLayer, type SkiaLayout } from "./SkiaLayout";
import { SkiaLabel } from "./SkiaLabel";
import { SkiaRichLabel } from "./SkiaRichLabel";
import { SkiaButton } from "./SkiaButton";
import { SkiaShape } from "./SkiaShape";
import { SkiaBackdrop } from "./SkiaBackdrop";
import { SkiaDrawer } from "./SkiaDrawer";

/** Arguments passed to a page (C# GoToAsync arguments / query string), e.g. `GoToAsync("detail", true, { id: 42 })` or `GoToAsync("detail?id=42")`. */
export type ShellArguments = Record<string, unknown>;
/** C# NavigationSource. */
export type NavigationSource = "Push" | "Pop";
/** C# SkiaShellNavigatingArgs: set Cancel to stop the navigation. */
export interface SkiaShellNavigatingArgs { Route: string; Source: NavigationSource; Cancel: boolean; View?: SkiaControl; Previous?: SkiaControl }
/** C# SkiaShellNavigatedArgs. */
export interface SkiaShellNavigatedArgs { Route: string; Source: NavigationSource; View?: SkiaControl }

/** "name?a=1&b=2" -> name + arguments (query values are strings). */
export function SplitRoute(route: string): { name: string; args: ShellArguments } {
  const q = route.indexOf("?");
  if (q < 0) return { name: route, args: {} };
  const args: ShellArguments = {};
  new URLSearchParams(route.slice(q + 1)).forEach((v, k) => { args[k] = v; });
  return { name: route.slice(0, q), args };
}
/** name + arguments -> "name?a=1" (only string / number / boolean values travel in the route, the rest stays in memory). */
export function BuildRoute(name: string, args?: ShellArguments): string {
  if (!args) return name;
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(args)) if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") p.set(k, String(v));
  const q = p.toString();
  return q ? `${name}?${q}` : name;
}

/** C# OpenPopupAsync parameters. */
export interface PopupOptions {
  animated?: boolean;
  /** A tap outside the content closes the popup (default true). */
  closeWhenBackgroundTapped?: boolean;
  /** Dim + blur the page behind (default true). */
  showOverlay?: boolean;
  backgroundColor?: string;
}

/** C# PushModalAsync parameters. */
export interface ModalOptions {
  /** The modal can be dragged down to close (default false). */
  useGestures?: boolean;
  animated?: boolean;
  /** Dim + blur the page behind (C# freezeBackground; the frozen screenshot is not ported). */
  freezeBackground?: boolean;
}

/** A shell tab: its root route and the label shown in the tab bar. */
export interface ShellTab { route: string; title: string }

/** C# SkiaShell static defaults (mutable). */
export const ShellDefaults = {
  ToastBackgroundColor: "#CC000000",
  ToastTextColor: Colors.White,
  ToastTextFont: "",
  ToastTextSize: 16,
  ToastTextMargins: 24,
  /** Default overlay tint behind popups / modals. */
  PopupBackgroundColor: "#66000000",
  /** Backdrop blur behind popups / modals, points. */
  PopupsBackgroundBlur: 6,
  PopupsAnimationSpeed: 250,
  PopupsCancelAnimationsAfterMs: 1500,
  ZIndexModals: 1000,
  ZIndexPopups: 2000,
  ZIndexToasts: 3000,
  /** Accent of the selected tab. */
  TabSelectedColor: "#6EA8FE",
  TabColor: "#ADB5BD",
};

/**
 * Content that puts itself into the place the shell made for it, instead of being a control the shell adds there (the
 * React `<SkiaShell>` renders JSX this way).
 */
export interface ShellContentHost {
  /** The shell made room for the content: fill `parent` with it. */
  AttachTo(parent: SkiaLayout): void;
  /** The shell removed that room (a page popped, a popup closed): let go of the content. */
  Detach(): void;
  /** Resolves once the content is in place; the shell waits for it before it animates or reports the navigation. */
  Ready?(): Promise<void>;
}
/** What the shell shows: a control, a function making one (built when shown), or a host filling the room itself. */
export type ShellContent = SkiaControl | (() => SkiaControl) | ShellContentHost;
/** Route name -> page factory receiving the navigation arguments (C# Routes). */
export type ShellRouteFactory = (args: ShellArguments) => ShellContent;

const IsContentHost = (c: ShellContent): c is ShellContentHost => typeof (c as ShellContentHost).AttachTo === "function";

/** C# SkiaViewSwitcher.Custom easing (back-ease, side coefficient 0.55) used for tab switches. */
const TabsEasing = new Easing((x) => (x - 1) * (x - 1) * ((0.55 + 1) * (x - 1) + 0.55) + 1);

const HISTORY_KEY = "drawnui-shell";
type HistoryKind = "page" | "popup" | "modal";

interface PageEntry {
  Route: string;
  /** Arguments that cannot travel in the route string (objects), kept for the page's whole life. */
  Memory?: ShellArguments;
  Host: SkiaLayer;
  Body: SkiaLayer;
  Bar: SkiaLayer;
  Title: SkiaLabel;
  Content?: ShellContent;
}

interface Overlay {
  id: number;
  /** The overlay's layer, child of the shell. */
  ctrl: SkiaLayer;
  /** Popups: the centered layer holding the content. */
  content?: SkiaLayer;
  drawer?: SkiaDrawer;
  body?: ShellContent;
  closing?: boolean;
  history?: boolean;
  animated?: boolean;
  /** A modal whose close started: out of the modal stack while it still slides away. */
  left?: boolean;
}

/** Canvas width in points for a control (page slide distance); falls back to the window. */
function CanvasWidthPts(ctrl: SkiaControl): number {
  const el = (ctrl.Superview as unknown as { Element?: HTMLCanvasElement } | undefined)?.Element;
  return el ? el.clientWidth : window.innerWidth;
}

/** Resolves once pred() is truthy or after timeout ms. */
async function WaitFor<T>(pred: () => T | undefined | null | false, timeout = 1000): Promise<T | undefined> {
  const started = performance.now();
  for (;;) {
    const v = pred();
    if (v) return v;
    if (performance.now() - started > timeout) return undefined;
    await new Promise((r) => setTimeout(r, 16));
  }
}

function AnimateWithTimeout(promise: Promise<unknown>, ms = ShellDefaults.PopupsCancelAnimationsAfterMs): Promise<void> {
  return Promise.race([promise.catch(() => undefined), new Promise<void>((r) => setTimeout(r, ms))]).then(() => undefined);
}

const thicknesses = new Map<string, Thickness>();
/** One Thickness per value, so an unchanged margin is not a change. */
function T(l: number, t: number, r: number, b: number): Thickness {
  const key = `${l},${t},${r},${b}`;
  let v = thicknesses.get(key);
  if (!v) { v = new Thickness(l, t, r, b); thicknesses.set(key, v); }
  return v;
}

/**
 * DrawnUi SkiaShell: a root page (or tabs) plus per-tab stacks of routed pages with a nav bar (pages slide in / out
 * like SkiaViewSwitcher), popups (blurred + dimmed backdrop, scale + fade, tap outside to close), modals (full-screen
 * SkiaDrawer from the bottom, optionally draggable), toasts (bottom banner, slide + fade, auto close). With
 * `UseBrowserHistory` pages live in the URL hash and the browser back button behaves like C# GoBack (popup, then
 * modal, then page). Content is a control, a function making one, or a ShellContentHost.
 */
export class SkiaShell extends SkiaLayer {
  constructor() {
    super();
    this.VerticalOptions = "Fill";
  }

  // ---- properties (C# names) ----

  /** Page factories by route name; a factory receives the route's arguments. */
  Routes: Record<string, ShellRouteFactory> = {};
  /** Page push / pop slide duration in ms (C# SkiaViewSwitcher.PagesAnimationSpeed). */
  PagesAnimationSpeed = 200;
  /** Slide + fade between tabs (C# SkiaViewSwitcher.AnimateTabs). */
  AnimateTabs = false;
  /** Tab switch duration in ms (C# TabsAnimationSpeed). */
  TabsAnimationSpeed = 150;
  /** Before a page / popup / modal is pushed or popped; set e.Cancel = true to stop it (C# Navigating). */
  Navigating?: (e: SkiaShellNavigatingArgs) => void;
  /** After a page / popup / modal went upfront or was removed (C# Navigated). */
  Navigated?: (e: SkiaShellNavigatedArgs) => void;
  /** The current route changed (C# RouteChanged). */
  RouteChanged?: (route: string) => void;

  private titles?: Record<string, string>;
  /** Title shown in the nav bar per route name; defaults to the route name. */
  get Titles(): Record<string, string> | undefined { return this.titles; }
  set Titles(v: Record<string, string> | undefined) { this.titles = v; this.RenderChrome(); }

  private navBarHeight = 56;
  /** Nav bar height in points when a page is open. */
  get NavBarHeight(): number { return this.navBarHeight; }
  set NavBarHeight(v: number) { this.navBarHeight = v; this.RenderChrome(); }

  private navBarColor = "#212529";
  get NavBarColor(): string { return this.navBarColor; }
  set NavBarColor(v: string) { this.navBarColor = v; this.RenderChrome(); }

  private pageBackgroundColor = "#212529";
  /** Opaque background of pushed pages (they slide over the page below). */
  get PageBackgroundColor(): string { return this.pageBackgroundColor; }
  set PageBackgroundColor(v: string) { this.pageBackgroundColor = v; this.RenderChrome(); }

  private tabBarHeight = 56;
  get TabBarHeight(): number { return this.tabBarHeight; }
  set TabBarHeight(v: number) { this.tabBarHeight = v; this.RenderChrome(); }

  private tabBarColor = "#212529";
  get TabBarColor(): string { return this.tabBarColor; }
  set TabBarColor(v: string) { this.tabBarColor = v; this.RenderChrome(); }

  private insets?: Thickness;
  /** Safe-area insets (points) reserved above the nav bar and below the tab bar; default Super.Insets (C# Super.Insets). */
  get Insets(): Thickness | undefined { return this.insets; }
  set Insets(v: Thickness | undefined) { this.insets = v; this.RenderChrome(); }

  private tabs?: ShellTab[];
  /** Bottom tab bar: one root route per tab, per-tab navigation stacks (C# SkiaViewSwitcher tabs). */
  get Tabs(): ShellTab[] | undefined { return this.tabs; }
  set Tabs(v: ShellTab[] | undefined) {
    const before = this.tabs?.map((t) => t.route).join("\n");
    this.tabs = v;
    if (this.containers.length && before !== v?.map((t) => t.route).join("\n")) this.RebuildContainers();
    else this.RenderChrome();
  }

  private useBrowserHistory = true;
  /** Mirror pages in the URL hash (#/route/route) and honour the browser back button (React extension, default true). */
  get UseBrowserHistory(): boolean { return this.useBrowserHistory; }
  set UseBrowserHistory(v: boolean) {
    if (v === this.useBrowserHistory) return;
    this.useBrowserHistory = v;
    if (this.started) { this.StopHistory(); this.StartHistory(); }
  }

  private rootContent?: ShellContent;
  /** The root content, shown when nothing is pushed and no Tabs are set (C# RootContent). */
  get RootContent(): ShellContent | undefined { return this.rootContent; }
  set RootContent(v: ShellContent | undefined) {
    if (v === this.rootContent) return;
    const old = this.rootContent;
    this.rootContent = v;
    const built = this.containers.length > 0;
    this.EnsureContainers();
    if (built && !this.HasTabs) this.SetRoot(0, old, v);
  }

  // ---- state ----

  private readonly containers: SkiaLayer[] = [];
  private readonly tabRoots: (ShellContent | undefined)[] = [];
  private readonly stacks: PageEntry[][] = [];
  private readonly popups: Overlay[] = [];
  private readonly modals: Overlay[] = [];
  private readonly toasts: Overlay[] = [];
  private tabBar?: SkiaLayer;
  private tabCells: { cell: SkiaLayer; label: SkiaLabel; marker?: SkiaShape }[] = [];
  private selected = 0;
  /** The page sliding out during a pop. */
  private leaving?: PageEntry;
  /** Pages sliding in: the page below stays visible meanwhile. */
  private transitions = 0;
  /** The tab root leaving during an animated switch (C# PreviousVisibleView) and the slide direction. */
  private tabTransition?: { from: number; dir: 1 | -1 };
  private nextId = 1;
  private lastRoute?: string;
  private started = false;
  private unsubscribeInsets?: () => void;
  /** What each chrome control was last given, so a new declaration changes only what differs (as React's props). */
  private readonly declared = new WeakMap<SkiaControl, ControlProps>();

  /** Bumped whenever what the navigation reports changed (stack, overlays, tab). */
  NavVersion = 0;

  /** Called after the stack, the overlays or the selected tab changed. */
  protected OnChanged(): void {}

  /** The root of tab `index` (C#: built from its route). */
  protected CreateTabRoot(index: number): ShellContent | undefined {
    const route = this.tabs?.[index]?.route ?? "";
    const { name, args } = SplitRoute(route);
    return this.Routes[name]?.(args);
  }

  // ---- read (C# names) ----

  private get HasTabs(): boolean { return !!this.tabs && this.tabs.length > 0; }
  private get Stack(): PageEntry[] { return this.stacks[this.selected] ?? []; }
  /** Index of the selected tab. */
  get SelectedTab(): number { return this.selected; }
  /** Routes below the current page of the current tab, root excluded. */
  get NavigationStack(): readonly string[] { return this.Stack.map((p) => p.Route); }
  /** Current route (with its query), "" for the root content. */
  get Route(): string { const s = this.Stack; return s[s.length - 1]?.Route ?? ""; }
  /** Arguments of the current page (query + explicit). */
  get Arguments(): ShellArguments { const s = this.Stack; const top = s[s.length - 1]; return { ...SplitRoute(top?.Route ?? "").args, ...top?.Memory }; }
  get PopupsCount(): number { return this.popups.length; }
  /** Open modals; a modal sliding out has left the stack. */
  get ModalsCount(): number { return this.modals.filter((m) => !m.left).length; }
  get ToastsCount(): number { return this.toasts.length; }
  /** Something to go back from: a popup, a modal or a pushed page. */
  get CanGoBack(): boolean { return this.Stack.length > 0 || this.popups.length > 0 || this.ModalsCount > 0; }

  // ---- building ----

  /** Builds the control and sets its values as the React renderer would (styles first, then the values). */
  private Create<C extends SkiaControl>(ctor: new () => C, props: ControlProps): C {
    const c = new ctor();
    c.ApplyInitialStyles(true);
    ApplyProps(c, null, props);
    this.declared.set(c, props);
    return c;
  }
  /** New values for a control the shell made: only the differences are applied. */
  private Declare(c: SkiaControl, props: ControlProps): void {
    ApplyProps(c, this.declared.get(c) ?? null, props);
    this.declared.set(c, props);
  }

  private Place(content: ShellContent | undefined, parent: SkiaLayout): void {
    if (!content) return;
    if (IsContentHost(content)) content.AttachTo(parent);
    else parent.InsertChild(typeof content === "function" ? content() : content);
  }
  /** A root replaced: the old one leaves its container (C# SetRoot), a control is not disposed. */
  private Release(content: ShellContent | undefined, parent: SkiaLayout): void {
    if (!content) return;
    if (IsContentHost(content)) content.Detach();
    else if (typeof content !== "function") parent.RemoveSubView(content);
  }
  /** Before the room of `content` is disposed: a host lets go of its content, a control is disposed with the room (C#). */
  private Detach(content: ShellContent | undefined): void {
    if (content && IsContentHost(content)) content.Detach();
  }
  private Ready(content: ShellContent | undefined): Promise<void> {
    return content && IsContentHost(content) && content.Ready ? content.Ready() : Promise.resolve();
  }

  private get EffectiveInsets(): Thickness { return this.insets ?? Super.Insets; }
  private get RootBottom(): number { return this.HasTabs ? this.tabBarHeight + this.EffectiveInsets.Bottom : 0; }

  /** A tabbed shell has no RootContent to start it: it is built at the first measure. */
  override Measure(widthConstraint: number, heightConstraint: number, scale: number) {
    this.EnsureContainers();
    return super.Measure(widthConstraint, heightConstraint, scale);
  }

  /** One container per tab (one without tabs) holds that tab's root; pushed pages are drawn over it. */
  private EnsureContainers(): void {
    if (this.containers.length || this.IsDisposed) return;
    const count = this.HasTabs ? this.tabs!.length : 1;
    for (let i = 0; i < count; i++) {
      const c = this.Create(SkiaLayer, this.ContainerProps(i));
      this.containers.push(c);
      this.tabRoots.push(undefined);
      if (!this.stacks[i]) this.stacks[i] = [];
      this.InsertChild(c, this.FirstPageHost());
      this.SetRoot(i, undefined, this.HasTabs ? this.CreateTabRoot(i) : this.rootContent);
    }
    if (this.HasTabs) this.BuildTabBar();
    if (!this.started) { this.started = true; queueMicrotask(() => this.Start()); }
  }

  /** The tabs changed after the shell was built: new containers, roots and tab bar; the pushed pages stay. */
  private RebuildContainers(): void {
    for (let i = 0; i < this.containers.length; i++) this.RemoveContainer(i);
    this.containers.length = 0; this.tabRoots.length = 0;
    if (this.tabBar) { this.RemoveSubView(this.tabBar); this.tabBar.Dispose(); this.tabBar = undefined; this.tabCells = []; }
    const count = this.HasTabs ? this.tabs!.length : 1;
    for (let t = count; t < this.stacks.length; t++) for (const p of this.stacks[t]) this.RemovePageHost(p);
    this.stacks.length = Math.min(this.stacks.length, count);
    this.selected = Math.min(this.selected, count - 1);
    this.EnsureContainers();
    this.RenderChrome();
    this.Notify();
  }

  private RemoveContainer(i: number): void {
    const c = this.containers[i];
    this.Detach(this.tabRoots[i]);
    this.RemoveSubView(c);
    c.Dispose();
  }

  private SetRoot(tab: number, old: ShellContent | undefined, root: ShellContent | undefined): void {
    const c = this.containers[tab];
    this.Release(old, c);
    this.tabRoots[tab] = root;
    this.Place(root, c);
  }

  private ContainerProps(t: number): ControlProps {
    const selected = t === this.selected;
    const stack = this.Stack;
    const transitioning = this.transitions > 0 || this.leaving !== undefined;
    const entering = this.tabTransition && selected ? { TranslationX: this.tabTransition.dir * 0.75 * (typeof window !== "undefined" ? window.innerWidth : 0), Opacity: 0.001, ZIndex: 1 } : {};
    return {
      VerticalOptions: "Fill", Margin: T(0, 0, 0, this.RootBottom), BackgroundColor: this.HasTabs ? this.pageBackgroundColor : undefined,
      IsVisible: selected ? stack.length === 0 || transitioning : this.tabTransition?.from === t, ZIndex: 0, ...entering,
    };
  }

  /** The first page host in the shell's children: tab containers go before every page. */
  private FirstPageHost(tabAfter = -1): SkiaControl | undefined {
    for (let t = tabAfter + 1; t < this.stacks.length; t++) if (this.stacks[t]?.length) return this.stacks[t][0].Host;
    return undefined;
  }

  private BuildTabBar(): void {
    const insets = this.EffectiveInsets;
    const bar = this.Create(SkiaLayer, this.TabBarProps(insets));
    bar.InsertChild(this.Create(SkiaLayer, { HeightRequest: 1, BackgroundColor: "#343A40" }));
    const grid = this.Create(SkiaGrid, { ColumnDefinitions: this.tabs!.map(() => "*").join(","), HorizontalOptions: "Fill", VerticalOptions: "Fill" });
    this.tabCells = this.tabs!.map((t, i) => {
      const cell = this.Create(SkiaLayer, { Column: i, HorizontalOptions: "Fill", VerticalOptions: "Fill", AnimationTapped: "Ripple", Tapped: () => void this.SelectTabAsync(i), AccessibilityRole: "button", AccessibilityLabel: t.title });
      const label = this.Create(SkiaLabel, this.TabLabelProps(t, i));
      cell.InsertChild(label);
      grid.InsertChild(cell);
      return { cell, label };
    });
    bar.InsertChild(grid);
    this.tabBar = bar;
    this.InsertChild(bar);
    this.RenderTabBar();
  }
  private TabBarProps(insets: Thickness): ControlProps {
    return { HeightRequest: this.tabBarHeight + insets.Bottom, VerticalOptions: "End", BackgroundColor: this.tabBarColor, ZIndex: ShellDefaults.ZIndexModals - 1, BlockGesturesBelow: true, Padding: T(0, 0, 0, insets.Bottom) };
  }
  private TabLabelProps(t: ShellTab, i: number): ControlProps {
    const selected = i === this.selected;
    return { Text: t.title, FontSize: 13, FontFamily: selected ? "FontTextBold" : undefined, TextColor: selected ? ShellDefaults.TabSelectedColor : ShellDefaults.TabColor, HorizontalOptions: "Center", VerticalOptions: "Center", AccessibilityRole: "presentation" };
  }
  private RenderTabBar(): void {
    if (!this.tabBar || !this.tabs) return;
    this.Declare(this.tabBar, this.TabBarProps(this.EffectiveInsets));
    this.tabCells.forEach((x, i) => {
      const t = this.tabs![i];
      if (!t) return;
      this.Declare(x.cell, { Column: i, HorizontalOptions: "Fill", VerticalOptions: "Fill", AnimationTapped: "Ripple", Tapped: x.cell.Tapped, AccessibilityRole: "button", AccessibilityLabel: t.title });
      this.Declare(x.label, this.TabLabelProps(t, i));
      // the selected tab's marker: made when its tab is selected, dropped when it is not
      if (i === this.selected && !x.marker) {
        x.marker = this.Create(SkiaShape, { Type: "Rectangle", HeightRequest: 3, WidthRequest: 36, CornerRadius: 2, BackgroundColor: ShellDefaults.TabSelectedColor, HorizontalOptions: "Center", VerticalOptions: "End" });
        x.cell.InsertChild(x.marker);
      } else if (i !== this.selected && x.marker) {
        x.cell.RemoveSubView(x.marker);
        x.marker.Dispose();
        x.marker = undefined;
      }
    });
  }

  /** Applies the state to the chrome: containers, page hosts and their bars, tab bar. */
  private RenderChrome(): void {
    if (!this.containers.length || this.IsDisposed) return;
    const insets = this.EffectiveInsets;
    const navTop = this.navBarHeight + insets.Top;
    const bottom = this.RootBottom;
    const transitioning = this.transitions > 0 || this.leaving !== undefined;
    const stack = this.Stack;
    const topRoute = stack[stack.length - 1]?.Route ?? "";
    this.containers.forEach((c, t) => this.Declare(c, this.ContainerProps(t)));
    this.stacks.forEach((s, t) => {
      for (const p of s) {
        const visible = t === this.selected && (p.Route === topRoute || transitioning);
        this.Declare(p.Host, { VerticalOptions: "Fill", HorizontalOptions: "Fill", Margin: T(0, 0, 0, bottom), BackgroundColor: this.pageBackgroundColor, IsVisible: visible, BlockGesturesBelow: true });
        this.Declare(p.Body, { VerticalOptions: "Fill", Margin: T(0, navTop, 0, 0) });
        this.Declare(p.Bar, { HeightRequest: navTop, BackgroundColor: this.navBarColor, Padding: T(0, insets.Top, 0, 0) });
        this.Declare(p.Title, this.TitleProps(p.Route));
      }
    });
    this.RenderTabBar();
  }

  private TitleProps(route: string): ControlProps {
    const name = SplitRoute(route).name;
    return { Text: this.titles?.[name] ?? name, FontSize: 18, FontFamily: "FontTextBold", TextColor: Colors.White, HorizontalOptions: "Fill", HorizontalTextAlignment: "Center", VerticalOptions: "Center", MaxLines: 1, Margin: T(96, 0, 96, 0), AccessibilityRole: "heading" };
  }

  // ---- notifications ----

  private Notify(): void { this.NavVersion++; this.OnChanged(); }
  /** C# NotifyAndCheckCanNavigate: raises Navigating, false when cancelled. */
  private CanNavigate(route: string, source: NavigationSource, view?: SkiaControl, previous?: SkiaControl): boolean {
    const e: SkiaShellNavigatingArgs = { Route: route ?? "", Source: source, Cancel: false, View: view, Previous: previous };
    this.Navigating?.(e);
    return !e.Cancel;
  }
  private NotifyNavigated(route: string, source: NavigationSource, view?: SkiaControl): void { this.Navigated?.({ Route: route ?? "", Source: source, View: view }); }
  private CheckRoute(): void {
    if (!this.started) return;
    const route = this.Route;
    if (route === this.lastRoute) return;
    this.lastRoute = route;
    this.RouteChanged?.(route);
  }

  /** After the first build: the first RouteChanged, the insets, the browser history (deep link). */
  private Start(): void {
    if (this.IsDisposed) return;
    this.unsubscribeInsets = Super.OnInsetsChanged(() => { if (!this.insets) this.RenderChrome(); });
    this.CheckRoute();
    this.StartHistory();
  }

  protected override OnDisposing(): void {
    this.StopHistory();
    this.unsubscribeInsets?.();
    // content hosts let go of their content; the controls themselves are disposed with the shell's children
    for (const c of this.tabRoots) if (c && IsContentHost(c)) c.Detach();
    for (const s of this.stacks) for (const p of s) if (p.Content && IsContentHost(p.Content)) p.Content.Detach();
    for (const o of [...this.popups, ...this.modals, ...this.toasts]) if (o.body && IsContentHost(o.body)) o.body.Detach();
    super.OnDisposing();
  }

  // ---- browser history: one entry per pushed page / popup / modal, popped in C# GoBack order ----

  private history: HistoryKind[] = [];
  private onPop?: () => void;
  private get HistoryOn(): boolean { return this.useBrowserHistory && typeof window !== "undefined"; }
  private HashFor(routes: readonly string[]): string {
    return routes.length ? "#/" + routes.map(encodeURIComponent).join("/") : window.location.pathname + window.location.search;
  }
  private PushHistory(kind: HistoryKind, routes: readonly string[]): void {
    if (!this.HistoryOn) return;
    this.history.push(kind);
    window.history.pushState({ [HISTORY_KEY]: this.history.length }, "", kind === "page" ? this.HashFor(routes) : undefined);
  }
  /** A programmatic close of something that has a history entry goes through history.back(), so the URL stays in sync. */
  private BackThroughHistory(kind: HistoryKind): boolean {
    if (!this.HistoryOn || this.history[this.history.length - 1] !== kind) return false;
    window.history.back();
    return true;
  }
  private ParseHash(): string[] {
    return window.location.hash.replace(/^#\/?/, "").split("/").filter(Boolean).map(decodeURIComponent).filter((r) => !!this.Routes[SplitRoute(r).name]);
  }

  private StopHistory(): void {
    if (this.onPop) window.removeEventListener("popstate", this.onPop);
    this.onPop = undefined;
  }

  private StartHistory(): void {
    if (!this.HistoryOn || this.onPop) return;
    // initial deep link
    const initial = this.ParseHash();
    if (initial.length) {
      this.ReplaceStack(this.selected, initial);
      this.history = initial.map(() => "page" as HistoryKind);
      window.history.replaceState({ [HISTORY_KEY]: this.history.length }, "", this.HashFor(initial));
    }
    // popstate: the browser popped OUR last entry (back), or moved forward to a hash we can rebuild
    this.onPop = () => {
      const depth = (window.history.state as Record<string, number> | null)?.[HISTORY_KEY] ?? 0;
      const target = this.ParseHash();
      // a Back lands on one of OUR entries: its hash is the stack it was pushed with (the first N pages, N = the page
      // entries below it). A typed hash or a plain <a href="#/route"> makes a new entry with no state (depth 0):
      // that is a navigation to the hash, not a Back to the root
      const pagesBelow = this.history.slice(0, depth).filter((k) => k === "page").length;
      const back = depth < this.history.length && target.join("/") === this.NavigationStack.slice(0, pagesBelow).join("/");
      if (back) {
        // back: unwind our entries down to depth
        void (async () => {
          while (this.history.length > depth) {
            const kind = this.history.pop();
            let done = true;
            if (kind === "popup") { const top = this.popups[this.popups.length - 1]; if (top) { top.history = false; done = await this.ClosePopupNow(top, true); if (!done) top.history = true; } }
            else if (kind === "modal") { const top = this.modals[this.modals.length - 1]; if (top) { top.history = false; done = await this.PopModalNow(top, true); if (!done) top.history = true; } }
            else if (kind === "page") done = await this.PopPage(true);
            if (!done && kind) { // Navigating cancelled: put the browser entry back
              this.history.push(kind);
              window.history.pushState({ [HISTORY_KEY]: this.history.length }, "", kind === "page" ? this.HashFor(this.NavigationStack) : undefined);
              break;
            }
          }
        })();
      } else {
        // forward (depth grew), or another hash = a plain <a href="#/route"> link or a typed hash:
        // the hash names the pages, rebuild the stack without animation (overlays cannot be restored)
        if (depth === this.history.length && target.join("/") === this.NavigationStack.join("/")) return;
        this.history = target.map(() => "page" as HistoryKind);
        window.history.replaceState({ [HISTORY_KEY]: this.history.length }, "", this.HashFor(target));
        this.ReplaceStack(this.selected, target);
      }
    };
    window.addEventListener("popstate", this.onPop);
  }

  // ---- pages ----

  /** Builds a page host (content under its nav bar) for `route` in tab `tab` and adds it; it slides in from the right. */
  private CreatePage(route: string, memory: ShellArguments | undefined, tab: number): PageEntry {
    const insets = this.EffectiveInsets;
    const navTop = this.navBarHeight + insets.Top;
    const host = this.Create(SkiaLayer, { VerticalOptions: "Fill", HorizontalOptions: "Fill", Margin: T(0, 0, 0, this.RootBottom), BackgroundColor: this.pageBackgroundColor, IsVisible: true, BlockGesturesBelow: true });
    const body = this.Create(SkiaLayer, { VerticalOptions: "Fill", Margin: T(0, navTop, 0, 0) });
    const bar = this.Create(SkiaLayer, { HeightRequest: navTop, BackgroundColor: this.navBarColor, Padding: T(0, insets.Top, 0, 0) });
    bar.InsertChild(this.Create(SkiaButton, { Text: "‹  Back", BackgroundColor: "#00000000", TextColor: "#6EA8FE", FontSize: 16, VerticalOptions: "Center", Margin: T(8, 0, 8, 0), ApplyEffect: "Ripple", Tapped: () => void this.GoBackAsync(), AccessibilityRole: "button", AccessibilityLabel: "Back" }));
    const title = this.Create(SkiaLabel, this.TitleProps(route));
    bar.InsertChild(title);
    bar.InsertChild(this.Create(SkiaButton, { Text: "Home", BackgroundColor: "#00000000", TextColor: "#6EA8FE", FontSize: 16, HorizontalOptions: "End", VerticalOptions: "Center", Margin: T(0, 0, 8, 0), ApplyEffect: "Ripple", Tapped: () => void this.PopToRootAsync(), AccessibilityRole: "button", AccessibilityLabel: "Home" }));
    bar.InsertChild(this.Create(SkiaLayer, { HeightRequest: 1, VerticalOptions: "End", BackgroundColor: "#343A40" }));
    const { name, args } = SplitRoute(route);
    const factory = this.Routes[name];
    const content = factory ? factory({ ...args, ...memory }) : undefined;
    this.Place(content, body);
    host.InsertChild(body);
    host.InsertChild(bar);
    const entry: PageEntry = { Route: route, Memory: memory, Host: host, Body: body, Bar: bar, Title: title, Content: content };
    this.InsertChild(host, this.FirstPageHost(tab) ?? this.tabBar ?? this.FirstOverlay());
    // slides in once, when added (C# SkiaViewSwitcher PushView), whether the push was animated or not
    const speed = this.PagesAnimationSpeed;
    if (speed > 0) { host.TranslationX = CanvasWidthPts(host); void host.TranslateToAsync(0, 0, speed); }
    return entry;
  }

  private FirstOverlay(): SkiaControl | undefined {
    return this.modals[0]?.ctrl ?? this.popups[0]?.ctrl ?? this.toasts[0]?.ctrl;
  }

  private RemovePageHost(p: PageEntry): void {
    if (p.Host.IsDisposed) return;
    this.RemoveSubView(p.Host);
    this.Detach(p.Content);
    p.Host.Dispose();
  }

  /** Tab `tab` shows `routes` (a deep link, a typed hash): pages already there at their index stay, the rest are made. */
  private ReplaceStack(tab: number, routes: readonly string[]): void {
    const old = this.stacks[tab] ?? [];
    const next: PageEntry[] = [];
    old.forEach((p, i) => { if (routes[i] !== p.Route) this.RemovePageHost(p); });
    this.stacks[tab] = next;
    routes.forEach((r, i) => { next.push(old[i] && old[i].Route === r ? old[i] : this.CreatePage(r, undefined, tab)); });
    if (this.leaving && !next.includes(this.leaving)) this.leaving = undefined;
    this.RenderChrome();
    this.Notify();
    this.CheckRoute();
  }

  private async SlideOut(current: PageEntry, animated: boolean): Promise<void> {
    if (!animated) return;
    const speed = this.PagesAnimationSpeed;
    this.leaving = current;
    this.RenderChrome();
    await AnimateWithTimeout(current.Host.TranslateToAsync(CanvasWidthPts(current.Host), 0, speed), speed + 500);
    this.leaving = undefined;
  }

  /** Pops the top page; false when Navigating cancelled it (C# NavigationSource.Pop). */
  private async PopPage(animated: boolean): Promise<boolean> {
    const s = this.Stack;
    const current = s[s.length - 1];
    if (!current) return false;
    const below = s[s.length - 2];
    const belowRoute = below?.Route ?? "";
    if (!this.CanNavigate(belowRoute, "Pop", current.Host, current.Host)) return false;
    await this.SlideOut(current, animated);
    for (const stack of this.stacks) { const i = stack.indexOf(current); if (i >= 0) stack.splice(i, 1); }
    this.RemovePageHost(current);
    this.RenderChrome();
    this.Notify();
    this.NotifyNavigated(belowRoute, "Pop", below && !below.Host.IsDisposed ? below.Host : undefined);
    this.CheckRoute();
    return true;
  }

  /** Pushes a registered route; `route` may carry a query ("detail?id=42") and/or explicit arguments (C# GoToAsync(route, animate, arguments)). */
  async GoToAsync(route: string, animated = true, args?: ShellArguments): Promise<void> {
    const { name, args: fromRoute } = SplitRoute(route);
    if (!this.Routes[name]) throw new Error(`DrawnUi: route '${name}' is not registered in SkiaShell.Routes`);
    this.EnsureContainers();
    const full = BuildRoute(name, { ...fromRoute, ...args });
    const s = this.Stack;
    if (!this.CanNavigate(full, "Push", undefined, s[s.length - 1]?.Host)) return;
    const entry = this.CreatePage(full, args ? { ...fromRoute, ...args } : undefined, this.selected);
    s.push(entry);
    this.PushHistory("page", this.NavigationStack);
    if (animated) this.transitions++;
    this.RenderChrome();
    this.Notify();
    this.CheckRoute();
    if (animated) {
      await new Promise((res) => setTimeout(res, this.PagesAnimationSpeed + 50));
      this.transitions--;
      this.RenderChrome();
    }
    await this.Ready(entry.Content);
    this.NotifyNavigated(full, "Push", entry.Host.IsDisposed ? undefined : entry.Host);
  }

  /** C# GoBack: closes the top popup, else the top modal, else pops the page. */
  async GoBackAsync(animated = true): Promise<void> {
    if (this.popups.length) { await this.ClosePopup(this.popups[this.popups.length - 1], animated); return; }
    if (this.modals.some((m) => !m.left)) { await this.PopModalAsync(animated); return; }
    const count = this.Stack.length;
    if (!count) return;
    if (this.BackThroughHistory("page")) { await WaitFor(() => this.Stack.length < count, this.PagesAnimationSpeed + 800); return; }
    await this.PopPage(animated);
  }

  /** Pops every page of every tab at once. */
  async PopToRootAsync(): Promise<void> {
    this.leaving = undefined;
    if (this.HistoryOn) {
      const pages = this.history.filter((k) => k === "page").length;
      this.history = this.history.filter((k) => k !== "page");
      if (pages) window.history.replaceState({ [HISTORY_KEY]: this.history.length }, "", this.HashFor([]));
    }
    for (let t = 0; t < this.stacks.length; t++) { for (const p of this.stacks[t]) this.RemovePageHost(p); this.stacks[t] = []; }
    this.RenderChrome();
    this.Notify();
    this.CheckRoute();
  }

  /** Pops every page of the current tab (C# PopTabToRoot). */
  async PopTabToRootAsync(): Promise<void> {
    this.leaving = undefined;
    for (const p of this.Stack) this.RemovePageHost(p);
    this.stacks[this.selected] = [];
    this.RenderChrome();
    this.Notify();
    this.CheckRoute();
  }

  /** Tabs (C# SkiaViewSwitcher.SelectedIndex): each tab keeps its own page stack. */
  async SelectTabAsync(index: number): Promise<void> {
    if (!this.HasTabs) return;
    this.EnsureContainers();
    const to = Math.max(0, Math.min(this.tabs!.length - 1, index));
    const from = this.selected;
    this.leaving = undefined;
    if (to === from) { this.RenderChrome(); return; }
    if (!this.AnimateTabs) { this.selected = to; this.RenderChrome(); this.Notify(); this.CheckRoute(); return; }
    // C# SelectRightTab / SelectLeftTab: the new root slides in from 0.75 width with a fade, the old one slides out.
    // The animations take their start values before the new root is placed off to the side, so the new root shows at
    // once over the old one sliding out under it (the shell has always done this, kept as is)
    const dir: 1 | -1 = to > from ? 1 : -1;
    const next = this.containers[to], prev = this.containers[from];
    const speed = this.TabsAnimationSpeed;
    const w = CanvasWidthPts(next);
    const anim = Promise.all([
      next.TranslateToAsync(0, 0, speed, TabsEasing),
      next.FadeToAsync(1, speed, Easing.Linear),
      prev.TranslateToAsync(-dir * w, 0, speed, TabsEasing),
    ]);
    this.tabTransition = { from, dir };
    this.selected = to;
    this.RenderChrome();
    this.Notify();
    this.CheckRoute();
    await AnimateWithTimeout(anim, speed + 500);
    // the tab left stays (its state kept): hidden first, then back in place for its next turn
    prev.IsVisible = false; prev.TranslationX = 0; prev.TranslationY = 0;
    this.tabTransition = undefined;
    this.RenderChrome();
  }

  // ---- popups ----

  private async ClosePopupNow(p: Overlay, animated: boolean): Promise<boolean> {
    if (p.closing) return false;
    if (!this.CanNavigate(this.Route, "Pop", p.content, p.content)) return false;
    p.closing = true;
    if (animated && p.animated !== false && p.content) {
      await AnimateWithTimeout(Promise.all([p.ctrl.FadeToAsync(0, ShellDefaults.PopupsAnimationSpeed), p.content.ScaleToAsync(0, 0, ShellDefaults.PopupsAnimationSpeed)]));
    }
    this.RemoveOverlay(this.popups, p);
    this.NotifyNavigated(this.Route, "Pop");
    return true;
  }
  private async ClosePopup(p: Overlay, animated: boolean): Promise<void> {
    if (p.closing) return;
    if (p.history && this.BackThroughHistory("popup")) { p.history = false; return; } // popstate closes it
    await this.ClosePopupNow(p, animated);
  }

  private RemoveOverlay(list: Overlay[], o: Overlay): void {
    const i = list.indexOf(o);
    if (i >= 0) list.splice(i, 1);
    if (!o.ctrl.IsDisposed) {
      this.RemoveSubView(o.ctrl);
      this.Detach(o.body);
      o.ctrl.Dispose();
    }
    this.Notify();
  }

  /** Shows `content` centered over the page (C# OpenPopupAsync): scales in, a tap outside closes it. */
  async OpenPopupAsync(content: ShellContent, options?: PopupOptions): Promise<void> {
    const animated = options?.animated ?? true;
    if (!this.CanNavigate(this.Route, "Push")) return;
    const id = this.nextId++;
    const closeWhenBackgroundTapped = options?.closeWhenBackgroundTapped ?? true;
    const showOverlay = options?.showOverlay ?? true;
    const overlay = options?.backgroundColor ?? ShellDefaults.PopupBackgroundColor;
    const entry = { id, animated, body: content } as Overlay;
    // a dialog for screen readers and the keyboard while open (drawnui-cross 6av, C# 2be842b8): its outside-tap close
    // stays, but the wrapper is no Tab stop; the backdrop is no node
    entry.ctrl = this.Create(SkiaLayer, {
      VerticalOptions: "Fill", HorizontalOptions: "Fill", ZIndex: ShellDefaults.ZIndexPopups + id, BlockGesturesBelow: true, Opacity: animated ? 0.1 : 1,
      AccessibilityModal: true, AccessibilityCanInteract: false,
      Tapped: (_: SkiaControl, e: ControlTappedEventArgs) => {
        // C# PopupWrapper: a tap outside the content closes it
        const c = entry.content;
        const l = e.ProcessingInfo.MappedLocation, o = e.ProcessingInfo.ChildOffset;
        if (closeWhenBackgroundTapped && c && !c.HitIsInside(l.X + o.X, l.Y + o.Y)) void this.ClosePopup(entry, animated);
      },
    });
    if (showOverlay) entry.ctrl.InsertChild(this.Create(SkiaBackdrop, { Blur: ShellDefaults.PopupsBackgroundBlur, BackgroundColor: overlay, InputTransparent: true }));
    entry.content = this.Create(SkiaLayer, { HorizontalOptions: "Center", VerticalOptions: "Center", Scale: animated ? 0.5 : 1 });
    this.Place(content, entry.content);
    entry.ctrl.InsertChild(entry.content);
    this.popups.push(entry);
    this.InsertChild(entry.ctrl);
    this.Notify();
    entry.history = true;
    this.PushHistory("popup", this.NavigationStack);
    await this.Ready(content);
    if (animated && !entry.ctrl.IsDisposed) await AnimateWithTimeout(Promise.all([entry.ctrl.FadeToAsync(1, ShellDefaults.PopupsAnimationSpeed), entry.content.ScaleToAsync(1, 1, ShellDefaults.PopupsAnimationSpeed)]));
    this.NotifyNavigated(this.Route, "Push", entry.content);
  }

  /** Closes the top popup. */
  async ClosePopupAsync(animated = true): Promise<void> {
    const top = this.popups[this.popups.length - 1];
    if (top) await this.ClosePopup(top, animated);
  }
  /** Closes every popup, without animation. */
  async CloseAllPopups(): Promise<void> { for (const p of [...this.popups].reverse()) await this.ClosePopup(p, false); }

  // ---- modals ----

  /**
   * A modal leaves the modal stack the moment its close starts, whatever started it (PopModalAsync, a swipe, IsOpen =
   * false): ModalsCount and CanGoBack drop it and Navigated Pop is raised; its drawer takes no more pans. It stays on
   * screen until its slide ends (drawnui-cross 6s, C# SkiaShell.LeaveModalStack).
   */
  private LeaveModalStack(m: Overlay): void {
    if (m.left) return;
    m.left = true;
    if (m.drawer) m.drawer.RespondsToGestures = false;
    this.Notify();
    this.NotifyNavigated(this.Route, "Pop");
  }

  private async PopModalNow(top: Overlay, animated: boolean): Promise<boolean> {
    if (top.closing) return false;
    if (!this.CanNavigate(this.Route, "Pop", top.drawer, top.drawer)) return false;
    top.closing = true;
    this.LeaveModalStack(top);
    const drawer = top.drawer;
    if (drawer && drawer.IsOpen) {
      drawer.Animated = animated;
      const done = new Promise<void>((r) => { const prev = drawer.StateTransitionComplete; drawer.StateTransitionComplete = (d, o) => { prev?.(d, o); if (!o) r(); }; });
      drawer.IsOpen = false;
      if (animated) await AnimateWithTimeout(done);
    }
    this.RemoveOverlay(this.modals, top);
    return true;
  }

  /** Shows `content` full screen in a drawer sliding up from the bottom (C# PushModalAsync). */
  async PushModalAsync(content: ShellContent, options?: ModalOptions): Promise<void> {
    const animated = options?.animated ?? true;
    if (!this.CanNavigate(this.Route, "Push")) return;
    const id = this.nextId++;
    const entry = { id, body: content } as Overlay;
    const overlay = (options?.freezeBackground ?? true) ? ShellDefaults.PopupBackgroundColor : undefined;
    let opened: () => void = () => {};
    const openedPromise = new Promise<void>((r) => { opened = r; });
    // the user closed it (drag down / IsOpen = false): leave through history when it owns an entry, else remove
    const userClosed = () => {
      if (entry.closing) return;
      if (entry.history && this.BackThroughHistory("modal")) entry.history = false;
      else { entry.closing = true; this.RemoveOverlay(this.modals, entry); }
    };
    // a dialog for screen readers and the keyboard while open (drawnui-cross 6av, C# 2be842b8)
    entry.ctrl = this.Create(SkiaLayer, { VerticalOptions: "Fill", HorizontalOptions: "Fill", ZIndex: ShellDefaults.ZIndexModals + id, BlockGesturesBelow: true, AccessibilityModal: true });
    if (overlay) entry.ctrl.InsertChild(this.Create(SkiaBackdrop, { Blur: ShellDefaults.PopupsBackgroundBlur, BackgroundColor: overlay, InputTransparent: true }));
    const drawer = this.Create(SkiaDrawer, {
      Direction: "FromBottom", HeaderSize: 0, HorizontalOptions: "Fill", VerticalOptions: "Fill",
      RespondsToGestures: options?.useGestures ?? false, Animated: animated, Bounces: false, BlockGesturesBelow: true, ClosingStarted: () => this.LeaveModalStack(entry),
      StateTransitionComplete: (d: SkiaDrawer, isOpen: boolean) => { if (isOpen) opened(); else if (!d.IsOpen) userClosed(); },
      IsOpenChanged: (_: SkiaDrawer, isOpen: boolean) => { if (!isOpen && !animated) userClosed(); },
    });
    entry.drawer = drawer;
    this.Place(content, drawer);
    entry.ctrl.InsertChild(drawer);
    this.modals.push(entry);
    this.InsertChild(entry.ctrl);
    this.Notify();
    entry.history = true;
    this.PushHistory("modal", this.NavigationStack);
    await this.Ready(content);
    await WaitFor(() => drawer.DrawingRect.Height > 0 || drawer.IsDisposed); // first draw: the drawer measured its travel
    if (!drawer.IsDisposed) { drawer.IsOpen = true; if (!animated) opened(); }
    await AnimateWithTimeout(openedPromise);
    this.NotifyNavigated(this.Route, "Push", drawer);
  }

  /** Closes the top modal. */
  async PopModalAsync(animated = true): Promise<void> {
    const top = [...this.modals].reverse().find((m) => !m.left); // a modal sliding out has left the stack
    if (!top || top.closing) return;
    if (top.history && this.BackThroughHistory("modal")) { top.history = false; return; }
    await this.PopModalNow(top, animated);
  }

  // ---- toasts ----

  private async CloseToast(t: Overlay, animated: boolean): Promise<void> {
    if (t.closing) return;
    t.closing = true;
    const c = t.ctrl;
    if (animated && !c.IsDisposed) await AnimateWithTimeout(Promise.all([c.TranslateToAsync(0, c.DrawingRect.Height / c.RenderingScale, 250), c.FadeToAsync(0, 250)]));
    this.RemoveOverlay(this.toasts, t);
  }

  /** Removes every toast, without animation. */
  async CloseAllToasts(): Promise<void> { await Promise.all([...this.toasts].map((t) => this.CloseToast(t, false))); }

  /** Shows a banner at the bottom for `msShowTime` ms: markdown text, or any content. */
  ShowToast(content: string | ShellContent, msShowTime = 4000): void {
    void (async () => {
      await this.CloseAllToasts();
      if (this.IsDisposed) return;
      const id = this.nextId++;
      const body: ShellContent = typeof content === "string"
        ? this.Create(SkiaRichLabel, { Text: content, TextColor: ShellDefaults.ToastTextColor, FontFamily: ShellDefaults.ToastTextFont || undefined, FontSize: ShellDefaults.ToastTextSize, Margin: new Thickness(ShellDefaults.ToastTextMargins), HorizontalOptions: "Fill" })
        : content;
      const entry = { id, body } as Overlay;
      entry.ctrl = this.Create(SkiaLayer, { HorizontalOptions: "Fill", VerticalOptions: "End", ZIndex: ShellDefaults.ZIndexToasts + id, BackgroundColor: ShellDefaults.ToastBackgroundColor, BlockGesturesBelow: true, UseCache: "Operations", Opacity: 0 });
      entry.content = this.Create(SkiaLayer, { HorizontalOptions: "Fill" });
      this.Place(body, entry.content);
      entry.ctrl.InsertChild(entry.content);
      this.toasts.push(entry);
      this.InsertChild(entry.ctrl);
      this.Notify();
      await this.Ready(body);
      const c = entry.ctrl;
      await WaitFor(() => c.DrawingRect.Height > 0 || c.IsDisposed); // laid out: height known
      if (!c.IsDisposed) {
        c.TranslationY = c.DrawingRect.Height / c.RenderingScale;
        void c.TranslateToAsync(0, 0, 300);
        void c.FadeToAsync(1, 300);
      }
      setTimeout(() => void this.CloseToast(entry, true), msShowTime);
    })();
  }
}
