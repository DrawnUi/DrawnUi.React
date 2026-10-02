// Wheel / touchpad and drag-start rules in Node (`npm run check:wheel`): a fast trackpad swipe (a notch-sized event before
// every frame) moves the content on every frame (no stall, then jump); a vertical scroll leaves horizontal events and a
// horizontal scroll takes both (drawnui-cross wheel rule 4); a carousel drag whose first move is too short to tell its
// direction still pans (a 1 CSS px first move at devicePixelRatio 2).
import { readFileSync } from "node:fs";
import {
  Super, SkiaScroll, SkiaStack, SkiaRow, SkiaLayer, SkiaCarousel, SKRect, SKPoint, TouchActionEventArgs, SkiaGesturesParameters,
  GestureEventProcessingInfo, type AnimatorBase, type SkiaControl,
} from "../src/index.ts";

declare const CanvasKitInit: (o: { locateFile: () => string }) => Promise<any>;
const ROOT = process.cwd();
let clock = 1000; // ms, the performance.now() timeline the wheel reads
(performance as unknown as { now: () => number }).now = () => clock;

class FakeCanvas {
  readonly AccessibilityManager = { Register() {}, Unregister() {}, NotifyUpdated() {}, OnFrameEnd() {} } as unknown;
  readonly AnimatingControls = new Map<number, AnimatorBase>();
  WheelDeltaPerNotch = 100; RenderingScale = 1; FrameTimeNanos = 0;
  readonly q: { Dispose(): void }[] = [];
  Update(): void {}
  DisposeObject(o: { Dispose(): void }): void { this.q.push(o); }
  RegisterAnimator(a: AnimatorBase): boolean { this.AnimatingControls.set(a.Uid, a); return true; }
  UnregisterAnimator(uid: number): void { this.AnimatingControls.delete(uid); }
}

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => { if (!ok) failures++; console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`); };

(async () => {
  const CK = await CanvasKitInit({ locateFile: () => `${ROOT}/node_modules/canvaskit-wasm/bin/full/canvaskit.wasm` });
  (Super as unknown as { CK: unknown }).CK = CK;
  const W = 400, H = 600;
  const host = (root: SkiaControl, scale = 1) => {
    const fake = new FakeCanvas(); fake.RenderingScale = scale;
    (root as unknown as { _superview: unknown })._superview = fake;
    const frame = () => {
      clock += 16.667;
      fake.FrameTimeNanos = Math.round(clock * 1e6);
      for (const a of [...fake.AnimatingControls.values()]) a.TickFrame(fake.FrameTimeNanos);
      const s = CK.MakeSurface(W, H);
      root.Measure(W, H, scale); root.Arrange(new SKRect(0, 0, W, H), -1, -1, scale);
      root.Render({ Context: { Canvas: s.getCanvas(), Surface: s }, Destination: new SKRect(0, 0, W, H), Scale: scale });
      s.delete(); for (const o of fake.q.splice(0)) o.Dispose();
    };
    return frame;
  };
  const rows = (n: number, row: boolean) => { const l = row ? new SkiaRow() : new SkiaStack(); for (let i = 0; i < n; i++) { const c = new SkiaLayer(); if (row) c.WidthRequest = 80; else c.HeightRequest = 60; l.AddSubView(c); } return l; };
  const wheel = (target: SkiaControl, delta: number, horizontal = false) => {
    const a = new TouchActionEventArgs(); a.Type = "Wheel"; a.Location = new SKPoint(200, 300); a.StartingLocation = a.Location;
    a.Wheel = { Delta: delta, IsHorizontal: horizontal };
    return target.OnSkiaGestureEvent(SkiaGesturesParameters.Create("Wheel", a), new GestureEventProcessingInfo(a.Location));
  };

  // 1. fast trackpad swipe: an event of 1.2 notches before every frame moves the content on every frame
  {
    const scroll = new SkiaScroll(); scroll.Orientation = "Vertical"; scroll.Content = rows(200, false);
    const frame = host(scroll); frame(); frame();
    const trace: number[] = [];
    for (let i = 0; i < 8; i++) { clock += 2; wheel(scroll, 120); frame(); trace.push(scroll.ViewportOffsetY); }
    for (let i = 0; i < 60; i++) frame();
    const moves = trace.every((y, i) => y < (i === 0 ? 0 : trace[i - 1]) - 0.5);
    check("fast swipe: the content moves on every frame while events arrive", moves, trace.map((y) => y.toFixed(0)).join(", "));
    check("fast swipe: lands on 8 x 1.2 notches", Math.abs(scroll.ViewportOffsetY + 8 * 1.2 * 150) < 0.5, scroll.ViewportOffsetY.toFixed(1));
  }

  // 2. rule 4: a vertical scroll leaves horizontal events, a horizontal scroll takes both
  {
    const vertical = new SkiaScroll(); vertical.Orientation = "Vertical"; vertical.Content = rows(200, false);
    const frameV = host(vertical); frameV(); frameV();
    const used = wheel(vertical, 120, true); for (let i = 0; i < 40; i++) frameV();
    check("vertical scroll leaves a horizontal event", !used && vertical.ViewportOffsetY === 0, `${used ? "used" : "not used"}, offset ${vertical.ViewportOffsetY}`);
    const horizontal = new SkiaScroll(); horizontal.Orientation = "Horizontal"; horizontal.Content = rows(100, true);
    const frameH = host(horizontal); frameH(); frameH();
    wheel(horizontal, 30, true); frameH();
    const afterX = horizontal.ViewportOffsetX;
    wheel(horizontal, 30, false); frameH();
    check("horizontal scroll takes a horizontal event and a vertical one", afterX < -0.5 && horizontal.ViewportOffsetX < afterX - 0.5, `${afterX.toFixed(1)} then ${horizontal.ViewportOffsetX.toFixed(1)}`);
  }

  // 3. carousel: at scale 2 a first move of 1.3 px is too short to tell the direction; the drag must still pan
  {
    const carousel = new SkiaCarousel(); carousel.WidthRequest = 300; carousel.HeightRequest = 200;
    for (let i = 0; i < 4; i++) { const s = new SkiaLayer(); s.BackgroundColor = "#336699"; carousel.AddSubView(s); }
    const frame = host(carousel, 2); frame(); frame();
    const start = new SKPoint(400, 200);
    const send = (type: "Down" | "Panning", total: number, delta: number) => {
      const a = new TouchActionEventArgs(); a.Type = type === "Down" ? "Pressed" : "Moved"; a.Location = new SKPoint(start.X - total, start.Y); a.StartingLocation = start;
      a.Distance.Total = new SKPoint(-total, 0); a.Distance.Delta = new SKPoint(-delta, 0); a.Distance.Velocity = new SKPoint(-delta * 60, 0);
      carousel.OnSkiaGestureEvent(SkiaGesturesParameters.Create(type, a), new GestureEventProcessingInfo(a.Location));
    };
    send("Down", 0, 0);
    let prev = 0;
    for (const total of [1.3, 8.6, 26.4, 50.5, 80, 120, 160]) { send("Panning", total, total - prev); prev = total; frame(); }
    check("carousel pans after a 1.3 px first move at scale 2", carousel.IsUserPanning);
  }

  console.log(failures ? `FAIL: ${failures} checks` : "OK: wheel and drag start");
  process.exit(failures ? 1 : 0);
})();
