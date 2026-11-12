// Port of Add3dGallery.Shared Pages/Scenery.cs.
import type { Canvas as SkCanvas, Image, Paint, Path, Shader, Surface } from "canvaskit-wasm";
import { SkiaControl, Super, type DrawingContext } from "drawnui-react/core";

type Rgba = [number, number, number, number];
/** A layer's part: its shape and its fill, in device pixels. */
interface Part { Path: Path; Shader?: Shader; Color: Rgba }

/**
 * The mobs' field: a side-scroller scene drawn in code with gradients and smooth outlines, the same as DrawnUI for
 * Rust's gallery3d: a still sky and sun, then clouds, far hills, near hills and the grass with its dirt path, each
 * sliding at its own share of the pan (parallax). Every moving layer repeats every 1000 points. The shapes are made
 * once per size and painted once into a GPU image per layer (the sky and sun into one more); a frame draws each layer
 * as that image repeated sideways, at its exact slide (Pan, in points), fractions of a pixel included.
 */
export class Scenery extends SkiaControl {
  /** One tile of the scene, in points: every moving layer repeats over it. */
  static readonly TileWidth = 1000;
  /** Where the mobs walk: the top and bottom of the ground band, in points from the field's top. */
  static readonly GroundTop = 196;
  static readonly GroundBottom = 262;
  /** How fast the scene pans, points per second, and each layer's share of it (far ones move less). */
  static readonly PanSpeed = 33;
  private static readonly Parallax = [0.08, 0.2, 0.45, 1.0];

  private _pan = 0;
  private _builtH = 0;
  private _builtScale = -1;
  private _layers: Part[][] = [];
  private _sky?: Shader;
  private _paint?: Paint;
  private _glow?: Paint;
  /** The still sky and sun, then one tile of each moving layer, as GPU images of the canvas's context; each tile also
   * as a shader that repeats it sideways, so a layer is one draw at any fraction of a pixel, without a seam. */
  private _backdrop?: Image;
  private readonly _images: (Image | undefined)[] = [undefined, undefined, undefined, undefined];
  private readonly _tiles: (Shader | undefined)[] = [undefined, undefined, undefined, undefined];
  private _imagesSurface?: Surface;

  /** How far the scene has panned, in points (the ground's pace; farther layers move less). */
  get Pan(): number { return this._pan; }
  set Pan(value: number) {
    if (this._pan === value) return;
    this._pan = value;
    this.InvalidateCache();
    this.RepaintComposition();
  }

  private static C(r: number, g: number, b: number, a = 255): Rgba { return [r / 255, g / 255, b / 255, a / 255]; }

  private static Vertical(top: number, bottom: number, from: Rgba, to: Rgba, s: number): Shader {
    const CK = Super.CK;
    return CK.Shader.MakeLinearGradient([0, top * s], [0, bottom * s], [Float32Array.from(from), Float32Array.from(to)], null, CK.TileMode.Clamp);
  }

  /** A ridge line across one tile down to `bottom`, filled top to bottom with a gradient. */
  private static Ridge(baseY: number, waves: [number, number, number][], bottom: number, from: Rgba, to: Rgba, s: number): Part {
    // One device pixel past each end: the twin copies overlap there, so no antialiased edge shows between them.
    const path = new Super.CK.PathBuilder();
    path.moveTo(-1, bottom * s);
    let top = bottom;
    for (let i = 0; i <= 100; i++) {
      const x = i * 10;
      let y = baseY;
      for (const [amp, period, phase] of waves) y -= amp * Math.sin((x / period) * Math.PI * 2 + phase);
      top = Math.min(top, y);
      path.lineTo(i === 0 ? -1 : i === 100 ? Scenery.TileWidth * s + 1 : x * s, y * s);
    }
    path.lineTo(Scenery.TileWidth * s + 1, bottom * s);
    path.close();
    return { Path: path.detachAndDelete(), Shader: Scenery.Vertical(top, bottom, from, to, s), Color: from };
  }

  private PaintImages(main: Surface, w: number, h: number): void {
    this.DisposeImages();
    this._imagesSurface = main;
    const tile = Math.round(Scenery.TileWidth * this._builtScale);
    const backdrop = main.makeSurface({ ...main.imageInfo(), width: w, height: h });
    if (!backdrop) return;
    this.PaintBackdrop(backdrop.getCanvas(), w, h, this._builtScale);
    this._backdrop = backdrop.makeImageSnapshot();
    backdrop.delete();
    const CK = Super.CK;
    for (let i = 0; i < this._layers.length; i++) {
      const surface = main.makeSurface({ ...main.imageInfo(), width: tile, height: h });
      if (!surface) return;
      surface.getCanvas().clear(CK.TRANSPARENT);
      this.PaintLayer(surface.getCanvas(), i);
      const image = surface.makeImageSnapshot();
      surface.delete();
      this._images[i] = image;
      this._tiles[i] = image.makeShaderOptions(CK.TileMode.Repeat, CK.TileMode.Decal, CK.FilterMode.Linear, CK.MipmapMode.None);
    }
  }

  private PaintBackdrop(canvas: SkCanvas, w: number, h: number, s: number): void {
    const CK = Super.CK, paint = this._paint!;
    paint.setShader(this._sky ?? null);
    canvas.drawRect(CK.XYWHRect(0, 0, w, h), paint);
    paint.setShader(null);
    // The sun: a soft glow, then its disc.
    canvas.drawCircle(795 * s, 69 * s, 38 * s, this._glow!);
    paint.setColor(Float32Array.from(Scenery.C(255, 236, 170)));
    canvas.drawCircle(795 * s, 69 * s, 35 * s, paint);
  }

  private PaintLayer(canvas: SkCanvas, i: number): void {
    const paint = this._paint!;
    for (const part of this._layers[i]) {
      paint.setShader(part.Shader ?? null);
      paint.setColor(Float32Array.from(part.Color));
      canvas.drawPath(part.Path, paint);
    }
    paint.setShader(null);
  }

  private DisposeImages(): void {
    this._backdrop?.delete();
    this._backdrop = undefined;
    for (let i = 0; i < this._images.length; i++) {
      this._tiles[i]?.delete();
      this._tiles[i] = undefined;
      this._images[i]?.delete();
      this._images[i] = undefined;
    }
    this._imagesSurface = undefined;
  }

  private Build(h: number, s: number): void {
    const CK = Super.CK, C = Scenery.C;
    this.DisposeShapes();
    this.DisposeImages();
    this._builtH = h;
    this._builtScale = s;
    if (!this._paint) {
      this._paint = new CK.Paint();
      this._paint.setAntiAlias(true);
      this._glow = new CK.Paint();
      this._glow.setAntiAlias(true);
      this._glow.setColor(Float32Array.from(C(255, 230, 150, 230)));
      this._glow.setMaskFilter(CK.MaskFilter.MakeBlur(CK.BlurStyle.Normal, 13, true));
    }
    this._sky = Scenery.Vertical(0, h, C(92, 164, 232), C(214, 238, 250), s);

    const clouds: Part[] = [];
    for (const [x, y, k] of [[60, 26, 1], [340, 52, 0.7], [610, 18, 1.2], [860, 60, 0.8]]) {
      const ellipse = new CK.PathBuilder();
      ellipse.addOval(CK.XYWHRect(x * s, (y + 14 * k) * s, 90 * k * s, 30 * k * s));
      clouds.push({ Path: ellipse.detachAndDelete(), Color: C(255, 255, 255, 220) });
      const puffs = new CK.PathBuilder();
      puffs.addOval(CK.XYWHRect((x + 18 * k) * s, y * s, 44 * k * s, 44 * k * s));
      puffs.addOval(CK.XYWHRect((x + 46 * k) * s, (y + 8 * k) * s, 32 * k * s, 32 * k * s));
      clouds.push({ Path: puffs.detachAndDelete(), Color: C(255, 255, 255, 230) });
    }
    const far = [Scenery.Ridge(150, [[22, 1000, 0.3], [12, 500, 1.7], [5, 250, 0.4]], h, C(150, 190, 196), C(176, 210, 210), s)];
    const near = [Scenery.Ridge(190, [[26, 1000, 2.1], [14, 333.33, 0.9], [6, 200, 2.5]], h, C(98, 160, 104), C(70, 128, 80), s)];
    // Grass, then the dirt path the mobs walk on.
    const ground = [
      Scenery.Ridge(Scenery.GroundTop - 6, [[3, 500, 0], [2, 125, 1.3]], h, C(112, 178, 72), C(64, 120, 48), s),
      Scenery.Ridge(Scenery.GroundTop + 22, [[4, 1000, 0.8], [3, 250, 2.2]], Scenery.GroundBottom + 4, C(214, 182, 128), C(190, 152, 98), s),
    ];
    this._layers = [clouds, far, near, ground];
  }

  protected override Paint(ctx: DrawingContext): void {
    super.Paint(ctx);
    const CK = Super.CK;
    const dest = ctx.Destination;
    const s = ctx.Scale;
    const h = dest.Height / s;
    if (dest.Width <= 0 || h <= 0) return;
    if (h !== this._builtH || s !== this._builtScale) this.Build(h, s);
    const canvas = ctx.Context.Canvas;
    // CanvasKit's own GPU surface: the layers' images are made on its context (no surface: a software canvas).
    const main = this.Superview?.Surface;
    const w = Math.round(dest.Width), hp = Math.round(dest.Height);
    if (main && (this._imagesSurface !== main || !this._backdrop || this._backdrop.width() !== w || this._backdrop.height() !== hp))
      this.PaintImages(main, w, hp);
    const images = !!main && !!this._backdrop && !!this._images[this._images.length - 1];
    canvas.save();
    canvas.clipRect(CK.LTRBRect(dest.Left, dest.Top, dest.Right, dest.Bottom), CK.ClipOp.Intersect, true);
    // The field's corner on a whole device pixel: the backdrop image maps one to one.
    canvas.translate(Math.round(dest.Left), Math.round(dest.Top));

    if (images) canvas.drawImage(this._backdrop!, 0, 0);
    else this.PaintBackdrop(canvas, dest.Width, dest.Height, s);

    // Every slide keeps its fraction of a pixel: a layer snapped to whole pixels steps 0 or 1 pixel on alternate
    // frames at these speeds (the ground moves under one pixel a frame), which reads as a stutter.
    const tile = Math.round(Scenery.TileWidth * s);
    const paint = this._paint!;
    for (let i = 0; i < this._layers.length; i++) {
      const shift = (this._pan * Scenery.Parallax[i] * s) % tile;
      if (images) {
        // One draw of the repeating tile shader: no edge between copies to keep on a pixel.
        paint.setShader(this._tiles[i]!);
        paint.setColor(CK.WHITE); // a shader takes the paint's alpha: keep it opaque
        canvas.save();
        canvas.translate(-shift, 0);
        canvas.drawRect(CK.XYWHRect(shift, 0, dest.Width, dest.Height), paint);
        canvas.restore();
        paint.setShader(null);
        continue;
      }
      // No GPU surface: the shapes twice, side by side; they overlap by a pixel at each end, so no gap opens.
      for (let copy = 0; copy < 2; copy++) {
        canvas.save();
        canvas.translate(copy * tile - shift, 0);
        this.PaintLayer(canvas, i);
        canvas.restore();
      }
    }
    canvas.restore();
  }

  private DisposeShapes(): void {
    for (const layer of this._layers) for (const part of layer) { part.Path.delete(); part.Shader?.delete(); }
    this._layers = [];
    this._sky?.delete();
    this._sky = undefined;
  }

  protected override OnDisposing(): void {
    this.DisposeImages();
    this.DisposeShapes();
    this._paint?.delete();
    this._glow?.delete();
    super.OnDisposing();
  }
}
