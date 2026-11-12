// A glTF scene on the CPU: read from a .glb, posed by its animations, hit by rays. One read per bytes, shared by every
// control that shows them. Port of DrawnUi.Add3d Scene3D / GltfReader / RayTree (.NET) and drawnui-add3d (Rust).
// ponytail: base color factor and texture only (no normal, metallic-roughness or emissive maps), no morph targets, no
// sparse accessors, vertex colors ignored, CUBICSPLINE samplers read as linear. Add them when a model needs them.
import { Super } from "drawnui-react/core";
import { Invert, LookAt, Mat4Identity, Mul, PerspectiveGl, Project, QuatAxisAngle, QuatNormalize, Radians, SlerpInto, Rotate, TransformDir, TransformPoint, Decompose, type Mat4, type Quat, type Vec3 } from "./math";

export interface Node3D { Name: string; Parent: number; Mesh: number; Skin: number; /** t3 r4 s3 */ Rest: Float32Array }

export class Primitive3D {
  Positions: Float32Array = new Float32Array(0);
  Normals: Float32Array = new Float32Array(0);
  /** The directions an outline pushes each vertex along, given by a shape made in code; empty = OutlineDirections makes them. */
  OutlineNormals?: Float32Array;
  Uvs: Float32Array = new Float32Array(0);
  /** Joint indices as floats, empty when not skinned. */
  Joints: Float32Array = new Float32Array(0);
  Weights: Float32Array = new Float32Array(0);
  Indices: Uint32Array = new Uint32Array(0);
  Material = -1;
  /** The triangles' box tree for rays, made at the first ray; rigid primitives only. */
  Tree?: RayTree;
  get VertexCount(): number { return this.Positions.length / 3; }
  get Skinned(): boolean { return this.Joints.length > 0; }
  /** The outline directions: given, else the normals averaged per position (made once, kept). */
  OutlineDirections(): Float32Array { return this.OutlineNormals ??= AveragedNormals(this.Positions, this.Normals); }
}

export interface Material3D {
  Name: string;
  /** Linear RGBA. */
  Color: [number, number, number, number];
  Texture: number;
  /** glTF roughnessFactor: 1 = matte (no highlight), toward 0 = glossy. */
  Roughness: number;
  DoubleSided: boolean;
  Blend: boolean;
}

/** Unpremultiplied RGBA pixels. */
export interface Image3D { Rgba: Uint8Array; Width: number; Height: number }
export interface Skin3D { Joints: number[]; /** 16 floats per joint */ InverseBind: Float32Array }
export const enum ChannelPath { Translation, Rotation, Scale }
export interface Channel3D { Node: number; Path: ChannelPath; Step: boolean; Times: Float32Array; /** 3 or 4 floats per key */ Values: Float32Array }
export interface Animation3D { Name: string; Duration: number; Channels: Channel3D[] }

/** An animation playing: its index and seconds into it. */
export interface Track { Animation: number; Time: number; Looped: boolean }

/** A material changed from code (SetMaterialColor, SetMaterialVisible, SetMaterialImage). */
export interface MaterialOverride {
  /** Linear RGBA, undefined = the file's. */
  Color?: [number, number, number, number];
  Hidden?: boolean;
  /** An image in place of the file's own, undefined = the file's. */
  Image?: Image3D;
  /** 0 glossy .. 1 matte, in place of the file's roughness. */
  Roughness?: number;
}

/** Floats per node in a locals array: translation 3, rotation 4, scale 3. */
export const LOCAL = 10;

export class Scene3D {
  Nodes: Node3D[] = [];
  Meshes: Primitive3D[][] = [];
  Materials: Material3D[] = [];
  Images: Image3D[] = [];
  Skins: Skin3D[] = [];
  Animations: Animation3D[] = [];
  /** Node indices with every parent before its children. */
  Order: number[] = [];
  /** The scene's box at rest. */
  BoundsMin: Vec3 = [-1, -1, -1];
  BoundsMax: Vec3 = [1, 1, 1];
  /** The most joints any skin has. */
  MaxJoints = 0;

  /** Files read, by their bytes: every control showing the same array shares one scene, and the GPU keeps one copy. */
  private static readonly shared = new WeakMap<object, Scene3D>();

  /** The scene of these bytes, read once while the bytes live; or why they cannot be read. */
  static Shared(bytes: Uint8Array | ArrayBuffer | undefined | null): { Scene?: Scene3D; Error?: string } {
    if (!bytes) return { Error: "no bytes" };
    const key = bytes instanceof Uint8Array ? bytes.buffer : bytes;
    const known = Scene3D.shared.get(key);
    if (known) return { Scene: known };
    try {
      const scene = Scene3D.Load(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
      Scene3D.shared.set(key, scene);
      return { Scene: scene };
    } catch (e) {
      return { Error: e instanceof Error ? e.message : String(e) };
    }
  }

  /** Reads a .glb (or a .gltf with its buffers embedded as data: URIs). */
  static Load(bytes: Uint8Array): Scene3D {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let json: string | undefined, bin: Uint8Array | undefined;
    if (bytes.length >= 20 && bytes[0] === 0x67 && bytes[1] === 0x6c && bytes[2] === 0x54 && bytes[3] === 0x46) {
      const length = Math.min(view.getUint32(8, true), bytes.length);
      let at = 12;
      while (at + 8 <= length) {
        const chunkLength = view.getUint32(at, true), chunkType = view.getUint32(at + 4, true), start = at + 8;
        if (start + chunkLength > length) throw new Error("broken GLB chunk");
        if (chunkType === 0x4e4f534a) json = new TextDecoder().decode(bytes.subarray(start, start + chunkLength));
        else if (chunkType === 0x004e4942) bin = bytes.slice(start, start + chunkLength);
        at = start + chunkLength;
      }
      if (json === undefined) throw new Error("GLB without a JSON chunk");
    } else {
      json = new TextDecoder().decode(bytes);
      if (!json.trimStart().startsWith("{")) throw new Error("not a glTF or GLB file");
    }
    return new GltfReader(JSON.parse(json), bin).Read();
  }

  /** A scene from parts made in code (Model3D): no skins, no animations, no images. */
  static Assemble(nodes: Node3D[], meshes: Primitive3D[][], materials: Material3D[]): Scene3D {
    const scene = new Scene3D();
    scene.Nodes = nodes; scene.Meshes = meshes; scene.Materials = materials;
    scene.Finish();
    return scene;
  }

  /** Order, joint count and rest bounds, after the parts are in. */
  Finish(): void {
    const depth = this.Nodes.map((_, i) => { let d = 0; for (let p = this.Nodes[i].Parent; p >= 0 && d <= this.Nodes.length; p = this.Nodes[p].Parent) d++; return d; });
    this.Order = this.Nodes.map((_, i) => i).sort((a, b) => depth[a] - depth[b] || a - b);
    this.MaxJoints = this.Skins.reduce((m, s) => Math.max(m, s.Joints.length), 0);
    this.RestBounds();
  }

  AnimationNamed(name: string | undefined): number { return name === undefined ? -1 : this.Animations.findIndex((a) => a.Name === name); }
  NodeNamed(name: string): number { return this.Nodes.findIndex((n) => n.Name === name); }
  MaterialNamed(name: string): number { return this.Materials.findIndex((m) => m.Name === name); }

  /** Nodes hidden: those `own` says, with everything under them. */
  Hidden(own: ArrayLike<boolean>, hidden: boolean[]): void {
    for (const i of this.Order) { const p = this.Nodes[i].Parent; hidden[i] = !!own[i] || (p >= 0 && hidden[p]); }
  }

  /** The name of the material a node's primitive is drawn with ("" when none). */
  MaterialOf(node: number, primitive: number): string {
    const mesh = this.Nodes[node].Mesh;
    if (mesh < 0 || primitive >= this.Meshes[mesh].length) return "";
    const m = this.Meshes[mesh][primitive].Material;
    return m >= 0 && m < this.Materials.length ? this.Materials[m].Name : "";
  }

  /** Every node's own transform as the file gives it. */
  Rest(local: Float32Array): void { for (let i = 0; i < this.Nodes.length; i++) local.set(this.Nodes[i].Rest, i * LOCAL); }

  /** Writes an animation's values at its time into the nodes it moves; a looped one wraps, a once-only one stops at its end. */
  Apply(track: Track, local: Float32Array): void {
    if (track.Animation < 0 || track.Animation >= this.Animations.length) return;
    const a = this.Animations[track.Animation];
    let t: number;
    if (a.Duration <= 0) t = 0;
    else if (track.Looped) { t = track.Time % a.Duration; if (t < 0) t += a.Duration; }
    else t = Math.min(Math.max(track.Time, 0), a.Duration);
    const n = this.Nodes.length;
    for (const c of a.Channels) {
      if (c.Node < 0 || c.Node >= n) continue;
      const at = c.Node * LOCAL;
      if (c.Path === ChannelPath.Translation) Sample(c, t, 3, local, at);
      else if (c.Path === ChannelPath.Rotation) {
        Sample(c, t, 4, local, at + 3);
        const l = Math.hypot(local[at + 3], local[at + 4], local[at + 5], local[at + 6]) || 1;
        local[at + 3] /= l; local[at + 4] /= l; local[at + 5] /= l; local[at + 6] /= l;
      } else Sample(c, t, 3, local, at + 7);
    }
  }

  /** Every node's world matrix (16 floats each in `world`) from the local transforms, then placed by `place`. */
  World(local: Float32Array, world: Float32Array, place: Mat4): void {
    const own = scratchMat;
    for (const i of this.Order) {
      LocalMatrix(own, local, i * LOCAL);
      const p = this.Nodes[i].Parent;
      Mul(world.subarray(i * 16, i * 16 + 16), p >= 0 ? world.subarray(p * 16, p * 16 + 16) : place, own);
    }
  }

  /** The world matrices with one looped animation at this time (bounds, tests). */
  Pose(animation: number, time: number): Float32Array {
    const local = new Float32Array(this.Nodes.length * LOCAL);
    this.Rest(local);
    if (animation >= 0) this.Apply({ Animation: animation, Time: time, Looped: true }, local);
    const world = new Float32Array(this.Nodes.length * 16);
    this.World(local, world, Mat4Identity());
    return world;
  }

  /** Each joint's skinning matrix of a skin in this pose (the joint's world after its inverse bind) into `joints`; returns how many. */
  JointMatrices(skin: number, pose: Float32Array, joints: Float32Array): number {
    const s = this.Skins[skin];
    const n = Math.min(s.Joints.length, joints.length / 16);
    for (let j = 0; j < n; j++)
      Mul(joints.subarray(j * 16, j * 16 + 16), pose.subarray(s.Joints[j] * 16, s.Joints[j] * 16 + 16), s.InverseBind.subarray(j * 16, j * 16 + 16));
    return n;
  }

  /** A primitive's vertices in the scene as posed (3 floats each into `result`): skinned by its joints, else moved by its node. */
  PosedPositions(node: number, primitive: Primitive3D, pose: Float32Array, result: Float32Array): void {
    const skin = this.Nodes[node].Skin;
    const p = primitive.Positions, count = primitive.VertexCount;
    if (!(skin >= 0 && skin < this.Skins.length && primitive.Skinned)) {
      const m = pose.subarray(node * 16, node * 16 + 16);
      for (let v = 0; v < count; v++) {
        const x = p[v * 3], y = p[v * 3 + 1], z = p[v * 3 + 2];
        result[v * 3] = m[0] * x + m[4] * y + m[8] * z + m[12];
        result[v * 3 + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
        result[v * 3 + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
      }
      return;
    }
    const joints = new Float32Array(this.Skins[skin].Joints.length * 16);
    const jc = this.JointMatrices(skin, pose, joints);
    const J = primitive.Joints, W = primitive.Weights;
    for (let v = 0; v < count; v++) {
      const x = p[v * 3], y = p[v * 3 + 1], z = p[v * 3 + 2];
      let sx = 0, sy = 0, sz = 0;
      for (let k = 0; k < 4; k++) {
        const j = J[v * 4 + k] | 0, w = W[v * 4 + k];
        if (j < 0 || j >= jc || w === 0) continue;
        const o = j * 16;
        sx += (joints[o] * x + joints[o + 4] * y + joints[o + 8] * z + joints[o + 12]) * w;
        sy += (joints[o + 1] * x + joints[o + 5] * y + joints[o + 9] * z + joints[o + 13]) * w;
        sz += (joints[o + 2] * x + joints[o + 6] * y + joints[o + 10] * z + joints[o + 14]) * w;
      }
      result[v * 3] = sx; result[v * 3 + 1] = sy; result[v * 3 + 2] = sz;
    }
  }

  /** The nearest surface a ray meets: node, primitive, distance; undefined when none. Hidden nodes and materials are passed through. */
  RayHit(pose: Float32Array, hidden: ArrayLike<boolean>, materials: ArrayLike<MaterialOverride | undefined>, from: Vec3, dir: Vec3): { Node: number; Primitive: number; Distance: number } | undefined {
    return this.Ray(pose, hidden, materials, from, dir, Number.MAX_VALUE, false);
  }

  /** Whether any surface lies on the ray closer than `limit` (in units of `dir`). Hidden nodes and materials are passed through. */
  RayBlocked(pose: Float32Array, hidden: ArrayLike<boolean>, materials: ArrayLike<MaterialOverride | undefined>, from: Vec3, dir: Vec3, limit: number): boolean {
    return !!this.Ray(pose, hidden, materials, from, dir, limit, true);
  }

  private Ray(pose: Float32Array, hidden: ArrayLike<boolean>, materials: ArrayLike<MaterialOverride | undefined>, from: Vec3, dir: Vec3, limit: number, anyHit: boolean) {
    let hitNode = -1, hitPrimitive = -1;
    const best = { Distance: limit };
    for (let i = 0; i < this.Nodes.length; i++) {
      const mesh = this.Nodes[i].Mesh;
      if (mesh < 0 || mesh >= this.Meshes.length || hidden[i]) continue;
      const skin = this.Nodes[i].Skin;
      const primitives = this.Meshes[mesh];
      for (let p = 0; p < primitives.length; p++) {
        const primitive = primitives[p];
        if (primitive.Material >= 0 && materials[primitive.Material]?.Hidden) continue;
        if (!(skin >= 0 && skin < this.Skins.length && primitive.Skinned)) {
          // A rigid part: the ray goes into the part's own space and through its box tree. A point along a ray keeps its
          // parameter through an affine map, so distances compare.
          if (!Invert(scratchMat, pose.subarray(i * 16, i * 16 + 16))) continue;
          primitive.Tree ??= RayTree.Build(primitive.Positions, primitive.Indices);
          if (primitive.Tree.Hit(primitive.Positions, primitive.Indices, TransformPoint(scratchMat, from), TransformDir(scratchMat, dir), best, anyHit)) {
            hitNode = i; hitPrimitive = p;
            if (anyHit) return { Node: i, Primitive: p, Distance: best.Distance };
          }
          continue;
        }
        // A skinned part: its vertices where the pose puts them, tested one by one.
        if (rayScratch.length < primitive.Positions.length) rayScratch = new Float32Array(primitive.Positions.length);
        this.PosedPositions(i, primitive, pose, rayScratch);
        const idx = primitive.Indices, n = primitive.VertexCount;
        for (let k = 0; k + 2 < idx.length; k += 3) {
          const a = idx[k], b = idx[k + 1], c = idx[k + 2];
          if (a >= n || b >= n || c >= n) continue;
          const t = RayTriangle(from, dir, rayScratch, a, b, c);
          if (t > 0 && t < best.Distance) {
            best.Distance = t; hitNode = i; hitPrimitive = p;
            if (anyHit) return { Node: i, Primitive: p, Distance: t };
          }
        }
      }
    }
    return hitNode >= 0 ? { Node: hitNode, Primitive: hitPrimitive, Distance: best.Distance } : undefined;
  }

  private RestBounds(): void {
    const pose = this.Pose(-1, 0);
    const lo: Vec3 = [Infinity, Infinity, Infinity], hi: Vec3 = [-Infinity, -Infinity, -Infinity];
    let at = new Float32Array(0);
    for (let i = 0; i < this.Nodes.length; i++) {
      const mesh = this.Nodes[i].Mesh;
      if (mesh < 0 || mesh >= this.Meshes.length) continue;
      for (const p of this.Meshes[mesh]) {
        if (at.length < p.Positions.length) at = new Float32Array(p.Positions.length);
        this.PosedPositions(i, p, pose, at);
        for (let v = 0; v < p.VertexCount; v++)
          for (let k = 0; k < 3; k++) { const x = at[v * 3 + k]; if (x < lo[k]) lo[k] = x; if (x > hi[k]) hi[k] = x; }
      }
    }
    if (lo[0] > hi[0]) { this.BoundsMin = [-1, -1, -1]; this.BoundsMax = [1, 1, 1]; } else { this.BoundsMin = lo; this.BoundsMax = hi; }
  }

  /** View and projection that fit the scene's box, turned by yaw / pitch (degrees), into `out`. */
  Camera(out: Mat4, yaw: number, pitch: number, zoom: number, aspect: number): Mat4 {
    const lo = this.BoundsMin, hi = this.BoundsMax;
    const center: Vec3 = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
    const radius = Math.max(Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / 2, 1e-3);
    const fov = Radians(35);
    const fit = (radius / Math.sin(fov / 2)) * (aspect < 1 ? 1 / aspect : 1);
    const distance = fit * zoom;
    // glam: from_rotation_y(yaw) * from_rotation_x(-pitch), applied to (0, 0, distance).
    const rotation = mulQ(QuatAxisAngle([0, 1, 0], Radians(yaw)), QuatAxisAngle([1, 0, 0], Radians(-pitch)));
    const off = Rotate(rotation, [0, 0, distance]);
    const eye: Vec3 = [center[0] + off[0], center[1] + off[1], center[2] + off[2]];
    LookAt(scratchView, eye, center, [0, 1, 0]);
    PerspectiveGl(scratchProj, fov, aspect, Math.max(distance - radius * 2, distance * 0.01), distance + radius * 2);
    return Mul(out, scratchProj, scratchView);
  }

  /** The ray through a point of the view (fx, fy from 0 to 1, from the top left): its start on the near plane and its direction. */
  static Ray(viewProj: Mat4, fx: number, fy: number): { From: Vec3; Dir: Vec3 } {
    Invert(scratchMat, viewProj);
    const nx = fx * 2 - 1, ny = 1 - fy * 2;
    const near = Project(scratchMat, [nx, ny, -1]), far = Project(scratchMat, [nx, ny, 1]);
    const d: Vec3 = [far[0] - near[0], far[1] - near[1], far[2] - near[2]];
    const l = Math.hypot(d[0], d[1], d[2]) || 1;
    return { From: near, Dir: [d[0] / l, d[1] / l, d[2] / l] };
  }
}

/** A node's local matrix from its 10 floats (t3 r4 s3) at `at`, without allocating. */
function LocalMatrix(out: Mat4, l: Float32Array, at: number): void {
  const x = l[at + 3], y = l[at + 4], z = l[at + 5], w = l[at + 6], sx = l[at + 7], sy = l[at + 8], sz = l[at + 9];
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2, wx = w * x2, wy = w * y2, wz = w * z2;
  out[0] = (1 - (yy + zz)) * sx; out[1] = (xy + wz) * sx; out[2] = (xz - wy) * sx; out[3] = 0;
  out[4] = (xy - wz) * sy; out[5] = (1 - (xx + zz)) * sy; out[6] = (yz + wx) * sy; out[7] = 0;
  out[8] = (xz + wy) * sz; out[9] = (yz - wx) * sz; out[10] = (1 - (xx + yy)) * sz; out[11] = 0;
  out[12] = l[at]; out[13] = l[at + 1]; out[14] = l[at + 2]; out[15] = 1;
}

const mulQ = (a: Quat, b: Quat): Quat => { const [ax, ay, az, aw] = a, [bx, by, bz, bw] = b; return [aw * bx + ax * bw + ay * bz - az * by, aw * by - ax * bz + ay * bw + az * bx, aw * bz + ax * by - ay * bx + az * bw, aw * bw - ax * bx - ay * by - az * bz]; };
const scratchMat = new Float32Array(16), scratchView = new Float32Array(16), scratchProj = new Float32Array(16);
let rayScratch = new Float32Array(0);

/** Where a ray meets triangle (a, b, c) of `p` (3 floats per vertex), both sides (Moller-Trumbore): the distance, 0 = none. */
export function RayTriangle(from: Vec3, dir: Vec3, p: ArrayLike<number>, a: number, b: number, c: number): number {
  const ax = p[a * 3], ay = p[a * 3 + 1], az = p[a * 3 + 2];
  const e1x = p[b * 3] - ax, e1y = p[b * 3 + 1] - ay, e1z = p[b * 3 + 2] - az;
  const e2x = p[c * 3] - ax, e2y = p[c * 3 + 1] - ay, e2z = p[c * 3 + 2] - az;
  const px = dir[1] * e2z - dir[2] * e2y, py = dir[2] * e2x - dir[0] * e2z, pz = dir[0] * e2y - dir[1] * e2x;
  const det = e1x * px + e1y * py + e1z * pz;
  if (det > -1e-9 && det < 1e-9) return 0;
  const inv = 1 / det;
  const sx = from[0] - ax, sy = from[1] - ay, sz = from[2] - az;
  const u = (sx * px + sy * py + sz * pz) * inv;
  if (u < 0 || u > 1) return 0;
  const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
  const v = (dir[0] * qx + dir[1] * qy + dir[2] * qz) * inv;
  if (v < 0 || u + v > 1) return 0;
  const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
  return t > 0 ? t : 0;
}

/** The value of a channel at `t`, `width` floats into `out` at `at`. */
export function Sample(c: Channel3D, t: number, width: number, out: Float32Array, at: number): void {
  const keys = c.Times.length, values = c.Values;
  if (keys === 0 || values.length < keys * width) { out.fill(0, at, at + width); return; }
  // the first key after t (partition point of k <= t)
  let lo = 0, hi = keys;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (c.Times[mid] <= t) lo = mid + 1; else hi = mid; }
  const next = lo;
  if (next === 0) { for (let i = 0; i < width; i++) out[at + i] = values[i]; return; }
  if (next >= keys) { for (let i = 0; i < width; i++) out[at + i] = values[(keys - 1) * width + i]; return; }
  const k0 = next - 1, k1 = next;
  if (c.Step) { for (let i = 0; i < width; i++) out[at + i] = values[k0 * width + i]; return; }
  const span = Math.max(c.Times[k1] - c.Times[k0], 1e-6);
  const f = Math.min(Math.max((t - c.Times[k0]) / span, 0), 1);
  const a0 = k0 * width, b0 = k1 * width;
  if (width === 4) {
    SlerpInto(out, at, values, a0, values, b0, f);
    return;
  }
  for (let i = 0; i < width; i++) out[at + i] = values[a0 + i] + (values[b0 + i] - values[a0 + i]) * f;
}

/**
 * One normal per position, the average of the normals there: an outline pushed along them stays closed at hard edges (a
 * coin's rim, a box's corner). Positions are matched to 1/10000 of a unit.
 */
export function AveragedNormals(positions: Float32Array, normals: Float32Array): Float32Array {
  const n = positions.length / 3;
  const result = new Float32Array(n * 3);
  if (n === 0 || normals.length !== positions.length) return result;
  const groups = new Map<string, number>(), sums: number[] = [], groupOf = new Int32Array(n);
  const q = (v: number) => Math.round(v * 10_000);
  for (let i = 0; i < n; i++) {
    const key = `${q(positions[i * 3])},${q(positions[i * 3 + 1])},${q(positions[i * 3 + 2])}`;
    let g = groups.get(key);
    if (g === undefined) { g = groups.size; groups.set(key, g); sums.push(0, 0, 0); }
    sums[g * 3] += normals[i * 3]; sums[g * 3 + 1] += normals[i * 3 + 1]; sums[g * 3 + 2] += normals[i * 3 + 2];
    groupOf[i] = g;
  }
  for (let i = 0; i < n; i++) {
    const g = groupOf[i], x = sums[g * 3], y = sums[g * 3 + 1], z = sums[g * 3 + 2], l = Math.hypot(x, y, z);
    if (l > 0) { result[i * 3] = x / l; result[i * 3 + 1] = y / l; result[i * 3 + 2] = z / l; }
  }
  return result;
}

/** A bounding-box tree over a rigid primitive's triangles, in the primitive's own units (median split, 6 per leaf). */
export class RayTree {
  // per node: min3 max3 first count second
  private readonly boxes: Float32Array;
  private readonly links: Int32Array;
  private used = 0;
  private readonly tris: Int32Array;

  private constructor(triangles: number) {
    this.tris = new Int32Array(triangles);
    const nodes = Math.max(1, 2 * triangles);
    this.boxes = new Float32Array(nodes * 6);
    this.links = new Int32Array(nodes * 3);
  }

  static Build(positions: Float32Array, indices: Uint32Array): RayTree {
    const count = Math.floor(indices.length / 3), n = positions.length / 3;
    const tree = new RayTree(count);
    const mins = new Float32Array(count * 3), maxs = new Float32Array(count * 3), centers = new Float32Array(count * 3);
    for (let t = 0; t < count; t++) {
      tree.tris[t] = t;
      for (let k = 0; k < 3; k++) {
        let lo = Infinity, hi = -Infinity;
        for (let c = 0; c < 3; c++) { const v = indices[t * 3 + c]; const x = v < n ? positions[v * 3 + k] : 0; if (x < lo) lo = x; if (x > hi) hi = x; }
        mins[t * 3 + k] = lo; maxs[t * 3 + k] = hi; centers[t * 3 + k] = (lo + hi) / 2;
      }
    }
    if (count > 0) tree.Split(0, count, centers, mins, maxs);
    return tree;
  }

  private Split(first: number, count: number, centers: Float32Array, mins: Float32Array, maxs: Float32Array): number {
    const index = this.used++;
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = first; i < first + count; i++) {
      const t = this.tris[i];
      for (let k = 0; k < 3; k++) { if (mins[t * 3 + k] < lo[k]) lo[k] = mins[t * 3 + k]; if (maxs[t * 3 + k] > hi[k]) hi[k] = maxs[t * 3 + k]; }
    }
    this.boxes.set([lo[0], lo[1], lo[2], hi[0], hi[1], hi[2]], index * 6);
    if (count <= 6) { this.links[index * 3] = first; this.links[index * 3 + 1] = count; return index; }
    const sx = hi[0] - lo[0], sy = hi[1] - lo[1], sz = hi[2] - lo[2];
    const axis = sx >= sy && sx >= sz ? 0 : sy >= sz ? 1 : 2;
    const part = Array.from(this.tris.subarray(first, first + count)).sort((a, b) => centers[a * 3 + axis] - centers[b * 3 + axis]);
    this.tris.set(part, first);
    const half = count >> 1;
    this.Split(first, half, centers, mins, maxs);
    this.links[index * 3 + 1] = 0;
    this.links[index * 3 + 2] = this.Split(first + half, count - half, centers, mins, maxs);
    return index;
  }

  /** The nearest triangle the ray meets closer than `best.Distance`, which it then holds; with anyHit the first one found. */
  Hit(positions: Float32Array, indices: Uint32Array, from: Vec3, dir: Vec3, best: { Distance: number }, anyHit: boolean): boolean {
    if (this.used === 0) return false;
    const inv = (v: number) => 1 / (Math.abs(v) < 1e-12 ? 1e-12 : v);
    const ix = inv(dir[0]), iy = inv(dir[1]), iz = inv(dir[2]);
    const stack = hitStack;
    let top = 0, found = false;
    stack[top++] = 0;
    const b = this.boxes, L = this.links;
    while (top > 0) {
      const at = stack[--top];
      // slab test
      let a = (b[at * 6] - from[0]) * ix, c = (b[at * 6 + 3] - from[0]) * ix;
      let enter = Math.min(a, c), leave = Math.max(a, c);
      a = (b[at * 6 + 1] - from[1]) * iy; c = (b[at * 6 + 4] - from[1]) * iy;
      enter = Math.max(enter, Math.min(a, c)); leave = Math.min(leave, Math.max(a, c));
      a = (b[at * 6 + 2] - from[2]) * iz; c = (b[at * 6 + 5] - from[2]) * iz;
      enter = Math.max(enter, Math.min(a, c), 0); leave = Math.min(leave, Math.max(a, c), best.Distance);
      if (enter > leave) continue;
      const count = L[at * 3 + 1];
      if (count > 0) {
        const first = L[at * 3], n = positions.length / 3;
        for (let i = first; i < first + count; i++) {
          const t3 = this.tris[i] * 3, ia = indices[t3], ib = indices[t3 + 1], ic = indices[t3 + 2];
          if (ia >= n || ib >= n || ic >= n) continue;
          const t = RayTriangle(from, dir, positions, ia, ib, ic);
          if (t > 0 && t < best.Distance) { best.Distance = t; found = true; if (anyHit) return true; }
        }
        continue;
      }
      // the first child follows its parent
      stack[top++] = L[at * 3 + 2];
      stack[top++] = at + 1;
    }
    return found;
  }
}
const hitStack = new Int32Array(128);

/** PNG / JPEG / WebP through CanvasKit's codecs, as unpremultiplied RGBA; undefined when not an image. */
export function DecodeImage(encoded: Uint8Array | undefined): Image3D | undefined {
  if (!encoded || encoded.length === 0) return undefined;
  const CK = Super.CK;
  const image = CK.MakeImageFromEncoded(encoded);
  if (!image) return undefined;
  try { return ImagePixels(image); } finally { image.delete(); }
}

/** A CanvasKit image's pixels as unpremultiplied RGBA; undefined when it has none to read. */
export function ImagePixels(image: { width(): number; height(): number; readPixels(x: number, y: number, info: object): Uint8Array | Float32Array | null }): Image3D | undefined {
  const CK = Super.CK;
  const w = image.width(), h = image.height();
  const px = image.readPixels(0, 0, { width: w, height: h, colorType: CK.ColorType.RGBA_8888, alphaType: CK.AlphaType.Unpremul, colorSpace: CK.ColorSpace.SRGB });
  return px instanceof Uint8Array ? { Rgba: px, Width: w, Height: h } : undefined;
}

const WHITE: Image3D = { Rgba: new Uint8Array([255, 255, 255, 255]), Width: 1, Height: 1 };

class GltfReader {
  private readonly buffers: Uint8Array[] = [];
  private readonly accessors: any[];
  private readonly views: any[];
  private readonly textures: any[];
  private animationIndex = 0;

  constructor(private readonly root: any, private readonly bin: Uint8Array | undefined) {
    this.accessors = root.accessors ?? [];
    this.views = root.bufferViews ?? [];
    this.textures = root.textures ?? [];
  }

  Read(): Scene3D {
    for (const b of this.root.buffers ?? []) {
      if (b.uri === undefined) { if (!this.bin) throw new Error("no binary chunk"); this.buffers.push(this.bin); }
      else { const d = DataUri(b.uri); if (!d) throw new Error(`external buffer ${b.uri} (use a .glb)`); this.buffers.push(d); }
    }
    const scene = new Scene3D();
    scene.Images = (this.root.images ?? []).map((i: any) => this.ReadImage(i));
    scene.Materials = (this.root.materials ?? []).map((m: any) => this.ReadMaterial(m));
    scene.Meshes = (this.root.meshes ?? []).map((m: any) => this.ReadMesh(m));
    scene.Skins = (this.root.skins ?? []).map((s: any) => this.ReadSkin(s));
    const nodes: any[] = this.root.nodes ?? [];
    scene.Nodes = nodes.map((n) => this.ReadNode(n));
    nodes.forEach((n, i) => { for (const c of n.children ?? []) if (c >= 0 && c < scene.Nodes.length && c !== i) scene.Nodes[c].Parent = i; });
    scene.Animations = (this.root.animations ?? []).map((a: any) => this.ReadAnimation(a));
    scene.Finish();
    return scene;
  }

  private ReadImage(image: any): Image3D {
    let encoded: Uint8Array | undefined;
    if (typeof image.bufferView === "number") { const v = this.View(image.bufferView); encoded = v.Bytes.subarray(v.Offset, v.Offset + v.Length); }
    else if (typeof image.uri === "string") encoded = DataUri(image.uri);
    return DecodeImage(encoded) ?? WHITE;
  }

  private ReadMaterial(m: any): Material3D {
    const pbr = m.pbrMetallicRoughness ?? {};
    const c = pbr.baseColorFactor;
    const texture = pbr.baseColorTexture?.index;
    return {
      Name: m.name ?? "",
      DoubleSided: m.doubleSided === true,
      Blend: m.alphaMode === "BLEND",
      Color: Array.isArray(c) && c.length === 4 ? [c[0], c[1], c[2], c[3]] : [1, 1, 1, 1],
      Roughness: typeof pbr.roughnessFactor === "number" ? Math.min(Math.max(pbr.roughnessFactor, 0), 1) : 1,
      Texture: typeof texture === "number" && texture >= 0 && texture < this.textures.length && typeof this.textures[texture].source === "number" ? this.textures[texture].source : -1,
    };
  }

  private ReadMesh(mesh: any): Primitive3D[] {
    const result: Primitive3D[] = [];
    for (const p of mesh.primitives ?? []) {
      if ((p.mode ?? 4) !== 4 || !p.attributes || typeof p.attributes.POSITION !== "number") continue;
      const a = p.attributes;
      const primitive = new Primitive3D();
      primitive.Positions = this.Accessor(a.POSITION, 3);
      const n = primitive.VertexCount;
      primitive.Normals = typeof a.NORMAL === "number" ? this.Accessor(a.NORMAL, 3) : new Float32Array(0);
      if (primitive.Normals.length !== n * 3) { primitive.Normals = new Float32Array(n * 3); for (let i = 0; i < n; i++) primitive.Normals[i * 3 + 1] = 1; }
      primitive.Uvs = typeof a.TEXCOORD_0 === "number" ? this.Accessor(a.TEXCOORD_0, 2) : new Float32Array(n * 2);
      if (primitive.Uvs.length !== n * 2) primitive.Uvs = new Float32Array(n * 2);
      if (typeof a.JOINTS_0 === "number" && typeof a.WEIGHTS_0 === "number") {
        const j = this.Accessor(a.JOINTS_0, 4), w = this.Accessor(a.WEIGHTS_0, 4);
        if (j.length === n * 4 && w.length === n * 4) { primitive.Joints = j; primitive.Weights = w; }
      }
      if (typeof p.indices === "number") primitive.Indices = Uint32Array.from(this.Accessor(p.indices, 1));
      else { primitive.Indices = new Uint32Array(n); for (let i = 0; i < n; i++) primitive.Indices[i] = i; }
      primitive.Material = typeof p.material === "number" ? p.material : -1;
      result.push(primitive);
    }
    return result;
  }

  private ReadSkin(skin: any): Skin3D {
    const joints: number[] = skin.joints ?? [];
    const inverse = new Float32Array(joints.length * 16);
    for (let i = 0; i < joints.length; i++) inverse[i * 16] = inverse[i * 16 + 5] = inverse[i * 16 + 10] = inverse[i * 16 + 15] = 1;
    if (typeof skin.inverseBindMatrices === "number") {
      const values = this.Accessor(skin.inverseBindMatrices, 16);
      inverse.set(values.subarray(0, Math.min(values.length, inverse.length)));
    }
    return { Joints: joints, InverseBind: inverse };
  }

  private ReadNode(n: any): Node3D {
    const rest = new Float32Array([0, 0, 0, 0, 0, 0, 1, 1, 1, 1]);
    if (Array.isArray(n.matrix) && n.matrix.length === 16) {
      const d = Decompose(n.matrix);
      rest.set(d.T, 0); rest.set(d.R, 3); rest.set(d.S, 7);
    } else {
      if (Array.isArray(n.translation) && n.translation.length === 3) rest.set(n.translation, 0);
      if (Array.isArray(n.rotation) && n.rotation.length === 4) rest.set(QuatNormalize(n.rotation as Quat), 3);
      if (Array.isArray(n.scale) && n.scale.length === 3) rest.set(n.scale, 7);
    }
    return { Name: n.name ?? "", Parent: -1, Mesh: typeof n.mesh === "number" ? n.mesh : -1, Skin: typeof n.skin === "number" ? n.skin : -1, Rest: rest };
  }

  private ReadAnimation(a: any): Animation3D {
    const index = ++this.animationIndex;
    const samplers: any[] = a.samplers ?? [];
    let duration = 0;
    const channels: Channel3D[] = [];
    for (const c of a.channels ?? []) {
      const sampler = samplers[c.sampler];
      const node = c.target?.node;
      if (!sampler || typeof node !== "number" || node < 0) continue;
      const path = c.target.path;
      const kind = path === "translation" ? ChannelPath.Translation : path === "rotation" ? ChannelPath.Rotation : path === "scale" ? ChannelPath.Scale : -1;
      if (kind < 0 || typeof sampler.input !== "number" || typeof sampler.output !== "number") continue; // morph target weights
      const width = kind === ChannelPath.Rotation ? 4 : 3;
      const interpolation = sampler.interpolation ?? "LINEAR";
      const times = this.Accessor(sampler.input, 1);
      if (times.length > 0) duration = Math.max(duration, times[times.length - 1]);
      let values = this.Accessor(sampler.output, width);
      if (interpolation === "CUBICSPLINE") {
        // keys hold (in tangent, value, out tangent): keep the values
        const kept = new Float32Array(values.length / 3);
        for (let k = 0; (k + 1) * width * 3 <= values.length; k++) kept.set(values.subarray(k * width * 3 + width, k * width * 3 + 2 * width), k * width);
        values = kept;
      }
      channels.push({ Node: node, Path: kind as ChannelPath, Step: interpolation === "STEP", Times: times, Values: values });
    }
    return { Name: a.name ?? `Animation ${index}`, Duration: duration, Channels: channels };
  }

  private View(index: number): { Bytes: Uint8Array; Offset: number; Length: number; Stride: number } {
    const v = this.views[index];
    if (!v) throw new Error(`no buffer view ${index}`);
    const bytes = this.buffers[v.buffer ?? 0];
    if (!bytes) throw new Error(`no buffer ${v.buffer}`);
    const offset = v.byteOffset ?? 0, length = v.byteLength ?? 0;
    if (offset < 0 || length < 0 || offset + length > bytes.length) throw new Error(`buffer view ${index} out of its buffer`);
    return { Bytes: bytes, Offset: offset, Length: length, Stride: v.byteStride ?? 0 };
  }

  /** An accessor as floats, `width` per element (normalized integers mapped to 0..1 / -1..1). */
  private Accessor(index: number, width: number): Float32Array {
    const a = this.accessors[index];
    if (!a) throw new Error(`no accessor ${index}`);
    const count = a.count ?? 0;
    const components = ({ SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 } as Record<string, number>)[a.type] ?? 1;
    const kind = a.componentType ?? 5126, normalized = a.normalized === true;
    const result = new Float32Array(count * width);
    if (typeof a.bufferView !== "number") return result; // all zeros (sparse-only accessors are not read)
    const v = this.View(a.bufferView);
    const size = kind === 5120 || kind === 5121 ? 1 : kind === 5122 || kind === 5123 ? 2 : 4;
    const stride = v.Stride || size * components;
    const start = v.Offset + (a.byteOffset ?? 0);
    const take = Math.min(width, components);
    const dv = new DataView(v.Bytes.buffer, v.Bytes.byteOffset, v.Bytes.byteLength);
    const end = v.Offset + v.Length;
    for (let i = 0; i < count; i++) {
      const at = start + i * stride;
      if (at + size * take > end) throw new Error(`accessor ${index} out of its buffer view`);
      for (let c = 0; c < take; c++) {
        const o = at + c * size;
        let x: number;
        switch (kind) {
          case 5120: x = dv.getInt8(o); if (normalized) x = Math.max(x / 127, -1); break;
          case 5121: x = dv.getUint8(o); if (normalized) x /= 255; break;
          case 5122: x = dv.getInt16(o, true); if (normalized) x = Math.max(x / 32767, -1); break;
          case 5123: x = dv.getUint16(o, true); if (normalized) x /= 65535; break;
          case 5125: x = dv.getUint32(o, true); break;
          default: x = dv.getFloat32(o, true);
        }
        result[i * width + c] = x;
      }
    }
    return result;
  }
}

/** data:...;base64, contents; undefined when not a base64 data URI. */
export function DataUri(uri: string): Uint8Array | undefined {
  if (!uri.startsWith("data:")) return undefined;
  const at = uri.indexOf(";base64,");
  if (at < 0) return undefined;
  try { const s = atob(uri.slice(at + 8)); const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i); return b; }
  catch { return undefined; }
}
