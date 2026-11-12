// The engine SkiaShell used from code, without React (`npm run check:shell-core`): RootContent shows, OpenPopupAsync /
// ClosePopupAsync and PushModalAsync / PopModalAsync change PopupsCount / ModalsCount, a pushed page and GoBackAsync,
// Navigated raised for Push and Pop; a popup around a named dialog reads as one dialog and, once closed, gives the keyboard
// back to the control that opened it (drawnui-cross 6av / 6bs).
import { readFileSync } from "node:fs";
import { Super, SKRect, Thickness, SkiaAccessibilityManager, HoverManager, SkiaShell, SkiaLayer, SkiaShape, SkiaStack, Aria, type ShellArguments, type SkiaShellNavigatedArgs, type SkiaControl, type AnimatorBase, type Canvas } from "../src/index.ts";

declare const CanvasKitInit: (o: { locateFile: () => string }) => Promise<any>;
const ROOT = process.cwd();
const W = 400, H = 600;
let failures = 0;
const check = (name: string, ok: boolean, detail = "") => { if (!ok) failures++; console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`); };

class FakeCanvas {
  readonly AccessibilityManager = new SkiaAccessibilityManager();
  readonly Hover = new HoverManager();
  readonly AnimatingControls = new Map<number, AnimatorBase>();
  RenderingScale = 1;
  GpuEpoch = 0;
  Update(): void {}
  DisposeObject(o: { Dispose(): void }): void { o.Dispose(); }
  RegisterAnimator(a: AnimatorBase): boolean { this.AnimatingControls.set(a.Uid, a); return true; }
  UnregisterAnimator(uid: number): void { this.AnimatingControls.delete(uid); }
  ControlLeft(): void {}
}

(async () => {
  const CK = await CanvasKitInit({ locateFile: () => `${ROOT}/node_modules/canvaskit-wasm/bin/full/canvaskit.wasm` });
  (Super as unknown as { CK: unknown }).CK = CK;
  const face = CK.Typeface.MakeFreeTypeFaceFromData(readFileSync(`${ROOT}/samples/public/fonts/OpenSans-Regular.ttf`).buffer);
  Super.Fonts.set("FontText", new Map([[400, face]])); Super.DefaultTypeface = face; Super.DefaultFontAlias = "FontText";

  const fake = new FakeCanvas();
  const mgr = fake.AccessibilityManager;
  mgr.MinUpdateIntervalMs = 0;
  const surface = CK.MakeSurface(W, H);
  const button = (name: string, top = 0) => {
    const b = new SkiaShape(); b.WidthRequest = 80; b.HeightRequest = 30; b.Margin = new Thickness(0, top, 0, 0);
    b.AccessibilityRole = Aria.RoleButton; b.AccessibilityLabel = name; b.Tapped = () => {};
    return b;
  };

  // the shell, from code: C# property names, content as controls
  const shell = new SkiaShell();
  shell.UseBrowserHistory = false;
  shell.PagesAnimationSpeed = 0;
  shell.Insets = Thickness.Zero;
  const pushed: string[] = [], popped: string[] = [], views: (SkiaControl | undefined)[] = [];
  shell.Navigated = (e: SkiaShellNavigatedArgs) => { (e.Source === "Push" ? pushed : popped).push(e.Route); views.push(e.View); };
  let detailArgs: ShellArguments | undefined;
  let detailPage: SkiaControl | undefined;
  shell.Routes = { detail: (args) => { detailArgs = args; const page = new SkiaLayer(); page.VerticalOptions = "Fill"; page.AddSubView(button("Inside detail")); detailPage = page; return page; } };
  const root = new SkiaLayer(); root.VerticalOptions = "Fill"; root.HorizontalOptions = "Fill";
  const opener = button("Help"), other = button("Pause", 40);
  root.AddSubView(opener); root.AddSubView(other);
  shell.RootContent = root;
  shell._superview = fake as unknown as Canvas;

  const frame = () => {
    for (const a of [...fake.AnimatingControls.values()]) a.TickFrame(performance.now() * 1e6);
    shell.Measure(W, H, 1); shell.Arrange(new SKRect(0, 0, W, H), W, H, 1);
    shell.Render({ Context: { Canvas: surface.getCanvas(), Surface: surface }, Destination: new SKRect(0, 0, W, H), Scale: 1 });
    mgr.OnFrameEnd(1, W, H, () => {});
    // the overlay's rule: a focused node that left the snapshot (it closed with the dialog) gives up the focus
    const f = mgr.FocusedNode; if (f && !mgr.Snapshot.some((n) => n.Source === f)) mgr.NotifyFocused(undefined);
  };
  const frames = async (n: number) => { for (let i = 0; i < n; i++) { await new Promise((r) => setTimeout(r, 20)); frame(); } };
  /** Frames until the promise settles (an animated close runs on the frames). */
  const settle = async (p: Promise<unknown>) => { let done = false; void p.then(() => { done = true; }); for (let i = 0; i < 100 && !done; i++) await frames(1); await frames(2); };
  const said = () => mgr.Snapshot.map((n) => `${n.Role}:${n.Label ?? ""}`);
  const shown = (c: SkiaControl) => { for (let p: SkiaControl | undefined = c; p; p = p.Parent) if (!p.IsVisible) return false; return c.Superview === (fake as unknown as Canvas) && !c.IsDisposed; };
  await frames(3);

  check("RootContent is shown", shown(root) && root.DrawingRect.Height > 0 && said().includes("button:Help"), said().join(", "));
  check("nothing pushed: Route empty, CanGoBack false", shell.Route === "" && !shell.CanGoBack && shell.NavigationStack.length === 0);

  // popup
  const card = new SkiaShape(); card.WidthRequest = 200; card.HeightRequest = 100;
  await settle(shell.OpenPopupAsync(card, { animated: false }));
  check("OpenPopupAsync: PopupsCount 1, the content shown", shell.PopupsCount === 1 && shown(card) && shell.CanGoBack, `PopupsCount ${shell.PopupsCount}`);
  check("Navigated Push for the popup, its view holds the content", pushed.length === 1 && views[0] !== undefined && card.Parent === views[0], `${pushed.length} Push`);
  await settle(shell.ClosePopupAsync(false));
  check("ClosePopupAsync: PopupsCount 0, the content gone", shell.PopupsCount === 0 && !shown(card) && popped.length === 1, `PopupsCount ${shell.PopupsCount}, ${popped.length} Pop`);

  // modal
  const sheet = new SkiaShape(); sheet.HorizontalOptions = "Fill"; sheet.VerticalOptions = "Fill";
  await settle(shell.PushModalAsync(sheet, { animated: false }));
  check("PushModalAsync: ModalsCount 1, the content shown", shell.ModalsCount === 1 && shown(sheet), `ModalsCount ${shell.ModalsCount}`);
  check("Navigated Push for the modal", pushed.length === 2);
  await settle(shell.PopModalAsync(false));
  check("PopModalAsync: ModalsCount 0, the content gone", shell.ModalsCount === 0 && !shown(sheet) && popped.length === 2, `ModalsCount ${shell.ModalsCount}, ${popped.length} Pop`);

  // a page
  await settle(shell.GoToAsync("detail", false, { id: 7, item: { name: "kept" } }));
  check("GoToAsync: the page is built with its arguments and shown over the root", shown(detailPage!) && !shown(root) && detailArgs?.id === 7 && (detailArgs?.item as { name: string })?.name === "kept",
    `id ${String(detailArgs?.id)}, root shown ${shown(root)}`);
  check("the stack holds the route with its query", shell.NavigationStack.join() === "detail?id=7" && shell.Route === "detail?id=7" && shell.Arguments.id === 7 && shell.CanGoBack, shell.NavigationStack.join());
  check("Navigated Push for the page", pushed.length === 3 && pushed[2] === "detail?id=7", pushed.join(", "));
  const page = detailPage!;
  await settle(shell.GoBackAsync(false));
  check("GoBackAsync: the page is popped, the root shown again", !shown(page) && shown(root) && shell.NavigationStack.length === 0 && shell.Route === "", shell.NavigationStack.join());
  check("Navigated Pop for the page, to the root route", popped.length === 3 && popped[2] === "", popped.join(", "));

  // a popup around a named dialog: one dialog for readers, the keyboard in it, then back to its opener
  mgr.NotifyFocused(opener);
  const dialog = new SkiaStack(); dialog.AccessibilityRole = Aria.RoleDialog; dialog.AccessibilityLabel = "HOW TO PLAY";
  dialog.AddSubView(button("OK")); dialog.AddSubView(button("Close"));
  await settle(shell.OpenPopupAsync(dialog, { showOverlay: false }));
  const named = mgr.ActiveModalNode;
  const otherDialogs = mgr.Snapshot.filter((n) => (n.Role === Aria.RoleDialog || n.Role === Aria.RoleAlertDialog) && n.Source !== mgr.ActiveModal && n !== named);
  check("a popup around a named dialog reads as one dialog, named after it", named?.Label === "HOW TO PLAY" && named.Role === Aria.RoleDialog && otherDialogs.length === 0,
    `dialog named ${named?.Label ?? "nothing"}; other dialogs ${otherDialogs.map((n) => n.Label || "(no name)").join(", ") || "none"}`);
  check("only the dialog's controls are read", said().includes("button:OK") && !said().includes("button:Pause"), said().join(", "));
  check("on open the keyboard is on the dialog's first control", mgr.FocusedNode?.AccessibilityLabel === "OK", mgr.FocusedNode?.AccessibilityLabel ?? "none");
  await settle(shell.ClosePopupAsync());
  await frames(3);
  check("after ClosePopupAsync (animated) the keyboard is back on the opener", mgr.ActiveModal === undefined && mgr.FocusedNode === opener, mgr.FocusedNode?.AccessibilityLabel ?? "none");

  shell.Dispose();
  check("disposed with its content", root.IsDisposed && dialog.IsDisposed);
  surface.delete();
  console.log(failures ? `FAIL: ${failures} checks` : "OK: the engine shell from code");
  process.exit(failures ? 1 : 0);
})();
