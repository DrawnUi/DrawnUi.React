// The drawn dungeon (port of the .NET port's Scene.cs, itself a port of DrawnUi.Rust examples/dungeon scene.rs, the
// `Scene` and `Builder` half). Every frame the visible quads are clipped at the near plane and projected on the CPU
// into one triangle list; its fragment program (mesh.ts) does the materials, the torches and the fog. The game loop
// steps `World` and marks the control to draw again. Float math is rounded as C# float (F), see world.ts.
import type { Paint as SkPaint } from "canvaskit-wasm";
import { SkiaControl, Super, type DrawingContext, type SKRect } from "drawnui-react/core";
import { drawDungeonMesh } from "./mesh";
import { World, RowKind } from "./world";

const F = Math.fround;

/** Segments drawn ahead; the fog hides the end. */
const VISIBLE = 50;
const NEAR = F(0.2);
/**
 * The shader works in coordinates moved back by a multiple of this, so they stay small. A multiple of two torch
 * distances: the torches keep their walls.
 */
const REBASE = 40.0;
/** Floats per vertex: position 2, then three float4. */
export const FLOATS = 14;
const FLOAT_MAX = 3.4028234663852886e38;

const W = World.HALF_WIDTH;
const H = World.HEIGHT;

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
/** C# (byte)(Math.Clamp(channel, 0, 1) * 255). */
const toByte = (channel: number) => Math.trunc(F(clamp(channel, 0.0, 1.0) * 255.0));

export class Scene extends SkiaControl {
  readonly World = new World();

  /** The frame's vertices, kept for their allocation. */
  vertices = new Float32Array(4096 * FLOATS);
  private _floats = 0;

  readonly uniforms = new Float32Array(20);
  private readonly _palette = new Float32Array(9);
  private readonly _rect = new Float32Array(4);
  private _paint?: SkPaint;

  // The builder of the frame: camera in the shader's rebased coordinates, sideways and upward bend per squared unit
  // of depth, sine and cosine of the camera roll, screen center, focal length, bounds.
  private _camX = 0; private _camY = 0; private _camZ = 0;
  private _bendX = 0; private _bendY = 0;
  private _rollSin = 0; private _rollCos = 0;
  private _centerX = 0; private _centerY = 0; private _focal = 0;
  /** The mesh bounds of the last build (not Left / Top: those are the control's own offset). */
  MeshLeft = 0; MeshTop = 0; MeshRight = 0; MeshBottom = 0;
  // Per corner: view xyz, world xyz, uv, glow; and the near-clipped polygon (at most 6 corners).
  private readonly _view = new Float32Array(4 * 9);
  private readonly _polygon = new Float32Array(6 * 9);
  private readonly _projected = new Float32Array(6 * FLOATS);
  private readonly _lanes = new Int32Array(3);

  constructor() {
    super();
    this.UseCache = "None"; // draws every frame; the post effect reads what it drew
  }

  protected override Paint(ctx: DrawingContext): void {
    super.Paint(ctx);

    const world = this.World;
    const rect = ctx.Destination;
    const canvas = ctx.Context.Canvas;
    const p = this._palette; // torch 0..2, accent 3..5, fog 6..8
    world.Palette(0, p, 0);
    world.Palette(1, p, 3);
    world.Palette(2, p, 6);
    // A ghost near: the torches dim, the fog thickens and darkens. The exit's daylight: from 600 units before it,
    // the whole corridor brightens toward it (ambient, torches, the far end), the walls and the floor catch the
    // light from the door; stronger out of the door.
    const dim = F(1.0 - F(F(0.55) * world.Dread));
    const exitLight = F(F(clamp((world.Z - (World.EXIT - 600.0)) / 600.0, 0.0, 1.0)) * F(1.0 + F(F(0.8) * world.Escape)));
    const far = Math.min(F(exitLight * F(0.9)), 1.0);
    const sky0 = 1.0, sky1 = F(0.9), sky2 = F(0.7);
    const keep = F(1.0 - far);
    p[6] = F(F(F(p[6] * dim) * keep) + F(sky0 * far));
    p[7] = F(F(F(p[7] * dim) * keep) + F(sky1 * far));
    p[8] = F(F(F(p[8] * dim) * keep) + F(sky2 * far));

    // What no quad covers is the fog at the end of the corridor (the sky past the exit): the same color the shader
    // fogs to, so the last drawn row has no seam.
    const paint = (this._paint ??= new Super.CK.Paint());
    paint.setColorComponents(toByte(p[6]) / 255, toByte(p[7]) / 255, toByte(p[8]) / 255, 1);
    const r = this._rect;
    r[0] = rect.Left; r[1] = rect.Top; r[2] = rect.Right; r[3] = rect.Bottom;
    canvas.drawRect(r, paint);

    const floats = this.Build(world, rect);
    if (floats === 0) return;
    const bright = F(dim * F(1.0 + F(F(0.7) * exitLight)));
    // Near the exit the air clears (daylight), so the opening reads from far.
    const ramp = F(clamp((world.Z - (World.EXIT - 600.0)) / 600.0, 0.0, 1.0));
    const baseZ = Math.floor(world.Z / REBASE) * REBASE;
    const u = this.uniforms;
    u[0] = world.Time; u[1] = this._camX; u[2] = this._camY; u[3] = this._camZ;
    u[4] = F(p[0] * bright); u[5] = F(p[1] * bright); u[6] = F(p[2] * bright); u[7] = F(World.EXIT - baseZ);
    u[8] = p[3]; u[9] = p[4]; u[10] = p[5]; u[11] = exitLight;
    u[12] = p[6]; u[13] = p[7]; u[14] = p[8]; u[15] = F(F(F(0.028) * F(1.0 - F(F(0.4) * ramp))) + F(F(0.08) * world.Dread));
    u[16] = world.Glare; u[17] = 0.0; u[18] = 0.0; u[19] = 0.0;
    drawDungeonMesh(canvas, this.vertices, floats, u, this.MeshLeft, this.MeshTop, this.MeshRight, this.MeshBottom, rect);
  }

  /** Builds the frame's triangles for `rect` into `vertices` (no canvas needed); returns the float count. */
  Build(world: World, rect: SKRect): number {
    this._floats = 0;
    const baseZ = Math.floor(world.Z / REBASE) * REBASE;
    const onGround = world.Y <= 0 ? 1.0 : 0.0;
    this._camX = F(F(world.X * F(0.92)) + F(F(F(Math.sin(F(world.Time * 90.0))) * F(0.12)) * world.Shake));
    // Going down, the camera sinks to the floor and tips over.
    this._camY = F(F(F(F(F(1.55) - F(F(F(1.2) * world.Fall) * world.Fall)) + F(world.Y * F(0.9)))
      + F(F(F(Math.sin(F(F(world.Z) * F(1.1)))) * F(0.05)) * onGround))
      + F(F(F(Math.cos(F(world.Time * 70.0))) * F(0.1)) * world.Shake));
    this._camZ = F(world.Z - baseZ);
    const d = F(world.Z);
    // The corridor straightens over 600 to 300 units before the exit: from there the way out is dead ahead, and the
    // long stretch to it is drawn as straight quads.
    const straight = F(clamp((World.EXIT - World.EXIT_SIGHT - world.Z) / 300.0, 0.0, 1.0));
    this._bendX = F(F(F(F(0.0032) * F(Math.sin(F(d * F(0.011))))) + F(F(0.0016) * F(Math.sin(F(F(d * F(0.027)) + F(1.3)))))) * straight);
    this._bendY = F(F(F(F(0.0018) * F(Math.sin(F(F(d * F(0.007)) + 0.5)))) - F(0.0006)) * straight);
    const roll = F(F(world.Lean + F(this._bendX * 18.0)) + F(F(F(0.6) * world.Fall) * world.Fall));
    this._rollSin = F(Math.sin(roll));
    this._rollCos = F(Math.cos(roll));
    const left = F(rect.Left), top = F(rect.Top), width = F(F(rect.Right) - left), height = F(F(rect.Bottom) - top);
    this._centerX = F(left + F(width / 2));
    this._centerY = F(top + F(height / 2));
    this._focal = Math.min(F(height * 0.5), F(width * 0.75));
    this.MeshLeft = FLOAT_MAX; this.MeshTop = FLOAT_MAX; this.MeshRight = -FLOAT_MAX; this.MeshBottom = -FLOAT_MAX;
    this.Corridor(world, baseZ);
    return this._floats;
  }

  // ---- the builder ----

  /** A quad given by its corners (uv 0,0 / 1,0 / 1,1 / 0,1): clipped at the near plane, projected. */
  private Quad(ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number,
    dx: number, dy: number, dz: number, material: number, g0: number, g1: number, g2: number, g3: number,
    nx: number, ny: number, nz: number, seed: number): void {
    const view = this._view;
    this.Corner(0, ax, ay, az, 0.0, 0.0, g0);
    this.Corner(1, bx, by, bz, 1.0, 0.0, g1);
    this.Corner(2, cx, cy, cz, 1.0, 1.0, g2);
    this.Corner(3, dx, dy, dz, 0.0, 1.0, g3);
    if (view[2] < NEAR && view[9 + 2] < NEAR && view[18 + 2] < NEAR && view[27 + 2] < NEAR) return;
    const polygon = this._polygon;
    let n = 0;
    for (let k = 0; k < 4; k++) {
      const a = k * 9, b = ((k + 1) % 4) * 9;
      const aIn = view[a + 2] >= NEAR, bIn = view[b + 2] >= NEAR;
      if (aIn) {
        for (let j = 0; j < 9; j++) polygon[n * 9 + j] = view[a + j];
        n++;
      }
      if (aIn !== bIn) {
        const t = F(F(NEAR - view[a + 2]) / F(view[b + 2] - view[a + 2]));
        for (let j = 0; j < 9; j++) polygon[n * 9 + j] = view[a + j] + F(F(view[b + j] - view[a + j]) * t);
        n++;
      }
    }
    if (n < 3) return;
    // Each corner of the polygon projected once, then the fan's triangles copied from them.
    const projected = this._projected;
    for (let k = 0; k < n; k++) this.Project(k * 9, k * FLOATS, material, nx, ny, nz, seed);
    const triangles = n - 2;
    const needed = this._floats + triangles * 3 * FLOATS;
    if (needed > this.vertices.length) {
      const grown = new Float32Array(Math.max(this.vertices.length * 2, needed));
      grown.set(this.vertices.subarray(0, this._floats));
      this.vertices = grown;
    }
    const vertices = this.vertices;
    for (let k = 1; k < n - 1; k++) {
      let o = this._floats;
      for (let j = 0; j < FLOATS; j++) vertices[o++] = projected[j];
      for (let j = k * FLOATS, end = (k + 2) * FLOATS; j < end; j++) vertices[o++] = projected[j];
      this._floats = o;
    }
  }

  private Corner(k: number, px: number, py: number, pz: number, u: number, v: number, glow: number): void {
    const dx = F(px - this._camX), dy = F(py - this._camY), dz = F(pz - this._camZ);
    const ahead = dz > 0 ? dz : 0.0;
    const depth = F(ahead * ahead);
    const bx = F(dx + F(this._bendX * depth)), by = F(dy + F(this._bendY * depth));
    const view = this._view, o = k * 9;
    view[o] = F(bx * this._rollCos) - F(by * this._rollSin);
    view[o + 1] = F(bx * this._rollSin) + F(by * this._rollCos);
    view[o + 2] = dz;
    view[o + 3] = px;
    view[o + 4] = py;
    view[o + 5] = pz;
    view[o + 6] = u;
    view[o + 7] = v;
    view[o + 8] = glow;
  }

  /** Polygon corner `at` projected into the vertex layout at `to` of the scratch. */
  private Project(at: number, to: number, material: number, nx: number, ny: number, nz: number, seed: number): void {
    const p = this._polygon, o = this._projected;
    const w = F(1.0 / p[at + 2]);
    const x = F(this._centerX + F(F(this._focal * p[at]) * w)), y = F(this._centerY - F(F(this._focal * p[at + 1]) * w));
    if (x < this.MeshLeft) this.MeshLeft = x;
    if (y < this.MeshTop) this.MeshTop = y;
    if (x > this.MeshRight) this.MeshRight = x;
    if (y > this.MeshBottom) this.MeshBottom = y;
    o[to] = x;
    o[to + 1] = y;
    o[to + 2] = p[at + 3] * w;
    o[to + 3] = p[at + 4] * w;
    o[to + 4] = p[at + 5] * w;
    o[to + 5] = w;
    o[to + 6] = p[at + 6] * w;
    o[to + 7] = p[at + 7] * w;
    o[to + 8] = material;
    o[to + 9] = p[at + 8] * w;
    o[to + 10] = nx;
    o[to + 11] = ny;
    o[to + 12] = nz;
    o[to + 13] = seed;
  }

  /** A sprite facing the run. */
  private Sprite(x: number, y0: number, y1: number, z: number, halfWidth: number, material: number, seed: number): void {
    const x0 = F(x - halfWidth), x1 = F(x + halfWidth);
    this.Quad(x0, y0, z, x1, y0, z, x1, y1, z, x0, y1, z, material, 0, 0, 0, 0, 0.0, 0.0, -1.0, seed);
  }

  /** Far to near: each segment's floor, ceiling and walls, then what stands in it. */
  private Corridor(world: World, baseZ: number): void {
    const first = Math.floor(world.Z / 2.0);
    // The way out, once in sight: the corridor simply ends, open. Behind the opening, the world outside (one wide
    // quad far off: sky, sun, clouds, mountains in the shader) and the stone floor going on as a terrace; the
    // stretch of corridor past the drawn rows up to the door as four long quads (straight by then).
    const door = World.EXIT_ROW * 2.0 - baseZ;
    if (world.Z >= World.EXIT - World.EXIT_SIGHT) {
      const sky = F(door + 90.0);
      this.Quad(-400, -40, sky, 400, -40, sky, 400, 200, sky, -400, 200, sky, 13.0, 0, 0, 0, 0, 0.0, 0.0, -1.0, 0.0);
      const t0 = F(door), t1 = F(door + 24.0);
      this.Quad(-30, 0, t0, 30, 0, t0, 30, 0, t1, -30, 0, t1, 0.0, 0, 0, 0, 0, 0.0, 1.0, 0.0, 0.0);
      const nearRow = first + VISIBLE;
      if (nearRow < World.EXIT_ROW) {
        const z0 = F(nearRow * 2.0 - baseZ), z1 = F(door);
        this.Quad(-W, 0, z0, W, 0, z0, W, 0, z1, -W, 0, z1, 0.0, 0, 0, 0, 0, 0.0, 1.0, 0.0, 0.0);
        this.Quad(-W, H, z0, W, H, z0, W, H, z1, -W, H, z1, 1.0, 0, 0, 0, 0, 0.0, -1.0, 0.0, 0.0);
        this.Quad(-W, 0, z0, -W, 0, z1, -W, H, z1, -W, H, z0, 2.0, 0, 0, 0, 0, 1.0, 0.0, 0.0, 0.0);
        this.Quad(W, 0, z0, W, 0, z1, W, H, z1, W, H, z0, 2.0, 0, 0, 0, 0, -1.0, 0.0, 0.0, 0.0);
      }
    }
    const f06 = F(0.6), f006 = F(0.06), f01 = F(0.1);
    // the glow at a segment's far end is the one at the near end of the segment drawn before it
    let glowAfter = World.LavaGlow(first + VISIBLE);
    for (let i = first + VISIBLE - 1; i >= first; i--) {
      const g1 = glowAfter, g0 = (glowAfter = World.LavaGlow(i));
      if (i >= World.EXIT_ROW) continue;
      const z0 = F(i * 2.0 - baseZ);
      const z1 = F(z0 + World.SEG);
      const kind = World.GetRow(i);
      const floor = kind.Kind === RowKind.Lava ? 3.0 : 0.0;
      const f0 = F(g0 * f06), f1 = F(g1 * f06), c0 = F(g0 * f006), c1 = F(g1 * f006), w0 = F(g0 * f01), w1 = F(g1 * f01);
      this.Quad(-W, 0, z0, W, 0, z0, W, 0, z1, -W, 0, z1, floor, f0, f0, f1, f1, 0.0, 1.0, 0.0, 0.0);
      this.Quad(-W, H, z0, W, H, z0, W, H, z1, -W, H, z1, 1.0, c0, c0, c1, c1, 0.0, -1.0, 0.0, 0.0);
      this.Quad(-W, 0, z0, -W, 0, z1, -W, H, z1, -W, H, z0, 2.0, g0, g1, w1, w0, 1.0, 0.0, 0.0, 0.0);
      this.Quad(W, 0, z0, W, 0, z1, W, H, z1, W, H, z0, 2.0, g0, g1, w1, w0, -1.0, 0.0, 0.0, 0.0);

      // A torch every fifth segment, on alternating walls (the shader lights from the same places).
      if (World.RemEuclid(i, 5) === 0) {
        const k = World.DivEuclid(i, 5);
        const side = World.RemEuclid(k, 2) === 0 ? 1.0 : -1.0;
        this.Sprite(F(side * F(2.62)), 2.5, F(4.3), F(z0 + F(0.05)), 0.75, 6.0, World.Hash01(k, 3));
      }
      switch (kind.Kind) {
        case RowKind.Pillars:
          this.Pillars(i, kind.Mask, z0);
          break;
        case RowKind.Beam:
          this.Sprite(0.0, F(0.1), 1.0, F(z0 + 1.0), W, 7.0, 0.0);
          break;
        case RowKind.Power:
          if (kind.Power === World.GHOST) {
            // Far: a faint shimmer. Under a second away it reveals itself (`reveal`, 0 to 1: eyes open, it swells
            // and lunges at the camera). The one that took the run leans in over the fallen camera (1 + fall). The
            // glow slot carries the value.
            const distance = F(i * 2.0 + 1.0 - world.Z);
            const reveal = clamp(F(1.0 - F(distance / F(Math.max(world.Speed, 8.0) * F(0.9)))), 0.0, 1.0);
            let state: number, lunge: number, loom: number;
            if (world.Killer === i) { state = F(1.0 + world.Fall); lunge = 0.0; loom = world.Fall; }
            else { state = reveal; lunge = F(reveal * reveal); loom = 0.0; }
            const s = F(Math.sin(F(F(world.Time * F(1.3)) + F(i))));
            const y = F(F(F(F(1.35) + F(F(0.1) * s)) - F(F(0.3) * lunge)) - F(0.75 * loom));
            const half = F(F(1.0 + F(0.5 * lunge)) + F(F(0.2) * loom));
            const x0 = F(kind.Lane * World.LANE - half), x1 = F(kind.Lane * World.LANE + half);
            const z = F(F(z0 + 1.0) - F(F(0.6) * lunge));
            const yb = F(y - half), yt = F(y + half);
            this.Quad(x0, yb, z, x1, yb, z, x1, yt, z, x0, yt, z, 10.0, state, state, state, state, 0.0, 0.0, -1.0, World.Hash01(i, 5));
          } else if (!world.Collected(i)) {
            const y = F(F(1.05) + F(F(0.12) * F(Math.sin(F(F(world.Time * 3.0) + F(i))))));
            const material = kind.Power === World.SHIELD ? 14.0 : 8.0 + kind.Power;
            this.Sprite(kind.Lane * World.LANE, F(y - 0.75), F(y + 0.75), F(z0 + 1.0), 0.75, material, World.Hash01(i, 5));
          }
          break;
        case RowKind.Orb:
          if (!world.Collected(i)) {
            const y = F(1.0 + F(F(0.12) * F(Math.sin(F(F(world.Time * 3.0) + F(i))))));
            this.Sprite(kind.Lane * World.LANE, F(y - F(0.6)), F(y + F(0.6)), F(z0 + 1.0), F(0.6), 5.0, World.Hash01(i, 5));
          }
          break;
      }
    }
  }

  /** The pillars of a row, the one farthest to the side first. */
  private Pillars(i: number, mask: number, z0: number): void {
    // lanes -1, 0, 1 sorted by their sideways distance from the camera, farthest first (a stable sort, as Rust's)
    const lanes = this._lanes;
    lanes[0] = -1; lanes[1] = 0; lanes[2] = 1;
    for (let a = 1; a < 3; a++)
      for (let b = a; b > 0 && this.Offset(lanes[b]) > this.Offset(lanes[b - 1]); b--) {
        const t = lanes[b]; lanes[b] = lanes[b - 1]; lanes[b - 1] = t;
      }
    const f085 = F(0.85);
    for (let l = 0; l < 3; l++) {
      const lane = lanes[l];
      if ((mask & (1 << (lane + 1))) === 0) continue;
      const x0 = F(lane * World.LANE - f085), x1 = F(lane * World.LANE + f085);
      const za = F(z0 + F(0.4)), zb = F(z0 + F(1.6));
      const seed = World.Hash01(i * 4 + lane, 4);
      if (this._camX < x0) this.Quad(x0, 0, zb, x0, 0, za, x0, H, za, x0, H, zb, 4.0, 0, 0, 0, 0, -1.0, 0.0, 0.0, seed);
      if (this._camX > x1) this.Quad(x1, 0, za, x1, 0, zb, x1, H, zb, x1, H, za, 4.0, 0, 0, 0, 0, 1.0, 0.0, 0.0, seed);
      this.Quad(x0, 0, za, x1, 0, za, x1, H, za, x0, H, za, 4.0, 0, 0, 0, 0, 0.0, 0.0, -1.0, seed);
    }
  }

  private Offset(lane: number): number { return Math.abs(F(lane * World.LANE - this._camX)); }

  protected override OnDisposing(): void {
    this._paint?.delete();
    this._paint = undefined;
    super.OnDisposing();
  }
}
