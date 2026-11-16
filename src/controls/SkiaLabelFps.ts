import type { DrawingContext } from "../core/SkiaControl";
import { Aria } from "../core/Accessibility";
import { SkiaLabel } from "./SkiaLabel";

/**
 * Mirrors DrawnUi SkiaLabelFps: a label showing the canvas FPS, drawn above its siblings, input-transparent, never
 * re-laying out its parent. It shows the value on every frame it draws and asks for the next one, so while it is on
 * screen the canvas keeps drawing and the number is the frame rate the canvas reaches (as DrawnUi.Net and Rust). Not
 * ported: ForceRefresh, Format, MonoForDigits.
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

  override Render(ctx: DrawingContext): void {
    const view = this.Superview;
    // as SkiaControl.Render: a hidden or transparent label draws nothing and asks for nothing
    if (view && this.IsVisible && this.Opacity > 0 && !this.IsDisposed) {
      const shown = `FPS ${view.FPS.toFixed(1).padStart(4, "0")}`;
      if (shown !== this.Text) this.Text = shown;
      // the next frame (C#'s ever-changing value asks for it the same way): the counter shows what the canvas reaches
      view.Update();
    }
    // parent-independent: it measures itself again in its slot as it draws (SkiaControl.Render)
    super.Render(ctx);
  }
}
