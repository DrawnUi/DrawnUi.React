// An interrupted swipe on a SkiaShaderCarousel (drawnui-cross 6y, C# ShaderCarouselInterruptedSwipeTests f4628b7e),
// checked in Node (`npm run check:shader-carousel-interrupted`) through the engine Canvas touch state machine: a second
// swipe while the first still animates finishes it fast (phase 1), then goes one slide on (phase 2); Stopped fires once,
// at real rest, never between the phases, and InTransition stays true from phase 1 to the end of phase 2. A move by
// code during phase 1 drops the queued phase 2.
import {
  Super, SKRect, SKPoint, Canvas, SkiaAccessibilityManager, HoverManager, SkiaLayer, SkiaShape, SkiaShaderCarousel, TouchActionEventArgs,
  type AnimatorBase, type TouchActionType,
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

  /** 5 slides, Bounces off, LinearSpeedMs 420, in a 400 x 300 canvas; a clock that frames and touches share. */
  const create = (looped = false) => {
    const carousel = new SkiaShaderCarousel(); carousel.HeightRequest = 250; carousel.HorizontalOptions = "Fill";
    carousel.Bounces = false; carousel.IsLooped = looped; carousel.LinearSpeedMs = 420;
    for (let i = 0; i < 5; i++) { const s = new SkiaShape(); s.BackgroundColor = "#483D8B"; s.HorizontalOptions = "Fill"; s.VerticalOptions = "Fill"; carousel.AddSubView(s); }
    const root = new SkiaLayer(); root.WidthRequest = W; root.HeightRequest = H; root.VerticalOptions = "Fill"; root.AddSubView(carousel);
    const fake = new FakeCanvas();
    root._superview = fake as unknown as Canvas;
    let ms = 1000;
    const surface = CK.MakeSurface(W, H);
    const frame = () => {
      fake.FrameTimeNanos = Math.round(ms * 1_000_000);
      for (const a of [...fake.AnimatingControls.values()]) if (!a.IsPaused) a.TickFrame(fake.FrameTimeNanos);
      root.Measure(W, H, 1); root.Arrange(new SKRect(0, 0, W, H), W, H, 1);
      root.Render({ Context: { Canvas: surface.getCanvas(), Surface: surface }, Destination: new SKRect(0, 0, W, H), Scale: 1 });
    };
    const frames = (n: number) => { for (let i = 0; i < n; i++) { ms += 16; frame(); } };
    const c = Object.create(Canvas.prototype) as Record<string, unknown>;
    Object.assign(c, {
      gestures: "Lock", gestureOwner: null, content: root, activeTouchIds: new Set(), pointerDownArgs: new Map(), previousTouchArgs: new Map(),
      pendingGestures: [], claimedTouches: new Set(), longPressTimers: new Map(), longPressed: new Set(), Update() {},
    });
    const cv = c as unknown as Canvas & { ProcessPendingGestures(): void };
    const send = (type: TouchActionType, x: number, dt: number) => {
      ms += dt;
      const a = new TouchActionEventArgs(); a.Id = 1; a.Type = type; a.Location = new SKPoint(x, Y); a.Scale = 1; a.Timestamp = ms;
      cv.OnTouchAction(a); cv.ProcessPendingGestures(); frame();
    };
    /** A short fast swipe to the next slide (leftward), no frames after the release. */
    const flick = () => {
      let x = 300;
      send("Pressed", x, 0);
      for (let i = 0; i < 5; i++) { x -= 25; send("Moved", x, 8); }
      send("Released", x, 8);
    };
    let stops = 0;
    carousel.Stopped = () => { stops++; };
    frames(8);
    return { carousel, frames, flick, stopsSince: () => stops, resetStops: () => { stops = 0; } };
  };

  {
    const t = create();
    t.flick(); t.frames(4);
    const inMove = t.carousel.InTransition;
    t.resetStops();
    t.flick();
    let gap = false;
    for (let i = 0; i < 90; i++) { t.frames(1); if (t.carousel.InTransition === false && t.carousel.SelectedIndex !== 2) gap = true; }
    check("the second swipe lands one slide further: slide 2", inMove && t.carousel.SelectedIndex === 2, `index ${t.carousel.SelectedIndex}`);
    check("Stopped fires once, at real rest, not between the two phases", t.stopsSince() === 1, `${t.stopsSince()} stops`);
    check("InTransition stays true from phase 1 to the end of phase 2", !gap);
  }
  {
    const t = create();
    t.flick(); t.frames(4);
    t.flick(); t.frames(1);
    t.carousel.ScrollTo(0); // a move by code during phase 1
    t.frames(90);
    check("a move by code during phase 1 drops the queued phase 2: slide 0", t.carousel.SelectedIndex === 0, `index ${t.carousel.SelectedIndex}`);
  }
  {
    const t = create(true);
    t.carousel.ScrollTo(4, false); t.frames(4);
    t.resetStops();
    t.flick(); t.frames(4);
    t.flick(); t.frames(90);
    check("looped, from the last slide: two swipes wrap to slide 1, one Stopped", t.carousel.SelectedIndex === 1 && t.stopsSince() === 1, `index ${t.carousel.SelectedIndex}, ${t.stopsSince()} stops`);
  }

  console.log(failures ? `FAIL: ${failures} checks` : "OK: an interrupted swipe stops once");
  process.exit(failures ? 1 : 0);
})();
