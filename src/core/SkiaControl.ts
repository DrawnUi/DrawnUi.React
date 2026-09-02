import type { Canvas as SkCanvas, Path } from "canvaskit-wasm";
import { Super } from "./Super";
import { type Color, Colors, type LayoutOptions, SKRect, ScaledSize, type SkiaTouchAnimation, Thickness } from "./Types";
import { type IOverlayEffect, RippleAnimator } from "./Animators";
import type { Canvas } from "./Canvas";
import {
  ControlTappedEventArgs, GestureEventProcessingInfo, type LockTouch, SKPoint, SkiaGesturesInfo, type SkiaGesturesParameters,
} from "./Gestures";

/** Mirrors DrawnUi DrawingContext: ctx.Context.Canvas, ctx.Destination (pixels), ctx.Scale. */
export interface DrawingContext {
  Context: { Canvas: SkCanvas };
  Destination: SKRect;
  Scale: number;
}

/**
 * Base of every drawn control. Same contract as DrawnUi SkiaControl:
 * Measure(constraints px, scale) -> MeasuredSize (includes Margin),
 * Arrange(destination px) -> DrawingRect,
 * Render(ctx) -> background + Paint(ctx),
 * ProcessGestures(args, apply) -> consumer or null.
 */
export class SkiaControl {
  // ---- layout properties (points) ----
  HorizontalOptions: LayoutOptions = "Start";
  VerticalOptions: LayoutOptions = "Start";
  /** -1 = auto. */
  WidthRequest = -1;
  HeightRequest = -1;
  Margin: Thickness = Thickness.Zero;
  /**
   * DrawnUi LockRatio: 0 = off; positive = square of the LARGER of the two sizes (requests or constraints),
   * negative = square of the SMALLER one. Infinite sides are ignored, so WidthRequest=150 + LockRatio=1 = 150x150.
   */
  LockRatio = 0;
  BackgroundColor?: Color;
  IsVisible = true;
  Tag?: string;

  // ---- gesture properties ----
  /** Control itself ignores input (things below it still get it). */
  InputTransparent = false;
  /** Consume every gesture that lands on this control so nothing below (z-order) receives it. */
  BlockGesturesBelow = false;
  LockChildrenGestures: LockTouch = "Disabled";

  // ---- touch feedback (same names as DrawnUi) ----
  TouchEffectColor: Color = Colors.White;
  /** Plays a ripple (from the tap point) when Tapped fires. */
  AnimationTapped: SkiaTouchAnimation = "None";
  /** Ripple duration ms, 0 = animator default (500). */
  AnimationTappedSpeed = 0;
  /** Overlay effects drawn above this control's content every frame (ripple etc). */
  readonly PostAnimators: IOverlayEffect[] = [];
  /** Clip overlay effects to the control's shape (CreateClip). */
  ClipEffects = true;

  // ---- gesture events (single handler each; C# events map to one callback prop) ----
  Tapped?: (sender: SkiaControl, e: ControlTappedEventArgs) => void;
  ChildTapped?: (sender: SkiaControl, e: ControlTappedEventArgs) => void;
  /** Raw gesture hook: set e.Consumed = true to stop propagation (not for Up). */
  ConsumeGestures?: (sender: SkiaControl, e: SkiaGesturesInfo) => void;

  // ---- tree ----
  Parent?: SkiaControl;
  /** Containers override; a leaf control cannot host children. */
  AddSubView(_control: SkiaControl): void { throw new Error(`DrawnUi: ${this.constructor.name} cannot host children`); }
  InsertSubView(_index: number, control: SkiaControl): void { this.AddSubView(control); }
  RemoveSubView(_control: SkiaControl): void {}
  /** Set by Canvas on its Content. Children resolve through Parent. */
  _superview?: Canvas;
  get Superview(): Canvas | undefined {
    return this.Parent ? this.Parent.Superview : this._superview;
  }

  // ---- state (pixels) ----
  MeasuredSize: ScaledSize = ScaledSize.Default;
  DrawingRect: SKRect = SKRect.Empty;
  RenderingScale = 1;
  NeedMeasure = true;

  /** Public non-virtual entry like DrawnUi: applies Margin/requests, then MeasureAbsolute for content. */
  Measure(widthConstraint: number, heightConstraint: number, scale: number): ScaledSize {
    this.RenderingScale = scale;
    const mx = this.Margin.HorizontalThickness * scale;
    const my = this.Margin.VerticalThickness * scale;

    let w = widthConstraint - mx;
    let h = heightConstraint - my;
    if (this.WidthRequest >= 0) w = this.WidthRequest * scale;
    if (this.HeightRequest >= 0) h = this.HeightRequest * scale;

    let locked = false;
    if (this.LockRatio !== 0) {
      const lock = this.LockRatio > 0 ? SkiaControl.SmartMax(w, h) : SkiaControl.SmartMin(w, h);
      if (lock > 0 && isFinite(lock)) { w = h = lock; locked = true; }
    }

    const content = this.MeasureAbsolute(w, h, scale);

    const rw = locked || this.WidthRequest >= 0 ? w : this.HorizontalOptions === "Fill" && isFinite(w) ? w : content.Pixels.Width;
    const rh = locked || this.HeightRequest >= 0 ? h : this.VerticalOptions === "Fill" && isFinite(h) ? h : content.Pixels.Height;

    this.MeasuredSize = ScaledSize.FromPixels(rw + mx, rh + my, scale);
    this.NeedMeasure = false;
    return this.MeasuredSize;
  }

  /** Override to measure own content, constraints already exclude Margin. */
  protected MeasureAbsolute(_widthConstraint: number, _heightConstraint: number, scale: number): ScaledSize {
    return ScaledSize.FromPixels(0, 0, scale);
  }

  /** Places MeasuredSize inside destination per Margin + Horizontal/VerticalOptions -> DrawingRect. */
  Arrange(destination: SKRect, _widthRequest: number, _heightRequest: number, scale: number): void {
    const m = this.Margin;
    const availL = destination.Left + m.Left * scale;
    const availT = destination.Top + m.Top * scale;
    const availW = destination.Width - m.HorizontalThickness * scale;
    const availH = destination.Height - m.VerticalThickness * scale;

    const w = this.HorizontalOptions === "Fill" ? availW : Math.min(availW, this.MeasuredSize.Pixels.Width - m.HorizontalThickness * scale);
    const h = this.VerticalOptions === "Fill" ? availH : Math.min(availH, this.MeasuredSize.Pixels.Height - m.VerticalThickness * scale);

    const x = availL + SkiaControl.Align(this.HorizontalOptions, availW, w);
    const y = availT + SkiaControl.Align(this.VerticalOptions, availH, h);
    this.DrawingRect = SKRect.Create(x, y, w, h);
    this.OnLayoutChanged();
  }

  /** DrawnUi SmartMax: larger of two sizes, an infinite one loses. */
  protected static SmartMax(a: number, b: number): number {
    if (!isFinite(a) || (isFinite(b) && b > a)) return b;
    return a;
  }

  /** DrawnUi SmartMin: smaller of two sizes, an infinite one loses. */
  protected static SmartMin(a: number, b: number): number {
    if (!isFinite(a) || (isFinite(b) && b < a)) return b;
    return a;
  }

  private static Align(o: LayoutOptions, avail: number, size: number): number {
    if (o === "Center") return (avail - size) / 2;
    if (o === "End") return avail - size;
    return 0;
  }

  /** Called after DrawingRect changed; layouts arrange children here. */
  protected OnLayoutChanged(): void {}

  /** Draws background then Paint(). */
  Render(ctx: DrawingContext): void {
    if (!this.IsVisible) return;
    const own: DrawingContext = { ...ctx, Destination: this.DrawingRect };
    if (this.BackgroundColor) this.PaintBackground(own);
    this.Paint(own);
    this.ExecutePostAnimators(own);
  }

  /** Draws PostAnimators above content; an effect returning true asks for another frame. */
  ExecutePostAnimators(ctx: DrawingContext): void {
    if (this.PostAnimators.length === 0) return;
    for (const effect of [...this.PostAnimators]) if (effect.Render(ctx, this)) this.Repaint();
  }

  /** Clip path of this control in canvas pixels (rect; shapes override). Caller deletes it. */
  CreateClip(): Path {
    const r = this.DrawingRect;
    const b = new Super.CK.PathBuilder();
    b.addRect(Super.CK.LTRBRect(r.Left, r.Top, r.Right, r.Bottom));
    const path = b.detach();
    b.delete();
    return path;
  }

  /** Fills DrawingRect with BackgroundColor; shapes override for rounded corners etc. */
  protected PaintBackground(ctx: DrawingContext): void {
    const paint = new Super.CK.Paint();
    paint.setColor(Super.CK.parseColorString(this.BackgroundColor!));
    const r = ctx.Destination;
    ctx.Context.Canvas.drawRect(Super.CK.LTRBRect(r.Left, r.Top, r.Right, r.Bottom), paint);
    paint.delete();
  }

  /** Override to draw own content into ctx.Destination. */
  protected Paint(_ctx: DrawingContext): void {}

  // ---- invalidation (same names as DrawnUi) ----

  /** Content changed: remeasure + redraw. */
  Update(): void {
    this.InvalidateMeasure();
  }

  /** Redraw without remeasure. */
  Repaint(): void {
    this.Superview?.Update();
  }

  InvalidateMeasure(): void {
    this.NeedMeasure = true;
    if (this.Parent) this.Parent.InvalidateMeasure();
    else this.Superview?.Update();
  }

  // ---- gestures (same names as DrawnUi) ----

  /** Hit rect in pixels (no transforms in this port, so it is DrawingRect). */
  get HitBoxAuto(): SKRect { return this.DrawingRect; }

  HitIsInside(x: number, y: number): boolean {
    const r = this.HitBoxAuto;
    return x >= r.Left && x < r.Right && y >= r.Top && y < r.Bottom;
  }

  IsGestureForChild(child: SkiaControl, point: SKPoint): boolean {
    return child.HitIsInside(point.X, point.Y);
  }

  /** Children that may receive gestures, top-most LAST (layouts return their Views). */
  protected GetGestureListeners(): readonly SkiaControl[] { return SkiaControl.NoListeners; }
  private static readonly NoListeners: readonly SkiaControl[] = [];

  /** ISkiaGestureListener entry, same as DrawnUi: routes to ProcessGestures. */
  OnSkiaGestureEvent(args: SkiaGesturesParameters, apply: GestureEventProcessingInfo): SkiaControl | null {
    return this.ProcessGestures(args, apply);
  }

  protected CheckChildrenGesturesLocked(type: SkiaGesturesParameters["Type"]): boolean {
    switch (this.LockChildrenGestures) {
      case "Enabled": return true;
      case "PassNone": return true;
      case "PassTap": return type !== "Tapped";
      case "PassTapAndLongPress": return type !== "Tapped" && type !== "LongPressing";
      default: return false;
    }
  }

  /**
   * Port of DrawnUi SkiaControl.ProcessGestures (non-render-tree branch):
   * ConsumeGestures hook -> children top-most first -> own Tapped. Returns the consumer or null.
   */
  ProcessGestures(args: SkiaGesturesParameters, apply: GestureEventProcessingInfo): SkiaControl | null {
    if (!this.Superview) return null;

    const consumedDefault = this.BlockGesturesBelow ? this : null;

    if (this.ConsumeGestures) {
      const sent = new SkiaGesturesInfo(args, apply);
      this.ConsumeGestures(this, sent);
      if (args.Type !== "Up" && sent.Consumed) return this;
    }

    if (this.CheckChildrenGesturesLocked(args.Type)) return consumedDefault;

    let consumed: SkiaControl | null = null;
    const wasConsumed = apply.AlreadyConsumed;
    const point = new SKPoint(apply.MappedLocation.X + apply.ChildOffset.X, apply.MappedLocation.Y + apply.ChildOffset.Y);
    const listeners = this.GetGestureListeners();

    for (let i = listeners.length - 1; i >= 0; i--) {
      const listener = listeners[i];
      if (!listener.IsVisible || listener.InputTransparent) continue;
      if (!this.IsGestureForChild(listener, point)) continue;

      let breakForChild: SkiaControl | null = null;
      if (args.Type === "Tapped") {
        if (this.ChildTapped) { breakForChild = listener; this.ChildTapped(this, new ControlTappedEventArgs(listener, args, apply)); }
      }
      consumed = listener.OnSkiaGestureEvent(args, new GestureEventProcessingInfo(apply.MappedLocation, apply.ChildOffset, apply.ChildOffsetDirect, wasConsumed));
      if (consumed) break;
      if (breakForChild) { consumed = breakForChild; break; }
    }
    if (wasConsumed) consumed = wasConsumed;

    if (args.Type === "Tapped" && !consumed && this.SendTapped(args, apply)) return this;

    return consumed ?? consumedDefault;
  }

  /** Fires Tapped (after AnimationTapped feedback); true when a handler existed (= consumed), like DrawnUi SendTapped. */
  protected SendTapped(args: SkiaGesturesParameters, apply: GestureEventProcessingInfo): boolean {
    if (!this.Tapped) return false;
    if (this.AnimationTapped === "Ripple") {
      const pts = this.GetOffsetInsideControlInPoints(apply.MappedLocation, apply.ChildOffset);
      this.PlayRippleAnimation(this.TouchEffectColor, pts.X, pts.Y, true, this.AnimationTappedSpeed);
    }
    this.Tapped(this, new ControlTappedEventArgs(this, args, apply));
    return true;
  }

  /** Canvas-pixel touch location -> points relative to this control's top-left. */
  GetOffsetInsideControlInPoints(location: SKPoint, childOffset: SKPoint): SKPoint {
    return new SKPoint(
      (location.X + childOffset.X - this.DrawingRect.Left) / this.RenderingScale,
      (location.Y + childOffset.Y - this.DrawingRect.Top) / this.RenderingScale,
    );
  }

  /** Starts a ripple at (x, y) points inside this control; speedMs 0 = RippleAnimator default. */
  PlayRippleAnimation(color: Color, x: number, y: number, _removePrevious = true, speedMs = 0): void {
    const animation = new RippleAnimator(this);
    animation.Color = color;
    animation.X = x;
    animation.Y = y;
    if (speedMs > 0) animation.Speed = speedMs;
    animation.Start();
  }
}
