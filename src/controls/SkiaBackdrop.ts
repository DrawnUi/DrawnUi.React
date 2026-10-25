import type { Image } from "canvaskit-wasm";
import type { DrawingContext } from "../core/SkiaControl";
import { Super } from "../core/Super";
import { SkiaImageEffects } from "../core/ImageEffects";
import { SkiaLayout } from "./SkiaLayout";

/**
 * Mirrors DrawnUi SkiaBackdrop: draws what is already painted beneath its box through `Blur` (points, default 5)
 * and `Brightness` (gamma, 1 = unchanged), tinted by `BackgroundColor`; children draw first and are blurred too.
 * The snapshot comes from the surface being drawn (`UseContext`, the area it covers there through every ancestor
 * transform) or the on-screen surface. Not cached (re-blurs on every frame it is drawn in). Its picture-cached parents
 * should use `UseCache = None` (the app sets it, the library never changes a parent's cache; a one-time console warning
 * names the case); inside an Image-cached ancestor it copies that cache's surface
 * (right when what shows through the glass is inside that cache, wrong when it should show content outside it).
 */
export class SkiaBackdrop extends SkiaLayout {
  /** Samples what is drawn below: a composite above redraws it whole when something inside changes (drawnui-cross 6m). */
  protected override get SamplesContent(): boolean { return true; }
  Blur = 5;
  Brightness = 1;
  /** Snapshot the surface currently drawn into (true) or the on-screen surface (false). */
  UseContext = true;

  private snapshot?: Image;
  private warnedPicture = false;

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
    // recorded into a parent's picture cache: its copy of what is behind goes into the picture. The library never
    // changes a parent's cache (Nick, C# cf18cf29): it says so once, the app sets UseCache = None on those parents
    if (ctx.Context.Recording && !this.warnedPicture) {
      this.warnedPicture = true;
      console.warn(`[SkiaBackdrop]${this.Tag ? ` ${this.Tag}` : ""} is recorded into a parent's picture cache (Operations / OperationsFull, the default of SkiaShape): its copy of what is behind goes into the picture. Set UseCache = None on its picture-cached parents.`);
    }
    // C# UseContext: snapshot the surface the pixels end up on — the on-screen surface or the nearest Image cache
    // surface. Copied where the backdrop really is on that surface: its rect through the canvas matrix (ancestor
    // scale, move, rotation, 3D, the cache origin), rounded out, clamped to the surface, and drawn back 1:1 with the
    // matrix undone, clipped to the backdrop's own (maybe turned) rect: the blur stays the same on screen while an
    // ancestor scales (C# 6fd3bae3). The global surface (UseContext false) is copied at the layout rect.
    const surface = this.UseContext ? ctx.Context.Surface : this.Superview?.Surface;
    if (!surface) return;
    surface.flush();
    let l = Math.floor(d.Left), t = Math.floor(d.Top), r = Math.ceil(d.Right), b = Math.ceil(d.Bottom);
    let device: number[] | null = null;
    if (this.UseContext) {
      const m = canvas.getTotalMatrix();
      const p = CK.Matrix.mapPoints(m, [d.Left, d.Top, d.Right, d.Top, d.Right, d.Bottom, d.Left, d.Bottom]);
      l = Math.max(0, Math.floor(Math.min(p[0], p[2], p[4], p[6]))); t = Math.max(0, Math.floor(Math.min(p[1], p[3], p[5], p[7])));
      r = Math.min(surface.width(), Math.ceil(Math.max(p[0], p[2], p[4], p[6]))); b = Math.min(surface.height(), Math.ceil(Math.max(p[1], p[3], p[5], p[7])));
      if (r <= l || b <= t) return;
      device = CK.Matrix.invert(m);
      if (!device) return;
    }
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
    if (device) {
      canvas.concat(device);
      canvas.drawImageRectOptions(image, CK.LTRBRect(l, t, r, b), CK.LTRBRect(l, t, r, b), CK.FilterMode.Nearest, CK.MipmapMode.None, paint);
    } else {
      canvas.drawImageRectOptions(image, CK.LTRBRect(l, t, r, b), CK.LTRBRect(d.Left, d.Top, d.Right, d.Bottom), CK.FilterMode.Linear, CK.MipmapMode.None, paint);
    }
    canvas.restoreToCount(saved);
    blur?.delete(); gamma?.delete(); paint.delete();
    const kill = this.snapshot;
    this.snapshot = image;
    kill?.delete();
    // the library never changes how a parent's cache behaves (Nick, 2026-10-25): a cached parent replays the copy it
    // recorded, as in C#; the app sets UseCache = None on the parents of a backdrop that must follow what is behind
  }

  protected override OnDisposing(): void { this.snapshot?.delete(); this.snapshot = undefined; }
}
