// Long press (DrawnUi.Rust input_pointer "a press held still is a long press", 4f0ac22; AppoMobi TouchEffect), checked
// in Node (`npm run check:longpress`) on the engine Canvas without its DOM: a press held still for LongPressTimeMs
// gives one LongPressing at the press point and its release no Tapped; a quick press is a Tapped; a press that moves
// past the tap threshold first gives no LongPressing. The time is TouchEffect.LongPressTimeMsDefault (AppoMobi name,
// drawnui-cross 6cf): 750 ms by default on every engine, settable, Canvas.LongPressTimeMs is its alias.
import { Canvas, TouchEffect, SKPoint, TouchActionEventArgs, MultitouchTracker, PointerData, type SkiaGesturesParameters } from "../src/index.ts";

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => { if (!ok) failures++; console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const canvas = Object.create(Canvas.prototype) as Canvas & Record<string, unknown>;
  Object.assign(canvas, {
    gestures: "Lock", RenderingScale: 1, activeTouchIds: new Set(), pointerDownArgs: new Map(), previousTouchArgs: new Map(),
    pendingGestures: [], claimedTouches: new Set(), longPressTimers: new Map(), longPressed: new Set(), fingers: new MultitouchTracker(), multiTouch: false, Update: () => {},
  });
  const pending = () => canvas.pendingGestures as SkiaGesturesParameters[];
  const send = (type: TouchActionEventArgs["Type"], x: number, y: number) => {
    const a = new TouchActionEventArgs(); a.Id = 1; a.Type = type; a.Scale = 1; a.Location = new SKPoint(x, y);
    const pd = new PointerData(); pd.DeviceType = "Mouse"; a.Pointer = pd;
    canvas.OnTouchAction(a);
  };
  const types = () => pending().splice(0).map((g) => g.Type).join(",");

  // the default time and the setting
  const longAfter = async (ms: number) => { send("Pressed", 50, 50); await sleep(ms); send("Released", 50, 50); return types().includes("LongPressing"); };
  check("default TouchEffect.LongPressTimeMsDefault is 750 ms, Canvas.LongPressTimeMs the same", TouchEffect.LongPressTimeMsDefault === 750 && Canvas.LongPressTimeMs === 750, `${TouchEffect.LongPressTimeMsDefault} / ${Canvas.LongPressTimeMs}`);
  check("held 0.8 s: a long press", await longAfter(800));
  check("held 0.7 s: no long press", !(await longAfter(700)));
  TouchEffect.LongPressTimeMsDefault = 1200;
  check("set to 1200: Canvas.LongPressTimeMs follows", Canvas.LongPressTimeMs === 1200);
  check("set to 1200: held 1.1 s is no long press", !(await longAfter(1100)));
  check("set to 1200: held 1.3 s is a long press", await longAfter(1300));
  Canvas.LongPressTimeMs = 200; // the alias sets it too; the rule, not the number: shorter to keep the rest fast
  check("Canvas.LongPressTimeMs sets TouchEffect.LongPressTimeMsDefault", TouchEffect.LongPressTimeMsDefault === 200);

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
