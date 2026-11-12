// Dialogs for screen readers and the keyboard (drawnui-cross 6bs, the WAI-ARIA dialog pattern), checked in Node
// (`npm run check:dialog-a11y`): a popup host that is only a modal scope (no name) around a named dialog gives ONE dialog,
// named after the dialog inside; when it opens the keyboard goes into it (its first control), Tab stays inside, and when
// it closes (at once, or after fading out) the keyboard goes back to the control that opened it.
import { readFileSync } from "node:fs";
import { Super, SKRect, SkiaAccessibilityManager, HoverManager, SkiaLayer, SkiaShape, SkiaStack, Aria, Thickness, type AnimatorBase, type Canvas, type SkiaControl } from "../src/index.ts";

declare const CanvasKitInit: (o: { locateFile: () => string }) => Promise<any>;
const ROOT = process.cwd();
const W = 400, H = 300;
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

  const button = (name: string, top = 0) => {
    const b = new SkiaShape(); b.WidthRequest = 80; b.HeightRequest = 30; b.Margin = new Thickness(0, top, 0, 0);
    b.AccessibilityRole = Aria.RoleButton; b.AccessibilityLabel = name; b.Tapped = () => {};
    return b;
  };
  const fake = new FakeCanvas();
  const mgr = fake.AccessibilityManager;
  mgr.MinUpdateIntervalMs = 0;
  const root = new SkiaLayer(); root.WidthRequest = W; root.HeightRequest = H;
  const opener = button("Help"), other = button("Pause", 40);
  root.AddSubView(opener); root.AddSubView(other);
  root._superview = fake as unknown as Canvas;
  const surface = CK.MakeSurface(W, H);
  const frame = () => {
    root.Measure(W, H, 1); root.Arrange(new SKRect(0, 0, W, H), W, H, 1);
    root.Render({ Context: { Canvas: surface.getCanvas(), Surface: surface }, Destination: new SKRect(0, 0, W, H), Scale: 1 });
    mgr.OnFrameEnd(1, W, H, () => {});
  };
  const frames = (n: number) => { for (let i = 0; i < n; i++) frame(); };
  // the overlay's rule: a focused node that left the snapshot (it closed with the dialog) gives up the focus
  const lost = () => { const f = mgr.FocusedNode; if (f && !mgr.Snapshot.some((n) => n.Source === f)) mgr.NotifyFocused(undefined); };
  const name = (c?: SkiaControl) => c ? c.AccessibilityLabel ?? c.constructor.name : "none";
  frames(2);

  // the opener has the keyboard (as when Tab reached it and Enter was pressed)
  mgr.NotifyFocused(opener);
  const open = (title = "HOW TO PLAY") => {
    const dialog = new SkiaStack(); dialog.AccessibilityRole = Aria.RoleDialog; dialog.AccessibilityLabel = title;
    dialog.HorizontalOptions = "Center"; dialog.VerticalOptions = "Center";
    dialog.AddSubView(button("OK")); dialog.AddSubView(button("Close"));
    const host = new SkiaLayer(); host.HorizontalOptions = "Fill"; host.VerticalOptions = "Fill"; host.AccessibilityModal = true;
    host.AccessibilityCanInteract = false; host.AddSubView(dialog);
    root.AddSubView(host);
    return host;
  };

  for (const closing of ["at once", "after fading out", "after shrinking away", "with the opener hidden while it is open"]) {
    mgr.NotifyFocused(opener);
    const host = open();
    const hideOpener = closing === "with the opener hidden while it is open";
    if (hideOpener) { opener.IsVisible = false; opener.Update(); }
    frames(3);
    // the overlay: the modal's container is the dialog (role, name); the nodes it names it after are not shown again
    const named = mgr.ActiveModalNode;
    const shownDialogs = mgr.Snapshot.filter((n) => (n.Role === Aria.RoleDialog || n.Role === Aria.RoleAlertDialog) && n.Source !== mgr.ActiveModal && n !== named);
    check(`${closing}: one dialog for a nameless modal scope around a named dialog`, named?.Label === "HOW TO PLAY" && named.Role === Aria.RoleDialog && shownDialogs.length === 0,
      `overlay dialog named ${named?.Label ?? "nothing"}; other dialog nodes ${shownDialogs.map((n) => n.Label || "(no name)").join(", ") || "none"}`);
    check(`${closing}: on open the keyboard is on the dialog's first control`, mgr.FocusedNode?.AccessibilityLabel === "OK", name(mgr.FocusedNode));
    const next = mgr.NextTabStop(mgr.FocusedNode, true), round = mgr.NextTabStop(next, true);
    check(`${closing}: Tab stays inside (OK, Close, OK)`, name(next) === "Close" && name(round) === "OK", `${name(next)}, ${name(round)}`);
    if (closing === "after fading out") { host.Opacity = 0; host.RepaintComposition(); frame(); lost(); frame(); }
    if (closing === "after shrinking away") {
      // as the shell's popup close: the content scales to 0 while the layer fades, then the layer goes
      const content = host.Views[0];
      for (const k of [0.6, 0.3, 0]) { content.ScaleX = k; content.ScaleY = k; host.Opacity = Math.max(k, 0.01); content.RepaintComposition(); frame(); lost(); }
    }
    root.RemoveSubView(host); host.Dispose();
    if (hideOpener) { frame(); lost(); opener.IsVisible = true; opener.Update(); } // shown again a frame after the close
    for (let i = 0; i < 3; i++) { frame(); lost(); }
    check(`${closing}: on close the keyboard is back on the control that opened it`, mgr.FocusedNode === opener, name(mgr.FocusedNode));
  }

  // a dialog that hands over to another (How to play, then Paused, the opener hidden under both): closing the second
  // gives the keyboard back to the first opener (drawnui-cross 6bs)
  for (const gap of ["in the same frame", "a frame later"]) {
    mgr.NotifyFocused(opener);
    const first = open(); opener.IsVisible = false; opener.Update(); frames(3);
    root.RemoveSubView(first); first.Dispose();
    if (gap === "a frame later") { frame(); lost(); }
    const second = open("PAUSED");
    for (let i = 0; i < 3; i++) { frame(); lost(); }
    check(`hand-over ${gap}: the second dialog takes the keyboard`, mgr.FocusedNode?.Parent === second.Views[0], name(mgr.FocusedNode));
    root.RemoveSubView(second); second.Dispose();
    frame(); lost(); opener.IsVisible = true; opener.Update();
    for (let i = 0; i < 3; i++) { frame(); lost(); }
    check(`hand-over ${gap}: closing it gives the keyboard back to the first opener`, mgr.FocusedNode === opener, name(mgr.FocusedNode));
  }

  // a dialog whose buttons show a moment after it opens takes the keyboard once they show (6bs, up to 1 s)
  {
    mgr.NotifyFocused(opener);
    const late = open("LATE");
    const content = late.Views[0] as SkiaStack;
    const buttons = [...content.Views]; for (const b of buttons) b.IsVisible = false;
    for (let i = 0; i < 3; i++) { frame(); lost(); }
    for (const b of buttons) { b.IsVisible = true; b.Update(); }
    for (let i = 0; i < 3; i++) { frame(); lost(); }
    check("buttons shown after the dialog opened: the keyboard goes to its first one", mgr.FocusedNode?.AccessibilityLabel === "OK", name(mgr.FocusedNode));
    root.RemoveSubView(late); late.Dispose();
    for (let i = 0; i < 3; i++) { frame(); lost(); }
    check("buttons shown after the dialog opened: on close the keyboard is back on the opener", mgr.FocusedNode === opener, name(mgr.FocusedNode));
  }
  surface.delete();

  console.log(failures ? `FAIL: ${failures} checks` : "OK: one dialog, the keyboard in and back");
  process.exit(failures ? 1 : 0);
})();
