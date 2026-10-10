// Wheel routing between presses (DrawnUi.Rust input_router "the wheel goes to the owner of the press first"), checked
// in Node (`npm run check:wheel-routing`): while a press is held the wheel goes to its owner; between presses it goes
// by position and never makes an owner (a wheel over a second control moves that one); an owner that does not use
// the wheel keeps its press, the wheel goes by position and the release still reaches the owner.
import { readFileSync } from "node:fs";
import {
  Super, SKRect, SKPoint, Thickness, Canvas, SkiaAccessibilityManager, HoverManager, SkiaLayer, SkiaGesturesParameters, TouchActionEventArgs,
  type SkiaControl, type AnimatorBase, type TouchActionResult,
} from "../src/index.ts";

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
}

(async () => {
  const CK = await CanvasKitInit({ locateFile: () => `${ROOT}/node_modules/canvaskit-wasm/bin/full/canvaskit.wasm` });
  (Super as unknown as { CK: unknown }).CK = CK;
  const face = CK.Typeface.MakeFreeTypeFaceFromData(readFileSync(`${ROOT}/samples/public/fonts/OpenSans-Regular.ttf`).buffer);
  Super.Fonts.set("FontText", new Map([[400, face]])); Super.DefaultTypeface = face; Super.DefaultFontAlias = "FontText";

  const log: string[] = [];
  const probe = (name: string, x: number, takes: TouchActionResult[]) => {
    const c = new SkiaLayer(); c.WidthRequest = 100; c.HeightRequest = 100; c.Margin = new Thickness(x, 0, 0, 0);
    c.HorizontalOptions = "Start"; c.VerticalOptions = "Start";
    c.ConsumeGestures = (_, e) => { log.push(`${name}:${e.Args.Type}`); if (takes.includes(e.Args.Type)) e.Consumed = true; };
    return c;
  };
  const root = new SkiaLayer(); root.WidthRequest = 300; root.HeightRequest = 100;
  for (const c of [probe("a", 0, ["Down", "Up", "Wheel"]), probe("b", 100, ["Wheel"]), probe("c", 200, ["Down", "Up"])]) root.AddSubView(c);
  const fake = new FakeCanvas();
  root._superview = fake as unknown as Canvas;
  root.Measure(300, 100, 1); root.Arrange(new SKRect(0, 0, 300, 100), -1, -1, 1);

  // the engine Canvas without its DOM: only its gesture routing is used
  const canvas = Object.create(Canvas.prototype) as Canvas & { gestureOwner: SkiaControl | null; activeTouchIds: Set<number> };
  canvas.gestureOwner = null;
  canvas.activeTouchIds = new Set();
  const send = (type: TouchActionResult, x: number, y = 50) => {
    const a = new TouchActionEventArgs(); a.Location = new SKPoint(x, y); a.Scale = 1;
    if (type === "Down") canvas.activeTouchIds.add(1);
    (canvas as unknown as { ProcessGestures(r: SkiaControl, p: SkiaGesturesParameters): SkiaControl | null }).ProcessGestures(root, SkiaGesturesParameters.Create(type, a));
    if (type === "Up") canvas.activeTouchIds.delete(1);
  };
  const seen = (name: string) => log.filter((l) => l.startsWith(name + ":")).map((l) => l.slice(name.length + 1)).join(",");

  send("Down", 50); send("Wheel", 150);
  check("held down on a: a wheel over b is a's", seen("a") === "Down,Wheel" && seen("b") === "", `a ${seen("a")}, b ${seen("b")}`);
  send("Up", 50);
  log.length = 0;
  send("Wheel", 150);
  check("between presses the wheel goes to what is under the pointer", seen("b") === "Wheel", `b ${seen("b")}`);
  send("Wheel", 50);
  check("the last wheel consumer does not keep the wheel: over a it moves a", seen("a") === "Wheel" && seen("b") === "Wheel", `a ${seen("a")}, b ${seen("b")}`);
  log.length = 0;
  send("Down", 250); send("Wheel", 150); send("Up", 250);
  check("an owner that does not use the wheel: the wheel by position, the release still the owner's", seen("b") === "Wheel" && seen("c").startsWith("Down") && seen("c").endsWith("Up"), `b ${seen("b")}, c ${seen("c")}`);

  console.log(failures ? `FAIL: ${failures} checks` : "OK: wheel routing");
  process.exit(failures ? 1 : 0);
})();
