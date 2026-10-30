// One finger gesture moves a SkiaCarousel at most one slide (drawnui-cross 6ah, C# 1070e0db CarouselOneSlidePerSwipeTests),
// checked in Node (`npm run check:carousel-swipe`) through the engine Canvas touch state machine with timed moves: from
// slide N a release lands on N-1, N or N+1, whatever the pan distance and velocity; code moves are not limited.
import {
  Super, SKRect, SKPoint, Canvas, SkiaAccessibilityManager, HoverManager, SkiaLayer, SkiaShape, SkiaCarousel, TouchActionEventArgs,
  type SkiaControl, type AnimatorBase, type TouchActionType,
} from "../src/index.ts";

declare const CanvasKitInit: (o: { locateFile: () => string }) => Promise<any>;
const ROOT = process.cwd();
const W = 400, H = 300, Y = 125;
let failures = 0;
const check = (name: string, ok: boolean, detail = "") => { if (!ok) failures++; console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`); };

class FakeCanvas {
  readonly AccessibilityManager = new SkiaAccessibilityManager();
  readonly Hover = new HoverManager();
  readonly AnimatingControls = new Map<number, AnimatorBase>();
  RenderingScale = 1;
  GpuEpoch = 0;
  FrameTimeNanos = 0;
  Update(): void {}
  DisposeObject(o: { Dispose(): void }): void { o.Dispose(); }
  RegisterAnimator(a: AnimatorBase): boolean { this.AnimatingControls.set(a.Uid, a); return true; }
  UnregisterAnimator(uid: number): void { this.AnimatingControls.delete(uid); }
}

(async () => {
  const CK = await CanvasKitInit({ locateFile: () => `${ROOT}/node_modules/canvaskit-wasm/bin/full/canvaskit.wasm` });
  (Super as unknown as { CK: unknown }).CK = CK;

  /** C# Create: 3 slides, Bounces off, LinearSpeedMs 420, in a 400 x 300 canvas; a clock that frames and touches share. */
  const create = (looped = false) => {
    const carousel = new SkiaCarousel(); carousel.HeightRequest = 250; carousel.HorizontalOptions = "Fill";
    carousel.Bounces = false; carousel.IsLooped = looped; carousel.LinearSpeedMs = 420;
    for (let i = 0; i < 3; i++) { const s = new SkiaShape(); s.BackgroundColor = "#483D8B"; s.HorizontalOptions = "Fill"; s.VerticalOptions = "Fill"; carousel.AddSubView(s); }
    const root = new SkiaLayer(); root.WidthRequest = W; root.HeightRequest = H; root.VerticalOptions = "Fill"; root.AddSubView(carousel);
    const fake = new FakeCanvas();
    root._superview = fake as unknown as Canvas;
    let ms = 1000;
    const frame = () => {
      fake.FrameTimeNanos = Math.round(ms * 1_000_000);
      for (const a of [...fake.AnimatingControls.values()]) if (!a.IsPaused) a.TickFrame(fake.FrameTimeNanos);
      const surface = CK.MakeSurface(W, H);
      root.Measure(W, H, 1); root.Arrange(new SKRect(0, 0, W, H), W, H, 1);
      root.Render({ Context: { Canvas: surface.getCanvas(), Surface: surface }, Destination: new SKRect(0, 0, W, H), Scale: 1 });
      surface.delete();
    };
    const frames = (n: number) => { for (let i = 0; i < n; i++) { ms += 16; frame(); } };
    const c = Object.create(Canvas.prototype) as Record<string, unknown>;
    Object.assign(c, {
      gestures: "Lock", gestureOwner: null, content: root, activeTouchIds: new Set(), pointerDownArgs: new Map(), previousTouchArgs: new Map(),
      pendingGestures: [], claimedTouches: new Set(), longPressTimers: new Map(), longPressed: new Set(), Update() {},
    });
    const cv = c as unknown as Canvas & { ProcessPendingGestures(): void };
    /** One raw pointer event `dt` ms after the previous one; the frame clock moves with it. */
    const send = (type: TouchActionType, x: number, dt: number) => {
      ms += dt;
      const a = new TouchActionEventArgs(); a.Id = 1; a.Type = type; a.Location = new SKPoint(x, Y); a.Scale = 1; a.Timestamp = ms;
      cv.OnTouchAction(a); cv.ProcessPendingGestures(); frame();
    };
    frames(8);
    return { carousel, frames, send };
  };
  /** C# DragThenFlick: a slow drag of `ratio` of a slide (20 moves, 20 ms), then 4 fast moves of 30 px (8 ms), Up. */
  const dragThenFlick = (t: ReturnType<typeof create>, ratio: number, dir: -1 | 1, flick = true) => {
    let x = dir < 0 ? W - 20 : 20;
    const drag = ratio * W;
    t.send("Pressed", x, 0);
    for (let i = 1; i <= 20; i++) t.send("Moved", x + (dir * drag * i) / 20, 20);
    x += dir * drag;
    if (flick) for (let i = 1; i <= 4; i++) t.send("Moved", x + dir * 30 * i, 8);
    t.send("Released", x + (flick ? dir * 120 : 0), 8);
    t.frames(90);
  };
  const at = (t: ReturnType<typeof create>, i: number) => Math.abs(t.carousel.CurrentPosition.X - t.carousel.SnapPoints[i].X) < 1 && Math.abs(t.carousel.CurrentPosition.Y - t.carousel.SnapPoints[i].Y) < 1;

  for (const ratio of [0.45, 0.5, 0.55, 0.7]) {
    const t = create();
    dragThenFlick(t, ratio, -1);
    check(`drag ${ratio} of a slide then a flick, from slide 0: slide 1`, t.carousel.SelectedIndex === 1 && at(t, 1), `index ${t.carousel.SelectedIndex}`);
  }
  {
    const t = create();
    t.carousel.ScrollTo(2, false); t.frames(4);
    dragThenFlick(t, 0.6, 1);
    check("drag back 0.6 then a flick, from slide 2: slide 1", t.carousel.SelectedIndex === 1 && at(t, 1), `index ${t.carousel.SelectedIndex}`);
  }
  {
    const t = create(true);
    dragThenFlick(t, 0.6, -1);
    check("looped: drag 0.6 then a flick moves one slide", t.carousel.SelectedIndex === 1, `index ${t.carousel.SelectedIndex}`);
  }
  {
    const t = create();
    dragThenFlick(t, 0.7, -1, false);
    check("slow drag past the middle, no flick: the next slide", t.carousel.SelectedIndex === 1, `index ${t.carousel.SelectedIndex}`);
  }
  {
    const t = create();
    t.carousel.ScrollTo(2); t.frames(90);
    check("ScrollTo(2) by code is not limited", t.carousel.SelectedIndex === 2 && at(t, 2), `index ${t.carousel.SelectedIndex}`);
  }

  console.log(failures ? `FAIL: ${failures} checks` : "OK: one slide per swipe");
  process.exit(failures ? 1 : 0);
})();
