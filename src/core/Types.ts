// Mirrors DrawnUi (.NET) value types with the same names. Units: points unless a name says Pixels.

/** MAUI LayoutOptions subset used by DrawnUi. */
export type LayoutOptions = "Start" | "Center" | "End" | "Fill";

/** MAUI Thickness with the same ctor overloads: (all) / (horizontal, vertical) / (l, t, r, b). */
export class Thickness {
  Left: number;
  Top: number;
  Right: number;
  Bottom: number;
  constructor(a = 0, b?: number, c?: number, d?: number) {
    if (b === undefined) { this.Left = this.Top = this.Right = this.Bottom = a; }
    else if (c === undefined) { this.Left = this.Right = a; this.Top = this.Bottom = b; }
    else { this.Left = a; this.Top = b; this.Right = c; this.Bottom = d ?? 0; }
  }
  static readonly Zero = new Thickness();
  get HorizontalThickness() { return this.Left + this.Right; }
  get VerticalThickness() { return this.Top + this.Bottom; }
}

/** SKRect: left/top/right/bottom in pixels. */
export class SKRect {
  constructor(
    public Left = 0,
    public Top = 0,
    public Right = 0,
    public Bottom = 0,
  ) {}
  get Width() { return this.Right - this.Left; }
  get Height() { return this.Bottom - this.Top; }
  static Create(x: number, y: number, w: number, h: number) { return new SKRect(x, y, x + w, y + h); }
  static readonly Empty = new SKRect();
}

/** DrawnUi ScaledSize: same size in points (Units) and pixels. */
export class ScaledSize {
  constructor(public Pixels: { Width: number; Height: number }, public Units: { Width: number; Height: number }) {}
  static FromPixels(w: number, h: number, scale: number) {
    return new ScaledSize({ Width: w, Height: h }, { Width: w / scale, Height: h / scale });
  }
  static readonly Default = new ScaledSize({ Width: 0, Height: 0 }, { Width: 0, Height: 0 });
}

/** MAUI Color: a CSS "#RRGGBB" / "#RRGGBBAA" / "rgb()" / "rgba()" string (what CanvasKit parses). */
export type Color = string;

/** MAUI Colors subset. */
export const Colors = {
  Transparent: "#00000000",
  White: "#FFFFFF",
  Black: "#000000",
  Red: "#FF0000",
  Green: "#00FF00",
  Blue: "#0000FF",
  Gray: "#808080",
  DarkGray: "#A9A9A9",
  LightGray: "#D3D3D3",
  Orange: "#FFA500",
  Yellow: "#FFFF00",
  CornflowerBlue: "#6495ED",
  DarkSlateBlue: "#483D8B",
} as const;

/** DrawnUi LayoutType (Grid/Wrap not ported yet). */
export type LayoutType = "Absolute" | "Column" | "Row";

/** DrawnUi ShapeType (Squricle/Custom draw as Rectangle for now). */
export type ShapeType = "Rectangle" | "Circle" | "Ellipse" | "Arc" | "Squricle" | "Path" | "Polygon" | "Line" | "Custom";

/** SKStrokeCap. */
export type StrokeCap = "Butt" | "Round" | "Square";

/** MAUI CornerRadius: uniform or per corner (points). */
export class CornerRadius {
  readonly TopLeft: number; readonly TopRight: number; readonly BottomLeft: number; readonly BottomRight: number;
  constructor(topLeft: number, topRight?: number, bottomLeft?: number, bottomRight?: number) {
    this.TopLeft = topLeft;
    this.TopRight = topRight ?? topLeft;
    this.BottomLeft = bottomLeft ?? topLeft;
    this.BottomRight = bottomRight ?? topLeft;
  }
  static readonly Zero = new CornerRadius(0);
}

/** DrawnUi SkiaPoint: a vertex as ratios (0..1) of the shape rect. */
export class SkiaPoint {
  constructor(public X = 0, public Y = 0) {}
}

/** DrawnUi TransformAspect: how an image/svg is scaled into its box. */
export type TransformAspect = "None" | "Fill" | "Fit" | "AspectFit" | "AspectFill" | "AspectFitFill" | "FitFill" | "Cover" | "AspectCover" | "Tile";

/** DrawnUi DrawImageAlignment. */
export type DrawImageAlignment = "Start" | "Center" | "End";

/** MAUI/DrawnUi ScrollOrientation. */
export type ScrollOrientation = "Vertical" | "Horizontal" | "Both" | "Neither";

/**
 * DrawnUi SkiaCacheType. Operations = recorded draw commands (SkPicture) replayed each frame;
 * Image = offscreen surface snapshot blitted each frame (GPU-backed when the canvas is WebGL).
 * GPU / ImageDoubleBuffered / ImageComposite / ImageCompositeGPU are accepted and currently resolve to Image.
 */
export type SkiaCacheType = "None" | "Operations" | "OperationsFull" | "Image" | "ImageDoubleBuffered" | "ImageComposite" | "ImageCompositeGPU" | "GPU";

/** DrawnUi SkiaGradient (Linear only): colors spread from Start to End, ratios of the control's rect. */
export interface SkiaGradient {
  Type: "Linear";
  Colors: Color[];
  StartXRatio?: number;
  StartYRatio?: number;
  EndXRatio?: number;
  EndYRatio?: number;
}

/** DrawnUi RecyclingTemplate: Enabled = pool of cells for the visible range, Disabled = one view per item. */
export type RecyclingTemplate = "Enabled" | "Disabled";

/** DrawnUi MeasuringStrategy (MeasureVisible not ported yet). */
export type MeasuringStrategy = "MeasureAll" | "MeasureFirst" | "MeasureVisible";

/** DrawnUi RelativePositionType for ScrollToIndex. */
export type RelativePositionType = "None" | "Start" | "Center" | "End";

/** DrawnUi SkiaTouchAnimation (Shimmer declared for parity, not ported). */
export type SkiaTouchAnimation = "None" | "Ripple" | "Shimmer";

/** DrawnUi RenderingModeType subset. */
export type RenderingModeType = "Default" | "Accelerated";
