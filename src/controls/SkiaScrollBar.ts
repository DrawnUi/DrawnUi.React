import type { Color, ScrollOrientation } from "../core/Types";
import { Colors, SKRect, Thickness } from "../core/Types";
import { SkiaLayout } from "./SkiaLayout";
import { SkiaShape } from "./SkiaShape";

/** C# ScrollBarVisibility flags: which axis a SkiaScroll shows a bar for (matched against its Orientation). */
export type ScrollBarVisibility = "None" | "Vertical" | "Horizontal" | "Both";
/** C# ScrollBarDock: edge the bar docks to, perpendicular to the scrolling axis. */
export type ScrollBarDock = "End" | "Start";

/**
 * C# IScrollBar: a scroll bar indicator overlay for SkiaScroll; the scroll pushes its state here whenever the offset,
 * content size or scrolling state change.
 */
export interface IScrollBar {
  SetScrollProgress(orientation: ScrollOrientation, progress: number, thumbSizeRatio: number, overscrollPts: number, isScrolling: boolean): void;
  /** Optional desktop behavior: the bar takes the gesture that starts on it (thumb drag, track press). */
  IsDraggable?: boolean;
  /** Canvas pixels; true when the point is on the bar and a drag starts. */
  BeginDrag?(x: number, y: number): boolean;
  /** Scroll progress 0..1 for the pointer during a drag started by BeginDrag. */
  GetDragProgress?(x: number, y: number): number;
}

/**
 * Mirrors DrawnUi SkiaScrollBar: thin rounded thumb over an optional track, docked at the right edge for vertical
 * scrolling or at the bottom edge for horizontal (`Dock`), auto-hides `HideDelaySecs` after scrolling stops
 * (`AutoHide`), squashes on overscroll. Set through `SkiaScroll.ScrollBar` / `ScrollBarHorizontal`, or created by
 * `ScrollBarsVisibility`.
 */
export class SkiaScrollBar extends SkiaLayout implements IScrollBar {
  private dock: ScrollBarDock = "End";
  get Dock(): ScrollBarDock { return this.dock; }
  set Dock(v: ScrollBarDock) { if (this.dock !== v) { this.dock = v; this.ApplyOrientation(); } }
  private thumbColor: Color = "#66888888";
  get ThumbColor(): Color { return this.thumbColor; }
  set ThumbColor(v: Color) { if (this.thumbColor !== v) { this.thumbColor = v; this.thumb.BackgroundColor = v; this.thumb.InvalidateCache(); this.RepaintComposition(); } }
  private trackColor: Color = Colors.Transparent;
  get TrackColor(): Color { return this.trackColor; }
  set TrackColor(v: Color) { if (this.trackColor !== v) { this.trackColor = v; this.track.BackgroundColor = v; this.track.InvalidateCache(); this.RepaintComposition(); } }
  private thickness = 4;
  /** Thickness of the bar in points. */
  get Thickness(): number { return this.thickness; }
  set Thickness(v: number) { if (this.thickness !== v) { this.thickness = v; this.ApplyOrientation(); } }
  private edgeMargin = 2;
  /** Distance in points from the docked edge. */
  get EdgeMargin(): number { return this.edgeMargin; }
  set EdgeMargin(v: number) { if (this.edgeMargin !== v) { this.edgeMargin = v; this.ApplyOrientation(); } }
  /** Minimum thumb length in points. */
  MinThumbSize = 32;
  /** Fade out after scrolling stops. */
  AutoHide = true;
  HideDelaySecs = 1;
  /** Duration in seconds of the fade-out once HideDelaySecs has passed. */
  HideDurationSecs = 0.25;
  /**
   * Lets the user drag the thumb and press the track to jump there (desktop scroll bar behavior). The owning
   * SkiaScroll then takes the whole gesture, from down to up, when it starts on the bar. Default false: the bar only
   * indicates and every gesture passes through to the content.
   */
  IsDraggable = false;
  /** Extra grab area in points on both sides of the bar, across the scrolling axis, so a thin bar is easy to hit with a mouse. */
  GrabPadding = 8;
  private thumbOffsetPts = 0;
  private dragGrabPx = 0;
  private hasTravel = false;

  protected readonly thumb = new SkiaShape();
  protected readonly track = new SkiaShape();
  private hideTimer = 0;
  private hideAbort?: AbortController;
  private lastThumbLen = -1;
  private orientation: ScrollOrientation = "Vertical";

  constructor() {
    super();
    this.Type = "Absolute";
    this.UseCache = "Operations";
    this.HorizontalOptions = "Fill"; this.VerticalOptions = "Fill";
    this.InputTransparent = true; // display only, gestures pass through
    this.IsParentIndependent = true; // the bar's look (thumb squashed on overscroll) never changes the layout around it
    this.Opacity = 0; // hidden until the first scroll
    this.track.Type = "Rectangle"; this.track.BackgroundColor = this.trackColor; this.track.UseCache = "Operations";
    this.thumb.Type = "Rectangle"; this.thumb.BackgroundColor = this.thumbColor; this.thumb.UseCache = "Operations";
    this.AddSubView(this.track); this.AddSubView(this.thumb);
    this.ApplyOrientation();
  }

  /** Docks track and thumb to the edge matching the current orientation (C# ApplyOrientation). */
  protected ApplyOrientation(): void {
    const radius = this.thickness / 2, dockStart = this.dock === "Start";
    const dockOptions = dockStart ? "Start" : "End";
    if (this.orientation === "Horizontal") {
      const margin = dockStart ? new Thickness(0, this.edgeMargin, 0, 0) : new Thickness(0, 0, 0, this.edgeMargin);
      this.track.HorizontalOptions = "Fill"; this.track.VerticalOptions = dockOptions; this.track.HeightRequest = this.thickness; this.track.WidthRequest = -1; this.track.Margin = margin; this.track.CornerRadius = radius;
      this.thumb.HorizontalOptions = "Start"; this.thumb.VerticalOptions = dockOptions; this.thumb.HeightRequest = this.thickness; this.thumb.Margin = margin; this.thumb.CornerRadius = radius;
    } else {
      const margin = dockStart ? new Thickness(this.edgeMargin, 0, 0, 0) : new Thickness(0, 0, this.edgeMargin, 0);
      this.track.HorizontalOptions = dockOptions; this.track.VerticalOptions = "Fill"; this.track.WidthRequest = this.thickness; this.track.HeightRequest = -1; this.track.Margin = margin; this.track.CornerRadius = radius;
      this.thumb.HorizontalOptions = dockOptions; this.thumb.VerticalOptions = "Start"; this.thumb.WidthRequest = this.thickness; this.thumb.Margin = margin; this.thumb.CornerRadius = radius;
    }
    this.lastThumbLen = -1;
    this.InvalidateMeasure();
  }

  SetScrollProgress(orientation: ScrollOrientation, progress: number, thumbSizeRatio: number, overscrollPts: number, isScrolling: boolean): void {
    if (orientation !== this.orientation) { this.orientation = orientation; this.ApplyOrientation(); }
    if (thumbSizeRatio >= 1) { this.CancelHide(); this.Opacity = 0; this.RepaintComposition(); return; } // content fits: nothing to indicate
    const track = orientation === "Horizontal" ? this.MeasuredSize.Units.Width : this.MeasuredSize.Units.Height;
    if (track <= 0) return;
    let thumbLen = Math.max(this.MinThumbSize, track * thumbSizeRatio);
    if (overscrollPts !== 0) thumbLen = Math.max(this.MinThumbSize / 2, thumbLen - Math.abs(overscrollPts)); // squash on bounce
    const travel = track - thumbLen;
    const offset = Math.max(0, Math.min(1, progress)) * travel;
    this.thumbOffsetPts = offset;
    this.hasTravel = travel > 0;
    if (Math.abs(thumbLen - this.lastThumbLen) > 0.5) {
      this.lastThumbLen = thumbLen;
      if (orientation === "Horizontal") this.thumb.WidthRequest = thumbLen; else this.thumb.HeightRequest = thumbLen;
      this.thumb.InvalidateMeasure();
    }
    if (orientation === "Horizontal") this.thumb.TranslationX = offset; else this.thumb.TranslationY = offset;
    this.CancelHide();
    this.Opacity = 1;
    if (this.AutoHide && !isScrolling) {
      this.hideTimer = window.setTimeout(() => { this.hideTimer = 0; this.hideAbort = new AbortController(); void this.FadeToAsync(0, Math.max(0, this.HideDurationSecs * 1000), undefined, this.hideAbort.signal); }, this.HideDelaySecs * 1000);
    }
    this.RepaintComposition();
  }

  private CancelHide(): void {
    if (this.hideTimer) { clearTimeout(this.hideTimer); this.hideTimer = 0; }
    this.hideAbort?.abort(); this.hideAbort = undefined;
  }

  /**
   * Called by the owning scroll on touch down, coordinates in canvas pixels. True when the point is on the bar (track
   * plus GrabPadding) and a drag starts: on the thumb it keeps the grab point, on the track the thumb jumps to center
   * under the pointer.
   */
  BeginDrag(x: number, y: number): boolean {
    if (!this.IsDraggable || !this.hasTravel) return false;
    const scale = this.RenderingScale || 1;
    const track = this.track.DrawingRect;
    const pad = this.GrabPadding * scale;
    const vertical = this.orientation !== "Horizontal";
    const hit = vertical ? new SKRect(track.Left - pad, track.Top, track.Right + pad, track.Bottom) : new SKRect(track.Left, track.Top - pad, track.Right, track.Bottom + pad);
    if (x < hit.Left || x > hit.Right || y < hit.Top || y > hit.Bottom) return false;
    // an auto-hidden bar that gets grabbed shows again right away: never drag something invisible
    this.CancelHide();
    this.Opacity = 1;
    const pos = vertical ? y - track.Top : x - track.Left;
    const thumbStart = this.thumbOffsetPts * scale, thumbLen = this.lastThumbLen * scale;
    this.dragGrabPx = pos >= thumbStart && pos <= thumbStart + thumbLen ? pos - thumbStart : thumbLen / 2;
    this.RepaintComposition();
    return true;
  }

  /** Scroll progress 0..1 for the pointer position during a drag started by BeginDrag, coordinates in canvas pixels. */
  GetDragProgress(x: number, y: number): number {
    const scale = this.RenderingScale || 1;
    const track = this.track.DrawingRect;
    const vertical = this.orientation !== "Horizontal";
    const pos = (vertical ? y - track.Top : x - track.Left) - this.dragGrabPx;
    const travel = (vertical ? track.Height : track.Width) - this.lastThumbLen * scale;
    return travel > 0 ? Math.max(0, Math.min(1, pos / travel)) : 0;
  }

  protected override OnDisposing(): void { this.CancelHide(); super.OnDisposing(); }
}
