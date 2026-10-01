import type { DrawingContext } from "../core/SkiaControl";
import { Aria } from "../core/Accessibility";
import type { SKRect } from "../core/Types";
import { SkiaLabel } from "./SkiaLabel";

/**
 * Mirrors DrawnUi SkiaLabelFps: a label showing the canvas FPS, drawn above its siblings, input-transparent, never
 * re-laying out its parent. Divergence: C# sets Text on every draw, and each new value asks for another frame, so
 * the counter keeps an idle canvas redrawing. Here the value changes only on frames that running animators already
 * request (scroll inertia, transitions, Lottie, game loops): the counter never asks for a frame itself, and an idle
 * canvas keeps the last value measured. Not ported: ForceRefresh, Format, MonoForDigits.
 */
export class SkiaLabelFps extends SkiaLabel {
  constructor() {
    super();
    this.IsParentIndependent = true;
    this.AccessibilityRole = Aria.RolePresentation;
    this.Tag = "FPS";
    this.Text = "FPS --";
    this.MaxLines = 1;
    this.BackgroundColor = "#000000";
    this.TextColor = "#32CD32"; // LimeGreen
    this.InputTransparent = true;
    this.ZIndex = Number.MAX_SAFE_INTEGER;
  }

  private arrangedIn?: SKRect;

  override Arrange(destination: SKRect, widthRequest: number, heightRequest: number, scale: number): void {
    this.arrangedIn = destination;
    super.Arrange(destination, widthRequest, heightRequest, scale);
  }

  override Render(ctx: DrawingContext): void {
    const view = this.Superview;
    // the frame this asks for is requested anyway by the running animators
    if (view && view.AnimatingControls.size > 0) this.Text = `FPS ${view.FPS.toFixed(1).padStart(4, "0")}`;
    // parent-independent: the parent does not re-lay out for it, so it re-measures itself here (as SkiaScroll does for its bars)
    const d = this.arrangedIn;
    if (this.NeedMeasure && d) { this.Measure(d.Width, d.Height, ctx.Scale); this.Arrange(d, this.WidthRequest, this.HeightRequest, ctx.Scale); }
    super.Render(ctx);
  }
}
