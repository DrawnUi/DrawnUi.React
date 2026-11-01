import type { SkiaControl } from "../core/SkiaControl";
import { Aria } from "../core/Accessibility";
import { Super } from "../core/Super";
import { type Color, SkiaShadow, Thickness } from "../core/Types";
import { SkiaLabel } from "./SkiaLabel";
import { SkiaShape } from "./SkiaShape";

/**
 * Look and timing of the tooltips a canvas shows for controls with a `Tooltip` (drawnui-cross 6ar, C# TooltipStyle).
 * Set app-wide with `Super.TooltipStyle`, or per canvas with `Canvas.TooltipStyle`. Read when a tooltip is built, so a
 * change applies from the next tooltip shown.
 */
export class TooltipStyle {
  /** Background of the tooltip: dark, a step lighter than dark app surfaces. */
  BackgroundColor: Color = "#2B2D31";
  /** Color of the tooltip text. */
  TextColor: Color = "#F2F3F5";
  /** Color of the 1 pt border, lifts the tooltip off dark surfaces. Undefined or transparent for none. */
  BorderColor?: Color = "#24FFFFFF";
  /** Color of the soft shadow under the tooltip. Undefined or transparent for none. */
  ShadowColor?: Color = "#59000000";
  /** Font family of the tooltip text, undefined for the default font. */
  FontFamily?: string;
  /** Font size of the tooltip text, in points. */
  FontSize = 13;
  /** Corner radius of the tooltip, in points. */
  CornerRadius = 6;
  /** Space around the text, in points. */
  Padding = new Thickness(12, 8);
  /** Longer text wraps at this width, in points. */
  MaxWidth = 320;
  /** How long the mouse rests on a control before its tooltip shows, in milliseconds. */
  ShowDelayMs = 600;
  /** A tooltip that closed less than this many milliseconds ago lets the next one show at once (moving along a toolbar). */
  FollowWindowMs = 500;
  /**
   * False (default): attached to its control, centered 6 pt above it (below it where there is no room). True: below and
   * to the right of the pointer where it rested (above it where there is no room). Either way it stays put while the
   * mouse moves over the control.
   */
  AtCursor = false;
  /** Moves the tooltip right (negative: left) from where it would go, in points. */
  OffsetX = 0;
  /** Moves the tooltip down (negative: up), in points; on the flipped side it moves the other way, keeping its distance. */
  OffsetY = 0;
  /**
   * Builds the tooltip content for a text instead of the default rounded label. The control is measured and drawn on its
   * own, outside the tree: it takes no input and screen readers do not see it.
   */
  CreateTooltip?: (text: string) => SkiaControl;

  constructor(init?: Partial<TooltipStyle>) { if (init) Object.assign(this, init); }

  /** Room left around the default tooltip for its shadow, in points. */
  static readonly ShadowRoom = 8;

  private static Visible(c?: Color): boolean {
    if (!c || c === "Transparent" || c === "transparent") return false;
    const p = Super.ParseColor(c);
    return p[3] > 0;
  }

  /** The default tooltip content: the text on a rounded background. */
  CreateDefault(text: string): SkiaControl {
    const shadow = TooltipStyle.Visible(this.ShadowColor);
    const border = TooltipStyle.Visible(this.BorderColor);
    const shape = new SkiaShape();
    shape.CornerRadius = this.CornerRadius;
    shape.BackgroundColor = this.BackgroundColor;
    if (border) { shape.StrokeColor = this.BorderColor!; shape.StrokeWidth = 1; }
    shape.Padding = this.Padding;
    shape.Margin = shadow ? new Thickness(TooltipStyle.ShadowRoom) : Thickness.Zero; // the shadow is drawn inside the measured size
    shape.MaximumWidthRequest = this.MaxWidth;
    shape.UseCache = "Image";
    if (shadow) shape.Shadows = [new SkiaShadow({ X: 0, Y: 2, Blur: 6, Opacity: 1, Color: this.ShadowColor! })];
    const label = new SkiaLabel();
    label.Text = text;
    label.TextColor = this.TextColor;
    label.FontSize = this.FontSize;
    if (this.FontFamily) label.FontFamily = this.FontFamily;
    shape.AddSubView(label);
    shape.AccessibilityRole = Aria.RolePresentation;
    label.AccessibilityRole = Aria.RolePresentation;
    return shape;
  }
}

Super.TooltipStyle = new TooltipStyle();
