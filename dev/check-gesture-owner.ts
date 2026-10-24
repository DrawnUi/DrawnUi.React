// Gesture owner (drawnui-cross 6n, C# a32a6aac GestureOwnershipTests), checked in Node (`npm run check:gesture-owner`)
// through the engine Canvas touch state machine (Pressed / Moved / Released -> Down / Panning / Up): the control that
// consumed the last event is offered the next one first, wherever the finger is. A horizontal strip dragged left and
// then down out of it keeps the gesture: a full-screen sibling under it gets no pans, and a vertical page scroll
// around it does not move.
import {
  Super, SKRect, SKPoint, Thickness, Canvas, SkiaAccessibilityManager, HoverManager, SkiaLayer, SkiaLayout, SkiaRow, SkiaShape,
  SkiaScroll, TouchActionEventArgs, type SkiaControl, type AnimatorBase, type TouchActionType,
} from "../src/index.ts";

declare const CanvasKitInit: (o: { locateFile: () => string }) => Promise<any>;
const ROOT = process.cwd();
const W = 400, H = 700;
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

/** C# Strip(top): a horizontal scroll of 30 tiles, 100 tall, `top` points down the page. */
function strip(top: number): SkiaScroll {
  const s = new SkiaScroll(); s.Orientation = "Horizontal"; s.HeightRequest = 100; s.HorizontalOptions = "Fill"; s.VerticalOptions = "Start";
  s.Margin = new Thickness(0, top, 0, 0);
  const row = new SkiaRow(); row.Spacing = 4;
  for (let i = 0; i < 30; i++) { const t = new SkiaShape(); t.BackgroundColor = "#008080"; t.WidthRequest = 80; t.HeightRequest = 80; row.AddSubView(t); }
  s.Content = row;
  return s;
}

/** The engine Canvas without its DOM, fed raw pointer events: only its touch state machine and routing run. */
function robot(root: SkiaControl) {
  const fake = new FakeCanvas();
  root._superview = fake as unknown as Canvas;
  const layout = () => { root.Measure(W, H, 1); root.Arrange(new SKRect(0, 0, W, H), W, H, 1); };
  layout();
  const c = Object.create(Canvas.prototype) as Record<string, unknown>;
  Object.assign(c, {
    gestures: "Lock", gestureOwner: null, content: root, activeTouchIds: new Set(), pointerDownArgs: new Map(), previousTouchArgs: new Map(),
    pendingGestures: [], claimedTouches: new Set(), longPressTimers: new Map(), longPressed: new Set(), Update() {},
  });
  const canvas = c as unknown as Canvas & { ProcessPendingGestures(): void };
  let t = 1000;
  const send = (type: TouchActionType, x: number, y: number) => {
    const a = new TouchActionEventArgs(); a.Id = 1; a.Type = type; a.Location = new SKPoint(x, y); a.Scale = 1; a.Timestamp = (t += 16);
    canvas.OnTouchAction(a);
    canvas.ProcessPendingGestures();
    layout();
  };
  return { down: (x: number, y: number) => send("Pressed", x, y), move: (x: number, y: number) => send("Moved", x, y), up: (x: number, y: number) => send("Released", x, y) };
}

(async () => {
  const CK = await CanvasKitInit({ locateFile: () => `${ROOT}/node_modules/canvaskit-wasm/bin/full/canvaskit.wasm` });
  (Super as unknown as { CK: unknown }).CK = CK;

  {
    // a horizontal strip over a full-screen sibling, in a page root that keeps gestures from the pages below
    const s = strip(300);
    let siblingPans = 0;
    const sibling = new SkiaLayout(); sibling.HorizontalOptions = "Fill"; sibling.VerticalOptions = "Fill";
    sibling.ConsumeGestures = (_, e) => { if (e.Args.Type === "Panning" && s.IsUserPanning) siblingPans++; };
    const root = new SkiaLayer(); root.WidthRequest = W; root.HeightRequest = H; root.BlockGesturesBelow = true;
    root.AddSubView(sibling); root.AddSubView(s);
    const r = robot(root);
    r.down(300, 350);
    for (let i = 1; i <= 10; i++) r.move(300 - i * 15, 350); // left: the strip scrolls
    const scrolled = Math.abs(s.ViewportOffsetX);
    for (let i = 1; i <= 8; i++) r.move(150, 350 + i * 15); // then down, out of the strip, without lifting
    r.up(150, 470);
    check("strip dragged left then down out of it: it keeps the gesture, the sibling below gets no pans", scrolled > 50 && siblingPans === 0,
      `strip offset ${scrolled.toFixed(0)}, sibling pans ${siblingPans}`);
  }

  {
    // the strip inside a vertical page scroll: dragged left, then up, the page does not move
    const s = strip(200);
    const content = new SkiaLayer(); content.HorizontalOptions = "Fill"; content.AddSubView(s);
    for (let i = 0; i < 12; i++) {
      const b = new SkiaShape(); b.BackgroundColor = "#483D8B"; b.HeightRequest = 80; b.HorizontalOptions = "Fill"; b.Margin = new Thickness(0, 320 + i * 90, 0, 0);
      content.AddSubView(b);
    }
    const page = new SkiaScroll(); page.Orientation = "Vertical"; page.WidthRequest = W; page.HeightRequest = H; page.Content = content;
    const r = robot(page);
    r.down(300, 250);
    for (let i = 1; i <= 10; i++) r.move(300 - i * 15, 250);
    const scrolled = Math.abs(s.ViewportOffsetX);
    let maxPage = 0;
    for (let i = 1; i <= 8; i++) { r.move(150, 250 - i * 15); maxPage = Math.max(maxPage, Math.abs(page.ViewportOffsetY)); }
    r.up(150, 130);
    check("strip in a vertical page scroll dragged left then up: the page stays", scrolled > 50 && maxPage < 1,
      `strip offset ${scrolled.toFixed(0)}, page moved ${maxPage.toFixed(1)}`);
  }

  console.log(failures ? `FAIL: ${failures} checks` : "OK: the gesture stays with its owner");
  process.exit(failures ? 1 : 0);
})();
