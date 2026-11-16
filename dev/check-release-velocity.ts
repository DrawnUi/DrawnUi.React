// A fling after a short app freeze (Nick, 2026-11-16, Q10: as DrawnUi.Net), checked in Node (`npm run
// check:release-velocity`): the drag's samples are dated by when their events happened and the release velocity takes the
// samples of the last 150 ms before NOW, so a flick whose release a frozen app handles 1 s late does not fling, and a
// release handled at once does.
import { VelocityAccumulator } from "../src/core/ScrollAnimators.ts";

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => { if (!ok) failures++; console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`); };
const ns = (ms: number) => Math.round(ms * 1e6);
const started = performance.now();
while (performance.now() - started < 1100) { /* the clock past one second */ }
{
  const v = new VelocityAccumulator();
  const t = performance.now() - 1000; // the drag happened a second ago: the app was frozen until now
  for (let i = 0; i < 6; i++) v.CaptureVelocity(0, 900, ns(t + i * 16));
  const late = v.CalculateFinalVelocity();
  check("a flick handled 1 s late, after a freeze, does not fling", late.Y === 0, JSON.stringify(late));
}
{
  const v = new VelocityAccumulator();
  const t = performance.now() - 5 * 16 - 4; // the drag's last move 4 ms ago
  for (let i = 0; i < 6; i++) v.CaptureVelocity(0, 900, ns(t + i * 16));
  const now = v.CalculateFinalVelocity();
  check("a release handled at once flings", Math.abs(now.Y - 900) < 1, JSON.stringify(now));
}
console.log(failures ? `FAIL: ${failures} checks` : "OK: a flick handled late after a freeze does not fling");
process.exit(failures ? 1 : 0);
