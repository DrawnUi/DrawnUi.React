import type { Canvas as SkCanvas, Image, Path, SkPicture, Surface } from "canvaskit-wasm";
import { Super } from "./Super";
import { type Color, Colors, type LayoutOptions, SKRect, ScaledSize, type SkiaCacheType, type SkiaGradient, type SkiaTouchAnimation, Thickness } from "./Types";
import { type IOverlayEffect, RippleAnimator } from "./Animators";
import type { Canvas } from "./Canvas";
import {
  ControlTappedEventArgs, GestureEventProcessingInfo, type LockTouch, SKPoint, SkiaGesturesInfo, type SkiaGesturesParameters,
} from "./Gestures";

/** Mirrors DrawnUi DrawingContext: ctx.Context.Canvas / Surface, ctx.Destination (pixels), ctx.Scale. */
export interface DrawingContext {
  Context: { Canvas: SkCanvas; Surface?: Surface };
  Destination: SKRect;
  Scale: number;
}

/** Mirrors DrawnUi CachedObject: what a cached control replays instead of repainting. */
export class CachedObject {
  constructor(
    readonly Type: SkiaCacheType,
    /** Rect the content was recorded for, canvas pixels at recording time. */
    readonly Bounds: SKRect,
    readonly Scale: number,
    readonly Picture?: SkPicture,
    readonly Image?: Image,
  ) {}

  /** Replays the cache with its top-left moved to (left, top). */
  Draw(canvas: SkCanvas, left: number, top: number): void {
    const CK = Super.CK;
    if (this.Image) {
      // Nearest sampling: a cached bitmap is blitted 1:1, never resampled.
      canvas.drawImageOptions(this.Image, left, top, CK.FilterMode.Nearest, CK.MipmapMode.None, null);
    } else if (this.Picture) {
      const saved = canvas.save();
      canvas.translate(left - this.Bounds.Left, top - this.Bounds.Top);
      canvas.drawPicture(this.Picture);
      canvas.restoreToCount(saved);
    }
  }

  Dispose(): void {
    this.Picture?.delete();
    this.Image?.delete();
  }
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
  /** Gradient painted as the background (over BackgroundColor). */
  FillGradient?: SkiaGradient;
  IsVisible = true;
  Tag?: string;
  /** Generic numeric parameters (DrawnUi Value1/Value2): SkiaShape Arc uses start angle / sweep angle in degrees. */
  Value1 = 0;
  Value2 = 0;
  /** Extra points beyond the viewport a virtualized layout keeps realized (DrawnUi VirtualisationInflated). */
  VirtualisationInflated = 0;

  // ---- data binding (MAUI BindableObject subset) ----
  private bindingContext: unknown = undefined;
  /** Bound item; recycled cells get a new one on every rebind. */
  get BindingContext(): unknown { return this.bindingContext; }
  set BindingContext(value: unknown) {
    if (this.bindingContext === value) return;
    this.bindingContext = value;
    this.OnBindingContextChanged();
  }
  /** Index of the bound item inside its ItemsSource, -1 when not templated. */
  ContextIndex = -1;
  /** Override to react to a new BindingContext (DrawnUi ContextPropertyChanged / cell SetContent). */
  protected OnBindingContextChanged(): void {}

  // ---- caching (same names as DrawnUi) ----
  /** What to cache for this subtree; see SkiaCacheType. Layouts default to None, SkiaLabel/SkiaSvg to Operations. */
  UseCache: SkiaCacheType = "None";
  /** The cache type actually applied (None while caching is disabled globally). */
  get UsingCacheType(): SkiaCacheType {
    if (!Super.CacheEnabled) return "None";
    switch (this.UseCache) {
      case "None": return "None";
      case "Operations": case "OperationsFull": return "Operations";
      default: return "Image"; // Image, GPU, ImageDoubleBuffered, ImageComposite(GPU) -> single offscreen image for now
    }
  }
  /** Current cache, if any. */
  RenderObject?: CachedObject;
  private cacheDirty = true;

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

  private lastWidthConstraint = NaN;
  private lastHeightConstraint = NaN;

  /**
   * Public non-virtual entry like DrawnUi: applies Margin/requests, then MeasureAbsolute for content.
   * A control that was not invalidated and gets the same constraints + scale returns its previous size —
   * this is what keeps a cached tree from re-measuring text every frame.
   */
  Measure(widthConstraint: number, heightConstraint: number, scale: number): ScaledSize {
    if (!this.NeedMeasure && this.RenderingScale === scale
      && Object.is(this.lastWidthConstraint, widthConstraint) && Object.is(this.lastHeightConstraint, heightConstraint)) {
      return this.MeasuredSize;
    }
    this.lastWidthConstraint = widthConstraint;
    this.lastHeightConstraint = heightConstraint;
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

  /** Part of DrawingRect that can actually be seen: intersected with every ancestor (a scroll's box clips its content). */
  GetVisibleViewport(): SKRect {
    const r = this.DrawingRect;
    if (!this.Parent) return r;
    const p = this.Parent.GetVisibleViewport();
    return new SKRect(Math.max(r.Left, p.Left), Math.max(r.Top, p.Top), Math.min(r.Right, p.Right), Math.min(r.Bottom, p.Bottom));
  }

  /** Draws the control: from its cache when it has one, else background + Paint(); overlays always live. */
  Render(ctx: DrawingContext): void {
    if (!this.IsVisible) return;
    const own: DrawingContext = { ...ctx, Destination: this.DrawingRect };
    const cacheType = this.UsingCacheType;
    if (cacheType === "None") {
      this.DestroyRenderingObject();
      this.PaintContent(own);
    } else {
      const r = this.DrawingRect;
      const stale = this.cacheDirty || !this.RenderObject || this.RenderObject.Type !== cacheType
        || this.RenderObject.Scale !== ctx.Scale
        || Math.round(this.RenderObject.Bounds.Width) !== Math.round(r.Width) || Math.round(this.RenderObject.Bounds.Height) !== Math.round(r.Height);
      if (stale) this.CreateRenderingObject(own, cacheType);
      this.RenderObject?.Draw(ctx.Context.Canvas, r.Left, r.Top);
    }
    this.ExecutePostAnimators(own);
  }

  /** Background + Paint(): the part of the control that a cache captures. */
  protected PaintContent(ctx: DrawingContext): void {
    if (this.BackgroundColor || this.FillGradient) this.PaintBackground(ctx);
    this.Paint(ctx);
  }

  /** Records/renders the content into a new CachedObject for the current DrawingRect. */
  protected CreateRenderingObject(ctx: DrawingContext, cacheType: SkiaCacheType): void {
    const CK = Super.CK;
    const r = this.DrawingRect;
    const w = Math.max(1, Math.round(r.Width)), h = Math.max(1, Math.round(r.Height));
    this.DestroyRenderingObject();
    if (cacheType === "Operations") {
      const recorder = new CK.PictureRecorder();
      const canvas = recorder.beginRecording(CK.LTRBRect(r.Left, r.Top, r.Right, r.Bottom));
      this.PaintContent({ ...ctx, Context: { ...ctx.Context, Canvas: canvas } });
      const picture = recorder.finishRecordingAsPicture();
      recorder.delete();
      this.RenderObject = new CachedObject("Operations", r, ctx.Scale, picture);
    } else {
      const main = ctx.Context.Surface;
      if (!main) { this.PaintContent(ctx); return; } // no surface to derive from (e.g. recording): draw live
      const offscreen = main.makeSurface({ ...main.imageInfo(), width: w, height: h });
      if (!offscreen) { this.PaintContent(ctx); return; }
      const canvas = offscreen.getCanvas();
      canvas.clear(CK.TRANSPARENT);
      canvas.translate(-r.Left, -r.Top);
      this.PaintContent({ ...ctx, Context: { Canvas: canvas, Surface: offscreen } });
      const image = offscreen.makeImageSnapshot();
      offscreen.delete();
      this.RenderObject = new CachedObject("Image", r, ctx.Scale, undefined, image);
    }
    this.cacheDirty = false;
  }

  /** Drops the cache (disposed after the frame, never mid-draw). */
  DestroyRenderingObject(): void {
    const old = this.RenderObject;
    if (!old) return;
    this.RenderObject = undefined;
    const sv = this.Superview;
    if (sv) sv.DisposeObject(old); else old.Dispose();
  }

  /** Marks the cache stale; re-recorded on the next frame. */
  InvalidateCache(): void { this.cacheDirty = true; }

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

  /** Fills DrawingRect with BackgroundColor / FillGradient; shapes override for rounded corners etc. */
  protected PaintBackground(ctx: DrawingContext): void {
    const paint = this.CreateBackgroundPaint(ctx.Destination);
    const r = ctx.Destination;
    ctx.Context.Canvas.drawRect(Super.CK.LTRBRect(r.Left, r.Top, r.Right, r.Bottom), paint);
    paint.delete();
  }

  /** Paint for the background: solid BackgroundColor, or FillGradient shader over the given rect. Caller deletes. */
  protected CreateBackgroundPaint(rect: SKRect): import("canvaskit-wasm").Paint {
    const CK = Super.CK;
    const paint = new CK.Paint();
    paint.setAntiAlias(true);
    if (this.BackgroundColor) paint.setColor(Super.ParseColor(this.BackgroundColor));
    const g = this.FillGradient;
    if (g && g.Colors.length > 0) {
      const colors = g.Colors.map((c) => Super.ParseColor(c));
      const shader = CK.Shader.MakeLinearGradient(
        [rect.Left + rect.Width * (g.StartXRatio ?? 0), rect.Top + rect.Height * (g.StartYRatio ?? 0)],
        [rect.Left + rect.Width * (g.EndXRatio ?? 0), rect.Top + rect.Height * (g.EndYRatio ?? 1)],
        colors, null, CK.TileMode.Clamp,
      );
      paint.setShader(shader);
      shader.delete();
    }
    return paint;
  }

  /** Override to draw own content into ctx.Destination. */
  protected Paint(_ctx: DrawingContext): void {}

  // ---- invalidation (same names as DrawnUi) ----

  /** Content changed: cache invalidated + remeasure + redraw (bubbles to every ancestor, whose caches go stale too). */
  Update(): void {
    this.InvalidateMeasure();
  }

  /** Redraw without remeasure and WITHOUT dropping caches (position/overlay changes). */
  Repaint(): void {
    this.Superview?.Update();
  }

  /** Size or content may have changed: this control and all ancestors remeasure and re-record. */
  InvalidateMeasure(): void {
    this.NeedMeasure = true;
    this.cacheDirty = true;
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
