import { createContext, forwardRef, type ReactNode, useCallback, useContext, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Colors, Thickness } from "../core/Types";
import type { SkiaControl } from "../core/SkiaControl";
import type { SkiaDrawer as SkiaDrawerCtrl } from "../controls/SkiaDrawer";
import type { ControlTappedEventArgs } from "../core/Gestures";
import { SkiaButton, SkiaDrawer, SkiaLabel, SkiaLayer, SkiaRichLabel } from "./index";

/** Route name -> page factory. Pages are plain JSX, rendered inside the shell when navigated to. */
export type ShellRoutes = Record<string, () => ReactNode>;

/** C# OpenPopupAsync parameters. */
export interface PopupOptions {
  animated?: boolean;
  /** A tap outside the content closes the popup (default true). */
  closeWhenBackgroundTapped?: boolean;
  /** Dim the page behind (default true). */
  showOverlay?: boolean;
  backgroundColor?: string;
}

/** C# PushModalAsync parameters. */
export interface ModalOptions {
  /** The modal can be dragged down to close (default false). */
  useGestures?: boolean;
  animated?: boolean;
  /** Dim the page behind (C# freezeBackground; the frozen screenshot is not ported, the overlay color is). */
  freezeBackground?: boolean;
}

/** Navigation API, same verbs as DrawnUi SkiaShell. */
export interface ShellNavigation {
  GoToAsync(route: string, animated?: boolean): Promise<void>;
  GoBackAsync(animated?: boolean): Promise<void>;
  PopToRootAsync(): Promise<void>;
  /** Routes below the current page, root excluded. */
  NavigationStack: readonly string[];
  CanGoBack: boolean;
  /** Current route, "" for the root content. */
  Route: string;
  /** Opens content centered over everything; resolves once shown (C# returns the wrapper control). */
  OpenPopupAsync(content: ReactNode, options?: PopupOptions): Promise<void>;
  /** Closes the top-most popup. */
  ClosePopupAsync(animated?: boolean): Promise<void>;
  CloseAllPopups(): Promise<void>;
  /** Pushes content as a full-screen SkiaDrawer sliding from the bottom; resolves when open. */
  PushModalAsync(content: ReactNode, options?: ModalOptions): Promise<void>;
  PopModalAsync(animated?: boolean): Promise<void>;
  /** Shows text (SkiaRichLabel) or content at the bottom for msShowTime, replacing any toast. */
  ShowToast(content: string | ReactNode, msShowTime?: number): void;
  CloseAllToasts(): Promise<void>;
  PopupsCount: number;
  ModalsCount: number;
  ToastsCount: number;
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
  /** Root content shown when the stack is empty. */
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
}

/** C# SkiaShell static defaults (mutable). */
export const ShellDefaults = {
  ToastBackgroundColor: "#CC000000",
  ToastTextColor: Colors.White,
  ToastTextFont: "",
  ToastTextSize: 16,
  ToastTextMargins: 24,
  /** Default overlay tint behind popups / modals. */
  PopupBackgroundColor: "#66000000",
  PopupsAnimationSpeed: 250,
  PopupsCancelAnimationsAfterMs: 1500,
  ZIndexModals: 1000,
  ZIndexPopups: 2000,
  ZIndexToasts: 3000,
};

interface Overlay { id: number; node: ReactNode; ctrl?: SkiaControl; drawer?: SkiaDrawerCtrl; content?: SkiaControl; closing?: boolean }

/** Canvas width in points for a control (page slide distance); falls back to the window. */
function CanvasWidthPts(ctrl: SkiaControl): number {
  const el = (ctrl.Superview as unknown as { Element?: HTMLCanvasElement } | undefined)?.Element;
  return el ? el.clientWidth : window.innerWidth;
}

/** Resolves once pred() is truthy (a ref set by the React commit) or after timeout ms. */
async function WaitFor<T>(pred: () => T | undefined | null, timeout = 1000): Promise<T | undefined> {
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

/**
 * Mirrors DrawnUi SkiaShell at the React level: a root page plus a stack of routed pages drawn inside one
 * SkiaLayer with a nav bar (pages slide in/out like SkiaViewSwitcher), popups (dimmed backdrop, scale + fade,
 * tap outside to close), modals (full-screen SkiaDrawer from the bottom, optionally draggable), toasts (bottom
 * banner, slide + fade, auto close). Navigation via ref or useShell().
 */
export const SkiaShell = forwardRef<ShellNavigation, SkiaShellProps>(function SkiaShell(
  { Routes, children, NavBarHeight = 56, NavBarColor = "#212529", Titles, PagesAnimationSpeed = 200, PageBackgroundColor = "#212529" }, ref,
) {
  const [stack, setStack] = useState<string[]>([]);
  const [leaving, setLeaving] = useState<string | null>(null); // page sliding out during a pop
  const [transitions, setTransitions] = useState(0); // pages sliding in: the page below stays visible meanwhile
  const [popups, setPopups] = useState<Overlay[]>([]);
  const [modals, setModals] = useState<Overlay[]>([]);
  const [toasts, setToasts] = useState<Overlay[]>([]);
  const nextId = useRef(1);
  const pageCtrls = useRef(new Map<string, SkiaControl>());
  const route = stack[stack.length - 1] ?? "";

  // ---- pages ----
  const GoToAsync = useCallback(async (r: string, animated = true) => {
    if (!Routes[r]) throw new Error(`DrawnUi: route '${r}' is not registered in SkiaShell.Routes`);
    setStack((s) => [...s, r]);
    if (animated) { setTransitions((t) => t + 1); await new Promise((res) => setTimeout(res, PagesAnimationSpeed + 50)); setTransitions((t) => t - 1); }
  }, [Routes, PagesAnimationSpeed]);

  const GoBackAsync = useCallback(async (animated = true) => {
    const current = stack[stack.length - 1];
    if (!current) return;
    const ctrl = pageCtrls.current.get(current);
    if (animated && ctrl) {
      setLeaving(current);
      await AnimateWithTimeout(ctrl.TranslateToAsync(CanvasWidthPts(ctrl), 0, PagesAnimationSpeed), PagesAnimationSpeed + 500);
      setLeaving(null);
    }
    setStack((s) => s.slice(0, -1));
  }, [stack, PagesAnimationSpeed]);

  const PopToRootAsync = useCallback(async () => { setLeaving(null); setStack([]); }, []);

  // ---- popups ----
  const closePopup = useCallback(async (p: Overlay, animated: boolean) => {
    if (p.closing) return;
    p.closing = true;
    if (animated && p.ctrl && p.content) {
      await AnimateWithTimeout(Promise.all([p.ctrl.FadeToAsync(0, ShellDefaults.PopupsAnimationSpeed), p.content.ScaleToAsync(0, 0, ShellDefaults.PopupsAnimationSpeed)]));
    }
    setPopups((list) => list.filter((x) => x !== p));
  }, []);

  const OpenPopupAsync = useCallback(async (content: ReactNode, options?: PopupOptions) => {
    const animated = options?.animated ?? true;
    const entry: Overlay = { id: nextId.current++, node: null };
    const closeWhenBackgroundTapped = options?.closeWhenBackgroundTapped ?? true;
    const overlay = (options?.showOverlay ?? true) ? (options?.backgroundColor ?? ShellDefaults.PopupBackgroundColor) : undefined;
    entry.node = (
      <SkiaLayer key={entry.id} VerticalOptions="Fill" HorizontalOptions="Fill" ZIndex={ShellDefaults.ZIndexPopups + entry.id} BackgroundColor={overlay} BlockGesturesBelow Opacity={animated ? 0.1 : 1}
        ref={(c: SkiaControl | null) => { if (c) entry.ctrl = c; }}
        Tapped={(_, e: ControlTappedEventArgs) => {
          // C# PopupWrapper: a tap outside the content closes it
          const c = entry.content;
          const l = e.ProcessingInfo.MappedLocation, o = e.ProcessingInfo.ChildOffset;
          if (closeWhenBackgroundTapped && c && !c.HitIsInside(l.X + o.X, l.Y + o.Y)) void closePopup(entry, animated);
        }}>
        <SkiaLayer HorizontalOptions="Center" VerticalOptions="Center" Scale={animated ? 0.5 : 1} ref={(c: SkiaControl | null) => { if (c) entry.content = c; }}>
          {content}
        </SkiaLayer>
      </SkiaLayer>
    );
    setPopups((list) => [...list, entry]);
    if (!animated) return;
    await WaitFor(() => entry.ctrl && entry.content); // mounted after the React commit
    if (entry.ctrl && entry.content) await AnimateWithTimeout(Promise.all([entry.ctrl.FadeToAsync(1, ShellDefaults.PopupsAnimationSpeed), entry.content.ScaleToAsync(1, 1, ShellDefaults.PopupsAnimationSpeed)]));
  }, [closePopup]);

  const ClosePopupAsync = useCallback(async (animated = true) => { const top = popups[popups.length - 1]; if (top) await closePopup(top, animated); }, [popups, closePopup]);
  const CloseAllPopups = useCallback(async () => { await Promise.all(popups.map((p) => closePopup(p, false))); }, [popups, closePopup]);

  // ---- modals ----
  const removeModal = useCallback((m: Overlay) => setModals((list) => list.filter((x) => x !== m)), []);

  const PushModalAsync = useCallback(async (content: ReactNode, options?: ModalOptions) => {
    const animated = options?.animated ?? true;
    const entry: Overlay = { id: nextId.current++, node: null };
    const overlay = (options?.freezeBackground ?? true) ? ShellDefaults.PopupBackgroundColor : undefined;
    let opened: () => void = () => {};
    const openedPromise = new Promise<void>((r) => { opened = r; });
    entry.node = (
      <SkiaLayer key={entry.id} VerticalOptions="Fill" HorizontalOptions="Fill" ZIndex={ShellDefaults.ZIndexModals + entry.id} BackgroundColor={overlay} BlockGesturesBelow>
        <SkiaDrawer ref={(d: SkiaDrawerCtrl | null) => { if (d) entry.drawer = d; }} Direction="FromBottom" HeaderSize={0} HorizontalOptions="Fill" VerticalOptions="Fill"
          RespondsToGestures={options?.useGestures ?? false} Animated={animated} Bounces={false} BlockGesturesBelow
          StateTransitionComplete={(d, isOpen) => { if (isOpen) opened(); else if (entry.closing || !d.IsOpen) removeModal(entry); }}
          IsOpenChanged={(_, isOpen) => { if (!isOpen && !animated) removeModal(entry); }}>
          {content}
        </SkiaDrawer>
      </SkiaLayer>
    );
    setModals((list) => [...list, entry]);
    const drawer = await WaitFor(() => entry.drawer);
    await WaitFor(() => drawer && drawer.DrawingRect.Height > 0); // first draw: the drawer measured its travel
    if (drawer) { drawer.IsOpen = true; if (!animated) opened(); }
    await AnimateWithTimeout(openedPromise);
  }, [removeModal]);

  const PopModalAsync = useCallback(async (animated = true) => {
    const top = modals[modals.length - 1];
    if (!top || top.closing) return;
    top.closing = true;
    if (top.drawer) {
      top.drawer.Animated = animated;
      const done = new Promise<void>((r) => { const prev = top.drawer!.StateTransitionComplete; top.drawer!.StateTransitionComplete = (d, o) => { prev?.(d, o); if (!o) r(); }; });
      top.drawer.IsOpen = false;
      if (animated) await AnimateWithTimeout(done);
    }
    removeModal(top);
  }, [modals, removeModal]);

  // ---- toasts ----
  const closeToast = useCallback(async (t: Overlay, animated: boolean) => {
    if (t.closing) return;
    t.closing = true;
    const c = t.ctrl;
    if (animated && c) await AnimateWithTimeout(Promise.all([c.TranslateToAsync(0, c.DrawingRect.Height / c.RenderingScale, 250), c.FadeToAsync(0, 250)]));
    setToasts((list) => list.filter((x) => x !== t));
  }, []);

  const toastsRef = useRef<Overlay[]>([]);
  toastsRef.current = toasts;
  const CloseAllToasts = useCallback(async () => { await Promise.all(toastsRef.current.map((t) => closeToast(t, false))); }, [closeToast]);

  const ShowToast = useCallback((content: string | ReactNode, msShowTime = 4000) => {
    void (async () => {
      await CloseAllToasts();
      const entry: Overlay = { id: nextId.current++, node: null };
      const body = typeof content === "string"
        ? <SkiaRichLabel Text={content} TextColor={ShellDefaults.ToastTextColor} FontFamily={ShellDefaults.ToastTextFont || undefined} FontSize={ShellDefaults.ToastTextSize} Margin={new Thickness(ShellDefaults.ToastTextMargins)} HorizontalOptions="Fill" />
        : content;
      entry.node = (
        <SkiaLayer key={entry.id} HorizontalOptions="Fill" VerticalOptions="End" ZIndex={ShellDefaults.ZIndexToasts + entry.id} BackgroundColor={ShellDefaults.ToastBackgroundColor} BlockGesturesBelow UseCache="Operations" Opacity={0}
          ref={(c: SkiaControl | null) => { if (c) entry.ctrl = c; }}>
          <SkiaLayer HorizontalOptions="Fill">{body}</SkiaLayer>
        </SkiaLayer>
      );
      setToasts((list) => [...list, entry]);
      const c = await WaitFor(() => entry.ctrl);
      await WaitFor(() => c && c.DrawingRect.Height > 0); // laid out: height known
      if (c) {
        c.TranslationY = c.DrawingRect.Height / c.RenderingScale;
        void c.TranslateToAsync(0, 0, 300);
        void c.FadeToAsync(1, 300);
      }
      setTimeout(() => void closeToast(entry, true), msShowTime);
    })();
  }, [CloseAllToasts, closeToast]);

  const nav = useMemo<ShellNavigation>(() => ({
    GoToAsync, GoBackAsync, PopToRootAsync, NavigationStack: stack, CanGoBack: stack.length > 0, Route: route,
    OpenPopupAsync, ClosePopupAsync, CloseAllPopups, PushModalAsync, PopModalAsync, ShowToast, CloseAllToasts,
    PopupsCount: popups.length, ModalsCount: modals.length, ToastsCount: toasts.length,
  }), [GoToAsync, GoBackAsync, PopToRootAsync, stack, route, OpenPopupAsync, ClosePopupAsync, CloseAllPopups, PushModalAsync, PopModalAsync, ShowToast, CloseAllToasts, popups.length, modals.length, toasts.length]);
  useImperativeHandle(ref, () => nav, [nav]);

  const visiblePages = leaving && !stack.includes(leaving) ? [...stack, leaving] : stack;
  const topRoute = visiblePages[visiblePages.length - 1] ?? "";
  const transitioning = transitions > 0 || leaving !== null;

  return (
    <ShellContext.Provider value={nav}>
      <SkiaLayer VerticalOptions="Fill">
        <SkiaLayer VerticalOptions="Fill" IsVisible={visiblePages.length === 0 || transitioning}>{children}</SkiaLayer>
        {visiblePages.map((r, i) => (
          <PageHost key={`${r}#${i}`} route={r} speed={PagesAnimationSpeed} visible={r === topRoute || transitioning} background={PageBackgroundColor}
            register={(c) => { if (c) pageCtrls.current.set(r, c); else pageCtrls.current.delete(r); }}>
            <SkiaLayer VerticalOptions="Fill" Margin={new Thickness(0, NavBarHeight, 0, 0)}>{Routes[r]()}</SkiaLayer>
            <SkiaLayer HeightRequest={NavBarHeight} BackgroundColor={NavBarColor}>
              <SkiaButton Text="‹  Back" BackgroundColor="#00000000" TextColor="#6EA8FE" FontSize={16} VerticalOptions="Center" Margin={new Thickness(8, 0)} ApplyEffect="Ripple" Tapped={() => void GoBackAsync()} AccessibilityRole="button" AccessibilityLabel="Back" />
              <SkiaLabel Text={Titles?.[r] ?? r} FontSize={18} FontFamily="FontTextBold" TextColor={Colors.White} HorizontalOptions="Fill" HorizontalTextAlignment="Center" VerticalOptions="Center" MaxLines={1} Margin={new Thickness(96, 0)} AccessibilityRole="heading" />
              <SkiaLayer HeightRequest={1} VerticalOptions="End" BackgroundColor="#343A40" />
            </SkiaLayer>
          </PageHost>
        ))}
        {modals.map((m) => m.node)}
        {popups.map((p) => p.node)}
        {toasts.map((t) => t.node)}
      </SkiaLayer>
    </ShellContext.Provider>
  );
});

/** A pushed page: slides in from the right on mount (C# SkiaViewSwitcher PushView), covers what is below. */
function PageHost({ route, speed, visible, background, register, children }: { route: string; speed: number; visible: boolean; background: string; register: (c: SkiaControl | null) => void; children: ReactNode }) {
  const ctrl = useRef<SkiaControl | null>(null);
  useEffect(() => {
    const c = ctrl.current;
    if (!c) return;
    register(c);
    if (speed > 0) { c.TranslationX = CanvasWidthPts(c); void c.TranslateToAsync(0, 0, speed); }
    return () => register(null);
  }, [route]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <SkiaLayer ref={(c: SkiaControl | null) => { ctrl.current = c; }} VerticalOptions="Fill" HorizontalOptions="Fill" BackgroundColor={background} IsVisible={visible} BlockGesturesBelow>
      {children}
    </SkiaLayer>
  );
}
