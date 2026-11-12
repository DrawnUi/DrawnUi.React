// Port of Add3dGallery.Shared Pages/GalleryPage.cs and its partials, one section per C# file:
// GalleryPage.cs (the page, its cards), .Viewer (product viewer), .List (3D in a scrolling list), .Card (card flip),
// .Globe (globe with pins), .Form (3D next to normal UI), .Images (images on 3D), .Shapes (pieces made in code),
// .Loop (the state and the game loop).
//
// Most engine properties here are plain fields: a value set from code shows after the call that invalidates it,
// UpdateDraw() for a look, Update() for anything that changes size or visibility, RepaintComposition() for a
// transform or the opacity. Label texts invalidate by themselves.
import type { Canvas as SkCanvas, Paint, Path } from "canvaskit-wasm";
import {
  Aria, DrawnGame, Easing, ScaledSize, SkiaControl, SkiaEditor, SkiaLabel, SkiaLayer, SkiaLayout, SkiaRow, SkiaScroll,
  SkiaScrollBar, SkiaShadow, SkiaShape, SkiaStack, SkiaValueAnimator, SkiaWrap, Super, Thickness, type Color,
} from "drawnui-react/core";
import { LoadState3D, Look, Mesh3D, Model3D, SkiaModel3D, SkiaScene3D, Texture3D } from "drawnui-react-add3d/core";
import { RescalingLayout } from "./RescalingLayout";
import { Scenery } from "./Scenery";
import { Make, Theme, UiButton, WasInLastFrame } from "./Theme";

type Vec3 = [number, number, number];

// ---- GalleryPage.cs ----

/** The confetti tile and the mobs' field, in points. */
const RainWidth = 268, RainHeight = 190, FieldWidth = 1000, FieldHeight = 280;
/** The inner width of the wide cards (the first five sections and the mobs). */
const WideWidth = 1000;
const MobCounts = [10, 40, 100];
/** Two-column cards stay side by side while their content is at least this wide; narrower, the 3D view goes on top. */
const TwoColumnsMin = 720;
/** A list row keeps its button beside the text while the card's content is at least this wide. */
const RowBesideMin = 420;
/** The mascot's view height when the form and the mascot stack. */
const StackedView = 320;
/** The medal's resting turn: it spins from here and lands here. */
const MedalYaw = 20;
/** The drawn look of the mobs: toon shading and the gallery's ink outline (same in DrawnUI for Rust). */
const DrawnOutline = 2;
const DrawnInk = "#2B2540";

/** The width a card's content has on a page `width` points wide, at most the desktop card. */
const CardInner = (width: number) => Math.min(width - 2 * 24 - 2 * 21, WideWidth);
const TwoColumns = (width: number) => width <= 0 || CardInner(width) >= TwoColumnsMin;

// ---- GalleryPage.Viewer.cs ----

const ViewerWidth = 620, ViewerHeight = 420, PinSize = 26, NoteWidth = 210;

/** Where the sofa comes from. */
enum Source {
  /** The .glb shipped inside the app. */
  App,
  /** The same file at its address on the app's site. */
  Link,
  /** An address with nothing behind it: the error card. */
  Broken,
}

const Sources: [Source, string][] = [
  [Source.App, "In the app"],
  [Source.Link, "From a link"],
  [Source.Broken, "Broken link"],
];

const SofaUrl = "assets/sofa.glb", BrokenUrl = "assets/no-such-sofa.glb";

/** Parts of the sofa worth a note: name, note and the point in the model's own units, a hair above its surface. */
const Hotspots: [string, string, Vec3][] = [
  ["Seat", "Feather-wrapped cushions", [0.3, 0.386, 0.05]],
  ["Back", "Hand-sewn, deep buttoned", [0, 0.65, -0.252]],
  ["Frame", "Carved walnut", [0.76, 0.5, 0.183]],
];

/**
 * The upholstery, cheapest first: name, its fabric image (Poly Haven CC0), how matte it is (leather shines a little),
 * the swatch's color and the sofa's price in it.
 */
const Fabrics = (): [string, Uint8Array, number, Color, number][] => [
  ["Linen", Theme.Linen, 1.0, "#8CACCE", 1190],
  ["Wool", Theme.Wool, 0.95, "#7A7872", 1290],
  ["Velvet", Theme.Velvet, 0.7, "#B4283E", 1490],
  ["Leather", Theme.Leather, 0.42, "#5C341A", 1890],
];

const Dollars = (amount: number) => "$" + amount.toLocaleString("en-US");

// ---- GalleryPage.List.cs ----

const ListRows = 30;
const ListHeight = 440, RowHeight = 84, ThumbSize = 68;

/** The shop's pieces (Poly Haven, CC0): file, name, detail and base price; the same as DrawnUI for Rust's gallery3d. */
const Pieces = (): [Uint8Array, string, string, number][] => [
  [Theme.Sofa, "Walnut sofa", "Three-seater, carved walnut frame", 1190],
  [Theme.LoungeChair, "Lounge chair", "Leather on a bent plywood shell", 890],
  [Theme.Armchair, "Armchair", "Carved frame, linen seat", 640],
  [Theme.Ottoman, "Ottoman", "Soft leather on wooden feet", 290],
  [Theme.CoffeeTable, "Coffee table", "Stone top on an oak frame", 420],
  [Theme.DrawerCabinet, "Drawer cabinet", "Six drawers with brass pulls", 760],
];

/** Finishes: name, the tint over the piece's own colors (undefined = as it is), what it adds to the price. */
const Finishes: [string, Color | undefined, number][] = [
  ["Natural", undefined, 0],
  ["Honey", "#FFE8C4", 20],
  ["Smoke", "#BEC4D2", 40],
  ["Sage", "#CCE8D2", 60],
  ["Espresso", "#96867A", 80],
];

// ---- GalleryPage.Card.cs ----

/** The card in model units: a bank card's proportions (85.6 x 54 mm), its face 1024 x 646 path units. */
const CardScale = 8.56 / 1024;

// ---- GalleryPage.Globe.cs ----

const GlobeHeight = 420;
/** The pin's size, its tip (the city's point) from its top left, the chip's size and how far above the point it sits. */
const PinW = 32, PinH = 48, PinTipX = 16, PinTipY = 43, ChipW = 130, ChipH = 30, ChipRise = 78;
const PinRed = "#EA4335";

/** The pinned cities: name, latitude and longitude in degrees. */
const Cities: [string, number, number][] = [
  ["Tokyo", 35.7, 139.7],
  ["Sydney", -33.9, 151.2],
  ["Cape Town", -33.9, 18.4],
  ["London", 51.5, -0.1],
  ["New York", 40.7, -74.0],
  ["Rio de Janeiro", -22.9, -43.2],
];

/**
 * A point on the globe for a latitude and a longitude, a hair above the surface (the pin stands on it). The image
 * wraps once around the sphere: its left edge, longitude -180, at angle 360 around the y axis from +x.
 */
function OnGlobe(lat: number, lon: number): Vec3 {
  const angle = (1 - (lon + 180) / 360) * Math.PI * 2;
  const phi = (lat * Math.PI) / 180;
  const r = 1.002;
  return [r * Math.cos(phi) * Math.cos(angle), r * Math.sin(phi), r * Math.cos(phi) * Math.sin(angle)];
}

const Clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/** The view's turn that puts a point of the globe straight in front: the yaw and pitch, degrees. */
function Facing(p: Vec3): [number, number] {
  const length = Math.hypot(p[0], p[1], p[2]);
  return [(Math.atan2(p[0], p[2]) * 180) / Math.PI, Clamp((Math.asin(Clamp(p[1] / length, -1, 1)) * 180) / Math.PI, -55, 75)];
}

// ---- GalleryPage.Form.cs ----

const FormWidth = 420;
// The avatar's bones and moves (glTF names of avatar.glb).
const HeadBone = "Head", ArmL = "UpperArm.L", ArmR = "UpperArm.R", ForearmL = "LowerArm.L", ForearmR = "LowerArm.R";

/** A rotation as x, y, z, w (System.Numerics Quaternion). */
type Quat = [number, number, number, number];
const QMul = (a: Quat, b: Quat): Quat => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
const QAxis = (x: number, y: number, z: number, angle: number): Quat => {
  const s = Math.sin(angle / 2);
  return [x * s, y * s, z * s, Math.cos(angle / 2)];
};
/** Quaternion.Slerp: the short way round. */
function QSlerp(a: Quat, b: Quat, t: number): Quat {
  let cos = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  const flip = cos < 0;
  if (flip) cos = -cos;
  let k0: number, k1: number;
  if (cos > 1 - 1e-6) { k0 = 1 - t; k1 = t; } else {
    const omega = Math.acos(cos), sin = Math.sin(omega);
    k0 = Math.sin((1 - t) * omega) / sin;
    k1 = Math.sin(t * omega) / sin;
  }
  if (flip) k1 = -k1;
  return [a[0] * k0 + b[0] * k1, a[1] * k0 + b[1] * k1, a[2] * k0 + b[2] * k1, a[3] * k0 + b[3] * k1];
}

// The bones' own rest turns in avatar.glb: the poses are made on top of them (rest * turn), as in DrawnUI for Rust.
const HeadRest: Quat = [-0.0561773, -0.00027504, 0.0000154335, 0.998420775];
const Ear1LRest: Quat = [0.0947101936, -0.0489338711, -0.193506643, 0.97529];
const Ear1RRest: Quat = [0.0948166773, 0.0494704843, 0.193454459, 0.97526294];
const Ear2LRest: Quat = [-0.237358987, -0.0338113457, -0.0107185887, 0.970774233];
const Ear2RRest: Quat = [-0.223375544, 0.0275211222, 0.0118607497, 0.974271655];
const ArmLRest: Quat = [0.526785612, 0.503608823, 0.47415754, -0.494013935];
const ArmRRest: Quat = [0.526785672, -0.503608882, -0.474157482, -0.494013816];
const ForearmLRest: Quat = [-0.02938167, 0.261505067, -0.280782908, 0.922991216];
const ForearmRRest: Quat = [-0.0293817, -0.261505097, 0.280782908, 0.922991216];

/** Rotations around x, then y, then z, in degrees (glTF / glam XYZ: x * y * z). */
function Euler(x: number, y: number, z: number): Quat {
  const r = Math.PI / 180;
  return QMul(QMul(QAxis(1, 0, 0, x * r), QAxis(0, 1, 0, y * r)), QAxis(0, 0, 1, z * r));
}

/** The XYZ angles, in degrees, of a turn: the inverse of Euler. */
function ToEuler([x, y, z, w]: Quat): Vec3 {
  const d = 180 / Math.PI;
  return [
    Math.atan2(-2 * (y * z - w * x), 1 - 2 * (x * x + y * y)) * d,
    Math.asin(Clamp(2 * (x * z + w * y), -1, 1)) * d,
    Math.atan2(-2 * (x * y - w * z), 1 - 2 * (y * y + z * z)) * d,
  ];
}

// ---- GalleryPage.Images.cs / GalleryPage.Card.cs: images drawn with Skia ----

/** Paints and shaders made while an image is drawn, deleted when it is done. */
let paints: { delete(): void }[] = [];

/** A paint of one color (CanvasKit floats). */
function Fill(color: Float32Array): Paint {
  const paint = new Super.CK.Paint();
  paint.setAntiAlias(true);
  paint.setColor(color);
  paints.push(paint);
  return paint;
}

const Rgb = (r: number, g: number, b: number, a = 255) => Super.CK.Color(r, g, b, a / 255);

function Linear(x0: number, y0: number, x1: number, y1: number, colors: Float32Array[]): Paint {
  const CK = Super.CK;
  const paint = Fill(CK.WHITE);
  const shader = CK.Shader.MakeLinearGradient([x0, y0], [x1, y1], colors, null, CK.TileMode.Clamp);
  paints.push(shader);
  paint.setShader(shader);
  return paint;
}

/** An image drawn with Skia, ready to put on a 3D surface. */
function Painted(width: number, height: number, draw: (c: SkCanvas, w: number, h: number) => void): Texture3D {
  const surface = Super.CK.MakeSurface(width, height)!;
  draw(surface.getCanvas(), width, height);
  const image = surface.makeImageSnapshot();
  const texture = Texture3D.FromImage(image)!;
  image.delete();
  surface.delete();
  for (const p of paints) p.delete();
  paints = [];
  return texture;
}

/** Text at `x` (left, right or center of it), its baseline at `y`: subpixel-positioned and antialiased, so it stays even on a turning surface. */
function Text(canvas: SkCanvas, text: string, x: number, y: number, size: number, color: Float32Array, align: "Left" | "Right" | "Center" = "Left", italic = false, family = "FontText"): void {
  const CK = Super.CK;
  const font = new CK.Font(Super.GetTypeface(family), size);
  font.setSubpixel(true);
  font.setEdging(CK.FontEdging.AntiAlias);
  if (italic) font.setSkewX(-0.22);
  const width = font.getGlyphWidths(font.getGlyphIDs(text)).reduce((a, b) => a + b, 0);
  canvas.drawText(text, align === "Left" ? x : align === "Right" ? x - width : x - width / 2, y, Fill(color), font);
  font.delete();
}

/** Text centered on `x`, its baseline at `y`, in the app's title font. */
const Centered = (canvas: SkCanvas, text: string, x: number, y: number, size: number, color: Float32Array) =>
  Text(canvas, text, x, y, size, color, "Center", false, Theme.Title);

/** A product box's label: a fruit on a gradient, a frame and the flavor's name. */
const Label = (name: string, top: Float32Array, bottom: Float32Array, fruit: Float32Array) => Painted(512, 512, (c, w, h) => {
  const CK = Super.CK;
  c.drawRect(CK.XYWHRect(0, 0, w, h), Linear(0, 0, 0, h, [top, bottom]));
  const frame = Fill(Rgb(255, 255, 255, 200));
  frame.setStyle(CK.PaintStyle.Stroke);
  frame.setStrokeWidth(10);
  c.drawRRect(CK.RRectXY(CK.XYWHRect(26, 26, w - 52, h - 52), 36, 36), frame);
  c.drawCircle(w / 2, 214, 112, Fill(fruit));
  c.drawCircle(w / 2 - 38, 176, 30, Fill(Rgb(255, 255, 255, 90)));
  c.drawOval(CK.XYWHRect(w / 2 + 6, 70, 70, 34), Fill(Rgb(76, 201, 140)));
  Centered(c, name, w / 2, 410, 76, CK.WHITE);
  Centered(c, "made in code", w / 2, 456, 26, Rgb(255, 255, 255, 220));
});

const Labels = () => [
  Label("BERRY", Rgb(255, 99, 132), Rgb(124, 58, 237), Rgb(190, 24, 93)),
  Label("MINT", Rgb(52, 211, 153), Rgb(13, 110, 253), Rgb(16, 185, 129)),
  Label("SUN", Rgb(255, 214, 10), Rgb(253, 126, 20), Rgb(255, 159, 28)),
];

/** A white box: the label shows as it is. */
const ProductBox = () => new Model3D().Part("box", Mesh3D.Cuboid(1, 1, 1), "#FFFFFF");

function CardOutline(): Path {
  const CK = Super.CK;
  const path = new CK.PathBuilder();
  path.addRRect(CK.RRectXY(CK.XYWHRect(0, 0, 1024, 646), 46, 46));
  return path.detachAndDelete();
}

/**
 * The card: a front half and a back half, each a rounded slab with its own image. The back half is turned round, so
 * its image reads right from behind.
 */
function CardModel(): Model3D {
  const outline = CardOutline();
  const half = Mesh3D.Extrude(outline, 4);
  outline.delete();
  return new Model3D()
    .Part("front", half, "#FFFFFF").Scaled(CardScale, CardScale, CardScale).At(0, 0, 2 * CardScale)
    .Part("back", half, "#FFFFFF").Scaled(CardScale, CardScale, CardScale).Turned(0, 180, 0).At(0, 0, -2 * CardScale);
}

const CardFront = () => Painted(1024, 646, (c, w, h) => {
  const CK = Super.CK;
  c.drawRect(CK.XYWHRect(0, 0, w, h), Linear(0, 0, w, h, [Rgb(0x26, 0x1e, 0x5c), Rgb(0x7c, 0x6c, 0xf2), Rgb(0xff, 0x63, 0x84)]));
  // A soft white glow at the top right.
  const glow = Fill(CK.WHITE);
  const radial = CK.Shader.MakeRadialGradient([w * 0.84, h * 0.1], 330, [Rgb(255, 255, 255, 90), Rgb(255, 255, 255, 0)], null, CK.TileMode.Clamp);
  paints.push(radial);
  glow.setShader(radial);
  c.drawRect(CK.XYWHRect(0, 0, w, h), glow);
  // Two white rings and the name, top left; the tier, top right.
  const ring = Fill(CK.WHITE);
  ring.setStyle(CK.PaintStyle.Stroke);
  ring.setStrokeWidth(5);
  c.drawCircle(84, 92, 24, ring);
  c.drawCircle(114, 92, 24, ring);
  Text(c, "DRAWN REWARDS", 158, 106, 38, CK.WHITE);
  Text(c, "GOLD", w - 64, 108, 44, Rgb(0xff, 0xd6, 0x78), "Right");
  // The chip.
  c.drawRRect(CK.RRectXY(CK.XYWHRect(64, 196, 136, 104), 18, 18), Linear(64, 196, 200, 300, [Rgb(255, 222, 122), Rgb(255, 196, 61)]));
  const lines = Fill(Rgb(120, 80, 0, 130));
  lines.setStyle(CK.PaintStyle.Stroke);
  lines.setStrokeWidth(3);
  c.drawRRect(CK.RRectXY(CK.XYWHRect(98, 220, 68, 56), 10, 10), lines);
  c.drawLine(64, 248, 98, 248, lines);
  c.drawLine(166, 248, 200, 248, lines);
  Text(c, "4821  0730  5512  9046", 64, 420, 60, CK.WHITE);
  const dim = Rgb(255, 255, 255, 190);
  Text(c, "MEMBER", 64, 520, 24, dim);
  Text(c, "ALEX MORGAN", 64, 568, 40, CK.WHITE);
  Text(c, "VALID THRU", 700, 520, 24, dim);
  Text(c, "08/29", 700, 568, 40, CK.WHITE);
});

const CardBack = () => Painted(1024, 646, (c, w, h) => {
  const CK = Super.CK;
  c.drawRect(CK.XYWHRect(0, 0, w, h), Fill(Rgb(0x1e, 0x1a, 0x3e)));
  // The magnetic stripe.
  c.drawRect(CK.XYWHRect(0, 60, w, 112), Fill(Rgb(10, 10, 14)));
  // The signature strip and the CVV.
  c.drawRRect(CK.RRectXY(CK.XYWHRect(64, 226, 620, 84), 8, 8), Fill(Rgb(232, 228, 240)));
  Text(c, "Alex Morgan", 92, 282, 40, Rgb(52, 48, 84), "Left", true);
  c.drawRRect(CK.RRectXY(CK.XYWHRect(708, 226, 140, 84), 8, 8), Fill(CK.WHITE));
  Text(c, "123", 778, 282, 40, Rgb(30, 28, 52), "Center");
  Text(c, "12,480 points", 64, 420, 52, CK.WHITE);
  Text(c, "Show this card at checkout to collect points.", 64, 478, 30, Rgb(255, 255, 255, 200));
  Text(c, "drawnui.net", 64, h - 64, 34, Rgb(0xff, 0xd6, 0x78));
});

// ---- GalleryPage.Shapes.cs ----

const Gold = "#FFC43D";
const GoldLight = "#FFDE7A";
const Grey = "#C4C0CE";
const ConfettiColors = ["#FF6384", "#FFC43D", "#4CC98C", "#5C8CFF", "#B266FF"];

function Star(points: number, outer: number, inner: number): Path {
  const path = new Super.CK.PathBuilder();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (i * Math.PI * 2) / (points * 2) - Math.PI / 2;
    if (i === 0) path.moveTo(r * Math.cos(a), r * Math.sin(a));
    else path.lineTo(r * Math.cos(a), r * Math.sin(a));
  }
  path.close();
  return path.detachAndDelete();
}

function Heart(): Path {
  const path = new Super.CK.PathBuilder();
  path.moveTo(50, 88);
  path.cubicTo(20, 65, 0, 45, 0, 28);
  path.cubicTo(0, 12, 12, 0, 27, 0);
  path.cubicTo(38, 0, 46, 7, 50, 15);
  path.cubicTo(54, 7, 62, 0, 73, 0);
  path.cubicTo(88, 0, 100, 12, 100, 28);
  path.cubicTo(100, 45, 80, 65, 50, 88);
  path.close();
  return path.detachAndDelete();
}

/** A 3D mesh pushed out of a 2D path (the path is freed). */
function Extruded(path: Path, depth: number): Mesh3D {
  const mesh = Mesh3D.Extrude(path, depth);
  path.delete();
  return mesh;
}

/** A medal on two ribbons. */
const Medal = () => new Model3D()
  .Part("ribbon_left", Mesh3D.Cuboid(0.55, 1.5, 0.06), "#FF6384").At(-0.38, 1.05, -0.12).Turned(0, 0, 22)
  .Part("ribbon_right", Mesh3D.Cuboid(0.55, 1.5, 0.06), "#5C8CFF").At(0.38, 1.05, -0.12).Turned(0, 0, -22)
  .Part("disc", Mesh3D.Cylinder(1, 0.22), Gold).Turned(90, 0, 0)
  .Part("inner", Mesh3D.Cylinder(0.76, 0.34), GoldLight).Turned(90, 0, 0)
  .Part("star", Extruded(Star(5, 0.52, 0.22), 0.08), "#FFFFFF").At(0, 0, 0.2);

const HeartModel = () => new Model3D().Part("heart", Extruded(Heart(), 22), "#FF4D6D");

/** A strip of paper for the confetti; the part to recolor is "piece". */
const Paper = () => new Model3D().Part("piece", Mesh3D.Cuboid(1, 0.45, 0.06), "#FFFFFF");

const ConfettiStar = () => new Model3D().Part("piece", Extruded(Star(5, 0.6, 0.26), 0.12), "#FFFFFF");

// ---- GalleryPage.Loop.cs: types ----

/** A small random number generator: the same confetti and crowd every run (as the Rust gallery). */
class Dice {
  constructor(private state: number) {}
  Next(): number {
    this.state = (Math.imul(this.state, 1_664_525) + 1_013_904_223) >>> 0;
    return (this.state >>> 8) / (1 << 24);
  }
}

interface Piece { X: number; Y: number; Fall: number; Sway: number; Spin: number; Facing: number }
interface Walker { X: number; Y: number; Speed: number }

const PieceCount = 28;
const MaxMobs = 100;
// Object names made once: a frame formats no strings.
const PieceNames = Array.from({ length: PieceCount }, (_, i) => `c${i}`);
const MobNames = Array.from({ length: MaxMobs }, (_, i) => `m${i}`);

const EaseOut = (t: number) => 1 - Math.pow(1 - Clamp(t, 0, 1), 3);

/** Moves a control drawn over another to a point, skipping changes under a quarter point. */
function Move(control: SkiaControl, x: number, y: number): void {
  if (Math.abs(control.TranslationX - x) > 0.25 || Math.abs(control.TranslationY - y) > 0.25) {
    control.TranslationX = x;
    control.TranslationY = y;
    control.RepaintComposition();
  }
}

/** Shows or hides a control drawn over another (IsVisible is a plain field: the change asks for a layout). */
function Show(control: SkiaControl, visible: boolean): void {
  if (control.IsVisible === visible) return;
  control.IsVisible = visible;
  control.Update();
}

/**
 * Where 3D belongs in an app, inside a DrawnUI screen (the 3D add-on), the same gallery as DrawnUI for Rust's
 * gallery3d. The reasons an app adds 3D come first, the fun after, games last:
 * - a product viewer (a model from the app or from a link, turn, zoom, hotspots, colors);
 * - 3D thumbnails in a scrolling list;
 * - a card that flips;
 * - a globe with pins;
 * - a 3D mascot beside a plain sign-up form;
 * - micro-interactions (like, celebration, achievement), an image on a 3D box, models with their own animations,
 *   and a field of walking mobs drawn by one 3D layer.
 */
export class GalleryPage extends DrawnGame {
  private _scroll!: SkiaScroll;
  private _medal!: SkiaModel3D;
  private _heart!: SkiaModel3D;
  private _avatar!: SkiaModel3D;
  private _chest!: SkiaModel3D;
  private _rain!: SkiaScene3D;
  private _field!: SkiaScene3D;
  private _scenery!: Scenery;
  private _medalButton!: UiButton;
  private _likeButton!: UiButton;
  private _chestButton!: UiButton;
  private readonly _mobButtons: UiButton[] = [];
  private readonly _lookButtons: UiButton[] = [];
  private _drawnMobs = false;
  private _started = false;

  /** Layout changes that follow the page's width (the same thresholds as DrawnUI for Rust's gallery3d). */
  private readonly _adapt: ((width: number) => void)[] = [];
  private _width = -1;

  constructor() {
    super();
    this.HorizontalOptions = "Fill";
    this.VerticalOptions = "Fill";
    this.Children = [
      this._scroll = Make(new SkiaScroll(), {
        HorizontalOptions: "Fill",
        VerticalOptions: "Fill",
        Content: Make(new SkiaStack(), {
          Padding: new Thickness(24),
          Spacing: 20,
          Children: [
            Make(new SkiaStack(), {
              // As the page's own spacing in DrawnUI for Rust's gallery, where the caption is the title's sibling.
              Spacing: 20,
              UseCache: "Image",
              Children: [
                Make(new SkiaLabel(), { Text: "3D, made in the app", FontSize: 30, FontFamily: Theme.Title, TextColor: Theme.Ink, HorizontalOptions: "Center", AccessibilityRole: Aria.RoleHeading }),
                Make(new SkiaLabel(), {
                  Text: "Where 3D earns its place in an app: products, lists, cards, maps and forms first, then the fun.",
                  FontSize: 15, TextColor: Theme.Muted, HorizontalOptions: "Center", HorizontalTextAlignment: "Center",
                }),
              ],
            }),

            this.ViewerCard(),

            this.ListCard(),

            this.FlipCard(),

            this.GlobeCard(),

            this.FormCard(),

            Theme.Section("Micro-interactions", "Small 3D touches that answer a tap."),
            Make(new SkiaWrap(), {
              Spacing: 16,
              HorizontalOptions: "Center",
              Children: [
                GalleryPage.Tile("Like", "A heart that beats, and jumps when liked.",
                  this._heart = Make(GalleryPage.Shaded(HeartModel(), -24, 12), { Tapped3D: () => this.ToggleLike() }),
                  this._likeButton = Make(new UiButton("Unlike", Theme.Accent), { Tapped: () => this.ToggleLike() })),
                GalleryPage.Tile("Celebration", "Confetti and stars falling: one 3D layer, many pieces.",
                  this._rain = Make(new SkiaScene3D(), { Tilt: 20, HorizontalOptions: "Fill", VerticalOptions: "Fill" })
                    .Model("paper", Paper())
                    .Model("star", ConfettiStar()),
                  Make(new UiButton("Hooray", Theme.Accent), { Tapped: () => this.Hooray() })),
                GalleryPage.Tile("Achievement", "A medal that lights up and spins when unlocked.",
                  this._medal = Make(GalleryPage.Shaded(Medal(), MedalYaw, 12), { Tapped3D: () => this.SpinMedal() }),
                  this._medalButton = Make(new UiButton("Lock", Theme.Accent), { Tapped: () => this.ToggleMedal() })),
              ],
            }),

            Theme.Section("Images on 3D", "Any image on a 3D surface, switched live: drawn in code here, or a photo or a file."),
            this.ImagesSection(),

            Theme.Section("From model files", "Free 3D models with their own animations, driven by the app."),
            Make(new SkiaWrap(), {
              Spacing: 16,
              HorizontalOptions: "Center",
              Children: [
                GalleryPage.Tile("Avatar", "A character that idles, and waves when tapped.",
                  this._avatar = Make(new SkiaModel3D(Theme.Avatar), {
                    Animation: "CharacterArmature|Idle", Yaw: 25, Pitch: 10,
                    HorizontalOptions: "Fill", VerticalOptions: "Fill",
                    Tapped3D: (me) => { me.PlayOnce("CharacterArmature|Wave"); },
                  }),
                  Make(new UiButton("Wave", Theme.Accent), { Tapped: () => { this._avatar.PlayOnce("CharacterArmature|Wave"); } })),
                GalleryPage.Tile("Reward", "A chest that opens and closes.",
                  this._chest = Make(new SkiaModel3D(Theme.Chest), {
                    Animation: "Chest_Open", IsPlaying: false, Yaw: 30, Pitch: 20, Orbit: false,
                    HorizontalOptions: "Fill", VerticalOptions: "Fill",
                  }),
                  this._chestButton = Make(new UiButton("Open", Theme.Accent), { Tapped: () => this.ToggleChest() })),
              ],
            }),

            Theme.Section("Games", "Many 3D characters on one field, moved like sprites and drawn by one layer in one pass."),
            this.MobsCard(),
          ],
        }),
      }),
    ];
    this._mobs = 40;
    this.UpdateMobButtons();
    // C# ViewerCard().Initialize(...)
    this.SetFabric(0);
    this.LoadViewer(Source.App);
  }

  /** A card: title, caption, the 3D piece on its stage, the button that drives it. */
  private static Tile(title: string, caption: string, piece: SkiaControl, button: SkiaControl): SkiaShape {
    button.HorizontalOptions = "Center";
    return Make(new SkiaShape(), {
      WidthRequest: 300,
      // Holds a 3D piece that draws every frame: a recorded cache would be made again each frame.
      UseCache: "None",
      CornerRadius: 16,
      BackgroundColor: Theme.Card,
      StrokeColor: Theme.Line,
      StrokeWidth: 1,
      Padding: new Thickness(16),
      Children: [
        Make(new SkiaStack(), {
          Spacing: 10,
          Children: [
            Make(new SkiaStack(), {
              Spacing: 4,
              UseCache: "Image",
              Children: [
                Make(new SkiaLabel(), { Text: title, FontSize: 18, FontFamily: Theme.Title, TextColor: Theme.Ink, AccessibilityRole: Aria.RoleHeading }),
                Make(new SkiaLabel(), { Text: caption, FontSize: 13, TextColor: Theme.Muted, HeightRequest: 36 }),
              ],
            }),
            Make(GalleryPage.Stage(piece), { HeightRequest: RainHeight }),
            button,
          ],
        }),
      ],
    });
  }

  /** The rounded panel a 3D piece stands on. */
  private static Stage(piece: SkiaControl): SkiaShape {
    return Make(new SkiaShape(), {
      CornerRadius: 14,
      UseCache: "None",
      BackgroundColor: Theme.Stage,
      HorizontalOptions: "Fill",
      Children: [piece],
    });
  }

  /** The page's width decides how the cards arrange (C# OnMeasured). */
  protected override MeasureAbsolute(widthConstraint: number, heightConstraint: number, scale: number): ScaledSize {
    const width = widthConstraint / scale;
    if (width > 0 && isFinite(width) && width !== this._width) {
      this._width = width;
      for (const adapt of this._adapt) adapt(width);
    }
    return super.MeasureAbsolute(widthConstraint, heightConstraint, scale);
  }

  /**
   * A two-column card body: the 3D view (viewWidth x viewHeight) beside its panel; when the card is narrow, stacked,
   * the view on top at full width and its desktop proportions.
   */
  private TwoColumnCard(row: SkiaLayout, viewWidth: number, viewHeight: number): SkiaLayout {
    this._adapt.push((width) => {
      const wide = TwoColumns(width);
      row.Type = wide ? "Row" : "Column";
      row.HorizontalOptions = "Fill";
      const [view, side] = row.Children;
      view.WidthRequest = wide ? viewWidth : -1;
      view.HorizontalOptions = wide ? "Start" : "Fill";
      view.HeightRequest = wide ? viewHeight : Math.round((CardInner(width) * viewHeight) / viewWidth);
      side.WidthRequest = wide ? CardInner(width) - viewWidth - 24 : -1;
      side.HorizontalOptions = wide ? "Start" : "Fill";
      view.Update();
      side.Update();
      row.Update();
    });
    return row;
  }

  /**
   * A wide card for one demo: its title, a caption, and what it shows. A `still` card (its 3D at rest until touched:
   * the viewer, the card) is one GPU blit while the page scrolls or another card moves; a card whose 3D moves all the
   * time (globe, mascot, mobs) is drawn live, a cache would be made again each frame. The shop scrolls inside its card,
   * so it stays live too.
   */
  private WideCard(title: string, caption: string, content: SkiaControl, still = false): SkiaShape {
    content.Margin = new Thickness(0, 6, 0, 0);
    const card = Make(new SkiaShape(), {
      UseCache: still ? "GPU" : "None",
      CornerRadius: 16,
      BackgroundColor: Theme.Card,
      StrokeColor: Theme.Line,
      StrokeWidth: 1,
      Padding: new Thickness(20),
      HorizontalOptions: "Center",
      WidthRequest: WideWidth + 42,
      Children: [
        Make(new SkiaStack(), {
          Spacing: 10,
          Children: [
            Make(new SkiaStack(), {
              Spacing: 10,
              // Static text over a card that may redraw every frame: one blit (the still card's GPU cache holds it anyway).
              UseCache: still ? "None" : "Image",
              Children: [
                Make(new SkiaLabel(), { Text: title, FontSize: 20, FontFamily: Theme.Title, TextColor: Theme.Ink, AccessibilityRole: Aria.RoleHeading }),
                Make(new SkiaLabel(), { Text: caption, FontSize: 14, TextColor: Theme.Muted }),
              ],
            }),
            content,
          ],
        }),
      ],
    });
    // The page's width up to the desktop card.
    this._adapt.push((width) => { card.WidthRequest = Math.min(width - 2 * 24, WideWidth + 42); card.Update(); });
    return card;
  }

  /**
   * A piece made in code in real 3D (the default Lit look: shaded by a light with a sky ambient, in perspective),
   * turned so its depth shows; still unless the app moves it.
   */
  private static Shaded(model: Model3D, yaw: number, pitch: number): SkiaModel3D {
    return Make(new SkiaModel3D(model), { Orbit: false, Yaw: yaw, Pitch: pitch, HorizontalOptions: "Fill", VerticalOptions: "Fill" });
  }

  private MobsCard(): SkiaControl {
    const field = Make(new SkiaShape(), {
      HorizontalOptions: "Fill",
      MaximumWidthRequest: FieldWidth,
      HeightRequest: FieldHeight,
      UseCache: "None",
      CornerRadius: 10,
      Children: [
        Make(new RescalingLayout(), {
          LogicalWidth: FieldWidth,
          LogicalHeight: FieldHeight,
          Children: [
            // A side-scroller scene behind the mobs, its layers moving at their own pace.
            this._scenery = Make(new Scenery(), { HorizontalOptions: "Fill", VerticalOptions: "Fill" }),
            this._field = Make(new SkiaScene3D(), {
              Tilt: 30,
              HorizontalOptions: "Fill", VerticalOptions: "Fill",
              Tapped3D: (me, hit) => { me.PlayOnce(hit.Object, "CharacterArmature|HitRecieve"); },
            }).Model("slime", Theme.Mob),
          ],
        }),
      ],
    });
    // The whole field scaled down to the card when the card is narrower than it.
    this._adapt.push((width) => { field.HeightRequest = Math.round((FieldHeight * Math.min(CardInner(width), FieldWidth)) / FieldWidth); field.Update(); });
    return this.WideCard("Mobs on a 2D field",
      "Many 3D monsters from one model, moved like sprites and drawn by one layer in one pass. Tap one to hit it.", Make(new SkiaStack(), {
        Spacing: 10,
        Children: [
          field,
          Make(new SkiaWrap(), {
            Spacing: 8,
            AccessibilityRole: Aria.RoleRadioGroup,
            AccessibilityLabel: "Mobs on the field",
            Children: [
              ...MobCounts.map((n, i) => this._mobButtons[i] = Make(new UiButton(`${n} mobs`, Theme.Quiet, 110), {
                AccessibilityRole: Aria.RoleRadio,
                Tapped: () => this.SetMobs(n),
              })),
              // How they look, switched in place: a segmented 3D | Drawn on a plate (as DrawnUI for Rust).
              Make(new SkiaShape(), {
                CornerRadius: 12,
                BackgroundColor: Theme.Stage,
                Padding: new Thickness(3),
                Margin: new Thickness(8, 0, 0, 0),
                AccessibilityRole: Aria.RoleRadioGroup,
                AccessibilityLabel: "Look",
                Children: [
                  Make(new SkiaRow(), {
                    Spacing: 3,
                    Children: [
                      this._lookButtons[0] = Make(new UiButton("3D", Theme.Quiet, 90), { AccessibilityRole: Aria.RoleRadio, Tapped: () => this.SetDrawnMobs(false) }),
                      this._lookButtons[1] = Make(new UiButton("Drawn", Theme.Quiet, 90), { AccessibilityRole: Aria.RoleRadio, Tapped: () => this.SetDrawnMobs(true) }),
                    ],
                  }),
                ],
              }),
            ],
          }),
        ],
      }));
  }

  protected override OnLayoutChanged(): void {
    super.OnLayoutChanged();
    if (this._started) return;
    this._started = true;
    // The pins' first placement makes the globe's ray tree (hidden pins are found by a ray): done now, while the
    // page opens, and not in the frame the globe scrolls into view.
    this.PlacePins();
    this.StartLoop();
  }

  private SpinMedal(): void { this._spin = 0; }

  private MedalColors(): void {
    this._medal.SetMaterialColor("disc", this._unlocked ? undefined : Grey);
    this._medal.SetMaterialColor("inner", this._unlocked ? undefined : "#DEDBE6");
    this._medal.SetMaterialColor("star", this._unlocked ? undefined : "#F4F2F8");
  }

  private ToggleMedal(): void {
    this._unlocked = !this._unlocked;
    this._medalButton.Text = this._unlocked ? "Lock" : "Unlock";
    this.MedalColors();
    if (this._unlocked) {
      this._spin = 0;
      this._medal.Scale = 0.6;
      this._medal.RepaintComposition();
      void this._medal.ScaleToAsync(1, 1, 500, Easing.SpringOut);
    }
  }

  private ToggleLike(): void {
    this._liked = !this._liked;
    this._pop = this._liked ? 1 : 0;
    this._heart.SetMaterialColor("heart", this._liked ? undefined : Grey);
    this._likeButton.Text = this._liked ? "Unlike" : "Like";
  }

  private Hooray(): void {
    // A fresh shower: every piece starts again above the tile.
    for (const p of this._pieces) p.Y = -12 - this._dice.Next() * RainHeight;
  }

  private ToggleChest(): void {
    this._open = !this._open;
    this._chest.Hold(this._open ? "Chest_Open" : "Chest_Close");
    this._chestButton.Text = this._open ? "Close" : "Open";
  }

  SetMobs(n: number): void {
    this._mobs = n;
    this.UpdateMobButtons();
  }

  private UpdateMobButtons(): void {
    MobCounts.forEach((n, i) => {
      const on = n === this._mobs;
      this._mobButtons[i].Fill = on ? Theme.Accent : Theme.Quiet;
      this._mobButtons[i].AccessibilityIsPressed = on;
    });
    this._lookButtons.forEach((button, i) => {
      const on = (i === 1) === this._drawnMobs;
      button.Fill = on ? Theme.Accent : Theme.Quiet;
      button.AccessibilityIsPressed = on;
    });
  }

  /** The mobs as lit 3D models, or drawn as a cartoon. */
  SetDrawnMobs(drawn: boolean): void {
    this._drawnMobs = drawn;
    this._field.Look = drawn ? Look.Toon : Look.Lit;
    this._field.OutlineWidth = drawn ? DrawnOutline : 0;
    this._field.OutlineColor = DrawnInk;
    this.UpdateMobButtons();
  }

  // ---- GalleryPage.Viewer.cs ----
  //
  // The product viewer: a walnut sofa (Poly Haven, CC0) shipped in the app or loaded from the site by its address (a
  // placeholder while it loads, an error card when it cannot), turned by dragging, zoomed by pinch or wheel, reset by a
  // double tap; dots anchored to points of the sofa open a note on that part; the upholstery swatches put another
  // fabric image on the sofa (SetMaterialImage) with its own shine (SetMaterialRoughness) and its own price. The same
  // files, points and strings as DrawnUI for Rust's gallery3d.

  private readonly _fabrics = Fabrics();
  /** The fabric images, decoded once. */
  private _fabricImages?: (Texture3D | undefined)[];
  private _viewerHost!: SkiaLayer;
  private _loading!: SkiaLayer;
  private _failed!: SkiaLayer;
  private _viewer?: SkiaModel3D;
  private _failedText!: SkiaLabel;
  private _price!: SkiaLabel;
  private _note!: SkiaShape;
  private _noteTitle!: SkiaLabel;
  private _noteText!: SkiaLabel;
  private readonly _pins: SkiaShape[] = [];
  private readonly _sourceButtons: UiButton[] = [];
  private readonly _swatches: SkiaShape[] = [];
  private _fabric = -1;
  private _openSpot = -1;
  private _source = Source.App;
  /** The note's height when it was placed: a note shown for the first time is measured in the next frame. */
  private _noteHeight = 0;

  private ViewerCard(): SkiaControl {
    return this.WideCard("Product viewer", "A real product model on a shop page: turn it, zoom in, tap the dots, pick a fabric.", this.TwoColumnCard(Make(new SkiaRow(), {
      Spacing: 24,
      Children: [
        Make(new SkiaShape(), {
          CornerRadius: 14,
          // At rest the sofa shows its last render and the dots stand still: one GPU blit. Turning, zooming or a
          // note draws it again.
          UseCache: "GPU",
          BackgroundColor: Theme.Stage,
          WidthRequest: ViewerWidth,
          HeightRequest: ViewerHeight,
          Children: [
            this._viewerHost = Make(new SkiaLayer(), { VerticalOptions: "Fill" }),
            // The dots and the note follow their points of the model.
            Make(new SkiaLayer(), {
              VerticalOptions: "Fill",
              Children: [...Hotspots.map(([name], i) => this.Pin(i, name)), this.Note()],
            }),
            Make(new SkiaLabel(), {
              Text: "Drag to turn  ·  pinch or Ctrl+scroll to zoom  ·  double-tap to reset",
              FontSize: 12, TextColor: Theme.Muted, Margin: new Thickness(0, 0, 0, 12),
              HorizontalOptions: "Center", VerticalOptions: "End", InputTransparent: true,
            }),
            this._loading = GalleryPage.Loading(),
            this._failed = this.Failed(),
          ],
        }),
        Make(new SkiaStack(), {
          Spacing: 14,
          WidthRequest: WideWidth - ViewerWidth - 24,
          Children: [
            // Uncached: the price counts. Its box is the stack's width, so a new price never lays the page out again.
            Make(new SkiaStack(), {
              Spacing: 2,
              Children: [
                Make(new SkiaLabel(), { Text: "Walnut sofa", FontSize: 24, FontFamily: Theme.Title, TextColor: Theme.Ink, AccessibilityRole: Aria.RoleHeading }),
                Make(new SkiaLabel(), { Text: "Three-seater, carved walnut frame", FontSize: 13, TextColor: Theme.Muted }),
                this._price = Make(new SkiaLabel(), {
                  Text: Dollars(this._fabrics[0][4]),
                  FontSize: 18, FontFamily: Theme.Title, TextColor: Theme.Gold, Margin: new Thickness(0, 6, 0, 0),
                  HorizontalOptions: "Fill", AccessibilityRole: Aria.RoleText, AccessibilityLive: Aria.LivePolite,
                }),
              ],
            }),
            Make(new SkiaStack(), {
              Spacing: 14,
              // Still beside a stage that draws every frame: blitted, drawn again only when a choice changes.
              UseCache: "Image",
              Children: [
                GalleryPage.PanelLabel("FABRIC"),
                Make(new SkiaWrap(), {
                  Spacing: 10,
                  AccessibilityRole: Aria.RoleRadioGroup,
                  AccessibilityLabel: "Upholstery",
                  Children: this._fabrics.map(([name, , , swatch, price], i) => Make(new SkiaStack(), {
                    Spacing: 4,
                    WidthRequest: 60,
                    Children: [
                      this._swatches[i] = Make(GalleryPage.Swatch(`${name}, ${Dollars(price)}`, swatch), { Tapped: () => this.SetFabric(i) }),
                      Make(new SkiaLabel(), { Text: name, FontSize: 12, TextColor: Theme.Muted, HorizontalOptions: "Center", AccessibilityRole: Aria.RolePresentation }),
                    ],
                  })),
                }),
                GalleryPage.PanelLabel("MODEL"),
                Make(new SkiaWrap(), {
                  Spacing: 8,
                  AccessibilityRole: Aria.RoleRadioGroup,
                  AccessibilityLabel: "Load the model",
                  Children: Sources.map(([source, caption], i) => this._sourceButtons[i] = Make(new UiButton(caption, Theme.Quiet, -1), {
                    AccessibilityRole: Aria.RoleRadio,
                    Tapped: () => this.LoadViewer(source),
                  })),
                }),
                Make(new UiButton("Reset view", Theme.Quiet, 140), {
                  AccessibilityHint: "Turns the sofa back to the front",
                  Tapped: () => this._viewer?.ResetView(),
                }),
              ],
            }),
          ],
        }),
      ],
    }), ViewerWidth, ViewerHeight), true);
  }

  private static PanelLabel(text: string): SkiaLabel {
    return Make(new SkiaLabel(), { Text: text, FontSize: 12, FontFamily: Theme.Title, TextColor: Theme.Muted, Margin: new Thickness(0, 8, 0, -6), CharacterSpacing: 1.5 });
  }

  /** A dot on a part of the model: tap it for the part's note. */
  private Pin(index: number, name: string): SkiaShape {
    return this._pins[index] = Make(new SkiaShape(), {
      Type: "Circle",
      WidthRequest: PinSize,
      HeightRequest: PinSize,
      BackgroundColor: "#FFFFFF",
      StrokeColor: Theme.Accent,
      StrokeWidth: 3,
      // Shown while its point faces the eye: hidden, it is out of taps and screen readers too.
      IsVisible: false,
      AccessibilityRole: Aria.RoleButton,
      AccessibilityLabel: `${name}, hotspot`,
      AccessibilityHint: "Shows a note about this part",
      Shadows: [new SkiaShadow({ Blur: 4, Y: 2, Opacity: 0.35, Color: "#000000" })],
      Children: [
        Make(new SkiaLabel(), {
          Text: `${index + 1}`, FontSize: 12, FontFamily: Theme.Title, TextColor: Theme.Accent,
          HorizontalOptions: "Center", VerticalOptions: "Center", AccessibilityRole: Aria.RolePresentation,
        }),
      ],
      HoverChanged: (me, on) => { me.BackgroundColor = on ? Theme.Lighter(Theme.Accent, 0.75) : "#FFFFFF"; me.UpdateDraw(); },
      Tapped: () => this.ToggleNote(index),
    });
  }

  /** The note a dot opens, above its point. */
  private Note(): SkiaShape {
    return this._note = Make(new SkiaShape(), {
      CornerRadius: 10,
      BackgroundColor: Theme.Header,
      StrokeColor: Theme.Line,
      StrokeWidth: 1,
      Padding: new Thickness(12, 9),
      WidthRequest: NoteWidth,
      IsVisible: false,
      InputTransparent: true,
      Shadows: [new SkiaShadow({ Blur: 10, Y: 4, Opacity: 0.4, Color: "#000000" })],
      Children: [
        Make(new SkiaStack(), {
          Spacing: 2,
          Children: [
            this._noteTitle = Make(new SkiaLabel(), { FontSize: 14, FontFamily: Theme.Title, TextColor: Theme.Ink }),
            this._noteText = Make(new SkiaLabel(), { FontSize: 13, TextColor: Theme.Muted }),
          ],
        }),
      ],
    });
  }

  /** The placeholder while the model loads: a spinning ring and a line. */
  private static Loading(): SkiaLayer {
    const ring = Make(new SkiaShape(), {
      Type: "Arc", WidthRequest: 44, HeightRequest: 44, StrokeWidth: 4,
      StrokeColor: Theme.Accent, Value1: 0, Value2: 270, StrokeCap: "Round",
      HorizontalOptions: "Center",
    });
    // C# AnimateRotation(0, 360, seconds: 0.9, repeat: -1): paused by the engine while the placeholder is hidden.
    const spin = new SkiaValueAnimator(ring);
    Object.assign(spin, { mMinValue: 0, mMaxValue: 360, Speed: 900, Repeat: -1 });
    spin.OnUpdated = (degrees) => { ring.Rotation = degrees; ring.RepaintComposition(); };
    spin.Start();
    return Make(new SkiaLayer(), {
      VerticalOptions: "Fill",
      BackgroundColor: Theme.Stage,
      IsVisible: false,
      Children: [
        Make(new SkiaStack(), {
          Spacing: 14,
          HorizontalOptions: "Center",
          VerticalOptions: "Center",
          Children: [
            ring,
            Make(new SkiaLabel(), { Text: "Loading the sofa…", FontSize: 14, TextColor: Theme.Muted, HorizontalOptions: "Center", AccessibilityRole: Aria.RoleText, AccessibilityLive: Aria.LivePolite }),
          ],
        }),
      ],
    });
  }

  /** The card shown when the model could not be loaded, with a way back. */
  private Failed(): SkiaLayer {
    return Make(new SkiaLayer(), {
      VerticalOptions: "Fill",
      BackgroundColor: Theme.Stage,
      IsVisible: false,
      Children: [
        Make(new SkiaStack(), {
          Spacing: 10,
          HorizontalOptions: "Center",
          VerticalOptions: "Center",
          WidthRequest: 340,
          Children: [
            Make(new SkiaShape(), {
              Type: "Circle", WidthRequest: 48, HeightRequest: 48, BackgroundColor: "#2EFF6384",
              HorizontalOptions: "Center",
              Children: [
                Make(new SkiaLabel(), { Text: "!", FontSize: 24, FontFamily: Theme.Title, TextColor: Theme.Bad, HorizontalOptions: "Center", VerticalOptions: "Center", AccessibilityRole: Aria.RolePresentation }),
              ],
            }),
            Make(new SkiaLabel(), {
              Text: "The model could not be loaded",
              FontSize: 16, FontFamily: Theme.Title, TextColor: Theme.Ink, HorizontalOptions: "Center",
              AccessibilityRole: Aria.RoleText, AccessibilityLive: Aria.LivePolite,
            }),
            this._failedText = Make(new SkiaLabel(), { FontSize: 13, TextColor: Theme.Muted, HorizontalOptions: "Center", HorizontalTextAlignment: "Center" }),
            Make(new UiButton("Use the app's copy", Theme.Accent, 180), {
              Margin: new Thickness(0, 6, 0, 0),
              HorizontalOptions: "Center",
              Tapped: () => this.LoadViewer(Source.App),
            }),
          ],
        }),
      ],
    });
  }

  /** A round swatch: a ring shows the chosen one. */
  private static Swatch(name: string, color: Color): SkiaShape {
    return Make(new SkiaShape(), {
      Type: "Circle",
      WidthRequest: 44,
      HeightRequest: 44,
      StrokeWidth: 3,
      StrokeColor: "#00000000",
      Padding: new Thickness(5),
      HorizontalOptions: "Center",
      AccessibilityRole: Aria.RoleRadio,
      AccessibilityLabel: name,
      Children: [Make(new SkiaShape(), { Type: "Circle", BackgroundColor: color, HorizontalOptions: "Fill", VerticalOptions: "Fill" })],
      HoverChanged: (me, on) => { me.BackgroundColor = on ? Theme.Lighter(Theme.Card, 0.12) : "#00000000"; me.UpdateDraw(); },
    });
  }

  private SetFabric(index: number): void {
    this._fabric = index;
    this._swatches.forEach((swatch, i) => {
      swatch.StrokeColor = i === index ? Theme.Ink : "#00000000";
      swatch.AccessibilityIsPressed = i === index;
      swatch.UpdateDraw();
    });
    this.Dress(this._viewer);
  }

  /** The price on the label, counting to the chosen fabric's. */
  private _priceShown = this._fabrics[0][4];

  /** Each frame: the price counts to the chosen fabric's at 2,800 dollars a second (Linen to Leather in a quarter second). */
  private PriceFrame(delta: number): void {
    const target = this._fabrics[Math.max(this._fabric, 0)][4];
    if (this._priceShown === target) return;
    const step = Math.sign(target - this._priceShown) * Math.max(700 * 4 * delta, 1);
    this._priceShown = Math.abs(target - this._priceShown) <= Math.abs(step) ? target : this._priceShown + step;
    this._price.Text = Dollars(Math.round(this._priceShown));
  }

  /** The upholstery's image and shine for the chosen fabric. */
  private Dress(sofa: SkiaModel3D | undefined): void {
    if (!sofa || this._fabric < 0) return;
    this._fabricImages ??= this._fabrics.map(([, image]) => Texture3D.Decode(image));
    sofa.SetMaterialImage("upholstery", this._fabricImages[this._fabric]);
    sofa.SetMaterialColor("upholstery", "#FFFFFF");
    sofa.SetMaterialRoughness("upholstery", this._fabrics[this._fabric][2]);
  }

  private ToggleNote(index: number): void {
    this._openSpot = this._openSpot === index ? -1 : index;
    this._pins.forEach((pin, i) => { pin.AccessibilityIsPressed = i === this._openSpot; });
    if (this._openSpot >= 0) {
      this._noteTitle.Text = Hotspots[index][0];
      this._noteText.Text = Hotspots[index][1];
    }
    this.PlaceSpots();
  }

  /** Shows the sofa from where the buttons say: from the app at once, from an address through its loading states. */
  private LoadViewer(source: Source): void {
    this._source = source;
    Sources.forEach(([s], i) => {
      const on = s === source;
      this._sourceButtons[i].Fill = on ? Theme.Accent : Theme.Quiet;
      this._sourceButtons[i].AccessibilityIsPressed = on;
    });
    const sofa = Make(new SkiaModel3D(source === Source.App ? Theme.Sofa : undefined), {
      Yaw: 28,
      Pitch: 14,
      Zoom: 0.95,
      PinchZoom: true,
      MinZoom: 0.55,
      MaxZoom: 1.8,
      ResetOnDoubleTap: true,
      Antialias: true,
      HorizontalOptions: "Fill",
      VerticalOptions: "Fill",
      ViewChanged: () => this.PlaceSpots(),
      LoadStateChanged: (me, state) => {
        if (me !== this._viewer) return;
        this.ShowLoadState(state, me.Error);
        if (state === LoadState3D.Ready) this.Dress(me);
      },
    });
    this.Dress(sofa);
    this.ShowViewer(sofa);
    this.ShowLoadState(sofa.LoadState, sofa.Error);
    if (source !== Source.App) sofa.Source = source === Source.Link ? SofaUrl : BrokenUrl;
  }

  private ShowLoadState(state: LoadState3D, error: string | undefined): void {
    Show(this._loading, state === LoadState3D.Loading);
    Show(this._failed, state === LoadState3D.Failed);
    if (state === LoadState3D.Failed)
      this._failedText.Text = `${this._source === Source.Broken ? BrokenUrl : SofaUrl}: ${error}.\nCheck the link, or show the copy shipped with the app.`;
    this.PlaceSpots();
  }

  private ShowViewer(model: SkiaModel3D): void {
    const old = this._viewer;
    if (old) {
      this._viewerHost.RemoveSubView(old);
      // Its GPU frame is freed with the frame's other disposals.
      if (this.Superview) this.Superview.DisposeObject(old); else old.Dispose();
    }
    this._viewer = model;
    this._viewerHost.AddSubView(model);
    this._openSpot = -1;
    for (const pin of this._pins) pin.AccessibilityIsPressed = false;
    this.PlaceSpots();
  }

  /** The dots and the open note go where their points of the sofa show (when its view moves, and on changes). */
  private PlaceSpots(): void {
    const viewer = this._viewer;
    const ready = viewer?.LoadState === LoadState3D.Ready;
    for (let i = 0; i < Hotspots.length; i++) {
      const pin = this._pins[i];
      const at = ready ? viewer!.ScreenPosition(Hotspots[i][2]) : undefined;
      const shown = !!at && !at.Occluded;
      Show(pin, shown);
      if (shown) Move(pin, at!.X - PinSize / 2, at!.Y - PinSize / 2);
      if (i !== this._openSpot) continue;
      Show(this._note, shown);
      if (!shown) continue;
      const height = this._noteHeight = this._note.MeasuredSize.Units.Height;
      Move(this._note, Clamp(at!.X - NoteWidth / 2, 8, ViewerWidth - NoteWidth - 8), Math.max(8, at!.Y - PinSize / 2 - height - 8));
    }
    if (this._openSpot < 0) Show(this._note, false);
  }

  // ---- GalleryPage.List.cs ----
  //
  // 3D in a scrolling list: thirty product rows, each with a small 3D thumbnail; the row under the mouse turns its
  // model. A still thumbnail is shown again from its last render (no 3D pass while the list scrolls) and a row the list
  // does not draw (off screen) costs nothing. A sideways drag on a thumbnail turns it, a vertical one scrolls the list.

  private _listScroll!: SkiaScroll;
  private _listCount!: SkiaLabel;
  private readonly _thumbs: SkiaModel3D[] = [];
  private _thumbsDrawn = -1;

  private ListCard(): SkiaControl {
    const pieces = Pieces();
    const header = Make(new SkiaRow(), {
      HorizontalOptions: "Fill",
      Children: [
        Make(new SkiaLabel(), { Text: "Shop", FontSize: 18, FontFamily: Theme.Title, TextColor: Theme.Ink, AccessibilityRole: Aria.RoleHeading }),
        // Changes while the list scrolls: a fixed box. Not IsParentIndependent as in C#: in React a stack does not
        // re-measure such a child on draw, so its new text would never show (reported to the engine's owner).
        this._listCount = Make(new SkiaLabel(), {
          FontSize: 13, TextColor: Theme.Muted, HorizontalOptions: "End", VerticalOptions: "Center",
          WidthRequest: 320, HeightRequest: 20, HorizontalTextAlignment: "End",
        }),
      ],
    });
    // Narrow, the count goes under the title.
    this._adapt.push((width) => { header.Type = CardInner(width) >= RowBesideMin ? "Row" : "Wrap"; header.Update(); });
    return this.WideCard("3D in a scrolling list", "Thirty pieces of furniture, each with a live 3D thumbnail: point at a row to turn it, or drag a thumbnail sideways. Rows off screen draw nothing.", Make(new SkiaStack(), {
      Spacing: 10,
      Children: [
        header,
        Make(new SkiaShape(), {
          CornerRadius: 12,
          UseCache: "None",
          BackgroundColor: Theme.Page,
          HeightRequest: ListHeight,
          HorizontalOptions: "Fill",
          Children: [
            this._listScroll = Make(new SkiaScroll(), {
              HorizontalOptions: "Fill",
              VerticalOptions: "Fill",
              // Where the list is and how much is left, shown at rest too (the list scrolls); the thumb can be dragged.
              ScrollBar: Make(new SkiaScrollBar(), { IsDraggable: true, Thickness: 6, AutoHide: false }),
              ScrollBarThumbColor: Theme.Muted,
              ScrollBarTrackColor: "#12FFFFFF",
              Content: Make(new SkiaStack(), {
                Spacing: 2,
                // room for the scroll bar at the right edge
                Padding: new Thickness(0, 0, 10, 0),
                AccessibilityRole: Aria.RoleList,
                AccessibilityLabel: "Products",
                Children: Array.from({ length: ListRows }, (_, i) => this.ProductRow(i, pieces)),
              }),
            }),
          ],
        }),
      ],
    }));
  }

  /** One row: the 3D thumbnail, name and detail, price, the cart button. */
  private ProductRow(index: number, pieces: ReturnType<typeof Pieces>): SkiaControl {
    const [file, pieceName, detail, basePrice] = pieces[index % pieces.length];
    const [finishName, tint, extra] = Finishes[Math.floor(index / pieces.length) % Finishes.length];
    const large = index >= 15;
    const name = `${pieceName}, ${finishName}`;
    const price = basePrice + extra + (large ? 120 : 0);
    const model = Make(new SkiaModel3D(file), {
      Yaw: 32,
      Pitch: 14,
      LockPitch: true,
      HorizontalOptions: "Fill",
      VerticalOptions: "Fill",
    });
    // Each piece is one material (the sofa: its upholstery first): the finish tints it.
    if (tint && model.MaterialNames.length > 0) model.SetMaterialColor(model.MaterialNames[0], tint);
    this._thumbs[index] = model;
    let added = false;
    const row = Make(new SkiaRow(), {
      MinimumHeightRequest: RowHeight,
      HorizontalOptions: "Fill",
      Spacing: 16,
      Padding: new Thickness(12, 8),
      // A still row (its thumbnail shows its last render) is one GPU blit, also while the list scrolls; the row under
      // the mouse is drawn again while its model turns.
      UseCache: "GPU",
      AccessibilityRole: Aria.RoleListItem,
      AccessibilityLabel: `${name}, ${Dollars(price)}`,
      Children: [
        Make(new SkiaShape(), {
          CornerRadius: 10,
          BackgroundColor: Theme.Stage,
          WidthRequest: ThumbSize,
          HeightRequest: ThumbSize,
          VerticalOptions: "Center",
          Children: [model],
        }),
        Make(new SkiaStack(), {
          Spacing: 2,
          VerticalOptions: "Center",
          Children: [
            Make(new SkiaLabel(), { Text: name, FontSize: 15, TextColor: Theme.Ink }),
            Make(new SkiaLabel(), { Text: large ? `${detail} · large` : detail, FontSize: 12, TextColor: Theme.Muted }),
            Make(new SkiaLabel(), { Text: Dollars(price), FontSize: 14, TextColor: Theme.Gold }),
          ],
        }),
        Make(new UiButton("Add", Theme.Accent, 120), {
          AccessibilityLabel: `Add ${name} to the cart`, HorizontalOptions: "End", VerticalOptions: "Center",
          Tapped: (me) => {
            const button = me as UiButton;
            added = !added;
            button.Text = added ? "In the cart" : "Add";
            button.AccessibilityLabel = added ? `Remove ${name} from the cart` : `Add ${name} to the cart`;
            button.Fill = added ? Theme.Stage : Theme.Accent;
          },
        }),
      ],
      // The row under the mouse turns its piece; the others stay still and are only blitted.
      HoverChanged: (_, on) => { model.AutoRotate = on ? 40 : 0; },
    });
    // Narrow, the button goes under the text.
    this._adapt.push((width) => { row.Type = CardInner(width) >= RowBesideMin ? "Row" : "Wrap"; row.Update(); });
    return row;
  }

  /** Each frame: how many thumbnails are on screen now, shown above the list (the rest cost nothing). */
  private ListFrame(): void {
    if (!WasInLastFrame(this._listScroll)) return;
    // Drawn by the list, and inside the page's window too (a row below the window's edge is drawn but not seen).
    const window = this._scroll.GetAccessibilityPixelRect();
    let drawn = 0;
    for (const thumb of this._thumbs) {
      if (!WasInLastFrame(thumb)) continue;
      const r = thumb.GetAccessibilityPixelRect();
      if (r.Left < window.Right && r.Right > window.Left && r.Top < window.Bottom && r.Bottom > window.Top) drawn++;
    }
    if (drawn === this._thumbsDrawn) return;
    this._thumbsDrawn = drawn;
    this._listCount.Text = `3D thumbnails drawn now: ${drawn} of ${ListRows}`;
  }

  // ---- GalleryPage.Card.cs ----
  //
  // Card flip: a loyalty card in 3D, its front and back drawn in code with Skia. It leans toward the pointer (or the
  // finger) and turns over with a smooth half turn on a tap or the Flip button.

  private _card!: SkiaModel3D;
  private _flipButton!: UiButton;
  private _flipped = false;
  /** The half turn: where it is and where it goes (0 = front, 180 = back), degrees. */
  private _cardTurn = 0;
  private _cardTurnTo = 0;

  private FlipCard(): SkiaControl {
    this._card = Make(new SkiaModel3D(CardModel()), {
      Orbit: false,
      Yaw: 0,
      Pitch: 0,
      Zoom: 0.74,
      // Leans toward the mouse or the finger, up to 14 degrees at the stage's edge.
      TiltToPointer: 14,
      Antialias: true,
      HorizontalOptions: "Fill",
      VerticalOptions: "Fill",
      Tapped3D: () => this.Flip(),
    });
    this._card.SetMaterialImage("front", CardFront());
    this._card.SetMaterialImage("back", CardBack());
    return this.WideCard("Card flip", "A loyalty card in 3D: it leans toward the pointer and turns over to show its back.", this.TwoColumnCard(Make(new SkiaRow(), {
      Spacing: 24,
      Children: [
        // Still between moves (the card shows its last render): one GPU blit.
        Make(GalleryPage.Stage(this._card), { WidthRequest: ViewerWidth, HeightRequest: ViewerHeight, UseCache: "GPU" }),
        Make(new SkiaStack(), {
          Spacing: 14,
          // Still beside a stage that draws every frame: blitted, drawn again only when a choice changes.
          UseCache: "Image",
          WidthRequest: WideWidth - ViewerWidth - 24,
          VerticalOptions: "Center",
          Children: [
            Make(new SkiaStack(), {
              Spacing: 4,
              UseCache: "Image",
              Children: [
                Make(new SkiaLabel(), { Text: "Drawn Rewards Gold", FontSize: 24, FontFamily: Theme.Title, TextColor: Theme.Ink, AccessibilityRole: Aria.RoleHeading }),
                Make(new SkiaLabel(), { Text: "12,480 points · member since 2021", FontSize: 14, TextColor: Theme.Muted }),
                Make(new SkiaLabel(), { Text: "Both faces are images drawn in code with Skia and put on the card's two halves.", FontSize: 13, TextColor: Theme.Muted, Margin: new Thickness(0, 10, 0, 0) }),
              ],
            }),
            this._flipButton = Make(new UiButton("Show the back", Theme.Accent, 160), {
              AccessibilityHint: "Turns the card over",
              Tapped: () => this.Flip(),
            }),
          ],
        }),
      ],
    }), ViewerWidth, ViewerHeight), true);
  }

  private Flip(): void {
    this._flipped = !this._flipped;
    this._cardTurnTo = this._flipped ? 180 : 0;
    this._flipButton.Text = this._flipped ? "Show the front" : "Show the back";
  }

  /** Each frame: the half turn eases toward its side (the view's home yaw: the lean toward the pointer stays on top). */
  private CardFrame(delta: number): void {
    if (this._cardTurn === this._cardTurnTo || !WasInLastFrame(this._card)) return;
    // About half a second for the half turn, slowing into its side.
    this._cardTurn += (this._cardTurnTo - this._cardTurn) * Math.min(1, delta * 7);
    if (Math.abs(this._cardTurnTo - this._cardTurn) < 0.05) this._cardTurn = this._cardTurnTo;
    this._card.Yaw = this._cardTurn;
  }

  // ---- GalleryPage.Globe.cs ----
  //
  // The globe: NASA's Blue Marble on a sphere, turning slowly by itself and by drag. Map pins (a glossy teardrop with a
  // pulse ring) stay on their cities, hide when their city turns to the far side, and show a name chip when tapped;
  // picking a city in the list turns the globe to it. The same look and numbers as DrawnUI for Rust's gallery3d.

  private _globe!: SkiaModel3D;
  private _spinButton!: UiButton;
  private readonly _cityPins: SkiaLayer[] = [];
  private readonly _pulses: SkiaShape[] = [];
  private readonly _cityLabels: SkiaShape[] = [];
  private readonly _cityButtons: UiButton[] = [];
  private _openCity = -1;
  private _spinning = true;
  /** A glide to a city: 0 to 1 while it runs, and the turn it goes from and to. */
  private _globeGlide = 1;
  private _globeFromYaw = 0;
  private _globeFromPitch = 0;
  private _globeToYaw = 0;
  private _globeToPitch = 0;

  private GlobeCard(): SkiaControl {
    this._globe = Make(new SkiaModel3D(new Model3D().Part("earth", Mesh3D.Sphere(1), "#FFFFFF")), {
      Yaw: -20,
      Pitch: 15,
      Zoom: 0.9,
      AutoRotate: 10,
      PinchZoom: true,
      MinZoom: 0.6,
      MaxZoom: 1.6,
      ResetOnDoubleTap: true,
      Antialias: true,
      HorizontalOptions: "Fill",
      VerticalOptions: "Fill",
      ViewChanged: () => this.PlacePins(),
    });
    this._globe.SetMaterialImage("earth", Texture3D.Decode(Theme.Earth));
    return this.WideCard("Globe with pins", "Drag the Earth to turn it. Pins stay on their cities and hide behind the globe; tap one for its name.", this.TwoColumnCard(Make(new SkiaRow(), {
      Spacing: 24,
      Children: [
        Make(new SkiaShape(), {
          CornerRadius: 14,
          UseCache: "None",
          WidthRequest: ViewerWidth,
          HeightRequest: GlobeHeight,
          BackgroundColor: "#080A16",
          Children: [
            this._globe,
            // The pins, then their name chips over every pin.
            Make(new SkiaLayer(), {
              VerticalOptions: "Fill",
              Children: [...Cities.map(([name], i) => this.CityPin(i, name)), ...Cities.map(([name], i) => this.CityLabel(i, name))],
            }),
          ],
        }),
        Make(new SkiaStack(), {
          Spacing: 12,
          // Still beside a globe that draws every frame: blitted, drawn again only when a choice changes.
          UseCache: "Image",
          WidthRequest: WideWidth - ViewerWidth - 24,
          Children: [
            Make(new SkiaStack(), {
              Spacing: 4,
              Children: [
                Make(new SkiaLabel(), { Text: "Offices", FontSize: 24, FontFamily: Theme.Title, TextColor: Theme.Ink, AccessibilityRole: Aria.RoleHeading }),
                Make(new SkiaLabel(), { Text: "Pick a city to turn the globe to it, or tap a pin.", FontSize: 13, TextColor: Theme.Muted }),
              ],
            }),
            Make(new SkiaWrap(), {
              Spacing: 8,
              AccessibilityRole: Aria.RoleRadioGroup,
              AccessibilityLabel: "Cities",
              Children: Cities.map(([name], i) => this._cityButtons[i] = Make(new UiButton(name, Theme.Quiet, -1), {
                AccessibilityRole: Aria.RoleRadio,
                Tapped: () => this.GoToCity(i),
              })),
            }),
            this._spinButton = Make(new UiButton("Pause spin", Theme.Quiet, 158), {
              Margin: new Thickness(0, 6, 0, 0),
              AccessibilityHint: "Stops or starts the globe turning by itself",
              Tapped: () => this.SetSpin(!this._spinning),
            }),
            Make(new SkiaLabel(), { Text: "Image: NASA Blue Marble", FontSize: 12, TextColor: Theme.Muted }),
          ],
        }),
      ],
    }), ViewerWidth, GlobeHeight));
  }

  /** A map pin: a glossy teardrop with a soft shadow, a white dot inside and a ring pulsing where it stands. */
  private CityPin(index: number, name: string): SkiaLayer {
    return this._cityPins[index] = Make(new SkiaLayer(), {
      WidthRequest: PinW,
      HeightRequest: PinH,
      HorizontalOptions: "Start",
      VerticalOptions: "Start",
      UseCache: "None",
      // Shown while its city faces the eye: hidden, it is out of taps and screen readers too.
      IsVisible: false,
      AccessibilityRole: Aria.RoleButton,
      AccessibilityLabel: name,
      AccessibilityHint: "Shows the city's name",
      Children: [
        this._pulses[index] = Make(new SkiaShape(), { Type: "Ellipse", WidthRequest: 30, HeightRequest: 10, Margin: new Thickness(1, 38, 0, 0), StrokeColor: PinRed, StrokeWidth: 2 }),
        Make(new SkiaShape(), {
          Type: "Path",
          PathData: "M16 0 C7.2 0 0 7 0 15.6 C0 27 16 43 16 43 C16 43 32 27 32 15.6 C32 7 24.8 0 16 0 Z",
          WidthRequest: 32,
          HeightRequest: 43,
          BackgroundColor: PinRed,
          FillGradient: { StartXRatio: 0.3, StartYRatio: 0, EndXRatio: 0.7, EndYRatio: 1, Colors: ["#FF7060", "#C82820"] },
          Shadows: [new SkiaShadow({ Blur: 5, Y: 3, Opacity: 0.45, Color: "#000000" })],
        }),
        Make(new SkiaShape(), { Type: "Circle", WidthRequest: 12, HeightRequest: 12, Margin: new Thickness(10, 10, 0, 0), BackgroundColor: "#FFFFFF" }),
        Make(new SkiaShape(), { Type: "Ellipse", WidthRequest: 10, HeightRequest: 5, Margin: new Thickness(8, 4, 0, 0), BackgroundColor: "#5AFFFFFF" }),
      ],
      HoverChanged: (me, on) => { me.Scale = on ? 1.15 : 1; me.RepaintComposition(); },
      Tapped: () => this.ToggleCity(index),
    });
  }

  /**
   * A clean name chip over a pin. The globe under it draws every frame, the chip never changes: one image, its blurred
   * shadow and text made once and blitted where the city shows.
   */
  private CityLabel(index: number, name: string): SkiaShape {
    return this._cityLabels[index] = Make(new SkiaShape(), {
      WidthRequest: ChipW,
      HeightRequest: ChipH,
      CornerRadius: 15,
      UseCache: "Image",
      BackgroundColor: "#FAFAFC",
      Shadows: [new SkiaShadow({ Blur: 6, Y: 2, Opacity: 0.35, Color: "#000000" })],
      IsVisible: false,
      InputTransparent: true,
      Children: [Make(new SkiaLabel(), { Text: name, FontSize: 14, TextColor: "#1E202C", HorizontalOptions: "Center", VerticalOptions: "Center" })],
    });
  }

  private ToggleCity(index: number): void {
    this._openCity = this._openCity === index ? -1 : index;
    this._cityPins.forEach((pin, i) => { pin.AccessibilityIsPressed = i === this._openCity; });
    this.PlacePins();
  }

  /** Turns the globe to a city in 0.6 s, stops its spin and shows the city's name. */
  private GoToCity(index: number): void {
    this._cityButtons.forEach((button, i) => {
      button.Fill = i === index ? Theme.Accent : Theme.Quiet;
      button.AccessibilityIsPressed = i === index;
    });
    this.SetSpin(false);
    const [yaw, pitch] = Facing(OnGlobe(Cities[index][1], Cities[index][2]));
    this._globeFromYaw = this._globe.Yaw;
    this._globeFromPitch = this._globe.Pitch;
    this._globeToYaw = yaw;
    this._globeToPitch = pitch;
    this._globeGlide = 0;
    this._openCity = -1;
    this.ToggleCity(index);
  }

  private SetSpin(on: boolean): void {
    this._spinning = on;
    this._globe.AutoRotate = on ? 10 : 0;
    this._spinButton.Text = on ? "Pause spin" : "Spin";
    this._spinButton.AccessibilityIsPressed = !on;
  }

  /** Pins and the open name chip go where their cities show; a city on the far side hides its pin. */
  private PlacePins(): void {
    for (let i = 0; i < Cities.length; i++) {
      const at = this._globe.ScreenPosition(OnGlobe(Cities[i][1], Cities[i][2]));
      const shown = !!at && !at.Occluded;
      const pin = this._cityPins[i];
      Show(pin, shown);
      const label = this._cityLabels[i];
      const labelShown = shown && this._openCity === i;
      Show(label, labelShown);
      if (!shown) continue;
      Move(pin, at!.X - PinTipX, at!.Y - PinTipY);
      if (labelShown) Move(label, at!.X - ChipW / 2, at!.Y - ChipRise);
    }
  }

  /** Each frame: a glide to a city goes on, the pins' pulse rings grow and fade. */
  private GlobeFrame(delta: number): void {
    if (!WasInLastFrame(this._globe)) return;
    if (this._globeGlide < 1) {
      this._globeGlide = Math.min(1, this._globeGlide + delta / 0.6);
      const t = this._globeGlide;
      const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      const turn = ((((this._globeToYaw - this._globeFromYaw) % 360) + 540) % 360) - 180;
      this._globe.Yaw = this._globeFromYaw + turn * e;
      this._globe.Pitch = this._globeFromPitch + (this._globeToPitch - this._globeFromPitch) * e;
    }
    for (let i = 0; i < Cities.length; i++) {
      if (!this._cityPins[i].IsVisible) continue;
      // Each pulse grows and fades over 1.6 s, the pins out of step.
      const phase = (this._time / 1.6 + i * 0.17) % 1;
      const ring = this._pulses[i];
      ring.Scale = 0.4 + phase;
      ring.Opacity = 1 - phase;
      ring.RepaintComposition();
    }
  }

  // ---- GalleryPage.Form.cs ----
  //
  // 3D next to normal UI: a plain sign-up form with the avatar beside it as one more control. It looks at the field
  // being typed in (and along the text as it grows), folds its ears over its eyes while the password field has the
  // keyboard, waves when the form is sent and shakes its head when something is missing.

  private _mascot!: SkiaModel3D;
  private _nameField!: SkiaEditor;
  private _emailField!: SkiaEditor;
  private _passwordField!: SkiaEditor;
  private _formStatus!: SkiaLabel;
  /** The field with the keyboard: 0 name, 1 email, 2 password, -1 none. */
  private _formFocus = -1;
  /** The head's turn and tilt now and wanted, and how far the hands are up (0 down, 1 over the eyes). */
  private _headYaw = 0;
  private _headPitch = 0;
  private _headYawTo = 0;
  private _headPitchTo = 0;
  private _hands = 0;
  private _handsTo = 0;
  private _headSet = false;
  private _handsSet = false;
  /** How far the head is turned toward a field, 0 (its own animation) to 1. */
  private _look = 0;
  private _lookTo = 0;

  private FormCard(): SkiaControl {
    const row = Make(new SkiaRow(), {
      Spacing: 24,
      Children: [
        Make(new SkiaShape(), {
          CornerRadius: 14,
          BackgroundColor: Theme.Page,
          Padding: new Thickness(24),
          WidthRequest: FormWidth,
          VerticalOptions: "Start",
          // The form beside a mascot that moves every frame: blitted, drawn again when a field changes.
          UseCache: "Image",
          Children: [
            Make(new SkiaStack(), {
              Spacing: 12,
              Children: [
                Make(new SkiaLabel(), { Text: "Create your account", FontSize: 22, FontFamily: Theme.Title, TextColor: Theme.Ink, AccessibilityRole: Aria.RoleHeading }),
                Make(new SkiaLabel(), { Text: "It takes a minute. Our mascot will not peek at your password.", FontSize: 13, TextColor: Theme.Muted }),
                this._nameField = this.Field("Name", false, 0),
                this._emailField = this.Field("Email", false, 1),
                this._passwordField = this.Field("Password", true, 2),
                Make(new UiButton("Sign up", Theme.Accent), { HorizontalOptions: "Fill", WidthRequest: -1, Tapped: () => this.SignUp() }),
                this._formStatus = Make(new SkiaLabel(), { FontSize: 14, TextColor: Theme.Gold, HeightRequest: 20, AccessibilityRole: Aria.RoleText, AccessibilityLive: Aria.LivePolite }),
              ],
            }),
          ],
        }),
        Make(GalleryPage.Stage(this._mascot = Make(new SkiaModel3D(Theme.Avatar), {
          Animation: "CharacterArmature|Idle",
          // The camera on the mascot's left: it faces the form at screen left (a view turn, no mirror).
          Yaw: 32,
          Pitch: 8,
          Orbit: false,
          HorizontalOptions: "Fill",
          VerticalOptions: "Fill",
          Tapped3D: (me) => { me.PlayOnce("CharacterArmature|Wave"); },
        })), { WidthRequest: WideWidth - FormWidth - 24, HeightRequest: ViewerHeight }),
      ],
    });
    // Side by side on a wide card; narrow, the form on top at full width and the mascot under it.
    this._adapt.push((width) => {
      const wide = TwoColumns(width);
      row.Type = wide ? "Row" : "Column";
      row.HorizontalOptions = "Fill";
      const [form, stage] = row.Children;
      form.WidthRequest = wide ? FormWidth : -1;
      form.HorizontalOptions = wide ? "Start" : "Fill";
      stage.WidthRequest = wide ? CardInner(width) - FormWidth - 24 : -1;
      stage.HorizontalOptions = wide ? "Start" : "Fill";
      stage.HeightRequest = wide ? ViewerHeight : StackedView;
      form.Update();
      stage.Update();
      row.Update();
    });
    return this.WideCard("3D next to normal UI", "A plain sign-up form with a 3D mascot beside it: it watches what you type and looks away from your password.", row);
  }

  /** A one-line text field in the app's style; the mascot follows its focus and its text. */
  private Field(placeholder: string, password: boolean, index: number): SkiaEditor {
    let hovered = false;
    const frame = (me: SkiaEditor) => {
      me.StrokeColor = me.IsFocused ? Theme.Accent : hovered ? Theme.Lighter(Theme.Line, 0.25) : Theme.Line;
      me.UpdateDraw();
    };
    return Make(new SkiaEditor(), {
      MaxLines: 1,
      IsPassword: password,
      PlaceholderText: placeholder,
      PlaceholderColor: Theme.Muted,
      TextColor: Theme.Ink,
      CursorColor: Theme.Accent,
      FontSize: 15,
      FontFamily: "FontText",
      HorizontalOptions: "Fill",
      Padding: new Thickness(12, 10),
      HeightRequest: 44,
      CornerRadius: 10,
      BackgroundColor: Theme.Stage,
      StrokeColor: Theme.Line,
      StrokeWidth: 1.55,
      AccessibilityLabel: index === 0 ? "Name" : index === 1 ? "Email" : "Password",
      HoverChanged: (me, on) => { hovered = on; frame(me as SkiaEditor); },
      FocusChanged: (me, focused) => {
        frame(me);
        if (focused) this._formFocus = index;
        else if (this._formFocus === index) this._formFocus = -1;
        this.Watch();
      },
      TextChanged: () => this.Watch(),
    });
  }

  /** Where the mascot looks: at the field with the keyboard, along its text; hands over its eyes for the password. */
  private Watch(): void {
    this._handsTo = this._formFocus === 2 ? 1 : 0;
    if (this._formFocus === 0 || this._formFocus === 1) {
      const field = this._formFocus === 0 ? this._nameField : this._emailField;
      // Along the text: from the field's start toward its end as the text grows (DrawnUI for Rust's numbers).
      this._headYawTo = -30 + 20 * Math.min((field.Text?.length ?? 0) / 30, 1);
      this._headPitchTo = this._formFocus === 0 ? 10 : 22;
      this._lookTo = 1;
    } else this._lookTo = 0;
  }

  private SignUp(): void {
    const name = this._nameField.Text?.trim() ?? "";
    const email = this._emailField.Text?.trim() ?? "";
    const password = this._passwordField.Text ?? "";
    let problem: string | undefined;
    if (name.length === 0) problem = "Please tell us your name.";
    else if (!email.includes("@") || !email.includes(".")) problem = "That email does not look right.";
    else if (password.length < 8) problem = "Use at least 8 characters for the password.";
    if (problem) {
      this._formStatus.Text = problem;
      this._formStatus.TextColor = Theme.Bad;
      this._mascot.PlayOnce("CharacterArmature|No");
      return;
    }
    this._formStatus.Text = `Welcome aboard, ${name}!`;
    this._formStatus.TextColor = Theme.Gold;
    this._formFocus = -1;
    this.Watch();
    this._mascot.PlayOnce("CharacterArmature|Wave");
  }

  /** Each frame: the head and the hiding pose ease toward where the form wants them. */
  private FormFrame(delta: number): void {
    if (!WasInLastFrame(this._mascot)) return;
    const k = Math.min(1, delta * 8);
    this._headYaw += (this._headYawTo - this._headYaw) * k;
    this._headPitch += (this._headPitchTo - this._headPitch) * k;
    this._look += (this._lookTo - this._look) * k;
    this._hands += (this._handsTo - this._hands) * k;
    if (this._look > 0.01) {
      this.Turn(HeadBone, HeadRest, this._headPitch, this._headYaw, 0, this._look);
      this._headSet = true;
    } else if (this._headSet) {
      this._mascot.ResetNode(HeadBone);
      this._headSet = false;
    }
    if (this._hands > 0.01) {
      // Hiding from the password: the ears fold down over the eyes, the hands go to the cheeks.
      this._handsSet = true;
      this.Turn("Ear1.L", Ear1LRest, 150, 0, 0, this._hands);
      this.Turn("Ear1.R", Ear1RRest, 150, 0, 0, this._hands);
      this.Turn("Ear2.L", Ear2LRest, -30, 0, 0, this._hands);
      this.Turn("Ear2.R", Ear2RRest, -30, 0, 0, this._hands);
      this.Turn(ArmL, ArmLRest, -150, -150, 60, this._hands);
      this.Turn(ForearmL, ForearmLRest, 0, 0, 60, this._hands);
      this.Turn(ArmR, ArmRRest, 30, 30, 120, this._hands);
      this.Turn(ForearmR, ForearmRRest, 0, 0, -60, this._hands);
    } else if (this._handsSet) {
      this._handsSet = false;
      for (const bone of ["Ear1.L", "Ear1.R", "Ear2.L", "Ear2.R", ArmL, ArmR, ForearmL, ForearmR]) this._mascot.ResetNode(bone);
    }
  }

  /** A bone turned to rest * (x, y, z) degrees (XYZ), the way there by `t` (0 = rest). */
  private Turn(bone: string, rest: Quat, x: number, y: number, z: number, t: number): void {
    const [ex, ey, ez] = ToEuler(QSlerp(rest, QMul(rest, Euler(x, y, z)), t));
    this._mascot.SetNodeRotation(bone, ex, ey, ez);
  }

  // ---- GalleryPage.Images.cs ----

  private _product!: SkiaModel3D;
  private _labels?: Texture3D[];
  private _label = 0;

  /** The next image of a list on a material. */
  private NextImage(): void {
    this._label = (this._label + 1) % this._labels!.length;
    this._product.SetMaterialImage("box", this._labels![this._label]);
  }

  /** The section's tile. */
  private ImagesSection(): SkiaControl {
    this._labels ??= Labels();
    this._product = Make(GalleryPage.Shaded(ProductBox(), 28, 18), { AutoRotate: 40, Tapped3D: () => this.NextImage() });
    this._product.SetMaterialImage("box", this._labels[0]);
    return Make(new SkiaWrap(), {
      Spacing: 16,
      HorizontalOptions: "Center",
      Children: [
        GalleryPage.Tile("Product box", "A box with its label: tap it or switch the design.",
          this._product,
          Make(new SkiaRow(), {
            Spacing: 8,
            Children: [
              Make(new UiButton("Next design", Theme.Accent, 124), { Tapped: () => this.NextImage() }),
              // The box's edges: hard (the default) or smooth (4x multisampling).
              Make(new UiButton("Edges: hard", Theme.Quiet, 124), {
                Tapped: (me) => {
                  const button = me as UiButton;
                  this._product.Antialias = !this._product.Antialias;
                  button.Text = this._product.Antialias ? "Edges: smooth" : "Edges: hard";
                  button.Fill = this._product.Antialias ? Theme.Accent : Theme.Quiet;
                  button.AccessibilityIsPressed = this._product.Antialias;
                },
              }),
            ],
          })),
      ],
    });
  }

  // ---- GalleryPage.Loop.cs ----
  //
  // The gallery's state and its game loop: what the app moves every frame.

  private _time = 0;
  private _pan = 0;
  private _unlocked = true;
  /** The medal's spin after unlocking, 0 to 1. */
  private _spin = 1;
  private _liked = true;
  /** The heart's pop after a like, 1 to 0. */
  private _pop = 0;
  private _open = false;
  private readonly _pieces: Piece[] = [];
  private _rainReady = false;
  private readonly _walkers: Walker[] = [];
  private _walkersOnField = -1;
  private _mobs = 0;
  private readonly _dice = new Dice(7);

  override GameLoop(delta: number): void {
    super.GameLoop(delta);
    // The first tick after a start or a pause carries the whole gap.
    delta = Clamp(delta, 0, 0.1);
    this._time += delta;
    const t = this._time;

    this.PriceFrame(delta);
    // A note that was placed before it had its size goes above its dot once it has it.
    if (this._note.IsVisible && this._note.MeasuredSize.Units.Height !== this._noteHeight) this.PlaceSpots();
    this.ListFrame();
    // The scene pans: every layer slides by its share, the ground (and the mobs on it) the most.
    // Wrapped where every layer is back at its start (100000 pt, 50 min), so the number keeps its fractions.
    this._pan = (this._pan + Scenery.PanSpeed * delta) % 100_000;
    if (WasInLastFrame(this._field)) this._scenery.Pan = this._pan;
    this.CardFrame(delta);
    this.GlobeFrame(delta);
    this.FormFrame(delta);

    if (this._spin < 1) {
      this._spin = Math.min(this._spin + delta / 0.9, 1);
      this._medal.Yaw = MedalYaw + 360 * EaseOut(this._spin);
    }

    this._pop = Math.max(this._pop - delta * 3, 0);
    // Controls off screen are not touched: their state moves on, they get it when they show again.
    if (WasInLastFrame(this._heart)) {
      const beat = 1 + 0.05 * Math.max(Math.sin(t * 5), 0) + 0.35 * this._pop;
      this._heart.SetNodeScale("heart", beat, beat, 1);
    }

    if (!this._rainReady) {
      this._rainReady = true;
      for (let i = 0; i < PieceCount; i++) {
        const d = this._dice;
        const p: Piece = { X: d.Next() * RainWidth, Y: d.Next() * RainHeight, Fall: 40 + d.Next() * 50, Sway: d.Next() * Math.PI * 2, Spin: 120 + d.Next() * 300, Facing: d.Next() * 360 };
        this._rain.Add(PieceNames[i], i % 4 === 0 ? "star" : "paper", p.X, p.Y, i % 4 === 0 ? 18 : 11);
        this._rain.SetMaterialColor(PieceNames[i], "piece", ConfettiColors[i % ConfettiColors.length]);
        this._pieces[i] = p;
      }
    }
    const rainShown = WasInLastFrame(this._rain);
    for (let i = 0; i < PieceCount; i++) {
      const p = this._pieces[i];
      p.Y += p.Fall * delta;
      p.Facing += p.Spin * delta;
      if (p.Y > RainHeight + 16) p.Y = -12;
      if (!rainShown) continue;
      this._rain.SetPosition(PieceNames[i], p.X + Math.sin(t * 2 + p.Sway) * 10, p.Y);
      this._rain.SetFacing(PieceNames[i], p.Facing);
    }

    if (this._walkersOnField !== this._mobs) {
      this._walkersOnField = this._mobs;
      this._field.ClearObjects();
      for (let i = 0; i < this._mobs; i++) {
        const d = this._dice;
        const w: Walker = {
          // On the ground band, below the hills.
          X: d.Next() * FieldWidth, Y: Scenery.GroundTop + 10 + d.Next() * (Scenery.GroundBottom - Scenery.GroundTop - 10),
          Speed: (d.Next() < 0.5 ? -1 : 1) * (30 + d.Next() * 50),
        };
        this._field.Add(MobNames[i], "slime", w.X, w.Y, 46);
        this._field.Play(MobNames[i], "CharacterArmature|Walk");
        this._field.SetSpeed(MobNames[i], 0.8 + d.Next() * 0.5);
        this._field.SetFacing(MobNames[i], w.Speed > 0 ? 90 : -90);
        this._walkers[i] = w;
      }
    }
    const fieldShown = WasInLastFrame(this._field);
    for (let i = 0; i < this._mobs; i++) {
      const w = this._walkers[i];
      // Walking on the ground, which moves with the pan; off one side, back in at the other.
      w.X += (w.Speed - Scenery.PanSpeed) * delta;
      if (w.X < -40) w.X += FieldWidth + 80;
      else if (w.X > FieldWidth + 40) w.X -= FieldWidth + 80;
      if (fieldShown) this._field.SetPosition(MobNames[i], w.X, w.Y);
    }
  }
}
