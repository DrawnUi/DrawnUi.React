// DrawnGame frame clock (DrawnUi.Rust game_loop "resume restarts the frame clock and pause is a flag"), checked in Node
// (`npm run check:game`): the first delta after StartLoop is 0, the loop keeps running while paused (a flag the game
// reads), Resume restarts the clock (next delta 0), then deltas follow the frames.
import { readFileSync } from "node:fs";
import { Super, SKRect, SkiaAccessibilityManager, HoverManager, DrawnGame, type AnimatorBase, type Canvas } from "../src/index.ts";

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

class Game extends DrawnGame {
  readonly deltas: number[] = [];
  override GameLoop(delta: number): void { this.deltas.push(Math.round(delta * 1000) / 1000); }
}

(async () => {
  const CK = await CanvasKitInit({ locateFile: () => `${ROOT}/node_modules/canvaskit-wasm/bin/full/canvaskit.wasm` });
  (Super as unknown as { CK: unknown }).CK = CK;
  const face = CK.Typeface.MakeFreeTypeFaceFromData(readFileSync(`${ROOT}/samples/public/fonts/OpenSans-Regular.ttf`).buffer);
  Super.Fonts.set("FontText", new Map([[400, face]])); Super.DefaultTypeface = face; Super.DefaultFontAlias = "FontText";

  // the game subscribes to the window keyboard (KeyboardManager): Node has no window events
  (globalThis as unknown as { addEventListener(): void }).addEventListener ??= () => {};
  const fake = new FakeCanvas();
  const game = new Game(); game.WidthRequest = 100; game.HeightRequest = 100;
  game._superview = fake as unknown as Canvas;
  game.Measure(100, 100, 1); game.Arrange(new SKRect(0, 0, 100, 100), 100, 100, 1);
  game.StartLoop();
  const at = (ms: number) => { for (const a of [...fake.AnimatingControls.values()]) a.TickFrame(Math.round(ms * 1_000_000)); };
  at(1_000_000);          // a clock far from its origin: the first delta must still be 0
  at(1_000_016);
  game.Pause();
  at(1_005_016);          // paused: the loop runs, the game reads the flag
  game.Resume();
  at(1_008_016);          // 3 s after the resume: the clock restarted
  at(1_008_032);
  check("deltas: 0, 0.016, 5 (paused), 0 (resumed), 0.016", game.deltas.join() === "0,0.016,5,0,0.016", game.deltas.join());
  game.StopLoop();
  game.StartLoop();
  at(1_020_000);
  check("a restarted loop starts with 0", game.deltas[game.deltas.length - 1] === 0, `${game.deltas[game.deltas.length - 1]}`);

  console.log(failures ? `FAIL: ${failures} checks` : "OK: game frame clock");
  process.exit(failures ? 1 : 0);
})();
