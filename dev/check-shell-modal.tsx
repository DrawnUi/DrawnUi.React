// A shell modal leaves the modal stack when its close starts (drawnui-cross 6s, C# 371e486e), checked in Node through the
// real reconciler (`npm run check:shell-modal`): PopModalAsync, or the drawer closed by IsOpen = false (a swipe ends the
// same way), takes the modal out of ModalsCount / CanGoBack and raises Navigated Pop at once, while it still slides out;
// from then on its drawer takes no pans; the visual removal waits for the slide to end.
import { readFileSync } from "node:fs";
import { SkiaShell, SkiaLayer, SkiaShape, type ShellNavigation, type SkiaShellNavigatedArgs } from "../src/react/index.tsx";
import { createDrawnRoot } from "../src/react/reconciler.ts";
import { Super, SKRect, Thickness, SkiaAccessibilityManager, HoverManager, SkiaDrawer, type SkiaControl, type AnimatorBase, type Canvas } from "../src/index.ts";

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
  ControlLeft(): void {}
}

(async () => {
  const CK = await CanvasKitInit({ locateFile: () => `${ROOT}/node_modules/canvaskit-wasm/bin/full/canvaskit.wasm` });
  (Super as unknown as { CK: unknown }).CK = CK;
  const face = CK.Typeface.MakeFreeTypeFaceFromData(readFileSync(`${ROOT}/samples/public/fonts/OpenSans-Regular.ttf`).buffer);
  Super.Fonts.set("FontText", new Map([[400, face]])); Super.DefaultTypeface = face; Super.DefaultFontAlias = "FontText";

  const fake = new FakeCanvas();
  const root = createDrawnRoot(fake as unknown as Canvas);
  let shell!: ShellNavigation;
  const pops: string[] = [];
  const surface = CK.MakeSurface(400, 600);
  const frames = async (n: number) => {
    for (let i = 0; i < n; i++) {
      await new Promise((r) => setTimeout(r, 20));
      const c = fake.Content; if (!c) continue;
      for (const a of [...fake.AnimatingControls.values()]) a.TickFrame(performance.now() * 1e6);
      c.Measure(400, 600, 1); c.Arrange(new SKRect(0, 0, 400, 600), -1, -1, 1);
      c.Render({ Context: { Canvas: surface.getCanvas(), Surface: surface }, Destination: new SKRect(0, 0, 400, 600), Scale: 1 });
    }
  };
  const drawers = () => { const out: SkiaDrawer[] = []; const walk = (c: SkiaControl) => { if (c instanceof SkiaDrawer) out.push(c); for (const v of (c as unknown as { Views?: SkiaControl[] }).Views ?? []) walk(v); }; if (fake.Content) walk(fake.Content); return out; };
  root.render(<SkiaShell ref={(s: ShellNavigation | null) => { if (s) shell = s; }} Routes={{ home: () => <SkiaLayer VerticalOptions="Fill" /> }}
    UseBrowserHistory={false} PagesAnimationSpeed={0} Insets={Thickness.Zero}
    Navigated={(e: SkiaShellNavigatedArgs) => { if (e.Source === "Pop") pops.push(e.Route); }} />);
  await frames(4);
  const sheet = () => <SkiaShape HorizontalOptions="Fill" VerticalOptions="Fill" BackgroundColor="#808080" />;
  const push = async () => { const done = shell.PushModalAsync(sheet(), { useGestures: true }); for (let i = 0; i < 60 && shell.ModalsCount === 0; i++) await frames(1); await Promise.race([done, frames(40)]); await frames(2); };

  await push();
  const drawer = drawers()[0];
  check("a modal is pushed and open", shell.ModalsCount === 1 && !!drawer && drawer.IsOpen, `ModalsCount ${shell.ModalsCount}`);
  pops.length = 0;
  const popping = shell.PopModalAsync(true);
  await frames(1);
  check("PopModalAsync: the modal leaves the stack when its close starts", shell.ModalsCount === 0 && !shell.CanGoBack, `ModalsCount ${shell.ModalsCount}, CanGoBack ${shell.CanGoBack}`);
  check("Navigated Pop is raised at the start of the close", pops.length === 1, `${pops.length} Pop`);
  check("it still slides out (the visual removal waits)", drawers().length === 1 && drawer.InTransition, `${drawers().length} drawers, InTransition ${drawer.InTransition}`);
  await popping; await frames(4);
  check("after the slide it is removed, one Navigated Pop in all", drawers().length === 0 && pops.length === 1, `${drawers().length} drawers, ${pops.length} Pop`);

  await push();
  const swiped = drawers()[0];
  pops.length = 0;
  swiped.IsOpen = false; // a swipe release ends the same way: the drawer turns from open to closed
  await frames(1);
  check("the drawer closed (IsOpen = false): the modal leaves the stack at once", shell.ModalsCount === 0 && pops.length === 1, `ModalsCount ${shell.ModalsCount}, ${pops.length} Pop`);
  check("a closing modal's drawer takes no pans", swiped.RespondsToGestures === false);
  await frames(40);
  check("after the slide it is removed, one Navigated Pop in all", drawers().length === 0 && pops.length === 1, `${drawers().length} drawers, ${pops.length} Pop`);

  console.log(failures ? `FAIL: ${failures} checks` : "OK: a modal leaves the stack when its close starts");
  process.exit(failures ? 1 : 0);
})();
