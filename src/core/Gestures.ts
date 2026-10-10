// Mirrors AppoMobi.Gestures + DrawnUi.Features.Gestures types. Locations are PIXELS (like DrawnUi Event.Location).

import type { SkiaControl } from "./SkiaControl";

export class SKPoint {
  constructor(public X = 0, public Y = 0) {}
  static readonly Empty = new SKPoint();
  Add(p: SKPoint) { return new SKPoint(this.X + p.X, this.Y + p.Y); }
  Subtract(p: SKPoint) { return new SKPoint(this.X - p.X, this.Y - p.Y); }
}

/** Raw platform action (subset of TouchActionType). */
export type TouchActionType = "Pressed" | "Moved" | "Released" | "Cancelled" | "Wheel" | "Pointer";

/** Recognized gesture (TouchActionResult). LongPressing after Canvas.LongPressTimeMs held still; Pointer / Touch declared for parity, not produced. */
export type TouchActionResult = "Touch" | "Down" | "Up" | "Tapped" | "LongPressing" | "Panning" | "Wheel" | "Pointer";

export type GesturesMode = "Disabled" | "Enabled" | "Lock";

export type LockTouch = "Disabled" | "Enabled" | "PassNone" | "PassTap" | "PassTapAndLongPress";

/** TouchActionEventArgs.DistanceInfo. Velocity is pixels per second. */
export class DistanceInfo {
  Start = SKPoint.Empty;
  End = SKPoint.Empty;
  Delta = SKPoint.Empty;
  Total = SKPoint.Empty;
  Velocity = SKPoint.Empty;
}

/**
 * The last positions of a press with their times (DrawnUi.Rust gestures `Trail`, 6d525f7). Measured only against the
 * previous move, irregular delivery made the velocity worthless: moves handled in one burst (queued pointer events
 * handed over back to back by a busy main thread, WSLg pairs 0.01 ms apart) gave millions of px/s and every fling at
 * the limit. Moves under BurstMs apart are one position; a move's velocity is its displacement over the last WindowMs,
 * the earlier position interpolated; when the previous move is already that old, its own velocity exactly (evenly
 * spaced input at 60 Hz measures as before).
 */
export class VelocityTrail {
  /** A move's velocity is its displacement over this much time. */
  static readonly WindowMs = 16;
  /** Below this since the press no velocity is measured yet: the first moves of a burst. */
  static readonly MinMs = 4;
  /** Moves closer than this came in one burst: one position, at the burst's first time. */
  static readonly BurstMs = 1;
  private static readonly Capacity = 16;
  private readonly points: { X: number; Y: number; T: number }[] = [];

  Push(x: number, y: number, t: number): void {
    const last = this.points[this.points.length - 1];
    if (last && t - last.T < VelocityTrail.BurstMs) { last.X = x; last.Y = y; return; }
    if (this.points.length === VelocityTrail.Capacity) this.points.shift();
    this.points.push({ X: x, Y: y, T: t });
  }

  /** The velocity at (x, y) at time t (ms), pixels per second; `fallback` right after the press. */
  Velocity(x: number, y: number, t: number, fallback: SKPoint): SKPoint {
    let n = this.points.length;
    // a move in the burst of the last position measures from the positions before it
    if (n > 0 && t - this.points[n - 1].T < VelocityTrail.BurstMs) n--;
    if (n === 0) return fallback;
    const since = t - this.points[0].T;
    if (since < VelocityTrail.MinMs) return fallback;
    const window = Math.min(VelocityTrail.WindowMs, since), at = t - window;
    const last = this.points[n - 1];
    if (last.T <= at) { const secs = (t - last.T) / 1000; return new SKPoint((x - last.X) / secs, (y - last.Y) / secs); }
    // the position at `at`: between the two positions around it (the current one included)
    let fromX = this.points[0].X, fromY = this.points[0].Y, prev = this.points[0];
    for (let i = 1; i <= n; i++) {
      const p = i < n ? this.points[i] : { X: x, Y: y, T: t };
      if (p.T >= at) {
        const share = p.T - prev.T < 1e-6 ? 1 : (at - prev.T) / (p.T - prev.T);
        fromX = prev.X + (p.X - prev.X) * share; fromY = prev.Y + (p.Y - prev.Y) * share;
        break;
      }
      prev = p;
    }
    const secs = window / 1000;
    return new SKPoint((x - fromX) / secs, (y - fromY) / secs);
  }
}

/** AppoMobi.Gestures MouseButton: which button pressed / released (DOM button 0..4). */
export type MouseButton = "Left" | "Middle" | "Right" | "XButton1" | "XButton2" | "Extended";
export type PointerDeviceType = "Mouse" | "Touch" | "Pen";

/** AppoMobi.Gestures PointerData: the device and button behind a Down / Up / Tapped (every button is delivered). */
export class PointerData {
  Button: MouseButton = "Left";
  /** 1 = Left, 2 = Right, 3 = Middle, 4+ = extended, like AppoMobi.Gestures. */
  ButtonNumber = 1;
  DeviceType: PointerDeviceType = "Mouse";
  /** DOM `buttons` bitmask of the buttons held (1 left, 2 right, 4 middle, 8 back, 16 forward). */
  PressedButtons = 0;
}

/** AppoMobi.Gestures TouchActionEventArgs. */
export class TouchActionEventArgs {
  Id = 0;
  /** Device and button of this event (mouse, pen, touch); undefined for wheel. */
  Pointer?: PointerData;
  Type: TouchActionType = "Pressed";
  /** Pixels. */
  Location = SKPoint.Empty;
  StartingLocation = SKPoint.Empty;
  Distance = new DistanceInfo();
  NumberOfTouches = 1;
  IsInContact = false;
  Scale = 1;
  Timestamp = performance.now();
  /** ms since the previous event of the same pointer. */
  DeltaTimeMs = 0;
  /** The press's recent positions the velocity is measured over, carried from event to event of one pointer. */
  Trail?: VelocityTrail;
  /**
   * Mouse wheel: Delta > 0 = wheel down / right (browser sign). IsHorizontal: the event is along the X axis (a tilting
   * wheel, the sideways part of a two-finger touchpad swipe), as C# WheelEventArgs.IsHorizontal.
   */
  Wheel: { Delta: number; IsHorizontal?: boolean } = { Delta: 0 };
  /**
   * AppoMobi TouchActionEventArgs.Handled: set by a control that actually used the event. The canvas prevents the
   * browser default (the page scrolling under the wheel) only for a Handled event in `Gestures="Enabled"`.
   */
  Handled = false;

  /** Same as the .NET helper: derives Start/End/Delta/Total from the previous event of the same pointer. */
  static FillDistanceInfo(current: TouchActionEventArgs, previous: TouchActionEventArgs | undefined): void {
    if (!previous) { current.Distance = new DistanceInfo(); return; }
    current.StartingLocation = previous.StartingLocation;
    current.IsInContact = previous.IsInContact;
    current.DeltaTimeMs = current.Timestamp - previous.Timestamp;
    const d = new DistanceInfo();
    d.Start = previous.Location;
    const released = current.Type === "Released" || current.Type === "Cancelled";
    d.End = released ? previous.Location : current.Location;
    d.Delta = released ? SKPoint.Empty : current.Location.Subtract(previous.Location);
    d.Total = previous.Distance.Total.Add(d.Delta);
    if (released) d.Velocity = previous.Distance.Velocity;
    else {
      let trail = previous.Trail;
      if (!trail) { trail = new VelocityTrail(); trail.Push(previous.Location.X, previous.Location.Y, previous.Timestamp); }
      d.Velocity = trail.Velocity(current.Location.X, current.Location.Y, current.Timestamp, previous.Distance.Velocity);
      trail.Push(current.Location.X, current.Location.Y, current.Timestamp);
      current.Trail = trail;
    }
    current.Distance = d;
  }
}

/** DrawnUi SkiaGesturesParameters: recognized gesture + its raw event. */
export class SkiaGesturesParameters {
  Type: TouchActionResult = "Touch";
  Event = new TouchActionEventArgs();
  ArrivedTimeNanos = 0;

  static Create(action: TouchActionResult, args: TouchActionEventArgs): SkiaGesturesParameters {
    const p = new SkiaGesturesParameters();
    p.Type = action;
    p.Event = args;
    p.ArrivedTimeNanos = Math.round(performance.now() * 1e6);
    return p;
  }
}

/** DrawnUi GestureEventProcessingInfo. */
export class GestureEventProcessingInfo {
  constructor(
    public MappedLocation = SKPoint.Empty,
    public ChildOffset = SKPoint.Empty,
    public ChildOffsetDirect = SKPoint.Empty,
    public AlreadyConsumed: SkiaControl | null = null,
  ) {}
  static readonly Empty = new GestureEventProcessingInfo();
}

/** DrawnUi SkiaGesturesInfo: payload of ConsumeGestures, set Consumed=true to stop propagation. */
export class SkiaGesturesInfo {
  Consumed = false;
  constructor(public Args: SkiaGesturesParameters, public Info: GestureEventProcessingInfo) {}
}

/** DrawnUi ControlTappedEventArgs. */
/** Where a context-menu request came from: right click, long press (Android fires contextmenu), or the keyboard Menu key. */
export type ContextMenuSource = "mouse" | "touch" | "keyboard";

/**
 * Arguments of SkiaControl.ContextMenu / Canvas.ContextMenu: a browser `contextmenu` request on the canvas (right
 * click, long press on touch, the Menu key). Handlers return true to take it: the browser's own menu ("Save image")
 * is then suppressed; otherwise it shows as usual.
 */
export class ContextMenuEventArgs {
  /** Deepest control under the point that had a ContextMenu handler (set while routing). */
  Control?: SkiaControl;
  /** Point inside Control, in pixels relative to its DrawingRect origin (set while routing). */
  Local: SKPoint = SKPoint.Empty;
  constructor(
    /** Point on the canvas, in points (CSS px). */
    public Location: SKPoint,
    /** Same point in pixels (canvas space). */
    public Pixels: SKPoint,
    public Source: ContextMenuSource,
    /** The DOM event: modifiers, target, preventDefault if you need it yourself. */
    public Native: MouseEvent,
  ) {}
}

export class ControlTappedEventArgs {
  constructor(
    public Control: SkiaControl,
    public Parameters: SkiaGesturesParameters,
    public ProcessingInfo: GestureEventProcessingInfo,
  ) {}
}
