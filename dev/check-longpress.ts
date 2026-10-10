// Long press (DrawnUi.Rust input_pointer "a press held still is a long press", 4f0ac22; AppoMobi TouchEffect), checked
// in Node (`npm run check:longpress`) on the engine Canvas without its DOM: a press held still for LongPressTimeMs
// gives one LongPressing at the press point and its release no Tapped; a quick press is a Tapped; a press that moves
// past the tap threshold first gives no LongPressing.
import { Canvas, SKPoint, TouchActionEventArgs, PointerData, type SkiaGesturesParameters } from "../src/index.ts";

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => { if (!ok) failures++; console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

(async () => {
  Canvas.LongPressTimeMs = 200; // the rule, not the number: shorter to keep the check fast
  const canvas = Object.create(Canvas.prototype) as Canvas & Record<string, unknown>;
  Object.assign(canvas, {
    gestures: "Lock", RenderingScale: 1, activeTouchIds: new Set(), pointerDownArgs: new Map(), previousTouchArgs: new Map(),
    pendingGestures: [], claimedTouches: new Set(), longPressTimers: new Map(), longPressed: new Set(), Update: () => {},
  });
  const pending = () => canvas.pendingGestures as SkiaGesturesParameters[];
  const send = (type: TouchActionEventArgs["Type"], x: number, y: number) => {
    const a = new TouchActionEventArgs(); a.Id = 1; a.Type = type; a.Scale = 1; a.Location = new SKPoint(x, y);
    const pd = new PointerData(); pd.DeviceType = "Mouse"; a.Pointer = pd;
    canvas.OnTouchAction(a);
  };
  const types = () => pending().splice(0).map((g) => g.Type).join(",");

  send("Pressed", 50, 50); await sleep(300); send("Released", 50, 50);
  const held = pending().slice();
  check("held still: Down, LongPressing, Up, no Tapped", types() === "Down,LongPressing,Up", held.map((g) => g.Type).join(","));
  const lp = held.find((g) => g.Type === "LongPressing");
  check("LongPressing at the press point", !!lp && lp.Event.Location.X === 50 && lp.Event.Location.Y === 50);

  send("Pressed", 50, 50); await sleep(50); send("Released", 50, 50); await sleep(250);
  check("a quick press is a tap, no long press later", types() === "Down,Tapped,Up");

  send("Pressed", 50, 50); send("Moved", 90, 50); await sleep(300); send("Released", 90, 50);
  check("moved past the threshold: no LongPressing", types() === "Down,Panning,Up");

  console.log(failures ? `FAIL: ${failures} checks` : "OK: long press");
  process.exit(failures ? 1 : 0);
})();
