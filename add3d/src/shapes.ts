// Meshes made in code (Mesh3D) and models of named, colored parts (Model3D). Port of DrawnUi.Add3d Shapes3D.
import type { Path } from "canvaskit-wasm";
import { Euler, type Quat, type Vec3 } from "./math";
import { ColorLinear, ColorSrgb } from "./colors";
import { Primitive3D, Scene3D, type Material3D, type Node3D } from "./scene";

type V2 = [number, number];

/**
 * A mesh made in code: smooth shapes (turned profiles, spheres, rings, boxes, any 2D path pushed into depth). Put them
 * together as named, colored parts with Model3D. Every shape has texture coordinates, so SetMaterialImage can wrap an
 * image around it.
 */
export class Mesh3D {
  readonly Positions: number[] = [];
  readonly Normals: number[] = [];
  readonly Indices: number[] = [];
  /** Outline directions per vertex; empty = the normals averaged per position. */
  readonly Outline: number[] = [];
  /** Texture coordinates per vertex, (0, 0) = the image's top left. */
  readonly Uvs: number[] = [];

  private static readonly Whole: V2[] = [[0, 1], [1, 1], [1, 0], [0, 0]];

  private Quad(a: Vec3, b: Vec3, c: Vec3, d: Vec3, normal: Vec3, uvs: V2[]): void {
    const at = this.Positions.length / 3;
    this.Positions.push(...a, ...b, ...c, ...d);
    for (let i = 0; i < 4; i++) this.Normals.push(...normal);
    for (const uv of uvs) this.Uvs.push(...uv);
    this.Indices.push(at, at + 1, at + 2, at, at + 2, at + 3);
  }

  /**
   * A profile turned around the vertical axis: (radius, height) points from bottom to top (a cup, a vase, a coin's rim).
   * Each step of the profile is its own band, so corners stay sharp. An image wraps once around and runs from the top of
   * the profile to its bottom, by length along it.
   */
  static Lathe(profile: readonly V2[], segments: number): Mesh3D {
    segments = Math.max(segments, 3);
    const mesh = new Mesh3D();
    let total = 0;
    for (let k = 0; k + 1 < profile.length; k++) total += Math.hypot(profile[k + 1][0] - profile[k][0], profile[k + 1][1] - profile[k][1]);
    total = Math.max(total, 1e-6);
    let along = 0;
    for (let k = 0; k + 1 < profile.length; k++) {
      const [r0, y0] = profile[k], [r1, y1] = profile[k + 1];
      const length = Math.hypot(r1 - r0, y1 - y0);
      const v0 = 1 - along / total, v1 = 1 - (along + length) / total;
      along += length;
      // the band's outward normal in the profile plane
      const ex = y1 - y0, ey = -(r1 - r0), len = Math.hypot(ex, ey);
      const nr = len > 0 ? ex / len : 0, ny = len > 0 ? ey / len : 0;
      const at = mesh.Positions.length / 3;
      for (let s = 0; s <= segments; s++) {
        const u = s / segments, sin = Math.sin(u * Math.PI * 2), cos = Math.cos(u * Math.PI * 2);
        mesh.Positions.push(r0 * cos, y0, r0 * sin); mesh.Normals.push(nr * cos, ny, nr * sin); mesh.Uvs.push(1 - u, v0);
        mesh.Positions.push(r1 * cos, y1, r1 * sin); mesh.Normals.push(nr * cos, ny, nr * sin); mesh.Uvs.push(1 - u, v1);
      }
      for (let s = 0; s < segments; s++) {
        const a = at + s * 2, b = at + s * 2 + 1, c = at + s * 2 + 3, d = at + s * 2 + 2;
        mesh.Indices.push(a, b, c, a, c, d);
      }
    }
    return mesh;
  }

  /** A disc or a short cylinder (a coin, a button, a medal), `height` thick, centered. */
  static Cylinder(radius: number, height: number): Mesh3D {
    const h = height / 2;
    return Mesh3D.Lathe([[0, -h], [radius, -h], [radius, h], [0, h]], 64);
  }

  /** A sphere (a ball, a dot of a loader). */
  static Sphere(radius: number): Mesh3D {
    const steps = 24, profile: V2[] = [];
    for (let i = 0; i <= steps; i++) {
      const a = Math.PI * (i / steps - 0.5);
      // the poles exactly on the axis: cos(pi/2) is not quite 0, a radius below zero that flips their triangles
      profile.push([i === 0 || i === steps ? 0 : radius * Math.cos(a), radius * Math.sin(a)]);
    }
    // shaded round, not band by band: every normal points away from the center
    return Mesh3D.Lathe(profile, 48).Smooth((p) => p);
  }

  /** A ring (a torus): `radius` to the middle of the tube, `tube` the tube's radius. */
  static Torus(radius: number, tube: number): Mesh3D {
    const steps = 24, profile: V2[] = [];
    for (let i = 0; i <= steps; i++) { const a = (i / steps) * Math.PI * 2; profile.push([radius + tube * Math.cos(a), tube * Math.sin(a)]); }
    // every normal points away from the middle of the tube
    return Mesh3D.Lathe(profile, 64).Smooth((p) => {
      const l = Math.hypot(p[0], p[2]);
      return l > 0 ? [p[0] - (p[0] / l) * radius, p[1], p[2] - (p[2] / l) * radius] : p;
    });
  }

  /** Normals from the surface's own shape: away(position) points outward from it. */
  private Smooth(away: (p: Vec3) => Vec3): Mesh3D {
    const P = this.Positions, N = this.Normals;
    for (let i = 0; i < P.length; i += 3) {
      const v = away([P[i], P[i + 1], P[i + 2]]), l = Math.hypot(v[0], v[1], v[2]);
      N[i] = l > 0 ? v[0] / l : 0; N[i + 1] = l > 0 ? v[1] / l : 0; N[i + 2] = l > 0 ? v[2] / l : 0;
    }
    return this;
  }

  /** A box, centered. An image covers each face whole, upright on the sides. */
  static Cuboid(width: number, height: number, depth: number): Mesh3D {
    const x = width / 2, y = height / 2, z = depth / 2;
    const V = (a: number, b: number, c: number): Vec3 => [a * x, b * y, c * z];
    const m = new Mesh3D(), W = Mesh3D.Whole;
    m.Quad(V(-1, -1, 1), V(1, -1, 1), V(1, 1, 1), V(-1, 1, 1), [0, 0, 1], W);
    m.Quad(V(1, -1, -1), V(-1, -1, -1), V(-1, 1, -1), V(1, 1, -1), [0, 0, -1], W);
    m.Quad(V(1, -1, 1), V(1, -1, -1), V(1, 1, -1), V(1, 1, 1), [1, 0, 0], W);
    m.Quad(V(-1, -1, -1), V(-1, -1, 1), V(-1, 1, 1), V(-1, 1, -1), [-1, 0, 0], W);
    m.Quad(V(-1, 1, 1), V(1, 1, 1), V(1, 1, -1), V(-1, 1, -1), [0, 1, 0], W);
    m.Quad(V(-1, -1, -1), V(1, -1, -1), V(1, -1, 1), V(-1, -1, 1), [0, -1, 0], W);
    return m;
  }

  // ponytail: contours are filled as solids, holes (an O, a ring) are not cut; draw a ring with Torus or Lathe until a
  // shape needs a hole.
  /**
   * A 2D path pushed into depth (a star, a heart, a check mark, a logo, a digit), `depth` thick, facing the viewer,
   * centered on the path's bounds; path units, y down as in Skia. Each closed contour is its own solid. An image lies on
   * the front over the path's bounds (mirrored on the back) and runs once around the walls.
   */
  static Extrude(path: Path, depth: number): Mesh3D {
    const b = path.getBounds();
    const cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2, sizeX = Math.max(b[2] - b[0], 1e-6), sizeY = Math.max(b[3] - b[1], 1e-6);
    const mesh = new Mesh3D();
    for (const raw of Contours(path)) {
      const contour: V2[] = raw.map((p) => [p[0] - cx, cy - p[1]]);
      if (SignedArea(contour) < 0) contour.reverse();
      const n = contour.length;
      if (n < 3) continue;
      // the outline follows the 2D shape: at each corner, between its two edges' normals
      const edgeNormal = (i: number): V2 => { const a = contour[i], c = contour[(i + 1) % n]; return norm2([c[1] - a[1], -(c[0] - a[0])]); };
      const corner: Vec3[] = contour.map((_, i) => { const p = edgeNormal((i + n - 1) % n), q = edgeNormal(i), v = norm2([p[0] + q[0], p[1] + q[1]]); return [v[0], v[1], 0]; });
      const front = depth / 2, back = -depth / 2;
      const triangles = EarClip(contour);
      for (const [z, normal, flip] of [[front, [0, 0, 1], false], [back, [0, 0, -1], true]] as [number, Vec3, boolean][]) {
        const at = mesh.Positions.length / 3;
        for (let i = 0; i < n; i++) {
          mesh.Positions.push(contour[i][0], contour[i][1], z);
          mesh.Normals.push(...normal);
          mesh.Outline.push(...corner[i]);
          mesh.Uvs.push(contour[i][0] / sizeX + 0.5, 0.5 - contour[i][1] / sizeY);
        }
        for (const [a, bb, c] of triangles) mesh.Indices.push(at + a, at + (flip ? c : bb), at + (flip ? bb : c));
      }
      let perimeter = 0;
      for (let i = 0; i < n; i++) perimeter += Math.hypot(contour[(i + 1) % n][0] - contour[i][0], contour[(i + 1) % n][1] - contour[i][1]);
      perimeter = Math.max(perimeter, 1e-6);
      let along = 0;
      for (let i = 0; i < n; i++) {
        const a = contour[i], c = contour[(i + 1) % n];
        const ex = c[0] - a[0], ey = c[1] - a[1], el = Math.hypot(ex, ey);
        if (el * el < 1e-12) continue;
        const u0 = along / perimeter, u1 = (along + el) / perimeter;
        along += el;
        mesh.Quad([a[0], a[1], back], [c[0], c[1], back], [c[0], c[1], front], [a[0], a[1], front], [ey / el, -ex / el, 0], [[u0, 1], [u1, 1], [u1, 0], [u0, 0]]);
        const ca = corner[i], cb = corner[(i + 1) % n];
        mesh.Outline.push(...ca, ...cb, ...cb, ...ca);
      }
    }
    return mesh;
  }

  /** The number of triangles. */
  get TriangleCount(): number { return this.Indices.length / 3; }
}

function norm2(v: V2): V2 { const l = Math.hypot(v[0], v[1]); return l > 0 && Number.isFinite(l) ? [v[0] / l, v[1] / l] : [0, 0]; }

/** The path's contours as polygons: lines as they are, curves in short straight steps. */
function Contours(path: Path): V2[][] {
  const cmds = path.toCmds();
  const result: V2[][] = [];
  let current: V2[] = [];
  let i = 0;
  while (i < cmds.length) {
    const verb = cmds[i++];
    const last = (): V2 => current.length > 0 ? current[current.length - 1] : [0, 0];
    if (verb === 0) { if (current.length > 2) result.push(current); current = [[cmds[i], cmds[i + 1]]]; i += 2; }
    else if (verb === 1) { current.push([cmds[i], cmds[i + 1]]); i += 2; }
    else if (verb === 2 || verb === 3) {
      const a = last(), bb: V2 = [cmds[i], cmds[i + 1]], c: V2 = [cmds[i + 2], cmds[i + 3]];
      i += verb === 3 ? 5 : 4;
      for (let k = 1; k <= 12; k++) { const t = k / 12, u = 1 - t; current.push([a[0] * u * u + bb[0] * 2 * t * u + c[0] * t * t, a[1] * u * u + bb[1] * 2 * t * u + c[1] * t * t]); }
    } else if (verb === 4) {
      const a = last(), bb: V2 = [cmds[i], cmds[i + 1]], c: V2 = [cmds[i + 2], cmds[i + 3]], d: V2 = [cmds[i + 4], cmds[i + 5]];
      i += 6;
      for (let k = 1; k <= 16; k++) {
        const t = k / 16, u = 1 - t;
        current.push([a[0] * u * u * u + bb[0] * 3 * u * u * t + c[0] * 3 * u * t * t + d[0] * t * t * t, a[1] * u * u * u + bb[1] * 3 * u * u * t + c[1] * 3 * u * t * t + d[1] * t * t * t]);
      }
    } else if (verb === 5) { if (current.length > 2) result.push(current); current = []; }
    else break;
  }
  if (current.length > 2) result.push(current);
  // a closing point equal to the first one is dropped
  for (const c of result) if (c.length > 3 && (c[0][0] - c[c.length - 1][0]) ** 2 + (c[0][1] - c[c.length - 1][1]) ** 2 < 1e-8) c.pop();
  return result;
}

function SignedArea(polygon: readonly V2[]): number {
  let sum = 0;
  for (let i = 0; i < polygon.length; i++) { const a = polygon[i], b = polygon[(i + 1) % polygon.length]; sum += a[0] * b[1] - b[0] * a[1]; }
  return sum / 2;
}

const Cross = (o: V2, a: V2, b: V2): number => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

/** Triangles of a simple counter-clockwise polygon, by clipping ears. */
function EarClip(polygon: readonly V2[]): [number, number, number][] {
  // strictly inside: a point on an edge (two points of the outline in a line) does not block an ear
  const inside = (p: V2, a: V2, b: V2, c: V2) => Cross(a, b, p) > 1e-9 && Cross(b, c, p) > 1e-9 && Cross(c, a, p) > 1e-9;
  const left = polygon.map((_, i) => i);
  const result: [number, number, number][] = [];
  let guard = 0;
  while (left.length > 3 && guard < polygon.length * polygon.length) {
    guard++;
    const n = left.length;
    let ear = -1;
    for (let i = 0; i < n && ear < 0; i++) {
      const ia = left[(i + n - 1) % n], ib = left[i], ic = left[(i + 1) % n];
      const a = polygon[ia], b = polygon[ib], c = polygon[ic];
      if (Cross(a, b, c) <= 1e-9) continue;
      if (!left.some((j) => j !== ia && j !== ib && j !== ic && inside(polygon[j], a, b, c))) ear = i;
    }
    // none found (a pinched outline): the most convex corner goes anyway, so no hole is left
    if (ear < 0) {
      let best = -Infinity;
      for (let i = 0; i < n; i++) { const c = Cross(polygon[left[(i + n - 1) % n]], polygon[left[i]], polygon[left[(i + 1) % n]]); if (c >= best) { best = c; ear = i; } }
    }
    result.push([left[(ear + n - 1) % n], left[ear], left[(ear + 1) % n]]);
    left.splice(ear, 1);
  }
  if (left.length === 3) result.push([left[0], left[1], left[2]]);
  return result;
}

interface PartInfo { Name: string; Mesh: Mesh3D; Color: string; T: Vec3; R: Quat; S: Vec3; Parent?: string }

/**
 * A 3D model made in code: named, colored parts, each a Mesh3D with its own place (At, Turned, Scaled) and optionally hung
 * under another part (Inside), for SkiaModel3D and SkiaScene3D.Model. A part is a node and a material of its own name, so
 * SetNode* and SetMaterialColor drive it like a part of a model file. The calls after Part change the part just added.
 */
export class Model3D {
  private readonly parts: PartInfo[] = [];
  private scene?: Scene3D;

  /** Adds a part: a mesh in one color. Its name is its node's and its material's. */
  Part(name: string, mesh: Mesh3D, color: string): Model3D {
    this.parts.push({ Name: name, Mesh: mesh, Color: color, T: [0, 0, 0], R: [0, 0, 0, 1], S: [1, 1, 1] });
    this.scene = undefined;
    return this;
  }

  private Last(change: (p: PartInfo) => void): Model3D {
    if (this.parts.length > 0) change(this.parts[this.parts.length - 1]);
    this.scene = undefined;
    return this;
  }

  /** Places the last part (in its parent's units). */
  At(x: number, y: number, z: number): Model3D { return this.Last((p) => (p.T = [x, y, z])); }
  /** Turns the last part: degrees around x, y, z (in that order). */
  Turned(x: number, y: number, z: number): Model3D { return this.Last((p) => (p.R = Euler(x, y, z))); }
  /** Scales the last part. */
  Scaled(x: number, y: number, z: number): Model3D { return this.Last((p) => (p.S = [x, y, z])); }
  /** Hangs the last part under another one by name: it moves, turns and hides with it. */
  Inside(parent: string): Model3D { return this.Last((p) => (p.Parent = parent)); }

  /** The scene of these parts, made once and shared by every control that shows this model. */
  ToScene(): Scene3D {
    if (this.scene) return this.scene;
    const nodes: Node3D[] = [], meshes: Primitive3D[][] = [], materials: Material3D[] = [];
    this.parts.forEach((p, i) => {
      const parent = p.Parent === undefined ? -1 : this.parts.findIndex((q) => q.Name === p.Parent);
      nodes.push({ Name: p.Name, Parent: parent === i ? -1 : parent, Mesh: i, Skin: -1, Rest: new Float32Array([...p.T, ...p.R, ...p.S]) });
      const n = p.Mesh.Positions.length / 3;
      const prim = new Primitive3D();
      prim.Positions = new Float32Array(p.Mesh.Positions);
      prim.Normals = new Float32Array(p.Mesh.Normals);
      // only a mesh that gave one for every vertex keeps its own outline directions
      prim.OutlineNormals = p.Mesh.Outline.length === n * 3 ? new Float32Array(p.Mesh.Outline) : undefined;
      prim.Uvs = p.Mesh.Uvs.length === n * 2 ? new Float32Array(p.Mesh.Uvs) : new Float32Array(n * 2);
      prim.Indices = new Uint32Array(p.Mesh.Indices);
      prim.Material = i;
      meshes.push([prim]);
      const color = p.Color ?? "#FFFFFF";
      materials.push({ Name: p.Name, Color: ColorLinear(color), Texture: -1, Roughness: 1, DoubleSided: false, Blend: ColorSrgb(color)[3] < 1 });
    });
    return (this.scene = Scene3D.Assemble(nodes, meshes, materials));
  }
}
