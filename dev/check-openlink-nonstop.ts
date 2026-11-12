// Two helpers as DrawnUi.Net has them, checked in Node (`npm run check:openlink-nonstop`):
// - Super.OpenLink(url) opens the address in a new tab (window.open, noopener);
// - control.UpdateNonStop() keeps frames coming while the control is on a canvas (a running no-op animator, as C#), from
//   before the control is attached too, and stops when the control is disposed.
import { Super, SKRect, Canvas as CanvasClass, SkiaAccessibilityManager, HoverManager, SkiaLayer, SkiaShape, type AnimatorBase, type Canvas } from "../src/index.ts";

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
  DisposeObject(o: { Dispose(): void }): void { o.Dispose(); }
  RegisterAnimator(a: AnimatorBase): boolean { this.AnimatingControls.set(a.Uid, a); return true; }
  UnregisterAnimator(uid: number): void { this.AnimatingControls.delete(uid); }
  // the engine Canvas rule: a control that leaves (disposed) stops its animators
  ControlLeft(root: unknown, disposed: boolean): void { (CanvasClass.prototype as unknown as { ControlLeft(r: unknown, d: boolean): void }).ControlLeft.call(this, root, disposed); }
}

(async () => {
  const CK = await CanvasKitInit({ locateFile: () => `${ROOT}/node_modules/canvaskit-wasm/bin/full/canvaskit.wasm` });
  (Super as unknown as { CK: unknown }).CK = CK;

  const opened: unknown[][] = [];
  (globalThis as unknown as { window: { open: (...a: unknown[]) => null } }).window.open = (...a: unknown[]) => { opened.push(a); return null; };
  (Super as unknown as { OpenLink(url: string): void }).OpenLink("https://drawnui.net/");
  check("Super.OpenLink opens the address in a new tab, noopener", JSON.stringify(opened) === JSON.stringify([["https://drawnui.net/", "_blank", "noopener"]]), JSON.stringify(opened));

  const fake = new FakeCanvas();
  const root = new SkiaLayer(); root.WidthRequest = 100; root.HeightRequest = 100;
  const shape = new SkiaShape(); shape.WidthRequest = 20; shape.HeightRequest = 20;
  (shape as unknown as { UpdateNonStop(): SkiaShape }).UpdateNonStop(); // before it is on a canvas
  root.AddSubView(shape);
  root._superview = fake as unknown as Canvas;
  root.Measure(100, 100, 1); root.Arrange(new SKRect(0, 0, 100, 100), 100, 100, 1);
  check("UpdateNonStop set before the control is on a canvas: an animator runs once it is", fake.AnimatingControls.size === 1, `${fake.AnimatingControls.size}`);
  const a = [...fake.AnimatingControls.values()][0];
  const keeps = a ? [1, 2, 3].every((i) => !a.TickFrame(i * 16_666_667)) : false; // TickFrame: true = finished
  check("the animator keeps going frame after frame", keeps);
  shape.Dispose();
  check("disposed: no animator left", fake.AnimatingControls.size === 0, `${fake.AnimatingControls.size}`);

  console.log(failures ? `FAIL: ${failures} checks` : "OK: OpenLink and UpdateNonStop");
  process.exit(failures ? 1 : 0);
})();
