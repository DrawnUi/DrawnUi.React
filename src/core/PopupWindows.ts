import type { DrawingContext, SkiaControl } from "./SkiaControl";
import { SKPoint } from "./Gestures";
import { SKRect } from "./Types";
import { Aria, type SkiaAccessibilityManager } from "./Accessibility";

/** A popup window opened with `Canvas.OpenPopupWindow` (drawnui-cross 6at, C# PopupId, Rust PopupId). */
export type PopupId = number;

/** Where a popup window opens from, in canvas points, or a control (C# PopupAnchor, Rust PopupAnchor). */
export class PopupAnchor {
  private constructor(
    /** The point or the rect, in canvas points (empty for a control). */
    readonly Rect: SKRect,
    /** A point: the popup's top-left corner is there; where the canvas ends it opens to the left of the point, or above it. */
    readonly IsPoint: boolean,
    /** A control: the popup opens below the rect it is drawn at now, as for a rect. */
    readonly Control?: SkiaControl,
  ) {}

  /** A point (where a right click was), in canvas points. */
  static AtPoint(point: SKPoint): PopupAnchor { return new PopupAnchor(new SKRect(point.X, point.Y, point.X, point.Y), true); }
  /** A rect (the button a dropdown belongs to), in canvas points: below it, left edges together; where the canvas ends, above it or right edges together. */
  static AtRect(rect: SKRect): PopupAnchor { return new PopupAnchor(rect, false); }
  /** A control: as a rect, with the rect it is drawn at now (moved, scaled, scrolled). */
  static AtControl(control: SkiaControl): PopupAnchor { return new PopupAnchor(SKRect.Empty, false, control); }
  /** A point, a rect or a control as an anchor. */
  static From(anchor: PopupAnchor | SKPoint | SKRect | SkiaControl | { X: number; Y: number }): PopupAnchor {
    if (anchor instanceof PopupAnchor) return anchor;
    if (typeof (anchor as SkiaControl).Measure === "function") return PopupAnchor.AtControl(anchor as SkiaControl);
    if ("Right" in anchor && "Bottom" in anchor) { const r = anchor as SKRect; return PopupAnchor.AtRect(new SKRect(r.Left, r.Top, r.Right, r.Bottom)); }
    const p = anchor as { X: number; Y: number };
    return PopupAnchor.AtPoint(new SKPoint(p.X, p.Y));
  }

  /** The anchor in canvas pixels. */
  Pixels(scale: number): SKRect {
    if (this.Control) {
      const r = this.Control.GetAccessibilityPixelRect(); // on screen now: through caches and scroll offsets
      return r.Width > 0 || r.Height > 0 ? r : this.Control.DrawingRect;
    }
    const r = this.Rect;
    return new SKRect(r.Left * scale, r.Top * scale, r.Right * scale, r.Bottom * scale);
  }
}

/** How a popup window behaves; the defaults: sized to its content, closed by a press outside it, Escape or the app. */
export interface PopupWindowOptions {
  /** Its size in points; unset: the size its content measures to. Never larger than the canvas. */
  Size?: { Width: number; Height: number };
  /** It also closes once the mouse has stayed outside it (or off the canvas) for 300 ms. */
  CloseOnPointerLeave?: boolean;
  /** Drawn on the canvas, inside it: always so in the browser (accepted for the same API as the other engines). */
  OnCanvas?: boolean;
  /** A window of its own drawn on the CPU (desktop engines); no effect in the browser. */
  Cpu?: boolean;
  /** Shows only, as a tooltip: takes no input, has no accessibility node, Escape and a press outside leave it open. */
  Passive?: boolean;
}

interface PopupWindow { Id: PopupId; Root: SkiaControl; Anchor: PopupAnchor; Options: PopupWindowOptions; Rect: SKRect; LeftAt: number }

/** The canvas side the layer needs. */
interface PopupHostCanvas {
  Update(): void;
  DisposeObject(o: { Dispose(): void }): void;
  RaisePopupWindowClosed(id: PopupId): void;
  readonly AccessibilityManager: SkiaAccessibilityManager;
}

/**
 * The popup windows of one canvas (C# PopupLayer): drawn over everything, given input first, closed by a press outside
 * (the rest of that press goes nowhere, as with native menus).
 */
export class PopupLayer {
  private readonly popups: PopupWindow[] = [];
  private nextId = 0;
  /** A press outside closed the popups: the rest of that press goes nowhere. */
  SwallowPress = false;

  constructor(private readonly canvas: PopupHostCanvas) {}

  get HasAny(): boolean { return this.popups.length > 0; }
  get HasInteractive(): boolean { return this.popups.some((p) => !p.Options.Passive); }
  /** The content of the top popup window that takes input. */
  get TopInteractive(): SkiaControl | undefined { for (let i = this.popups.length - 1; i >= 0; i--) if (!this.popups[i].Options.Passive) return this.popups[i].Root; return undefined; }
  IsOpen(id: PopupId): boolean { return this.popups.some((p) => p.Id === id); }

  Open(root: SkiaControl, anchor: PopupAnchor, options: PopupWindowOptions, superview: SkiaControl["_superview"]): PopupId {
    root.HorizontalOptions = "Start";
    root.VerticalOptions = "Start";
    if (options.Size) { root.WidthRequest = options.Size.Width; root.HeightRequest = options.Size.Height; }
    if (options.Passive) { root.InputTransparent = true; root.AccessibilityRole ??= Aria.RolePresentation; }
    root.Parent = undefined;
    root._superview = superview;
    const popup: PopupWindow = { Id: ++this.nextId, Root: root, Anchor: anchor, Options: options, Rect: SKRect.Empty, LeftAt: 0 };
    this.popups.push(popup);
    return popup.Id;
  }

  Close(id: PopupId): void { const p = this.popups.find((x) => x.Id === id); if (p) this.Remove(p); }

  CloseTop(): boolean {
    for (let i = this.popups.length - 1; i >= 0; i--) if (!this.popups[i].Options.Passive) { this.Remove(this.popups[i]); return true; }
    return false;
  }

  CloseAll(passiveToo: boolean): void {
    for (const p of [...this.popups]) if (passiveToo || !p.Options.Passive) this.Remove(p);
  }

  private Remove(popup: PopupWindow): void {
    const i = this.popups.indexOf(popup);
    if (i < 0) return;
    this.popups.splice(i, 1);
    // its nodes leave the accessibility tree with this frame, not when the disposal runs after it
    this.canvas.AccessibilityManager.UnregisterSubtree(popup.Root);
    this.canvas.AccessibilityManager.ForceRebuildOnNextFrame();
    this.canvas.DisposeObject(popup.Root);
    this.canvas.Update();
    this.canvas.RaisePopupWindowClosed(popup.Id);
  }

  /** The top popup window taking input whose content is under the point (canvas pixels). */
  At(x: number, y: number): SkiaControl | undefined {
    for (let i = this.popups.length - 1; i >= 0; i--) {
      const p = this.popups[i];
      if (!p.Options.Passive && p.Root.IsVisible && p.Root.HitIsInside(x, y)) return p.Root;
    }
    return undefined;
  }

  /** The pointer is at (x, y) (undefined: off the canvas): popups closing on pointer leave close after 300 ms outside. */
  PointerAt(x: number | undefined, y: number | undefined): void {
    const now = performance.now();
    for (const p of [...this.popups]) {
      if (!p.Options.CloseOnPointerLeave) continue;
      const inside = x !== undefined && y !== undefined && p.Root.HitIsInside(x, y);
      if (inside) { p.LeftAt = 0; continue; }
      if (!p.LeftAt) { p.LeftAt = now; window.setTimeout(() => { if (p.LeftAt && performance.now() - p.LeftAt >= 300) this.Remove(p); }, 310); }
    }
  }

  /**
   * Where a popup of `w` x `h` goes for `anchor` (pixels) inside `bounds`: at the anchor's corner, flipped to its other side
   * where it does not fit, then kept inside (C# PopupLayer.Place, Rust place_popup).
   */
  static Place(anchor: SKRect, point: boolean, w: number, h: number, bounds: SKRect): SKRect {
    w = Math.max(0, Math.min(w, bounds.Width));
    h = Math.max(0, Math.min(h, bounds.Height));
    let left = anchor.Left;
    if (left + w > bounds.Right) left = point ? anchor.Left - w : anchor.Right - w;
    let top = anchor.Bottom;
    if (top + h > bounds.Bottom) top = anchor.Top - h;
    left = Math.round(Math.min(Math.max(left, bounds.Left), bounds.Right - w));
    top = Math.round(Math.min(Math.max(top, bounds.Top), bounds.Bottom - h));
    return new SKRect(left, top, left + Math.round(w), top + Math.round(h));
  }

  /** Measures, places and draws every popup over the content, inside `bounds` (canvas pixels). */
  Draw(ctx: DrawingContext, bounds: SKRect): void {
    const scale = ctx.Scale;
    for (const p of this.popups) {
      const root = p.Root;
      const size = root.Measure(bounds.Width, bounds.Height, scale).Pixels;
      if (size.Width <= 0 || size.Height <= 0) continue;
      p.Rect = PopupLayer.Place(p.Anchor.Pixels(scale), p.Anchor.IsPoint, size.Width, size.Height, bounds);
      root.Arrange(p.Rect, root.WidthRequest, root.HeightRequest, scale);
      root.Render({ Context: ctx.Context, Destination: p.Rect, Scale: scale });
    }
  }

  Dispose(): void { for (const p of this.popups.splice(0)) p.Root.Dispose(); }
}
