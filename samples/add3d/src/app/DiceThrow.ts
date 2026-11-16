// Port of Add3dGallery.Shared Pages/DiceThrow.cs.
//
// A throw of two dice in physics, stepped along as it is shown: rigid cubes with rounded corners (edge 1, mass 1) thrown
// across the felt, falling under gravity, bouncing and sliding on their corners with restitution and Coulomb friction,
// kept on the felt by its edges and bumping into each other, until both lie still. The face each die ends on is the
// result, as with real dice.

export type Vec3 = [number, number, number];
/** x, y, z, w (System.Numerics Quaternion). */
export type Quat = [number, number, number, number];

interface Body {
  Position: Vec3;
  Turn: Quat;
  Velocity: Vec3;
  Spin: Vec3;
  /** Time it has lain on the felt barely moving; past a moment it rests and moves no more. */
  Quiet: number;
  /** Time it has stood still on an edge or a corner: past a moment it tips over, as a real die does. */
  Propped: number;
  Resting: boolean;
}

const Step = 1 / 360;
/**
 * Gravity in die edges per second squared: as for a die of about 20 cm, which a die on this felt reads as, so it falls
 * and rolls at the pace the eye expects.
 */
const Gravity = 50;
const Table = -0.5;
/**
 * How far the dice centers may go (die edges from the middle), so they stay in view on narrow screens too. The felt shows
 * no rail there, so a die reaching it only loses its way out, and never leans on it.
 */
const EdgeX = 1.15, EdgeZ = 0.5;
const Restitution = 0.5, Friction = 0.3, ThrowUp = 3.6, ThrowAcross = 3, SpinMin = 16;
const InverseInertia = 6; // cube, mass 1, edge 1: inertia 1/6
const Bump = 1.25; // dice centers keep this apart: faces never sink into each other

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const lengthSq = (a: Vec3): number => dot(a, a);
const normalize = (a: Vec3): Vec3 => scale(a, 1 / Math.sqrt(lengthSq(a)));
/** a * b (Hamilton product): b's rotation first, then a's. */
const quatMul = (a: Quat, b: Quat): Quat => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
const quatNormalize = (q: Quat): Quat => { const l = Math.hypot(q[0], q[1], q[2], q[3]); return [q[0] / l, q[1] / l, q[2] / l, q[3] / l]; };
/** Quaternion.CreateFromAxisAngle. */
export const QuatAxisAngle = (axis: Vec3, angle: number): Quat => { const s = Math.sin(angle / 2); return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(angle / 2)]; };
/** A vector turned by a unit quaternion (Vector3.Transform, Matrix4x4.CreateFromQuaternion + TransformNormal). */
const rotate = (q: Quat, v: Vec3): Vec3 => {
  const [x, y, z, w] = q;
  const tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + y * tz - z * ty, v[1] + w * ty + z * tx - x * tz, v[2] + w * tz + x * ty - y * tx];
};

const FaceAxes: [Vec3, number][] = [[[1, 0, 0], 3], [[-1, 0, 0], 4], [[0, 1, 0], 1], [[0, -1, 0], 6], [[0, 0, 1], 2], [[0, 0, -1], 5]];

export class DiceThrow {
  private readonly radius: number;
  private readonly corners: Vec3[] = [];
  private readonly dice: Body[] = [];
  private time = 0;
  private owed = 0;

  /** Both dice lie still; Faces holds the result. */
  Done = true;
  /** Seconds of the throw so far. */
  get Time(): number { return this.time; }
  readonly Faces = [0, 0];
  Position(die: number): Vec3 { return this.dice[die].Position; }
  Turn(die: number): Quat { return this.dice[die].Turn; }

  /** rounding: the dice's corner radius in die edges. */
  constructor(rounding: number) {
    this.radius = rounding;
    const core = 0.5 - rounding;
    for (let i = 0; i < 8; i++) this.corners.push([(i & 1) === 0 ? -core : core, (i & 2) === 0 ? -core : core, (i & 4) === 0 ? -core : core]);
  }

  /**
   * Throws both dice from where they lie: up, across the felt (direction: -1 left, 1 right, 0 either) and spinning around a
   * random axis. Run then moves them on.
   */
  Throw(at0: Vec3, turn0: Quat, at1: Vec3, turn1: Quat, direction: number, random: () => number): void {
    if (direction === 0) direction = Math.floor(random() * 2) * 2 - 1;
    // the die ahead goes faster than the one behind it, so they rarely run into each other and end apart
    const firstAhead = (at0[0] - at1[0]) * direction > 0;
    this.dice[0] = DiceThrow.Thrown(at0, turn0, -0.85, direction, firstAhead ? 1 : 0.55, random);
    this.dice[1] = DiceThrow.Thrown(at1, turn1, 0.85, direction, firstAhead ? 0.55 : 1, random);
    this.time = this.owed = 0;
    this.Done = false;
  }

  /**
   * Moves the throw on by `seconds` of real time, in fixed physics steps; when both dice lie still (or after 4 s) each is
   * laid exactly flat and Done turns true.
   */
  Run(seconds: number): void {
    if (this.Done) return;
    this.owed = Math.min(this.owed + seconds, 0.1); // a long frame never runs away with the physics
    while (this.owed >= Step && !this.Done) {
      this.owed -= Step;
      this.time += Step;
      this.Advance(this.dice);
      if ((this.dice[0].Resting && this.dice[1].Resting) || this.time >= 4) {
        for (let i = 0; i < 2; i++) this.Faces[i] = DiceThrow.Settle(this.dice[i]);
        this.Done = true;
      }
    }
  }

  private static Thrown(at: Vec3, turn: Quat, home: number, direction: number, pace: number, random: () => number): Body {
    const range = (a: number, b: number) => a + random() * (b - a);
    // both the same way, as from one hand, each toward a spot of its own half of the felt (so they end apart and never
    // live at one edge over many throws), at its own pace
    const target = [home + direction * range(0, 0.3), range(-0.35, 0.35)];
    const across = direction * pace * range(ThrowAcross * 0.7, ThrowAcross) + (target[0] - at[0]) * 2.2;
    const axis = normalize([range(-1, 1), range(-0.4, 0.4), range(-1, 1)]);
    return {
      Position: [...at] as Vec3,
      Turn: [...turn] as Quat,
      Velocity: [across, range(ThrowUp, ThrowUp * 1.3), (target[1] - at[2]) * 2.2],
      Spin: scale(axis, range(SpinMin, SpinMin * 1.5)),
      Quiet: 0, Propped: 0, Resting: false,
    };
  }

  private Advance(dice: Body[]): void {
    const touching = [0, 0];
    const corners: Vec3[][] = [[], []];
    for (let i = 0; i < 2; i++) {
      const d = dice[i];
      d.Velocity[1] -= Gravity * Step;
      // the corners do not move while the contacts are solved: turned once per step
      for (let c = 0; c < 8; c++) corners[i].push(add(d.Position, rotate(d.Turn, this.corners[c])));
      for (const c of corners[i]) if (c[1] - this.radius - Table < 0.02) touching[i]++;
    }

    // a few passes over the corner contacts, so a die landing on an edge or a face shares the impulse
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 0; i < 2; i++) {
        const d = dice[i];
        if (d.Resting) continue;
        for (const corner of corners[i]) {
          const depth = Table - (corner[1] - this.radius);
          if (depth < -0.02) continue;
          // a corner a hair above the felt may come only that close this step; one sunk in is eased out
          const allowed = depth < 0 ? depth / Step : (Math.max(0, depth - 0.002) * 0.2) / Step;
          this.Touch(d, [corner[0], corner[1] - this.radius, corner[2]], [0, 1, 0], allowed);
        }
      }

      // the two dice bump as two balls
      const between = sub(dice[1].Position, dice[0].Position);
      const distance = Math.sqrt(lengthSq(between));
      if (distance < Bump && distance > 1e-4) {
        const n = scale(between, 1 / distance);
        const closing = dot(sub(dice[1].Velocity, dice[0].Velocity), n);
        if (closing < 0) {
          const j = (-(1 + 0.4) * closing) / 2;
          dice[0].Velocity = sub(dice[0].Velocity, scale(n, j));
          dice[1].Velocity = add(dice[1].Velocity, scale(n, j));
          dice[0].Resting = dice[1].Resting = false;
        }
        if (pass === 0) {
          const apart = scale(n, (Bump - distance) / 2);
          dice[0].Position = sub(dice[0].Position, apart);
          dice[1].Position = add(dice[1].Position, apart);
        }
      }
    }

    for (let i = 0; i < 2; i++) {
      const d = dice[i];
      if (d.Resting) { d.Velocity = [0, 0, 0]; d.Spin = [0, 0, 0]; continue; }
      // flat on the felt and barely moving for a moment: it rests (a die never creeps on its own)
      const quiet = touching[i] >= 3 && lengthSq(d.Velocity) < 0.15 * 0.15 && lengthSq(d.Spin) < 0.6 * 0.6;
      d.Quiet = quiet ? d.Quiet + Step : 0;
      // balanced on an edge, which a real die never manages for long: the smallest touch tips it
      const propped = touching[i] < 3 && d.Position[1] < 0.3 && lengthSq(d.Velocity) < 0.25 * 0.25 && lengthSq(d.Spin) < 0.6 * 0.6;
      d.Propped = propped ? d.Propped + Step : 0;
      if (d.Propped > 0.2) {
        const a = this.time * 7 + i;
        d.Spin = add(d.Spin, scale([Math.cos(a), 0, Math.sin(a)], 1.5));
        d.Propped = 0;
      }
      if (d.Quiet > 0.15) { d.Resting = true; d.Velocity = [0, 0, 0]; d.Spin = [0, 0, 0]; continue; }
      // only while it flies or rolls fast: a die slowly tipping over is left alone
      if (lengthSq(d.Velocity) > 1) {
        DiceThrow.Edge(d.Position, d.Velocity, 0, EdgeX);
        DiceThrow.Edge(d.Position, d.Velocity, 2, EdgeZ);
      }
      d.Position = add(d.Position, scale(d.Velocity, Step));
      const w = scale(d.Spin, Step * 0.5);
      const q = quatMul([w[0], w[1], w[2], 0], d.Turn);
      d.Turn = quatNormalize([d.Turn[0] + q[0], d.Turn[1] + q[1], d.Turn[2] + q[2], d.Turn[3] + q[3]]);
    }
  }

  /**
   * The end of the room a die has: past it, its way further out is braked hard (no bounce off a rail nobody sees). Nothing
   * pushes it back, so a die there still tips over freely and never stays propped on an edge.
   */
  private static Edge(position: Vec3, velocity: Vec3, axis: number, limit: number): void {
    if ((position[axis] > limit && velocity[axis] > 0) || (position[axis] < -limit && velocity[axis] < 0)) velocity[axis] *= 0.8;
  }

  /** A corner touching the felt: an impulse that stops it going in (bouncing a part back when fast), then friction. */
  private Touch(d: Body, point: Vec3, n: Vec3, allowed: number): void {
    const r = sub(point, d.Position);
    let velocity = add(d.Velocity, cross(d.Spin, r));
    const vn = dot(velocity, n);
    const target = vn < -1.5 ? Math.max(-Restitution * vn, allowed) : allowed;
    if (vn >= target) return;
    const rn = cross(r, n);
    const j = (target - vn) / (1 + InverseInertia * lengthSq(rn));
    d.Velocity = add(d.Velocity, scale(n, j));
    d.Spin = add(d.Spin, scale(cross(r, scale(n, j)), InverseInertia));

    velocity = add(d.Velocity, cross(d.Spin, r));
    const slide = sub(velocity, scale(n, dot(velocity, n)));
    const speed = Math.sqrt(lengthSq(slide));
    if (speed < 1e-5) return;
    const t = scale(slide, 1 / speed);
    const rt = cross(r, t);
    const jt = Math.min(speed / (1 + InverseInertia * lengthSq(rt)), Friction * j);
    d.Velocity = sub(d.Velocity, scale(t, jt));
    d.Spin = sub(d.Spin, scale(cross(r, scale(t, jt)), InverseInertia));
  }

  /** Lays a die exactly flat on the face nearest the felt (keeping its turn around the vertical); its face up. */
  private static Settle(d: Body): number {
    let best = FaceAxes[0], height = -Infinity;
    for (const f of FaceAxes) {
      const y = rotate(d.Turn, f[0])[1];
      if (y > height) { height = y; best = f; }
    }
    const up = normalize(rotate(d.Turn, best[0]));
    const axis = cross(up, [0, 1, 0]);
    if (lengthSq(axis) > 1e-10) d.Turn = quatNormalize(quatMul(QuatAxisAngle(normalize(axis), Math.acos(Math.min(Math.max(up[1], -1), 1))), d.Turn));
    d.Position[1] = 0;
    d.Velocity = [0, 0, 0]; d.Spin = [0, 0, 0];
    return best[1];
  }
}
