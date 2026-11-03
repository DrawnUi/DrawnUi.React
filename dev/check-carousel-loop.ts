// A looped SkiaCarousel never jumps to another pair of slides at the wrap (drawnui-cross section 7, C# b75f233a +
// 21320167 CarouselLoopedFastSwipeTests), checked in Node (`npm run check:carousel-loop`): fast swipes across the wrap
// either way, and a re-layout during a transition (a title above it changing its text, in a centered column) leave the
// position moving by less than half a slide per frame.
import {
  Super, SKRect, SKPoint, Canvas, SkiaAccessibilityManager, HoverManager, SkiaLayer, SkiaShape, SkiaCarousel, SkiaShaderCarousel, SkiaStack, SkiaLabel, SkiaScroll,
  TouchActionEventArgs, type SkiaControl, type AnimatorBase, type TouchActionType,
} from "../src/index.ts";

declare const CanvasKitInit: (o: { locateFile: () => string }) => Promise<any>;
const ROOT = process.cwd();
const W = 400, H = 300, Y = 125;
let failures = 0;
const check = (name: string, ok: boolean, detail = "") => { if (!ok) failures++; console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`); };
let record: ((c: SkiaCarousel) => void) | undefined;

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
  const create = (looped: boolean, build?: (carousel: SkiaCarousel) => SkiaControl, shader = false) => {
    const carousel = shader ? new SkiaShaderCarousel() : new SkiaCarousel(); carousel.HeightRequest = 250; carousel.HorizontalOptions = "Fill";
    carousel.Bounces = false; carousel.IsLooped = looped; carousel.LinearSpeedMs = 750;
    for (let i = 0; i < 4; i++) { const s = new SkiaShape(); s.BackgroundColor = "#483D8B"; s.HorizontalOptions = "Fill"; s.VerticalOptions = "Fill"; carousel.AddSubView(s); }
    const root = new SkiaLayer(); root.WidthRequest = W; root.HeightRequest = H; root.VerticalOptions = "Fill"; root.AddSubView(build ? build(carousel) : carousel);
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
      if (record) record(carousel);
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

  /** Where the carousel is, in slides around the loop, recorded on every drawn frame. */
  const positions: number[] = [];
  const track = (c: SkiaCarousel) => { if (c.SnapPoints.length > 1) { const step = Math.abs(c.SnapPoints[1].X - c.SnapPoints[0].X); positions.push(-c.CurrentPosition.X / step); } };
  /** The largest move between two frames, in slides around the loop of 4 (a jump to another pair is about one slide). */
  const largestStep = () => {
    let worst = 0, at = "";
    for (let i = 1; i < positions.length; i++) {
      let d = Math.abs(positions[i] - positions[i - 1]) % 4; d = Math.min(d, 4 - d);
      if (d > worst) { worst = d; at = `frame ${i}: ${positions[i - 1].toFixed(2)} -> ${positions[i].toFixed(2)}`; }
    }
    return { worst, at };
  };

  {
    const t = create(true);
    positions.length = 0; record = track;
    // C# robot.Pan(700 -> 300, 60 ms, 4 steps): a fast swipe to the next slide, before the last one ended
    const pan = (from: number, to: number) => { t.send("Pressed", from, 0); for (let i = 1; i <= 4; i++) t.send("Moved", from + ((to - from) * i) / 4, 15); t.send("Released", to, 1); t.frames(6); };
    for (let s = 0; s < 10; s++) pan(360, 160);
    for (let s = 0; s < 10; s++) pan(160, 360);
    t.frames(80);
    record = undefined;
    const { worst, at } = largestStep();
    check("fast swipes across the wrap, both ways: never a jump to another pair", worst < 0.5, at);
  }
  {
    // the demo's page: a centered column in a scroll, a card around a title and the carousel; the title changes while
    // the carousel moves, so the page lays out again at the same size
    let title!: SkiaLabel;
    const t = create(true, (carousel) => {
      title = new SkiaLabel(); title.Text = "start";
      const inner = new SkiaStack(); inner.HorizontalOptions = "Fill"; inner.AddSubView(title); inner.AddSubView(carousel);
      const card = new SkiaShape(); card.HorizontalOptions = "Fill"; card.AddSubView(inner);
      const page = new SkiaStack(); page.HorizontalOptions = "Center"; page.MaximumWidthRequest = 360; page.AddSubView(card);
      const scroll = new SkiaScroll(); scroll.VerticalOptions = "Fill"; scroll.HorizontalOptions = "Fill"; scroll.Content = page;
      return scroll;
    });
    positions.length = 0;
    let n = 0;
    record = (c) => { track(c); title.Text = `frame ${n++}`; };
    t.carousel.SelectedIndex = 3; // 0 -> 3 backward across the wrap: one slide, through the virtual slot
    t.frames(60);
    record = undefined;
    const { worst, at } = largestStep();
    check("a re-layout during a transition across the wrap does not move it", worst < 0.5 && t.carousel.SelectedIndex === 3, `${at}, index ${t.carousel.SelectedIndex}`);
  }

  {
    // a shader carousel: a swipe back against a running transition goes straight to its slide, never on to the end of
    // that transition first and then back (C# b75f233a)
    for (const [from, name] of [[1, "in the middle"], [0, "across the wrap"]] as const) {
      const t = create(true, undefined, true);
      t.carousel.ScrollTo(from, false); t.frames(4);
      const pan = (a: number, b: number) => { t.send("Pressed", a, 0); for (let i = 1; i <= 4; i++) t.send("Moved", a + ((b - a) * i) / 4, 15); t.send("Released", b, 1); };
      pan(160, 360); t.frames(4); // back toward the previous slide (across the wrap from slide 0), still moving
      positions.length = 0; record = track;
      pan(360, 160); // forward, against it
      t.frames(80);
      record = undefined;
      // after the swipe against it nothing moves further back (a falling position, around the loop)
      let forward = 0;
      for (let i = 1; i < positions.length; i++) { let d = positions[i] - positions[i - 1]; d -= 4 * Math.round(d / 4); if (d < -0.02) forward -= d; }
      check(`a swipe back against a running transition ${name} goes straight back`, forward < 0.05 && t.carousel.SelectedIndex === from, `back first ${forward.toFixed(2)}, index ${t.carousel.SelectedIndex}`);
    }
  }

  console.log(failures ? `FAIL: ${failures} checks` : "OK: looped carousel wrap");
  process.exit(failures ? 1 : 0);
})();
