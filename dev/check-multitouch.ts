// Multi-touch (AppoMobi.Gestures MultitouchTracker / ManipulationInfo, as DrawnUi.Blazor and DrawnUi.Rust), checked in
// Node (`npm run check:multitouch`) through the engine Canvas touch state machine: a Panning while two or more fingers
// are down carries Manipulation (center, pinch scale, turn in degrees the short way, totals, finger count); one finger
// carries none; a press that had a second finger down is no tap.
import { Super, SKPoint, Canvas, MultitouchTracker, TouchActionEventArgs, type SkiaGesturesParameters, type TouchActionType } from "../src/index.ts";

declare const CanvasKitInit: (o: { locateFile: () => string }) => Promise<any>;
const ROOT = process.cwd();
let failures = 0;
const check = (name: string, ok: boolean, detail = "") => { if (!ok) failures++; console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`); };
const near = (a: number | undefined, b: number, eps = 0.01) => a !== undefined && Math.abs(a - b) <= eps;

(async () => {
  const CK = await CanvasKitInit({ locateFile: () => `${ROOT}/node_modules/canvaskit-wasm/bin/full/canvaskit.wasm` });
  (Super as unknown as { CK: unknown }).CK = CK;

  // a Canvas without a DOM: only its touch state machine runs, the gestures it produces are read before routing
  const make = () => {
    const c = Object.create(Canvas.prototype) as Record<string, unknown>;
    Object.assign(c, {
      gestures: "Lock", gestureOwner: null, activeTouchIds: new Set(), pointerDownArgs: new Map(), previousTouchArgs: new Map(),
      pendingGestures: [], claimedTouches: new Set(), longPressTimers: new Map(), longPressed: new Set(), Update() {},
      fingers: new MultitouchTracker(), multiTouch: false, RenderingScale: 1,
    });
    const cv = c as unknown as Canvas;
    let ms = 1000;
    const send = (id: number, type: TouchActionType, x: number, y: number) => {
      ms += 16;
      const a = new TouchActionEventArgs(); a.Id = id; a.Type = type; a.Location = new SKPoint(x, y); a.Scale = 1; a.Timestamp = ms;
      cv.OnTouchAction(a);
    };
    const pending = () => c.pendingGestures as SkiaGesturesParameters[];
    const last = () => { const p = pending(); return p[p.length - 1]; };
    return { send, pending, last };
  };

  {
    const t = make();
    t.send(1, "Pressed", 100, 100);
    t.send(1, "Moved", 110, 100);
    check("one finger: Panning carries no Manipulation", t.last().Type === "Panning" && t.last().Event.Manipulation === undefined);
    t.send(2, "Pressed", 210, 100);
    t.send(2, "Moved", 310, 100);
    const m = t.last().Event.Manipulation;
    check("two fingers spreading: pinch scale +1 (twice as far apart)", t.last().Type === "Panning" && near(m?.Scale, 1) && m?.TouchesCount === 2, `scale ${m?.Scale}, touches ${m?.TouchesCount}`);
    check("its center moves from (160, 100) to (210, 100)", near(m?.PreviousCenter.X, 160) && near(m?.Center.X, 210) && near(m?.Center.Y, 100), `${m?.PreviousCenter.X} -> ${m?.Center.X}`);
    t.send(2, "Moved", 210, 200);
    const turn = t.last().Event.Manipulation;
    check("the second finger turning 45 degrees: Rotation 45", near(turn?.Rotation, 45), `${turn?.Rotation}`);
    t.send(2, "Moved", 10, 101);
    t.send(2, "Moved", 10, 99);
    const cross = t.last().Event.Manipulation;
    check("a turn across 180 degrees is the short way (about 1 degree, not 359)", cross !== undefined && Math.abs(cross.Rotation) < 2, `${cross?.Rotation}`);
    t.send(2, "Released", 10, 99);
    t.send(1, "Released", 110, 100);
  }
  {
    const t = make();
    t.send(1, "Pressed", 100, 100);
    t.send(2, "Pressed", 200, 100);
    t.send(2, "Released", 200, 100);
    t.send(1, "Released", 100, 100);
    check("a press that had a second finger down is no tap", !t.pending().some((g) => g.Type === "Tapped"), t.pending().map((g) => g.Type).join(","));
  }
  {
    const t = make();
    t.send(1, "Pressed", 100, 100);
    t.send(1, "Released", 100, 100);
    check("one finger pressed and released: a tap", t.pending().some((g) => g.Type === "Tapped"));
  }

  console.log(failures ? `FAIL: ${failures} checks` : "OK: multi-touch");
  process.exit(failures ? 1 : 0);
})();
