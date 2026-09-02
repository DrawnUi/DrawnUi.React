import type { Image } from "canvaskit-wasm";
import { type DrawingContext, SkiaControl } from "../core/SkiaControl";
import { SkiaImageManager } from "../core/SkiaImageManager";
import { Super } from "../core/Super";
import { type DrawImageAlignment, SKRect, ScaledSize, type TransformAspect } from "../core/Types";

/**
 * Mirrors DrawnUi SkiaImage: async Source -> decoded image, drawn into DrawingRect with Aspect
 * (default AspectCover = fill and crop) and alignment. Content larger than the box is clipped.
 */
export class SkiaImage extends SkiaControl {
  Aspect: TransformAspect = "AspectCover";
  HorizontalAlignment: DrawImageAlignment = "Center";
  VerticalAlignment: DrawImageAlignment = "Center";

  /** Fired after the image decoded and the control invalidated. */
  Success?: (sender: SkiaImage, source: string) => void;
  Error?: (sender: SkiaImage, error: Error) => void;

  /** Decoded image currently shown. */
  LoadedSource?: Image;
  IsLoading = false;
  /** Where the scaled image was drawn last frame, canvas pixels. */
  DisplayRect: SKRect = SKRect.Empty;
  /** Scale applied to the source per axis at the last measure/draw (DrawnUi AspectScale). */
  AspectScale = { X: 0, Y: 0 };

  private source = "";
  private loadGeneration = 0;

  /** URL of the image; setting it starts loading, the control redraws when the image arrives. */
  get Source(): string { return this.source; }
  set Source(value: string) {
    if (this.source === value) return;
    this.source = value;
    const generation = ++this.loadGeneration;
    this.LoadedSource = undefined;
    if (!value) { this.IsLoading = false; this.Update(); return; }
    this.IsLoading = true;
    SkiaImageManager.Instance.LoadImageAsync(value).then(
      (image) => { if (generation !== this.loadGeneration) return; this.IsLoading = false; this.LoadedSource = image; this.Update(); this.Success?.(this, value); },
      (error: Error) => { if (generation !== this.loadGeneration) return; this.IsLoading = false; this.Error?.(this, error); },
    );
  }

  /** Port of DrawnUi SkiaControl.RescaleAspect: per-axis scale to apply to (width, height) inside dest. */
  static RescaleAspect(width: number, height: number, dest: SKRect, stretch: TransformAspect): { X: number; Y: number } {
    let aspectX = 1, aspectY = 1;
    const s1 = dest.Width / width;
    const s2 = dest.Height / height;
    switch (stretch) {
      case "None": break;
      case "Fit":
        aspectX = dest.Width < width ? dest.Width / width : 1;
        aspectY = dest.Height < height ? dest.Height / height : 1;
        break;
      case "Fill":
        aspectX = width < dest.Width ? s1 : 1;
        aspectY = height < dest.Height ? s2 : 1;
        break;
      case "FitFill":
        aspectX = width < dest.Width ? s1 : 1;
        aspectY = height < dest.Height ? s2 : 1;
        if (width * aspectX > dest.Width || height * aspectY > dest.Height) {
          aspectX = dest.Width < width ? dest.Width / width : 1;
          aspectY = dest.Height < height ? dest.Height / height : 1;
        }
        break;
      case "Cover": aspectX = s1; aspectY = s2; break;
      case "AspectCover": aspectX = aspectY = Math.max(s1, s2); break;
      case "AspectFill": aspectX = aspectY = width < dest.Width ? Math.max(s1, s2) : 1; break;
      case "AspectFit": aspectX = aspectY = Math.min(s1, s2); break;
      case "AspectFitFill":
        aspectX = aspectY = width < dest.Width ? Math.max(s1, s2) : 1;
        if (width * aspectX > dest.Width || height * aspectY > dest.Height) aspectX = aspectY = Math.min(s1, s2);
        break;
      case "Tile": break; // not ported: draws like None
    }
    return { X: aspectX, Y: aspectY };
  }

  /** Port of DrawnUi CalculateDisplayRect: places a (bmpWidth x bmpHeight) box inside dest by alignment. */
  static CalculateDisplayRect(dest: SKRect, bmpWidth: number, bmpHeight: number, horizontal: DrawImageAlignment, vertical: DrawImageAlignment): SKRect {
    let x = 0, y = 0;
    if (horizontal === "Center") x = (dest.Width - bmpWidth) / 2;
    else if (horizontal === "End") x = dest.Width - bmpWidth;
    if (vertical === "Center") y = (dest.Height - bmpHeight) / 2;
    else if (vertical === "End") y = dest.Height - bmpHeight;
    return SKRect.Create(dest.Left + x, dest.Top + y, bmpWidth, bmpHeight);
  }

  /**
   * DrawnUi sizing: a finite box is taken as is; an unbounded axis follows the source aspect from the
   * bounded one; with nothing loaded or nothing bounded the image measures empty.
   */
  protected override MeasureAbsolute(widthConstraint: number, heightConstraint: number, scale: number): ScaledSize {
    const img = this.LoadedSource;
    let w = widthConstraint, h = heightConstraint;
    if (img) {
      const aspect = img.width() / img.height();
      if (!isFinite(w) && isFinite(h)) w = h * aspect;
      else if (!isFinite(h) && isFinite(w)) h = w / aspect;
    }
    if (!isFinite(w) || !isFinite(h)) { this.AspectScale = { X: 0, Y: 0 }; return ScaledSize.FromPixels(0, 0, scale); }
    if (img) this.AspectScale = SkiaImage.RescaleAspect(img.width(), img.height(), SKRect.Create(0, 0, w, h), this.Aspect);
    return ScaledSize.FromPixels(w, h, scale);
  }

  protected override Paint(ctx: DrawingContext): void {
    const img = this.LoadedSource;
    if (!img) return;
    const dest = ctx.Destination;
    const scaled = SkiaImage.RescaleAspect(img.width(), img.height(), dest, this.Aspect);
    this.AspectScale = scaled;
    const display = SkiaImage.CalculateDisplayRect(dest, img.width() * scaled.X, img.height() * scaled.Y, this.HorizontalAlignment, this.VerticalAlignment);
    this.DisplayRect = display;

    const CK = Super.CK;
    const canvas = ctx.Context.Canvas;
    const overflows = display.Left < dest.Left || display.Top < dest.Top || display.Right > dest.Right || display.Bottom > dest.Bottom;
    const saved = canvas.save();
    if (overflows) canvas.clipRect(CK.LTRBRect(dest.Left, dest.Top, dest.Right, dest.Bottom), CK.ClipOp.Intersect, true);
    const paint = new CK.Paint();
    paint.setAntiAlias(true);
    canvas.drawImageRectOptions(
      img,
      CK.LTRBRect(0, 0, img.width(), img.height()),
      CK.LTRBRect(display.Left, display.Top, display.Right, display.Bottom),
      CK.FilterMode.Linear, CK.MipmapMode.Linear, paint,
    );
    paint.delete();
    canvas.restoreToCount(saved);
  }
}
