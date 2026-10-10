// SkiaShell tabs keep their roots and pages (DrawnUi.Rust shell "tabs keep their stacks"), checked in Node through the
// real reconciler (`npm run check:shell`): switching tabs and back keeps the tab root's component mounted (its state
// and control kept) and the pushed page of the other tab mounted too, shown again when its tab is selected.
import { readFileSync } from "node:fs";
import { useEffect, useState } from "react";
import { SkiaShell, SkiaLabel, SkiaLayer, type ShellNavigation } from "../src/react/index.tsx";
import { createDrawnRoot } from "../src/react/reconciler.ts";
import { Super, SKRect, Thickness, SkiaAccessibilityManager, HoverManager, type SkiaControl, type AnimatorBase, type Canvas } from "../src/index.ts";

declare const CanvasKitInit: (o: { locateFile: () => string }) => Promise<any>;
const ROOT = process.cwd();
let failures = 0;
const check = (name: string, ok: boolean, detail = "") => { if (!ok) failures++; console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`); };

class FakeCanvas {
  readonly AccessibilityManager = new SkiaAccessibilityManager();
  readonly Hover = new HoverManager();
  readonly AnimatingControls = new Map<number, AnimatorBase>();
  RenderingScale = 1;
  GpuEpoch = 0;
  private content?: SkiaControl;
  get Content(): SkiaControl | undefined { return this.content; }
  set Content(v: SkiaControl | undefined) { this.content = v; if (v) { v.Parent = undefined; v._superview = this as unknown as Canvas; } }
  Update(): void {}
  readonly disposeQueue: { Dispose(): void }[] = [];
  DisposeObject(o: { Dispose(): void }): void { this.disposeQueue.push(o); }
  RegisterAnimator(a: AnimatorBase): boolean { this.AnimatingControls.set(a.Uid, a); return true; }
  UnregisterAnimator(uid: number): void { this.AnimatingControls.delete(uid); }
}

const mounts: Record<string, number> = {};
const controls: Record<string, SkiaControl> = {};
/** A tab page that counts its mounts and keeps a state set once. */
function Page({ name }: { name: string }) {
  const [state] = useState(() => Math.random());
  useEffect(() => { mounts[name] = (mounts[name] ?? 0) + 1; }, [name]);
  return <SkiaLayer VerticalOptions="Fill" ref={(c: SkiaControl | null) => { if (c) controls[name] = c; }}><SkiaLabel Text={`${name} ${state}`} /></SkiaLayer>;
}

(async () => {
  const CK = await CanvasKitInit({ locateFile: () => `${ROOT}/node_modules/canvaskit-wasm/bin/full/canvaskit.wasm` });
  (Super as unknown as { CK: unknown }).CK = CK;
  const face = CK.Typeface.MakeFreeTypeFaceFromData(readFileSync(`${ROOT}/samples/public/fonts/OpenSans-Regular.ttf`).buffer);
  Super.Fonts.set("FontText", new Map([[400, face]])); Super.DefaultTypeface = face; Super.DefaultFontAlias = "FontText";

  const fake = new FakeCanvas();
  const root = createDrawnRoot(fake as unknown as Canvas);
  let shell!: ShellNavigation;
  const routes = { home: () => <Page name="home" />, search: () => <Page name="search" />, detail: () => <Page name="detail" /> };
  const surface = CK.MakeSurface(400, 600);
  const frames = async (n: number) => {
    for (let i = 0; i < n; i++) {
      await new Promise((r) => setTimeout(r, 30));
      const c = fake.Content; if (!c) continue;
      for (const a of [...fake.AnimatingControls.values()]) a.TickFrame(performance.now() * 1e6);
      c.Measure(400, 600, 1); c.Arrange(new SKRect(0, 0, 400, 600), -1, -1, 1);
      c.Render({ Context: { Canvas: surface.getCanvas(), Surface: surface }, Destination: new SKRect(0, 0, 400, 600), Scale: 1 });
    }
  };
  root.render(<SkiaShell ref={(s: ShellNavigation | null) => { if (s) shell = s; }} Routes={routes} Tabs={[{ route: "home", title: "Home" }, { route: "search", title: "Search" }]}
    UseBrowserHistory={false} PagesAnimationSpeed={0} Insets={Thickness.Zero} />);
  await frames(4);
  const home = controls.home;
  const homeText = (home as unknown as { Views: SkiaControl[] }).Views[0] as unknown as { Text: string };
  const homeState = homeText.Text;
  await shell.GoToAsync("detail", false);
  await frames(3);
  const detail = controls.detail;
  check("home tab: detail pushed and shown", !!detail && detail.Superview !== undefined && mounts.detail === 1);
  await shell.SelectTabAsync(1);
  await frames(3);
  check("search tab selected: its root mounted once", mounts.search === 1);
  check("home tab's pushed page stays mounted, hidden", detail.Superview !== undefined && !detail.IsDisposed && mounts.detail === 1);
  await shell.SelectTabAsync(0);
  await frames(3);
  check("back on home: its root kept (one mount, same control, same state)", mounts.home === 1 && controls.home === home && homeText.Text === homeState, `mounts ${mounts.home}`);
  check("back on home: the pushed page kept and on top", mounts.detail === 1 && controls.detail === detail && shell.NavigationStack.join() === "detail", `${shell.NavigationStack.join()}`);
  await shell.SelectTabAsync(1);
  await frames(3);
  check("search again: its root kept", mounts.search === 1);

  console.log(failures ? `FAIL: ${failures} checks` : "OK: shell tabs keep their stacks");
  process.exit(failures ? 1 : 0);
})();
