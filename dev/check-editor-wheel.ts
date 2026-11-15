// A focused text field keeps the keyboard, not the mouse wheel (DrawnUi.Net EditorWheelTests), checked in Node
// (`npm run check:editor-wheel`): a page scroll with a one-line SkiaEditor in a card, the field tapped (focused), the
// mouse moved over it and then to where it wheels: the page scrolls with the wheel over the field and away from it. A
// mouse move never makes a control the gesture owner (DrawnUi.Net 62608ca7).
import { readFileSync } from "node:fs";
import {
  Super, SKRect, SKPoint, Canvas, SkiaAccessibilityManager, HoverManager, SkiaScroll, SkiaStack, SkiaShape, SkiaLayer, SkiaEditor,
  SkiaGesturesParameters, TouchActionEventArgs, type SkiaControl, type AnimatorBase, type TouchActionResult,
} from "../src/index.ts";

declare const CanvasKitInit: (o: { locateFile: () => string }) => Promise<any>;
const ROOT = process.cwd();
let failures = 0;
const check = (name: string, ok: boolean, detail = "") => { if (!ok) failures++; console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`); };

// the keyboard listens on the window when a field takes the focus
const g = globalThis as unknown as Record<string, unknown>;
g.window = Object.assign(g.window ?? {}, { addEventListener() {}, removeEventListener() {}, focus() {}, setInterval, clearInterval, setTimeout, clearTimeout });

class FakeCanvas {
  readonly AccessibilityManager = new SkiaAccessibilityManager();
  readonly Hover = new HoverManager();
  readonly AnimatingControls = new Map<number, AnimatorBase>();
  RenderingScale = 1;
  GpuEpoch = 0;
  WheelDeltaPerNotch = 120;
  Update(): void {}
  DisposeObject(o: { Dispose(): void }): void { o.Dispose(); }
  RegisterAnimator(a: AnimatorBase): boolean { this.AnimatingControls.set(a.Uid, a); return true; }
  UnregisterAnimator(uid: number): void { this.AnimatingControls.delete(uid); }
  ControlLeft(): void {}
  ReportFocus(): void {}
}

(async () => {
  const CK = await CanvasKitInit({ locateFile: () => `${ROOT}/node_modules/canvaskit-wasm/bin/full/canvaskit.wasm` });
  (Super as unknown as { CK: unknown }).CK = CK;
  const face = CK.Typeface.MakeFreeTypeFaceFromData(readFileSync(`${ROOT}/samples/public/fonts/OpenSans-Regular.ttf`).buffer);
  Super.Fonts.set("FontText", new Map([[400, face]])); Super.DefaultTypeface = face; Super.DefaultFontAlias = "FontText";

  for (const [where, wx, wy] of [["away from the field", 150, 250], ["over the field", 150, 20]] as [string, number, number][]) {
    // as in a form: the field inside a cached panel, a card around it, a long page under it
    const editor = new SkiaEditor(); editor.HeightRequest = 40; editor.WidthRequest = 280; editor.MaxLines = 1;
    const field = new SkiaShape(); field.HeightRequest = 40; field.WidthRequest = 280; field.BackgroundColor = "#808080"; field.AddSubView(editor);
    const panel = new SkiaShape(); panel.UseCache = "Image"; const inner = new SkiaStack(); inner.AddSubView(field); panel.AddSubView(inner);
    const card = new SkiaShape(); card.CornerRadius = 16; card.AddSubView(panel);
    const tall = new SkiaLayer(); tall.HeightRequest = 2000; tall.BackgroundColor = "#00008B";
    const stack = new SkiaStack(); stack.AddSubView(card); stack.AddSubView(tall);
    const scroll = new SkiaScroll(); scroll.HorizontalOptions = "Fill"; scroll.VerticalOptions = "Fill"; scroll.Content = stack;
    scroll._superview = new FakeCanvas() as unknown as Canvas;
    const layout = () => { scroll.Measure(300, 300, 1); scroll.Arrange(new SKRect(0, 0, 300, 300), -1, -1, 1); };
    layout();

    // the engine Canvas without its DOM: only its gesture routing is used
    const canvas = Object.create(Canvas.prototype) as Canvas & { gestureOwner: SkiaControl | null; activeTouchIds: Set<number> };
    canvas.gestureOwner = null;
    canvas.activeTouchIds = new Set();
    (canvas as unknown as { ReportFocus(): void }).ReportFocus = () => {}; // the DOM focus side of a tap
    const send = (type: TouchActionResult, x: number, y: number, delta = 0) => {
      const a = new TouchActionEventArgs(); a.Location = new SKPoint(x, y); a.StartingLocation = a.Location; a.Scale = 1;
      if (type === "Wheel") a.Wheel = { Delta: delta };
      if (type === "Down") canvas.activeTouchIds.add(1);
      (canvas as unknown as { ProcessGestures(r: SkiaControl, p: SkiaGesturesParameters): SkiaControl | null }).ProcessGestures(scroll, SkiaGesturesParameters.Create(type, a));
      if (type === "Up") canvas.activeTouchIds.delete(1);
    };

    send("Down", 100, 20); send("Up", 100, 20); send("Tapped", 100, 20);
    const focused = editor.IsFocused;
    // a press and release on the page below (no tap: the field keeps the focus) ends the tap's ownership
    send("Down", 150, 250); send("Up", 150, 250);
    const ownerBefore = canvas.gestureOwner;
    // the mouse rests on the field, then moves to where it wheels
    send("Pointer", 100, 20);
    const ownerAfterHover = canvas.gestureOwner;
    send("Pointer", wx, wy);
    const before = scroll.ViewportOffsetY;
    for (let i = 0; i < 5; i++) send("Wheel", wx, wy, 40); // wheel down, small events: the content moves at once (no glide)
    const after = scroll.ViewportOffsetY;
    check(`the field focused, the wheel ${where}: the page scrolls`, focused && after < before - 1, `focused ${focused}, offset ${before} -> ${after.toFixed(1)}`);
    check(`a mouse move over the focused field does not make it the gesture owner (${where})`, editor.IsFocused && ownerBefore === null && ownerAfterHover === null, `still focused ${editor.IsFocused}, owner before ${ownerBefore?.constructor.name}, after the move ${ownerAfterHover?.constructor.name}`);
  }

  console.log(failures ? `FAIL: ${failures} checks` : "OK: a focused field leaves the wheel to the page");
  process.exit(failures ? 1 : 0);
})();
