import { createContext, forwardRef, useContext, useImperativeHandle, useLayoutEffect, useMemo, useReducer, useRef, useState, type FC, type ReactNode } from "react";
import type { Thickness } from "../core/Types";
import type { SkiaControl } from "../core/SkiaControl";
import type { SkiaLayout } from "../controls/SkiaLayout";
import { SkiaShell as SkiaShellControl, SplitRoute, type ModalOptions, type PopupOptions, type ShellArguments, type ShellContent, type ShellContentHost, type ShellRouteFactory, type ShellTab, type SkiaShellNavigatedArgs, type SkiaShellNavigatingArgs } from "../controls/SkiaShell";
import { Registry, createDrawnPortal, type DrawnContainer } from "./reconciler";

// the shell itself lives in the engine ("drawnui-react/core" SkiaShell); these are its types and helpers
export { BuildRoute, ShellDefaults, SplitRoute, type ModalOptions, type NavigationSource, type PopupOptions, type ShellArguments, type ShellTab, type SkiaShellNavigatedArgs, type SkiaShellNavigatingArgs } from "../controls/SkiaShell";

/** Route name -> page factory receiving the navigation arguments. Pages are plain JSX, rendered inside the shell when navigated to. */
export type ShellRoutes = Record<string, (args: ShellArguments) => ReactNode>;

/** Navigation API, same verbs as DrawnUi SkiaShell. */
export interface ShellNavigation {
  /** Pushes a registered route; `route` may carry a query ("detail?id=42") and/or explicit arguments (C# GoToAsync(route, animate, arguments)). */
  GoToAsync(route: string, animated?: boolean, args?: ShellArguments): Promise<void>;
  /** C# GoBack: closes the top popup, else the top modal, else pops the page. */
  GoBackAsync(animated?: boolean): Promise<void>;
  PopToRootAsync(): Promise<void>;
  /** Routes below the current page of the current tab, root excluded. */
  NavigationStack: readonly string[];
  CanGoBack: boolean;
  /** Current route (with its query), "" for the root content. */
  Route: string;
  /** Arguments of the current page (query + explicit). */
  Arguments: ShellArguments;
  OpenPopupAsync(content: ReactNode, options?: PopupOptions): Promise<void>;
  ClosePopupAsync(animated?: boolean): Promise<void>;
  CloseAllPopups(): Promise<void>;
  PushModalAsync(content: ReactNode, options?: ModalOptions): Promise<void>;
  PopModalAsync(animated?: boolean): Promise<void>;
  ShowToast(content: string | ReactNode, msShowTime?: number): void;
  CloseAllToasts(): Promise<void>;
  PopupsCount: number;
  ModalsCount: number;
  ToastsCount: number;
  /** Tabs (C# SkiaViewSwitcher.SelectedIndex): each tab keeps its own page stack. */
  SelectedTab: number;
  SelectTabAsync(index: number): Promise<void>;
  /** Pops every page of the current tab (C# PopTabToRoot). */
  PopTabToRootAsync(): Promise<void>;
}

const ShellContext = createContext<ShellNavigation | null>(null);

/** Navigation for pages and buttons rendered inside a SkiaShell. */
export function useShell(): ShellNavigation {
  const shell = useContext(ShellContext);
  if (!shell) throw new Error("DrawnUi: useShell() must be used inside <SkiaShell>");
  return shell;
}

export interface SkiaShellProps {
  Routes: ShellRoutes;
  /** Root content shown when the stack is empty (ignored when Tabs are set: the selected tab's route is the root). */
  children?: ReactNode;
  /** Nav bar height in points when a page is open. */
  NavBarHeight?: number;
  NavBarColor?: string;
  /** Title shown in the nav bar; defaults to the route name. */
  Titles?: Record<string, string>;
  /** Page push/pop slide duration in ms (C# SkiaViewSwitcher.PagesAnimationSpeed). */
  PagesAnimationSpeed?: number;
  /** Opaque background of pushed pages (they slide over the page below). */
  PageBackgroundColor?: string;
  /** Bottom tab bar: one root route per tab, per-tab navigation stacks (C# SkiaViewSwitcher tabs). */
  Tabs?: ShellTab[];
  TabBarHeight?: number;
  TabBarColor?: string;
  /** Mirror pages in the URL hash (#/route/route) and honour the browser back button (React extension, default true). */
  UseBrowserHistory?: boolean;
  /** Slide + fade between tabs (C# SkiaViewSwitcher.AnimateTabs, default false). */
  AnimateTabs?: boolean;
  /** Tab switch duration in ms (C# TabsAnimationSpeed). */
  TabsAnimationSpeed?: number;
  /** Before a page / popup / modal is pushed or popped; set e.Cancel = true to stop it (C# Navigating). */
  Navigating?: (e: SkiaShellNavigatingArgs) => void;
  /** After a page / popup / modal went upfront or was removed (C# Navigated). */
  Navigated?: (e: SkiaShellNavigatedArgs) => void;
  /** The current route changed (C# RouteChanged). */
  RouteChanged?: (route: string) => void;
  /** Safe-area insets (points) reserved above the nav bar and below the tab bar; default Super.Insets (C# Super.Insets). */
  Insets?: Thickness;
}

/** Ties a `<SkiaShell>` element to its engine shell: re-renders on navigation, hands over the tab roots. */
interface Bridge {
  core?: ShellHost;
  changed(): void;
  tabHosts: PortalHost[];
  /** Pages and overlays the shell shows now: one portal each. */
  readonly attached: Set<PortalHost>;
  unmounted: boolean;
}

let nextPortalKey = 1;

/**
 * JSX shown by the engine shell: a portal into the room the shell made for it (a page's body, a popup's center, a
 * modal's drawer, a toast, a tab container). Its top-level controls go straight into that control, as JSX children of
 * it would, so the content keeps the contexts of the tree around `<SkiaShell>` and lays out exactly as before.
 */
class PortalHost implements ShellContentHost, DrawnContainer {
  readonly key = `p${nextPortalKey++}`;
  private parent?: SkiaLayout;
  private readonly children: SkiaControl[] = [];
  private detached = false;
  private committed = false;
  private readonly onCommitted: (() => void)[] = [];
  /**
   * @param render the JSX, read on every render of the `<SkiaShell>` element (pages follow the latest Routes)
   * @param fixed rendered by the element whether attached or not (the root, the tab roots)
   */
  constructor(public render: () => ReactNode, private readonly bridge: Bridge, readonly fixed = false) {}

  AttachTo(parent: SkiaLayout): void {
    this.parent = parent;
    this.detached = false;
    for (const c of this.children) parent.InsertChild(c);
    if (!this.fixed && !this.bridge.attached.has(this)) { this.bridge.attached.add(this); this.bridge.changed(); }
  }
  Detach(): void {
    if (this.detached) return;
    this.detached = true;
    const p = this.parent;
    this.parent = undefined;
    // the controls leave the shell now; React disposes them when it unmounts the portal
    if (p) for (const c of this.children) if (c.Parent === p) p.RemoveSubView(c);
    if (this.bridge.attached.delete(this)) this.bridge.changed();
  }
  Ready(): Promise<void> {
    if (this.committed) return Promise.resolve();
    return new Promise((r) => this.onCommitted.push(r));
  }
  /** The portal's first commit: its controls are in place. */
  Committed(): void {
    if (this.committed) return;
    this.committed = true;
    for (const r of this.onCommitted.splice(0)) r();
  }

  // ---- DrawnContainer: React places the portal's top-level controls ----
  appendChild(child: SkiaControl): void {
    const i = this.children.indexOf(child);
    if (i >= 0) this.children.splice(i, 1);
    this.children.push(child);
    this.parent?.InsertChild(child);
  }
  insertBefore(child: SkiaControl, before: SkiaControl): void {
    const i = this.children.indexOf(child);
    if (i >= 0) this.children.splice(i, 1);
    const at = this.children.indexOf(before);
    this.children.splice(at < 0 ? this.children.length : at, 0, child);
    this.parent?.InsertChild(child, before);
  }
  removeChild(child: SkiaControl): void {
    const i = this.children.indexOf(child);
    if (i >= 0) this.children.splice(i, 1);
    if (this.parent && child.Parent === this.parent) this.parent.RemoveSubView(child);
  }
  clear(): void { for (const c of [...this.children]) this.removeChild(c); }
}

/** Marks its portal committed (a layout effect runs after the portal's controls were placed). */
function Committed({ host }: { host: PortalHost }): null {
  useLayoutEffect(() => host.Committed(), [host]);
  return null;
}

/** The engine shell as the `<SkiaShell>` element hosts it: tells the element when to re-render, takes its tab roots. */
class ShellHost extends SkiaShellControl {
  private bridge?: Bridge;
  set Bridge(b: Bridge | undefined) { this.bridge = b; if (b) b.core = this; }
  get Bridge(): Bridge | undefined { return this.bridge; }
  protected override OnChanged(): void { this.bridge?.changed(); }
  protected override CreateTabRoot(index: number): ShellContent | undefined { return this.bridge?.tabHosts[index] ?? super.CreateTabRoot(index); }
}
Registry.SkiaShellHost = ShellHost;
const ShellHostTag = "SkiaShellHost" as unknown as FC<Record<string, unknown>>;

/**
 * DrawnUi SkiaShell for React: the engine SkiaShell ("drawnui-react/core") with JSX content. A root page (or tabs) plus
 * per-tab stacks of routed pages with a nav bar (pages slide in/out like SkiaViewSwitcher), popups (blurred + dimmed
 * backdrop, scale + fade, tap outside to close), modals (full-screen SkiaDrawer from the bottom, optionally draggable),
 * toasts (bottom banner, slide + fade, auto close). Pages live in the URL hash and the browser back button behaves like
 * C# GoBack (popup, then modal, then page). Navigation via ref or useShell().
 */
export const SkiaShell = forwardRef<ShellNavigation, SkiaShellProps>(function SkiaShell(
  { Routes, children, NavBarHeight = 56, NavBarColor = "#212529", Titles, PagesAnimationSpeed = 200, PageBackgroundColor = "#212529", Tabs, TabBarHeight = 56, TabBarColor = "#212529", UseBrowserHistory = true, AnimateTabs = false, TabsAnimationSpeed = 150, Navigating, Navigated, RouteChanged, Insets }, ref,
) {
  const hasTabs = !!Tabs && Tabs.length > 0;
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  const [bridge] = useState<Bridge>(() => ({
    tabHosts: [], attached: new Set(), unmounted: false,
    changed() { if (!this.unmounted) rerender(); },
  }));
  useLayoutEffect(() => { bridge.unmounted = false; return () => { bridge.unmounted = true; }; }, [bridge]);

  const routes = useRef(Routes);
  routes.current = Routes;
  const RenderRoute = (name: string, args: ShellArguments): ReactNode => routes.current[name]?.(args) ?? null;
  // the engine asks for a page: a portal host that renders the route's JSX
  const engineRoutes = useMemo<Record<string, ShellRouteFactory>>(() => Object.fromEntries(Object.keys(Routes).map((name) =>
    [name, (args: ShellArguments) => new PortalHost(() => RenderRoute(name, args), bridge)])), [Routes, bridge]); // eslint-disable-line react-hooks/exhaustive-deps

  const [rootHost] = useState(() => new PortalHost(() => null, bridge, true));
  rootHost.render = () => children;
  const tabsKey = hasTabs ? Tabs!.map((t) => t.route).join("\n") : "";
  bridge.tabHosts = useMemo(() => (hasTabs ? Tabs!.map((t) => new PortalHost(() => null, bridge, true)) : []), [tabsKey, bridge]); // eslint-disable-line react-hooks/exhaustive-deps
  if (hasTabs) bridge.tabHosts.forEach((h, i) => { const { name, args } = SplitRoute(Tabs![i]?.route ?? ""); h.render = () => RenderRoute(name, args); });

  const host = (content: ReactNode) => new PortalHost(() => content, bridge);
  const core = () => {
    if (!bridge.core) throw new Error("DrawnUi: SkiaShell is not mounted yet");
    return bridge.core;
  };
  const version = bridge.core?.NavVersion ?? 0;
  const nav = useMemo<ShellNavigation>(() => {
    const s = bridge.core;
    return {
      GoToAsync: (r, animated, args) => core().GoToAsync(r, animated, args),
      GoBackAsync: (animated) => core().GoBackAsync(animated),
      PopToRootAsync: () => core().PopToRootAsync(),
      NavigationStack: s ? s.NavigationStack : [],
      CanGoBack: s ? s.CanGoBack : false,
      Route: s ? s.Route : "",
      Arguments: s ? s.Arguments : {},
      OpenPopupAsync: (content, options) => core().OpenPopupAsync(host(content), options),
      ClosePopupAsync: (animated) => core().ClosePopupAsync(animated),
      CloseAllPopups: () => core().CloseAllPopups(),
      PushModalAsync: (content, options) => core().PushModalAsync(host(content), options),
      PopModalAsync: (animated) => core().PopModalAsync(animated),
      ShowToast: (content, ms) => core().ShowToast(typeof content === "string" ? content : host(content), ms),
      CloseAllToasts: () => core().CloseAllToasts(),
      PopupsCount: s ? s.PopupsCount : 0,
      ModalsCount: s ? s.ModalsCount : 0,
      ToastsCount: s ? s.ToastsCount : 0,
      SelectedTab: s ? s.SelectedTab : 0,
      SelectTabAsync: (index) => core().SelectTabAsync(index),
      PopTabToRootAsync: () => core().PopTabToRootAsync(),
    };
  }, [version, bridge]); // eslint-disable-line react-hooks/exhaustive-deps
  useImperativeHandle(ref, () => nav, [nav]);

  const portal = (h: PortalHost) => createDrawnPortal(<>{h.render()}<Committed host={h} /></>, h, h.key);
  return (
    <ShellContext.Provider value={nav}>
      <ShellHostTag Bridge={bridge} VerticalOptions="Fill" Routes={engineRoutes} Titles={Titles} NavBarHeight={NavBarHeight} NavBarColor={NavBarColor}
        PagesAnimationSpeed={PagesAnimationSpeed} PageBackgroundColor={PageBackgroundColor} TabBarHeight={TabBarHeight} TabBarColor={TabBarColor}
        UseBrowserHistory={UseBrowserHistory} AnimateTabs={AnimateTabs} TabsAnimationSpeed={TabsAnimationSpeed} Navigating={Navigating} Navigated={Navigated}
        RouteChanged={RouteChanged} Insets={Insets} Tabs={Tabs} RootContent={rootHost}>
        {hasTabs ? bridge.tabHosts.map(portal) : portal(rootHost)}
        {[...bridge.attached].map(portal)}
      </ShellHostTag>
    </ShellContext.Provider>
  );
});
