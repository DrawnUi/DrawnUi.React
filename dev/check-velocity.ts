// Pan velocity with input in bursts (DrawnUi.Rust 6d525f7 `moves_in_bursts_release_at_the_hands_speed`), checked in
// Node (`npm run check:velocity`): moves handed over in pairs 0.01 ms apart every 15 ms release at the hand's speed,
// not millions of px/s; evenly spaced input at 60 Hz measures as before (each move's own velocity).
import { TouchActionEventArgs, SKPoint, VelocityAccumulator } from "../src/index.ts";

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => { if (!ok) failures++; console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`); };

/** One press fed through FillDistanceInfo as the canvas does; returns each move's event. */
const press = (base: number, moves: [number, number][]) => {
  let previous = new TouchActionEventArgs();
  previous.Type = "Pressed"; previous.Location = new SKPoint(0, 0); previous.Timestamp = base;
  const out: TouchActionEventArgs[] = [];
  for (const [time, y] of moves) {
    const e = new TouchActionEventArgs();
    e.Type = "Moved"; e.Location = new SKPoint(0, y); e.Timestamp = base + time;
    TouchActionEventArgs.FillDistanceInfo(e, previous);
    out.push(e); previous = e;
  }
  return out;
};

// pairs 0.01 ms apart every 15 ms (6 px, then 9 px): the hand moves 15 px per 15 ms = 1000 px/s
{
  const moves: [number, number][] = [];
  let y = 0;
  for (let burst = 1; burst <= 8; burst++) for (const [later, dy] of [[0, 6], [0.01, 9]]) { y += dy; moves.push([burst * 15 + later, y]); }
  const base = performance.now() - 125; // the release comes ~5 ms after the last move
  const accumulator = new VelocityAccumulator();
  for (const e of press(base, moves)) accumulator.CaptureVelocity(e.Distance.Velocity.X, e.Distance.Velocity.Y, Math.round(e.Timestamp * 1e6));
  const release = accumulator.CalculateFinalVelocity();
  check("bursts release at the hand's speed", Math.abs(release.Y - 1000) < 2, `${release.Y.toFixed(1)} px/s`);
}

// evenly spaced at 60 Hz, changing speed: every move's own velocity, as before
{
  const moves: [number, number][] = [];
  let y = 0;
  for (let i = 1; i <= 20; i++) { y += i * 1.5; moves.push([i * (1000 / 60), y]); }
  const worst = Math.max(...press(1000, moves).map((e) => Math.abs(e.Distance.Velocity.Y - e.Distance.Delta.Y / (e.DeltaTimeMs / 1000))));
  check("60 Hz moves measure their own velocity", worst < 1e-6, `worst diff ${worst}`);
}

// evenly spaced at 8 ms, steady hand: the steady speed
{
  const moves: [number, number][] = [];
  for (let i = 1; i <= 20; i++) moves.push([i * 8, i * 4]);
  const worst = Math.max(...press(1000, moves).map((e) => Math.abs(e.Distance.Velocity.Y - 500)));
  check("8 ms moves of a steady hand measure its speed", worst < 1e-6, `worst diff ${worst}`);
}

console.log(failures ? `FAIL: ${failures} checks` : "OK: pan velocity follows the hand");
process.exit(failures ? 1 : 0);
