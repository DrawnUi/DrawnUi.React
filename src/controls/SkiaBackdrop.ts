import type { Image } from "canvaskit-wasm";
import type { DrawingContext } from "../core/SkiaControl";
import { Super } from "../core/Super";
import { SkiaImageEffects } from "../core/ImageEffects";
import { SkiaLayout } from "./SkiaLayout";

/**
 * Mirrors DrawnUi SkiaBackdrop: draws what is already painted beneath its box through `Blur` (points, default 5)
 * and `Brightness` (gamma, 1 = unchanged), tinted by `BackgroundColor`; children draw first and are blurred too.
 * The snapshot comes from the surface being drawn (`UseContext`) or the on-screen surface. Not cached (re-blurs
 * on every frame it is drawn in). Under an Operations (picture) cache only the tint can be drawn: give the parent
 * UseCache=Image (offscreen surface) or None.
 */
export class SkiaBackdrop extends SkiaLayout {
  Blur = 5;
  Brightness = 1;
  /** Snapshot the surface currently drawn into (true) or the on-screen surface (false). */
  UseContext = true;

  private snapshot?: Image;
  private static warnedRecording = false;

  constructor() {
    super();
    this.HorizontalOptions = "Fill";
    this.VerticalOptions = "Fill";
  }

  get HasEffects(): boolean { return this.Blur !== 0 || this.Brightness !== 1; }

  /** The last snapshot taken (C# GetImage hands it over: the caller owns it afterwards). */
  GetImage(): Image | undefined { const i = this.snapshot; this.snapshot = undefined; return i; }

  /** Background is painted inside Paint(), after the children and before the snapshot (C# order). */
  protected override PaintBackground(_ctx: DrawingContext): void {}
  protected override PaintsBackgroundWithoutColor(): boolean { return false; }

  protected override Paint(ctx: DrawingContext): void {
    const d = ctx.Destination;
    if (d.Width <= 0 || d.Height <= 0) return;
    const CK = Super.CK;
    const canvas = ctx.Context.Canvas;
    super.Paint(ctx); // children
    if (this.BackgroundColor) { const paint = this.CreateBackgroundPaint(d); canvas.drawRect(CK.LTRBRect(d.Left, d.Top, d.Right, d.Bottom), paint); paint.delete(); }
    if (!this.HasEffects) return;
    // The surface being drawn into: an Image cache surface (translated to its own origin, so the box is mapped through
    // the canvas matrix) or the on-screen surface. While a picture is being RECORDED (an Operations cache above)
    // nothing is on any surface yet, so only the tint is drawn: put the backdrop under UseCache=Image or None.
    if (ctx.Context.Recording) {
      if (!SkiaBackdrop.warnedRecording) { SkiaBackdrop.warnedRecording = true; console.warn("[SkiaBackdrop] inside an Operations cache: blur needs a parent with UseCache=Image or None"); }
      return;
    }
    const surface = this.UseContext ? ctx.Context.Surface : this.Superview?.Surface;
    if (!surface) return;
    surface.flush();
    let sl = d.Left, st = d.Top, sr = d.Right, sb = d.Bottom;
    if (surface === ctx.Context.Surface) {
      const m = canvas.getTotalMatrix();
      const p = CK.Matrix.mapPoints(m, [d.Left, d.Top, d.Right, d.Bottom]);
      sl = Math.min(p[0], p[2]); sr = Math.max(p[0], p[2]); st = Math.min(p[1], p[3]); sb = Math.max(p[1], p[3]);
    }
    const l = Math.floor(sl), t = Math.floor(st), r = Math.ceil(sr), b = Math.ceil(sb);
    // whole-surface snapshot, sub-rect on draw: a bounded snapshot of a GPU surface is not origin-safe in CanvasKit
    const image = surface.makeImageSnapshot();
    if (!image) return;
    const paint = new CK.Paint();
    const blur = this.Blur > 0 ? CK.ImageFilter.MakeBlur(this.Blur * ctx.Scale, this.Blur * ctx.Scale, CK.TileMode.Mirror, null) : null;
    if (blur) paint.setImageFilter(blur);
    const gamma = this.Brightness !== 1 ? SkiaImageEffects.Gamma(this.Brightness) : null;
    if (gamma) paint.setColorFilter(gamma);
    const saved = canvas.save();
    canvas.clipRect(CK.LTRBRect(d.Left, d.Top, d.Right, d.Bottom), CK.ClipOp.Intersect, true);
    canvas.drawImageRectOptions(image, CK.LTRBRect(l, t, r, b), CK.LTRBRect(d.Left, d.Top, d.Right, d.Bottom), CK.FilterMode.Linear, CK.MipmapMode.None, paint);
    canvas.restoreToCount(saved);
    blur?.delete(); gamma?.delete(); paint.delete();
    const kill = this.snapshot;
    this.snapshot = image;
    kill?.delete();
  }

  protected override OnDisposing(): void { this.snapshot?.delete(); this.snapshot = undefined; }
}
