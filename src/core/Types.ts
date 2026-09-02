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

/** DrawnUi TransformAspect: how an image/svg is scaled into its box. */
export type TransformAspect = "None" | "Fill" | "Fit" | "AspectFit" | "AspectFill" | "AspectFitFill" | "FitFill" | "Cover" | "AspectCover" | "Tile";

/** DrawnUi DrawImageAlignment. */
export type DrawImageAlignment = "Start" | "Center" | "End";

/** DrawnUi SkiaTouchAnimation (Shimmer declared for parity, not ported). */
export type SkiaTouchAnimation = "None" | "Ripple" | "Shimmer";

/** DrawnUi RenderingModeType subset. */
export type RenderingModeType = "Default" | "Accelerated";
