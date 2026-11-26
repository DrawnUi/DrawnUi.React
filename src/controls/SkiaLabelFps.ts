import type { DrawingContext } from "../core/SkiaControl";
import { Aria } from "../core/Accessibility";
import { SkiaLabel } from "./SkiaLabel";

/**
 * Mirrors DrawnUi SkiaLabelFps: a label showing the canvas FPS (the frames the canvas draws, 0 on a still screen), drawn
 * above its siblings, input-transparent, never re-laying out its parent. It asks for no frames by itself: a new value
 * redraws it once, as in C#. `ForceRefresh` keeps the canvas drawing every frame while the label is shown. Not ported:
 * Format, MonoForDigits.
 */
export class SkiaLabelFps extends SkiaLabel {
  /** Keeps the canvas drawing every frame while the label is shown, so it reads the rate the canvas reaches. */
  ForceRefresh = false;

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

  override Render(ctx: DrawingContext): void {
    const view = this.Superview;
    // as SkiaControl.Render: a hidden or transparent label draws nothing and asks for nothing
    if (view && this.IsVisible && this.Opacity > 0 && !this.IsDisposed) {
      const shown = `FPS ${view.FPS.toFixed(1).padStart(4, "0")}`;
      if (shown !== this.Text) this.Text = shown;
      if (this.ForceRefresh) view.Update();
    }
    // parent-independent: it measures itself again in its slot as it draws (SkiaControl.Render)
    super.Render(ctx);
  }
}
