// Drag scroll chaining between nested scrolls (drawnui-cross 6bo, DrawnUi.Rust 8b0a85e scroll_rules.rs), checked in Node
// (`npm run check:scroll-chaining`) through the engine Canvas touch state machine: decided once, when the drag starts. A
// list inside a page that is already at its end in the drag's direction leaves the whole drag to the page; otherwise the
// list keeps the drag to its end, also when it reaches its edge on the way. A scroll with nothing around it keeps its
// edge bounce.
import {
  Super, SKRect, SKPoint, Thickness, Canvas, SkiaAccessibilityManager, HoverManager, SkiaLayer, SkiaShape,
  SkiaScroll, TouchActionEventArgs, MultitouchTracker, type SkiaControl, type AnimatorBase, type TouchActionType,
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
  WheelDeltaPerNotch = 100; // events under half a notch move at once (no glide to tick)
  Update(): void {}
  DisposeObject(o: { Dispose(): void }): void { o.Dispose(); }
  RegisterAnimator(a: AnimatorBase): boolean { this.AnimatingControls.set(a.Uid, a); return true; }
  UnregisterAnimator(uid: number): void { this.AnimatingControls.delete(uid); }
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
    pendingGestures: [], claimedTouches: new Set(), longPressTimers: new Map(), longPressed: new Set(), fingers: new MultitouchTracker(), multiTouch: false, Update() {},
  });
  const canvas = c as unknown as Canvas & { ProcessPendingGestures(): void };
  let t = 1000;
  const send = (type: TouchActionType, x: number, y: number) => {
    const a = new TouchActionEventArgs(); a.Id = 1; a.Type = type; a.Location = new SKPoint(x, y); a.Scale = 1; a.Timestamp = (t += 16);
    canvas.OnTouchAction(a);
    canvas.ProcessPendingGestures();
    layout();
  };
  /** A finger drag from (x, y) by dy in 10 steps, then lifted; the largest page and list offsets seen during it. */
  const drag = (x: number, y: number, dy: number, page: SkiaScroll, list: SkiaScroll) => {
    const p0 = page.ViewportOffsetY, l0 = list.ViewportOffsetY;
    let page1 = 0, list1 = 0;
    send("Pressed", x, y);
    for (let i = 1; i <= 10; i++) {
      send("Moved", x, y + (dy * i) / 10);
      page1 = Math.max(page1, Math.abs(page.ViewportOffsetY - p0)); list1 = Math.max(list1, Math.abs(list.ViewportOffsetY - l0));
    }
    send("Released", x, y + dy);
    return { page: page1, list: list1, listEnd: list.ViewportOffsetY };
  };
  /** Wheel events (40 = 0.4 notch = 60 points each, wheel down positive) at (x, y), one right after the other. */
  const wheel = (x: number, y: number, delta: number, events = 1) => {
    for (let i = 0; i < events; i++) {
      const a = new TouchActionEventArgs(); a.Id = -1; a.Type = "Wheel"; a.Location = new SKPoint(x, y); a.StartingLocation = a.Location; a.Scale = 1;
      a.Wheel = { Delta: delta, IsHorizontal: false };
      (canvas as unknown as { OnGestureEvent(a: TouchActionEventArgs, t: string): void }).OnGestureEvent(a, "Wheel");
      canvas.ProcessPendingGestures();
      layout();
    }
  };
  return { layout, drag, wheel };
}
/** Wheel events further apart than the wheel gesture gap: a new wheel gesture. */
const newWheelGesture = () => new Promise((r) => setTimeout(r, SkiaScroll.WheelGestureGapMs + 80));

/** A page scroll (vertical, the window) holding, 200 points down, a vertical list 300 tall of 30 rows of 60, then more page. */
function scene() {
  const list = new SkiaScroll(); list.Orientation = "Vertical"; list.HeightRequest = 300; list.HorizontalOptions = "Fill"; list.VerticalOptions = "Start";
  list.Margin = new Thickness(0, 200, 0, 0);
  const rows = new SkiaLayer(); rows.HorizontalOptions = "Fill";
  for (let i = 0; i < 30; i++) { const r = new SkiaShape(); r.BackgroundColor = "#008080"; r.HeightRequest = 56; r.HorizontalOptions = "Fill"; r.Margin = new Thickness(0, i * 60, 0, 0); rows.AddSubView(r); }
  list.Content = rows;
  const content = new SkiaLayer(); content.HorizontalOptions = "Fill"; content.AddSubView(list);
  const tail = new SkiaShape(); tail.BackgroundColor = "#483D8B"; tail.HeightRequest = 1500; tail.HorizontalOptions = "Fill"; tail.Margin = new Thickness(0, 520, 0, 0);
  content.AddSubView(tail);
  const page = new SkiaScroll(); page.Orientation = "Vertical"; page.WidthRequest = W; page.HeightRequest = H; page.Content = content;
  const r = robot(page);
  const listEnd = () => list.ContentOffsetBounds.Top; // the most negative offset: scrolled to its end
  return { page, list, r, listEnd };
}

(async () => {
  const CK = await CanvasKitInit({ locateFile: () => `${ROOT}/node_modules/canvaskit-wasm/bin/full/canvaskit.wasm` });
  (Super as unknown as { CK: unknown }).CK = CK;

  {
    const { page, list, r } = scene();
    list.ViewportOffsetY = -600; r.layout();
    const m = r.drag(200, 400, -150, page, list); // up: the list's content moves on
    check("a list in the middle keeps the drag: the list moves, the page does not", m.list > 50 && m.page < 1, `list ${m.list.toFixed(0)}, page ${m.page.toFixed(0)}`);
  }
  {
    const { page, list, r, listEnd } = scene();
    list.ViewportOffsetY = listEnd(); r.layout();
    const end = list.ViewportOffsetY;
    const m = r.drag(200, 400, -150, page, list); // up, past the list's end
    check("a list at its end dragged on: the page takes the drag, the list stays at its end", m.page > 50 && m.list < 1 && list.ViewportOffsetY === end,
      `page ${m.page.toFixed(0)}, list moved ${m.list.toFixed(1)}`);
  }
  {
    const { page, list, r } = scene();
    page.ViewportOffsetY = -150; r.layout(); // the list now spans 50-350 on screen, at its start
    const m = r.drag(200, 200, 150, page, list); // down, back toward the list's start
    check("a list at its start dragged back: the page takes the drag, the list does not stretch", m.page > 50 && m.list < 1,
      `page ${m.page.toFixed(0)}, list moved ${m.list.toFixed(1)}`);
  }
  {
    const { page, list, r, listEnd } = scene();
    list.ViewportOffsetY = listEnd() + 30; r.layout();
    const m = r.drag(200, 400, -150, page, list); // up: reaches the list's end on the way
    check("a list near its end keeps the drag to its end: no hand-over to the page", m.list > 29 && m.page < 1, `list ${m.list.toFixed(0)}, page ${m.page.toFixed(0)}`);
  }
  {
    // a lone scroll at its end, dragged on: its own rubber band
    const lone = new SkiaScroll(); lone.Orientation = "Vertical"; lone.WidthRequest = W; lone.HeightRequest = H;
    const rows = new SkiaLayer(); rows.HorizontalOptions = "Fill";
    for (let i = 0; i < 30; i++) { const s = new SkiaShape(); s.BackgroundColor = "#008080"; s.HeightRequest = 56; s.HorizontalOptions = "Fill"; s.Margin = new Thickness(0, i * 60, 0, 0); rows.AddSubView(s); }
    lone.Content = rows;
    const r = robot(lone);
    lone.ViewportOffsetY = lone.ContentOffsetBounds.Top; r.layout();
    const m = r.drag(200, 400, -150, new SkiaScroll() /* no page around it */, lone);
    check("a scroll with nothing around it keeps its edge bounce", m.list > 5, `pulled ${m.list.toFixed(1)} past its end`);
  }

  // the wheel (6bo, DrawnUi.Net NestedScrollWheelTests): the inner scroll while it can, then the outer one, decided once
  // per wheel gesture (events under WheelGestureGapMs apart keep the scroll they started on)
  {
    const { page, list, r } = scene();
    list.ViewportOffsetY = -600; r.layout();
    await newWheelGesture(); r.wheel(200, 400, 40, 2);
    check("wheel over a list midway: the list moves, the page stays", list.ViewportOffsetY < -700 && page.ViewportOffsetY === 0, `list ${list.ViewportOffsetY}, page ${page.ViewportOffsetY}`);
  }
  {
    const { page, list, r, listEnd } = scene();
    list.ViewportOffsetY = listEnd(); r.layout();
    await newWheelGesture(); r.wheel(200, 400, 40, 2);
    check("wheel over a list at its end: the page moves", page.ViewportOffsetY < -100 && list.ViewportOffsetY === listEnd(), `page ${page.ViewportOffsetY}, list ${list.ViewportOffsetY}`);
  }
  {
    const { page, list, r, listEnd } = scene();
    list.ViewportOffsetY = listEnd() + 60; r.layout();
    await newWheelGesture(); r.wheel(200, 400, 40, 4); // one spin: 60 to the end, the rest held by the list
    check("one wheel gesture stays on the list past its end", list.ViewportOffsetY === listEnd() && page.ViewportOffsetY === 0, `list ${list.ViewportOffsetY} (end ${listEnd()}), page ${page.ViewportOffsetY}`);
    await newWheelGesture(); r.wheel(200, 400, 40, 1);
    check("the next wheel gesture moves the page", page.ViewportOffsetY < -50, `page ${page.ViewportOffsetY}`);
  }
  {
    const { page, list, r } = scene();
    page.ViewportOffsetY = -50; r.layout();
    await newWheelGesture(); r.wheel(200, 160, -40, 1); // the list (now 150-450 on screen) at its start, wheel up
    check("wheel up over a list at its start: the page moves", page.ViewportOffsetY === 0 && list.ViewportOffsetY === 0, `page ${page.ViewportOffsetY}, list ${list.ViewportOffsetY}`);
  }
  {
    const { page, list, r } = scene();
    await newWheelGesture(); r.wheel(200, 100, 40, 1); // above the list: the page moves 60, the list comes under the pointer
    r.wheel(200, 300, 40, 2); // the same spin, now over the list
    check("a wheel gesture started on the page stays on the page over a list", page.ViewportOffsetY <= -170 && list.ViewportOffsetY === 0, `page ${page.ViewportOffsetY}, list ${list.ViewportOffsetY}`);
  }

  console.log(failures ? `FAIL: ${failures} checks` : "OK: drag and wheel chaining decided at the start");
  process.exit(failures ? 1 : 0);
})();
