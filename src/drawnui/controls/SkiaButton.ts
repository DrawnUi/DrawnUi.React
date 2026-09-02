import { type DrawingContext } from "../core/SkiaControl";
import type { SkiaControl } from "../core/SkiaControl";
import { Super } from "../core/Super";
import { type Color, Colors, ScaledSize, Thickness } from "../core/Types";
import { SKPoint, type GestureEventProcessingInfo, type SkiaGesturesParameters } from "../core/Gestures";
import { SkiaLayout } from "./SkiaLayout";
import { SkiaLabel } from "./SkiaLabel";

/**
 * Mirrors DrawnUi SkiaButton (default style): rounded frame (radius 8 like the C# default content) + centered label.
 * Consumes Down/Up/Tapped inside its rect; releases the pressed state when a pan exceeds PanThreshold.
 */
export class SkiaButton extends SkiaLayout {
  static PanThreshold = 5;

  Text = "";
  TextColor: Color = Colors.White;
  FontSize = 15;
  FontFamily = "";
  IsPressed = false;
  IsDisabled = false;
  LockPanning = false;
  TotalDown = 0;
  TotalTapped = 0;
  Down?: (sender: SkiaButton, args: SkiaGesturesParameters) => void;
  Up?: (sender: SkiaButton, args: SkiaGesturesParameters) => void;

  private readonly label = new SkiaLabel();
  private lastDownPts = SKPoint.Empty;
  private hadDown = false;

  constructor() {
    super();
    this.Type = "Absolute";
    this.BackgroundColor = Colors.CornflowerBlue;
    this.Padding = new Thickness(16, 10);
    this.label.Tag = "BtnText";
    this.label.HorizontalOptions = "Center";
    this.label.VerticalOptions = "Center";
    this.AddSubView(this.label);
  }

  protected override MeasureAbsolute(w: number, h: number, scale: number): ScaledSize {
    this.label.Text = this.Text;
    this.label.TextColor = this.TextColor;
    this.label.FontSize = this.FontSize;
    this.label.FontFamily = this.FontFamily;
    return super.MeasureAbsolute(w, h, scale);
  }

  protected override PaintBackground(ctx: DrawingContext): void {
    const r = ctx.Destination;
    const radius = 8 * ctx.Scale;
    const paint = new Super.CK.Paint();
    paint.setAntiAlias(true);
    paint.setColor(Super.CK.parseColorString(this.BackgroundColor!));
    ctx.Context.Canvas.drawRRect(Super.CK.RRectXY(Super.CK.LTRBRect(r.Left, r.Top, r.Right, r.Bottom), radius, radius), paint);
    if (this.IsPressed) {
      paint.setColor(Super.CK.Color4f(0, 0, 0, 0.2));
      ctx.Context.Canvas.drawRRect(Super.CK.RRectXY(Super.CK.LTRBRect(r.Left, r.Top, r.Right, r.Bottom), radius, radius), paint);
    }
    paint.delete();
  }

  private SetUp(args: SkiaGesturesParameters): void {
    this.IsPressed = false;
    this.hadDown = false;
    this.Up?.(this, args);
    this.Repaint();
  }

  override ProcessGestures(args: SkiaGesturesParameters, apply: GestureEventProcessingInfo): SkiaControl | null {
    if (this.IsDisabled) return null;
    const point = args.Event.Location;

    if (args.Type === "Down") {
      this.IsPressed = true;
      this.lastDownPts = point;
      this.hadDown = true;
      this.TotalDown++;
      this.Down?.(this, args);
      this.Repaint();
      return this;
    }
    if (args.Type === "Panning") {
      if (this.LockPanning) return this;
      const t = SkiaButton.PanThreshold * this.RenderingScale;
      if (Math.abs(point.X - this.lastDownPts.X) > t || Math.abs(point.Y - this.lastDownPts.Y) > t) {
        if (this.hadDown) this.SetUp(args);
        this.hadDown = false;
        return null;
      }
    } else if (args.Type === "Up") {
      this.SetUp(args);
    } else if (args.Type === "Tapped") {
      this.TotalTapped++;
      return this.SendTapped(args, apply) ? this : null;
    }
    return this.hadDown ? this : null;
  }
}
