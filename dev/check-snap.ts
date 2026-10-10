// Snap on release (drawnui-cross 6o; C# DrawerReleaseSnapTests, Rust snap_release.rs), checked in Node
// (`npm run check:snap`): an open FromRight drawer dragged 70 pt and released with a resting finger's drift goes back
// open; a flick closes it; a slow drag past half closes it.
import { readFileSync } from "node:fs";
import { Super, SKRect, SKPoint, SkiaAccessibilityManager, HoverManager, SkiaDrawer, SkiaLayer, type AnimatorBase, type Canvas } from "../src/index.ts";

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
  Update(): void {}
  readonly disposeQueue: { Dispose(): void }[] = [];
  DisposeObject(o: { Dispose(): void }): void { this.disposeQueue.push(o); }
  RegisterAnimator(a: AnimatorBase): boolean { this.AnimatingControls.set(a.Uid, a); return true; }
  UnregisterAnimator(uid: number): void { this.AnimatingControls.delete(uid); }
}

(async () => {
  const CK = await CanvasKitInit({ locateFile: () => `${ROOT}/node_modules/canvaskit-wasm/bin/full/canvaskit.wasm` });
  (Super as unknown as { CK: unknown }).CK = CK;
  const face = CK.Typeface.MakeFreeTypeFaceFromData(readFileSync(`${ROOT}/samples/public/fonts/OpenSans-Regular.ttf`).buffer);
  Super.Fonts.set("FontText", new Map([[400, face]])); Super.DefaultTypeface = face; Super.DefaultFontAlias = "FontText";

  /** An open FromRight drawer 300 pt wide, dragged to `at` and released at `speed` pt/s toward closing. */
  const release = async (at: number, speed: number) => {
    const fake = new FakeCanvas();
    const root = new SkiaLayer(); root.VerticalOptions = "Fill"; root.HorizontalOptions = "Fill";
    const drawer = new SkiaDrawer(); drawer.Direction = "FromRight"; drawer.WidthRequest = 300; drawer.HorizontalOptions = "End"; drawer.VerticalOptions = "Fill";
    drawer.IsOpen = true; drawer.BackgroundColor = "#808080";
    root.AddSubView(drawer);
    root._superview = fake as unknown as Canvas;
    const surface = CK.MakeSurface(400, 400);
    const frame = () => {
      for (const a of [...fake.AnimatingControls.values()]) a.TickFrame(performance.now() * 1e6);
      root.Measure(400, 400, 1); root.Arrange(new SKRect(0, 0, 400, 400), -1, -1, 1);
      root.Render({ Context: { Canvas: surface.getCanvas(), Surface: surface }, Destination: new SKRect(0, 0, 400, 400), Scale: 1 });
    };
    for (let i = 0; i < 3; i++) frame();
    const d = drawer as unknown as { ApplyPosition(p: SKPoint): void; CurrentSnap: SKPoint; CurrentPosition: SKPoint };
    d.ApplyPosition(new SKPoint(at, 0));
    d.CurrentSnap = d.CurrentPosition;
    drawer.ScrollToNearestAnchor(new SKPoint(at, 0), new SKPoint(speed, 0));
    for (let i = 0; i < 90; i++) { frame(); await new Promise((r) => setTimeout(r, 12)); }
    surface.delete();
    return drawer.IsOpen;
  };

  check("70 pt drag, resting finger (20 pt/s toward closed): back open", await release(70, 20) === true);
  check("70 pt drag, flick (2000 pt/s): closes", await release(70, 2000) === false);
  check("200 pt drag (past half), slow (20 pt/s): closes", await release(200, 20) === false);
  check("70 pt drag, at the threshold (100 pt/s): a flick, closes", await release(70, 100) === false);

  console.log(failures ? `FAIL: ${failures} checks` : "OK: snap on release");
  process.exit(failures ? 1 : 0);
})();
