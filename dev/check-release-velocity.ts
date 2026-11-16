// A fling is judged by when the release HAPPENED, checked in Node (`npm run check:release-velocity`): gestures are dated by
// their browser event's time, so a slow frame that handles a drag's release 400 ms late still flings with the velocity of
// the last 150 ms before the release; a release that really came long after the last move does not fling.
import { VelocityAccumulator } from "../src/core/ScrollAnimators.ts";

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => { if (!ok) failures++; console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`); };
const ns = (ms: number) => Math.round(ms * 1e6);
const started = performance.now();
while (performance.now() - started < 1100) { /* the clock past one second */ }
const t = performance.now() - 1000; // the drag happened a second ago: a slow frame handles its release only now
{
  const v = new VelocityAccumulator();
  for (let i = 0; i < 6; i++) v.CaptureVelocity(0, 900, ns(t + i * 16));
  const late = v.CalculateFinalVelocity(0, ns(t + 5 * 16 + 4));
  check("a release handled late by a slow frame still flings", Math.abs(late.Y - 900) < 1, JSON.stringify(late));
}
{
  const v = new VelocityAccumulator();
  for (let i = 0; i < 6; i++) v.CaptureVelocity(0, 900, ns(t + i * 16));
  const held = v.CalculateFinalVelocity(0, ns(t + 5 * 16 + 400));
  check("a release 400 ms after the last move (the finger held still) does not fling", held.Y === 0, JSON.stringify(held));
}
console.log(failures ? `FAIL: ${failures} checks` : "OK: a fling is judged by when the release happened");
process.exit(failures ? 1 : 0);
