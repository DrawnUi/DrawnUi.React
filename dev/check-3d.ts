// 3D transforms (drawnui-cross 6ab, C# 1e4610f6), checked in Node (`npm run check:3d`): TranslationZ is depth (a flat
// control at depth z draws at 576 / (576 - z), like C# Create3dMatrix), RotationY 180 mirrors, taps go through the
// inverse of the 3D matrix (a turned tile and the tilted strip of HelloReact's Transforms page), and an Image-cached
// row inside a turned SkiaShape (an Operations picture) samples smoothly: it draws like the same row uncached, and the
// picture is recorded again when the shape turns or turns back.
import {
  Super, SKRect, SKPoint, Canvas, SkiaAccessibilityManager, HoverManager, SkiaLayer, SkiaRow, SkiaShape, SkiaScroll,
  SkiaGesturesParameters, TouchActionEventArgs, Thickness, type SkiaControl, type AnimatorBase, type TouchActionResult, type SkiaCacheType,
} from "../src/index.ts";

declare const CanvasKitInit: (o: { locateFile: () => string }) => Promise<any>;
const ROOT = process.cwd();
const W = 400, H = 300;
let failures = 0;
const check = (name: string, ok: boolean, detail = "") => { if (!ok) failures++; console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`); };

class FakeCanvas {
  readonly AccessibilityManager = new SkiaAccessibilityManager();
  readonly Hover = new HoverManager();
  readonly AnimatingControls = new Map<number, AnimatorBase>();
  RenderingScale = 1;
  GpuEpoch = 0;
  Update(): void {}
  readonly disposeQueue: { Dispose(): void }[] = [];
  DisposeObject(o: { Dispose(): void }): void { this.disposeQueue.push(o); }
  RegisterAnimator(a: AnimatorBase): boolean { this.AnimatingControls.set(a.Uid, a); return true; }
  UnregisterAnimator(uid: number): void { this.AnimatingControls.delete(uid); }
}

/** The control centered over a full-size shape that counts its taps. */
class Scene {
  readonly fake = new FakeCanvas();
  readonly root = new SkiaLayer();
  tapsUnder = 0;
  private readonly canvas = Object.create(Canvas.prototype) as Canvas & { gestureOwner: SkiaControl | null; activeTouchIds: Set<number> };

  constructor(readonly control: SkiaControl, private readonly CK: any) {
    control.HorizontalOptions = "Center"; control.VerticalOptions = "Center";
    const under = new SkiaShape(); under.HorizontalOptions = "Fill"; under.VerticalOptions = "Fill"; under.BackgroundColor = "#202020";
    under.Tapped = () => { this.tapsUnder++; };
    this.root.WidthRequest = W; this.root.HeightRequest = H;
    this.root.AddSubView(under); this.root.AddSubView(control);
    this.root._superview = this.fake as unknown as Canvas;
    this.canvas.gestureOwner = null; this.canvas.activeTouchIds = new Set();
    this.frame();
  }

  /** Draws one frame and returns its pixels. */
  frame(): Uint8Array {
    const CK = this.CK, surface = CK.MakeSurface(W, H);
    this.root.Measure(W, H, 1); this.root.Arrange(new SKRect(0, 0, W, H), W, H, 1);
    this.root.Render({ Context: { Canvas: surface.getCanvas(), Surface: surface }, Destination: new SKRect(0, 0, W, H), Scale: 1 });
    const px = surface.makeImageSnapshot().readPixels(0, 0, { width: W, height: H, colorType: CK.ColorType.RGBA_8888, alphaType: CK.AlphaType.Unpremul, colorSpace: CK.ColorSpace.SRGB }) as Uint8Array;
    surface.delete();
    for (const o of this.fake.disposeQueue.splice(0)) o.Dispose();
    return px;
  }

  send(type: TouchActionResult, x: number, y: number): void {
    const a = new TouchActionEventArgs(); a.Location = new SKPoint(x, y); a.StartingLocation = a.Location; a.Scale = 1;
    if (type === "Down") this.canvas.activeTouchIds.add(1);
    (this.canvas as unknown as { ProcessGestures(r: SkiaControl, p: SkiaGesturesParameters): SkiaControl | null }).ProcessGestures(this.root, SkiaGesturesParameters.Create(type, a));
    if (type === "Up") this.canvas.activeTouchIds.delete(1);
  }

  tap(x: number, y: number): void { this.send("Down", x, y); this.send("Up", x, y); this.send("Tapped", x, y); this.frame(); }
}

const map = (m: number[], x: number, y: number): [number, number] => {
  const w = m[6] * x + m[7] * y + m[8];
  return [(m[0] * x + m[1] * y + m[2]) / w, (m[3] * x + m[4] * y + m[5]) / w];
};

/** HelloReact's tilted strip: a turned SkiaShape holding a horizontal scroll of 96x96 gradient tiles in a row. */
function strip(rowCache: SkiaCacheType, tapped: (i: number) => void) {
  const card = new SkiaShape();
  card.WidthRequest = 280; card.HeightRequest = 150; card.CornerRadius = 16;
  card.RotationX = 16; card.RotationY = 20; card.Rotation = -6;
  card.BackgroundColor = "#111827"; card.StrokeColor = "#6EA8FE"; card.StrokeWidth = 1.55;
  const scroll = new SkiaScroll(); scroll.Orientation = "Horizontal"; scroll.HorizontalOptions = "Fill"; scroll.VerticalOptions = "Fill";
  const row = new SkiaRow(); row.UseCache = rowCache; row.Spacing = 10; row.Padding = new Thickness(14); row.VerticalOptions = "Center";
  const tiles: SkiaShape[] = [];
  for (let i = 1; i <= 6; i++) {
    const t = new SkiaShape(); t.CornerRadius = 12; t.WidthRequest = 96; t.HeightRequest = 96;
    t.FillGradient = { Type: "Linear", EndXRatio: 1, EndYRatio: 1, Colors: i % 2 ? ["#6EA8FE", "#0D6EFD"] : ["#D63384", "#FD7E14"] };
    t.Tapped = () => tapped(i);
    row.AddSubView(t); tiles.push(t);
  }
  scroll.Content = row;
  card.AddSubView(scroll);
  return { card, row, tiles };
}

(async () => {
  const CK = await CanvasKitInit({ locateFile: () => `${ROOT}/node_modules/canvaskit-wasm/bin/full/canvaskit.wasm` });
  (Super as unknown as { CK: unknown }).CK = CK;

  for (const [z, factor] of [[-300, 0.66], [150, 1.35], [300, 2.09]]) {
    const tile = new SkiaShape(); tile.WidthRequest = 100; tile.HeightRequest = 100; tile.TranslationZ = z;
    new Scene(tile, CK);
    const r = tile.GetTransformedDirtyBounds(), want = 100 * 576 / (576 - z);
    check(`TranslationZ ${z}: a flat control draws ${factor}x, around its center`, Math.abs(r.Width - want) < 0.01 && Math.abs(r.Height - want) < 0.01
      && Math.abs((r.Left + r.Right) / 2 - W / 2) < 0.01, `${r.Width.toFixed(2)} x ${r.Height.toFixed(2)} px, want ${want.toFixed(2)}`);
  }

  {
    const tile = new SkiaShape(); tile.WidthRequest = 100; tile.HeightRequest = 60; tile.RotationY = 180;
    new Scene(tile, CK);
    const d = tile.DrawingRect, [x] = map(tile.RenderTransformMatrix!, d.Left, (d.Top + d.Bottom) / 2);
    check("RotationY 180: the left edge draws on the right (seen from behind)", Math.abs(x - d.Right) < 0.01, `${x.toFixed(2)} vs ${d.Right}`);
  }

  {
    // RotationY 60: the 200 px tile spans about -59..+44 px around its center on screen
    let taps = 0;
    const tile = new SkiaShape(); tile.WidthRequest = 200; tile.HeightRequest = 100; tile.RotationY = 60; tile.Tapped = () => { taps++; };
    const scene = new Scene(tile, CK);
    scene.tap(W / 2 + 80, H / 2);
    const outside = taps === 0 && scene.tapsUnder === 1;
    scene.tap(W / 2 - 50, H / 2);
    check("RotationY 60: a tap goes through the inverse 3D matrix (beside the drawn tile misses it, on it hits)", outside && taps === 1, `taps ${taps}, under ${scene.tapsUnder}`);
  }

  {
    // a transformed control in a cached card that a scroll moves: the card replays its picture (the control is not
    // rendered again), and taps still land on the control where it is drawn
    let taps = 0;
    const tile = new SkiaShape(); tile.WidthRequest = 200; tile.HeightRequest = 100; tile.Rotation = 30; tile.Scale = 1.5; tile.RotationY = 30;
    tile.HorizontalOptions = "Center"; tile.VerticalOptions = "Center"; tile.Tapped = () => { taps++; };
    const card = new SkiaShape(); card.WidthRequest = 360; card.HeightRequest = 220; card.Margin = new Thickness(0, 300, 0, 0); card.AddSubView(tile);
    const stack = new SkiaLayer(); stack.HorizontalOptions = "Fill"; stack.HeightRequest = 1200; stack.AddSubView(card);
    const scroll = new SkiaScroll(); scroll.WidthRequest = W; scroll.HeightRequest = H; scroll.Content = stack;
    const scene = new Scene(scroll, CK);
    scroll.ViewportOffsetY = -120; scene.frame();
    scroll.ViewportOffsetY = -270; scene.frame();
    const replayed = card.RenderObject?.Picture !== undefined, d = tile.DrawingRect;
    scene.tap((d.Left + d.Right) / 2, (d.Top + d.Bottom) / 2);
    check("a turned control in a cached card moved by a scroll still takes taps where it is drawn", replayed && taps === 1, `taps ${taps}`);
  }

  {
    let last = 0;
    const { card, tiles } = strip("Image", (i) => { last = i; });
    const scene = new Scene(card, CK);
    const d = tiles[1].DrawingRect, [x, y] = map(card.RenderTransformMatrix!, (d.Left + d.Right) / 2, (d.Top + d.Bottom) / 2);
    scene.tap(x, y);
    check("tilted strip: a tap on the drawn tile 2 reaches tile 2", last === 2, `tapped ${last} at ${x.toFixed(1)},${y.toFixed(1)}`);
  }

  for (const [name, turn] of [["Rotation 20", (s: SkiaShape) => { s.Rotation = 20; }], ["RotationY 40, Rotation -6", (s: SkiaShape) => { s.RotationY = 40; s.Rotation = -6; }]] as const) {
    // an opaque Image-cached card: its bitmap's own border is an edge on screen (C# PaintRenderObject antialiases the blit)
    const make = (cache: SkiaCacheType) => { const s = new SkiaShape(); s.WidthRequest = 200; s.HeightRequest = 120; s.UseCache = cache; s.BackgroundColor = "#0D6EFD"; turn(s); return s; };
    const pa = new Scene(make("Image"), CK).frame(), pb = new Scene(make("None"), CK).frame();
    let differ = 0;
    for (let i = 0; i < pa.length; i += 4) if (Math.max(Math.abs(pa[i] - pb[i]), Math.abs(pa[i + 1] - pb[i + 1]), Math.abs(pa[i + 2] - pb[i + 2])) > 48) differ++;
    // before (no paint on the blit): 337 and 301 pixels, a stair-stepped border
    check(`${name}: an Image-cached card's border draws smooth, like the card uncached`, differ <= 5, `${differ} pixels off by more than 48 levels`);
  }

  {
    const cached = strip("Image", () => {}), live = strip("None", () => {});
    const a = new Scene(cached.card, CK), b = new Scene(live.card, CK);
    const pa = a.frame(), pb = b.frame();
    let differ = 0;
    for (let i = 0; i < pa.length; i += 4) {
      if (Math.max(Math.abs(pa[i] - pb[i]), Math.abs(pa[i + 1] - pb[i + 1]), Math.abs(pa[i + 2] - pb[i + 2])) > 96) differ++;
    }
    const o = cached.card.RenderObject;
    // nearest sampling (before): 85 pixels off by more than 96 levels, stair steps on every tile edge
    check("turned card: its Image-cached row draws like the same row uncached (smooth, no stair steps)", differ <= 5, `${differ} pixels off by more than 96 levels`);
    check("turned card: its picture holds image blits recorded for distorted playback", !!o?.Picture && o.HasImageBlits && o.PlaybackDistorted);
    cached.card.RotationX = 0; cached.card.RotationY = 0; cached.card.Rotation = 0;
    a.frame();
    const flat = cached.card.RenderObject;
    check("card turned back flat: the picture is recorded again for straight playback", !!flat && flat !== o && !flat.PlaybackDistorted && flat.HasImageBlits);
  }

  console.log(failures ? `FAIL: ${failures} checks` : "OK: 3D transforms");
  process.exit(failures ? 1 : 0);
})();
