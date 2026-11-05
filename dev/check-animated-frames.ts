// Frame players' timing (C# AnimatedFramesTimingTests, 8b5d099f), checked in Node (`npm run check:animated-frames`):
// play time = duration / SpeedRatio in SkiaSprite, SkiaGif and SkiaLottie (0 or below = normal speed); DefaultFrame and
// CurrentFrame are frame indexes (-1 = the last frame); a seek to a frame's exact start time lands on that frame;
// FrameSequence changed after loading updates the animator range.
import { Super, SkiaSprite, SkiaGif, GifAnimation, SkiaLottie } from "../src/index.ts";

declare const CanvasKitInit: (o: { locateFile: () => string }) => Promise<any>;
const ROOT = process.cwd();
let failures = 0;
const check = (name: string, ok: boolean, detail = "") => { if (!ok) failures++; console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`); };

(async () => {
  const CK = await CanvasKitInit({ locateFile: () => `${ROOT}/node_modules/canvaskit-wasm/bin/full/canvaskit.wasm` });
  (Super as unknown as { CK: unknown }).CK = CK;
  const bitmap = (w: number, h: number) => { const s = CK.MakeSurface(w, h); s.getCanvas().clear(CK.RED); const img = s.makeImageSnapshot(); s.delete(); return img; };

  /** A 4-frame sheet at 10 fps: 400 ms. */
  const sprite = (setup?: (s: SkiaSprite) => void, columns = 4, fps = 10) => {
    const s = new SkiaSprite(); s.Columns = columns; s.Rows = 1; s.FramesPerSecond = fps; s.AutoPlay = false;
    setup?.(s);
    s.SetSpriteSheet(bitmap(columns * 10, 10));
    return s;
  };
  const speed = (s: { Animator?: { Speed: number } }) => s.Animator?.Speed ?? NaN;

  const half = sprite(); half.SpeedRatio = 0.5;
  check("SkiaSprite SpeedRatio 0.5: twice the duration, 800 ms", speed(half) === 800, `${speed(half)}`);
  const twice = sprite(); twice.SpeedRatio = 2;
  check("SkiaSprite SpeedRatio 2: 200 ms", speed(twice) === 200, `${speed(twice)}`);
  const negative = sprite(); negative.SpeedRatio = -1;
  check("SkiaSprite SpeedRatio below 0: normal speed, 400 ms", speed(negative) === 400, `${speed(negative)}`);

  const d2 = sprite(); d2.DefaultFrame = 2;
  check("SkiaSprite DefaultFrame 2 after loading: frame 2", d2.CurrentFrame === 2, `${d2.CurrentFrame}`);
  const last = sprite((s) => { s.DefaultFrame = -1; });
  check("SkiaSprite DefaultFrame -1 before loading: the last frame", last.CurrentFrame === 3, `${last.CurrentFrame}`);
  const cur = sprite(); cur.CurrentFrame = -1;
  check("SkiaSprite CurrentFrame -1: the last frame", cur.CurrentFrame === 3, `${cur.CurrentFrame}`);
  const twelve = sprite(undefined, 12, 12); twelve.Seek(7 * 1000 / 12);
  check("SkiaSprite 12 fps, seek to frame 7's start: frame 7", twelve.CurrentFrame === 7, `${twelve.CurrentFrame}`);
  const seq = sprite(); seq.FrameSequence = [0, 1];
  check("SkiaSprite FrameSequence [0, 1] after loading: the animator range follows, 200 ms", seq.Animator?.mMaxValue === 200 && speed(seq) === 200, `${seq.Animator?.mMaxValue} / ${speed(seq)}`);
  const order = sprite(); order.FrameSequence = [3, 1]; order.Seek(150);
  check("SkiaSprite FrameSequence [3, 1], 150 ms: the second position (sheet frame 1)", order.CurrentFrame === 1, `${order.CurrentFrame}`);

  // a GIF of 4 frames, 100 ms each
  const gifAnimation = () => {
    const a = new GifAnimation();
    a.Frames = [bitmap(4, 4), bitmap(4, 4), bitmap(4, 4), bitmap(4, 4)];
    a.TotalFrames = 4; a.DurationMs = 400; a.Width = 4; a.Height = 4;
    (a as unknown as { positionsMs: number[] }).positionsMs = [100, 200, 300, 400];
    return a;
  };
  const gif = (setup?: (g: SkiaGif) => void) => { const g = new SkiaGif(); g.AutoPlay = false; setup?.(g); const a = gifAnimation(); g.SetAnimation(a, false); return { g, a }; };
  const slowGif = gif((g) => { g.SpeedRatio = 0.5; });
  check("SkiaGif SpeedRatio 0.5: 800 ms", speed(slowGif.g) === 800, `${speed(slowGif.g)}`);
  const g2 = gif((g) => { g.DefaultFrame = 2; });
  check("SkiaGif DefaultFrame 2 on load: frame 2 shows", g2.a.Frame === g2.a.Frames[2]);
  const gLast = gif((g) => { g.DefaultFrame = -1; });
  check("SkiaGif DefaultFrame -1 on load: the last frame shows", gLast.a.Frame === gLast.a.Frames[3]);
  const gLater = gif(); gLater.g.DefaultFrame = 1;
  check("SkiaGif DefaultFrame 1 set while stopped: frame 1 shows", gLater.a.Frame === gLater.a.Frames[1]);

  // a Lottie of 0.4 s at 10 fps
  const lottie = new SkiaLottie(); lottie.AutoPlay = false; lottie.SpeedRatio = 0.5;
  (lottie as unknown as { SetAnimation(a: unknown): void }).SetAnimation({ duration: () => 0.4, fps: () => 10, seekFrame() {}, seek() {}, delete() {}, size: () => [10, 10], render() {} });
  check("SkiaLottie SpeedRatio 0.5: 800 ms", speed(lottie) === 800, `${speed(lottie)}`);

  console.log(failures ? `FAIL: ${failures} checks` : "OK: frame players' timing");
  process.exit(failures ? 1 : 0);
})();
