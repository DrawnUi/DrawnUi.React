// Easings and animator features (DrawnUi.Rust animation_features.rs), checked in Node (`npm run check:animation`):
// the MAUI easings' numbers; a ping-pong runs every repeat the other way; Pause freezes a run without frames and
// Resume goes on from there; a pause during the start delay keeps what is left of it.
import { readFileSync } from "node:fs";
import { Super, Easing, SkiaValueAnimator, PingPongAnimator, SkiaLayer, SkiaAccessibilityManager, HoverManager, type AnimatorBase, type Canvas } from "../src/index.ts";

declare const CanvasKitInit: (o: { locateFile: () => string }) => Promise<any>;
const ROOT = process.cwd();
let failures = 0;
const check = (name: string, ok: boolean, detail = "") => { if (!ok) failures++; console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
  /** What Canvas.ExecuteAnimators does: paused animators are skipped. Returns how many ticked. */
  Tick(ms = performance.now()): number {
    let n = 0;
    for (const a of [...this.AnimatingControls.values()]) { if (a.IsPaused) continue; a.TickFrame(Math.round(ms * 1_000_000)); n++; }
    return n;
  }
}

(async () => {
  const CK = await CanvasKitInit({ locateFile: () => `${ROOT}/node_modules/canvaskit-wasm/bin/full/canvaskit.wasm` });
  (Super as unknown as { CK: unknown }).CK = CK;

  // the MAUI easings at 0.25, 0.5, 0.75 (Rust the_maui_easings_have_their_numbers)
  const cases: [string, Easing, number[]][] = [
    ["Linear", Easing.Linear, [0.25, 0.5, 0.75]], ["CubicIn", Easing.CubicIn, [0.015625, 0.125, 0.421875]],
    ["CubicOut", Easing.CubicOut, [0.578125, 0.875, 0.984375]], ["CubicInOut", Easing.CubicInOut, [0.0625, 0.5, 0.9375]],
    ["SinIn", Easing.SinIn, [0.07612, 0.292893, 0.617317]], ["SinOut", Easing.SinOut, [0.382683, 0.707107, 0.92388]],
    ["SinInOut", Easing.SinInOut, [0.146447, 0.5, 0.853553]], ["BounceOut", Easing.BounceOut, [0.472656, 0.765625, 0.972656]],
    ["BounceIn", Easing.BounceIn, [0.027344, 0.234375, 0.527344]], ["SpringIn", Easing.SpringIn, [-0.064137, -0.087698, 0.18259]],
    ["SpringOut", Easing.SpringOut, [0.81741, 1.087697, 1.064137]], ["Default", Easing.Default, [0.0625, 0.5, 0.9375]],
  ];
  for (const [name, e, v] of cases) {
    const ok = Math.abs(e.Ease(0)) < 1e-6 && Math.abs(e.Ease(1) - 1) < 1e-6 && [0.25, 0.5, 0.75].every((t, i) => Math.abs(e.Ease(t) - v[i]) < 1e-5);
    check(`easing ${name}`, ok, [0.25, 0.5, 0.75].map((t) => e.Ease(t).toFixed(6)).join(","));
  }

  const fake = new FakeCanvas();
  const host = new SkiaLayer(); host._superview = fake as unknown as Canvas;

  // a spring easing goes past the end and the run still ends at the target
  {
    const a = new SkiaValueAnimator(host); a.mMinValue = 0; a.mMaxValue = 100; a.Speed = 100; a.Easing = Easing.SpringOut;
    let x = 0, peak = 0; a.OnUpdated = (v) => { x = v; peak = Math.max(peak, v); };
    a.Start(); fake.Tick(1000); fake.Tick(1050); fake.Tick(1075); fake.Tick(1100);
    check("SpringOut overshoots and lands on the end", peak > 100 && x === 100 && !a.IsRunning, `peak ${peak.toFixed(1)}, end ${x}`);
  }

  // ping-pong, one repeat: 0 -> 100, then 100 -> 0 (Rust ping_pong_runs_every_repeat_the_other_way)
  {
    const a = new PingPongAnimator(host); a.mMinValue = 0; a.mMaxValue = 100; a.Speed = 100; a.Repeat = 1;
    const xs: number[] = []; a.OnUpdated = (v) => xs.push(Math.round(v));
    a.Start(); fake.Tick(2000); fake.Tick(2050); fake.Tick(2100); fake.Tick(2116); fake.Tick(2141); fake.Tick(2216);
    check("ping-pong: 0, 50, 100, then 100, 75, 0 and stops", xs.join() === "0,50,100,100,75,0" && !a.IsRunning, xs.join());
  }

  // pause freezes, resume goes on from there (real clock: Pause / Resume read performance.now)
  {
    const a = new SkiaValueAnimator(host); a.mMinValue = 0; a.mMaxValue = 100; a.Speed = 400;
    let x = 0; a.OnUpdated = (v) => { x = v; };
    a.Start(); fake.Tick(); await sleep(100); fake.Tick();
    const before = x;
    a.Pause();
    const ticked = fake.Tick();
    await sleep(300); fake.Tick();
    check("paused: no tick, the value frozen", ticked === 0 && x === before, `ticked ${ticked}, ${x.toFixed(1)} vs ${before.toFixed(1)}`);
    a.Resume(); await sleep(100); fake.Tick();
    check("resumed: goes on from there (about 50 after 200 ms of running)", Math.abs(x - 50) < 8, `${x.toFixed(1)}`);
    a.Stop();
  }

  // a pause during the start delay keeps what is left of it
  {
    const a = new SkiaValueAnimator(host); a.mMinValue = 0; a.mMaxValue = 100; a.Speed = 100;
    a.Start(150); await sleep(60);
    a.Pause(); await sleep(300);
    check("paused during the delay: not started", !a.IsRunning);
    a.Resume(); await sleep(40);
    check("resumed: the rest of the delay still waits", !a.IsRunning);
    await sleep(100);
    check("then it starts", a.IsRunning);
    a.Stop();
  }

  console.log(failures ? `FAIL: ${failures} checks` : "OK: easings and animators");
  process.exit(failures ? 1 : 0);
})();
