// The rules of the run (port of the .NET port's World.cs, itself a port of DrawnUi.Rust examples/dungeon scene.rs,
// the `World` half). Pure TypeScript, no DrawnUI: the Node check runs this file alone. The corridor is straight in
// the world; the camera bends it with depth (scene.ts), so the rules stay simple and far to near is always the
// drawing order.
//
// Numbers: C# `float` is 32-bit, so every float operation is rounded with Math.fround (F) after each step, float
// literals included, as C# evaluates them; the distance run (Z) and what C# keeps in double stay double. Integers
// (C# long) are plain numbers: rows stay far below 2^53.

const F = Math.fround;

/** What stands in a segment. */
export enum RowKind {
  Empty,
  /** An orb in this lane (-1, 0, 1). */
  Orb,
  /** Pillars in the lanes of the mask (bit = lane + 1): change lane. */
  Pillars,
  /** A beam across the corridor: jump. */
  Beam,
  /** A lava pit: jump. */
  Lava,
  /** A power-up in this lane: HEALTH, SURGE, GHOST or SHIELD. */
  Power,
}

/** A row of the run: its kind and the lane, mask or power that goes with it. Every row is one shared instance. */
export class Row {
  private constructor(readonly Kind: RowKind, readonly Lane = 0, readonly Mask = 0, readonly Power = 0) {}

  static readonly Empty = new Row(RowKind.Empty);
  static readonly Beam = new Row(RowKind.Beam);
  static readonly Lava = new Row(RowKind.Lava);
  private static readonly ORBS = [-1, 0, 1].map((lane) => new Row(RowKind.Orb, lane));
  private static readonly PILLARS = [0, 1, 2, 3, 4, 5, 6, 7].map((mask) => new Row(RowKind.Pillars, 0, mask));
  private static readonly POWERS = [0, 1, 2, 3].flatMap((power) => [-1, 0, 1].map((lane) => new Row(RowKind.Power, lane, 0, power)));
  static Orb(lane: number): Row { return Row.ORBS[lane + 1]; }
  static Pillars(mask: number): Row { return Row.PILLARS[mask]; }
  static PowerUp(lane: number, power: number): Row { return Row.POWERS[power * 3 + lane + 1]; }

  get IsJump(): boolean { return this.Kind === RowKind.Beam || this.Kind === RowKind.Lava; }
  get IsGhost(): boolean { return this.Kind === RowKind.Power && this.Power === World.GHOST; }

  Equals(other: Row): boolean {
    return this.Kind === other.Kind && this.Lane === other.Lane && this.Mask === other.Mask && this.Power === other.Power;
  }
  toString(): string {
    switch (this.Kind) {
      case RowKind.Orb: return `Orb(${this.Lane})`;
      case RowKind.Pillars: return `Pillars(${this.Mask})`;
      case RowKind.Power: return `Power(${this.Lane}, ${this.Power})`;
      default: return RowKind[this.Kind];
    }
  }
}

export enum Phase {
  /** The game plays itself behind the title. */
  Attract,
  /** Three, two, one: the runner stands, nothing is taken from the player yet. */
  Countdown,
  Playing,
  /** The health is gone: the runner goes down. */
  Dead,
  /** Down: GAME OVER stays until a key or a tap brings the title back. */
  Over,
}

/** What a new player should do about what comes next. */
export enum Hint {
  None,
  Jump,
  Lane,
}

/** What the player asked for since the last step. */
export class Input {
  Left = false;
  Right = false;
  Jump = false;
}

// ---- 64-bit hash on 32-bit halves (no BigInt: it runs for every torch, orb and pillar of a frame) ----

let mulHi = 0, mulLo = 0;
/** The low 64 bits of a * b (u64 wrapping multiply), into mulHi / mulLo. */
function mul64(aHi: number, aLo: number, bHi: number, bLo: number): void {
  const a0 = aLo & 0xffff, a1 = aLo >>> 16, b0 = bLo & 0xffff, b1 = bLo >>> 16;
  const mid = a1 * b0 + a0 * b1; // < 2^33, exact
  const low = a0 * b0 + (mid % 65536) * 65536; // < 2^33, exact
  const carry = Math.floor(low / 4294967296);
  mulLo = low >>> 0;
  mulHi = (a1 * b1 + Math.floor(mid / 65536) + carry + Math.imul(aHi, bLo) + Math.imul(aLo, bHi)) >>> 0;
}

/** C#/Rust `1 - exp(-dt * k)` in float. */
function ease(dt: number, k: number): number {
  return F(1 - F(Math.exp(F(-dt * F(k)))));
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/** Torch, accent (lava, runes) and fog colors per zone. */
const PALETTES: Float32Array[][] = [
  [Float32Array.of(1.0, 0.55, 0.22), Float32Array.of(1.0, 0.33, 0.04), Float32Array.of(0.045, 0.02, 0.03)],
  [Float32Array.of(0.35, 0.65, 1.0), Float32Array.of(0.15, 0.85, 1.0), Float32Array.of(0.012, 0.03, 0.07)],
  [Float32Array.of(0.55, 1.0, 0.3), Float32Array.of(0.7, 1.0, 0.08), Float32Array.of(0.02, 0.05, 0.022)],
];

/** The first orb flash, violet: every zone's flash has as much light. */
const FIRST_FLASH = Float32Array.of(F(F(0.62) * F(0.32)), F(F(0.3) * F(0.32)), F(0.32));

/** How long GAME OVER's frozen picture takes to burn away over the title. */
const BURN_SECONDS = F(1.4);
/** A zone of one palette. */
const ZONE = 400.0;
/** What one orb gives back: ten orbs fill one cell of the health (the green cross fills two). */
const ORB_HEALTH = F(0.01);
/** The first orbs and the first hazards of a run. */
const ORBS_FROM = 6;
const HAZARDS_FROM = 16;
const JUMPS_FROM = 90;
/** Seconds before a hazard its prompt shows (longer while the run is young). */
const HINT_LEAD = F(1.2);
/** The run's speed: from the start to the top, gaining 0.012 per unit of distance. */
const START_SPEED = 10.0;
const TOP_SPEED = 24.0;
/** Seconds of running that cost one cell of health. */
const DRAIN_SECONDS = 4.0;
/** How long a shield holds. */
const SHIELD_SECONDS = 10.0;

// Row is a pure function of its number, asked for hundreds of times a frame (the corridor, its lava glow, the
// hints, the dread, the pilot): remembered in a small direct-mapped table (one thread here).
const ROW_CACHE_SIZE = 1024;
const rowKeys = new Float64Array(ROW_CACHE_SIZE).fill(NaN);
const rowValues: Row[] = new Array<Row>(ROW_CACHE_SIZE).fill(Row.Empty);

export class World {
  /** Length of a corridor segment: one row of the run. */
  static readonly SEG = 2.0;
  static readonly HALF_WIDTH = 3.0;
  static readonly HEIGHT = 5.0;
  /** Distance between the three lanes. */
  static readonly LANE = 2.0;
  /** The dungeon ends here: a doorway of light. The last hazards stand 100 units before it. */
  static readonly EXIT = 3000.0;
  /** From this far before the door the way out is in sight (the corridor is straight by then). */
  static readonly EXIT_SIGHT = 300.0;
  static readonly EXIT_ROW = Math.trunc(World.EXIT / 2.0);

  /** Gives 15 percent of the health back. */
  static readonly HEALTH = 0;
  /** Four seconds much faster, through everything unhurt. */
  static readonly SURGE = 1;
  /** The dungeon ghost: it hangs in a lane like a power-up and takes three tenths of the health. */
  static readonly GHOST = 2;
  /** A golden shield: the next pillar or ghost costs nothing (beams and lava still burn). */
  static readonly SHIELD = 3;

  /**
   * The run gets its full share of hazards from this row on; before it the share climbs from a half, and the first
   * beams come at JUMPS_FROM (about 13 seconds in). Lava comes in one event row of four from the first hazards on.
   */
  static readonly RAMP_UNTIL = 304;

  // ---- the run as a function of the row number ----

  /** Bit-exact to the Rust formula: u64 wrapping multiplies and xor-shifts, `(x >> 33) as u32`. */
  static Hash(i: number, salt: number): number {
    // (ulong)i * 0x9E3779B97F4A7C15 ^ salt * 0xBF58476D1CE4E5B9
    mul64(Math.floor(i / 4294967296) >>> 0, i >>> 0, 0x9e3779b9, 0x7f4a7c15);
    let hi = mulHi, lo = mulLo;
    mul64(Math.floor(salt / 4294967296) >>> 0, salt >>> 0, 0xbf58476d, 0x1ce4e5b9);
    hi = (hi ^ mulHi) >>> 0; lo = (lo ^ mulLo) >>> 0;
    // x ^= x >> 30
    lo = (lo ^ ((lo >>> 30) | (hi << 2))) >>> 0; hi = (hi ^ (hi >>> 30)) >>> 0;
    mul64(hi, lo, 0xbf58476d, 0x1ce4e5b9);
    hi = mulHi; lo = mulLo;
    // x ^= x >> 27
    lo = (lo ^ ((lo >>> 27) | (hi << 5))) >>> 0; hi = (hi ^ (hi >>> 27)) >>> 0;
    mul64(hi, lo, 0x94d049bb, 0x133111eb);
    return mulHi >>> 1;
  }

  static Hash01(i: number, salt: number): number { return (World.Hash(i, salt) & 0xffff) / 65536.0; }

  /** Rust i64::div_euclid (floor division for a positive divisor). */
  static DivEuclid(a: number, b: number): number {
    let q = Math.trunc(a / b);
    if (a % b < 0) q = b > 0 ? q - 1 : q + 1;
    return q;
  }

  /** Rust i64::rem_euclid (never negative). */
  static RemEuclid(a: number, b: number): number {
    const r = a % b;
    return r < 0 ? r + Math.abs(b) : r + 0; // + 0: no -0
  }

  private static LaneBit(lane: number): number { return 1 << (lane + 1); }

  private static CountOnes(mask: number): number { return (mask & 1) + ((mask >> 1) & 1) + ((mask >> 2) & 1); }

  /** The lane the orbs of a group of five rows hang in; the pillars after them leave it free. */
  static OrbLane(group: number): number { return (World.Hash(group, 1) % 3) - 1; }

  /** The one lane a double pillar row leaves free, or null. */
  private static OnlyFree(i: number): number | null {
    const r = World.GetRow(i);
    if (r.Kind !== RowKind.Pillars || World.CountOnes(r.Mask) !== 2) return null;
    for (let lane = -1; lane <= 1; lane++) if ((r.Mask & World.LaneBit(lane)) === 0) return lane;
    return null;
  }

  /**
   * The ghost's lane: any, but never the one lane a double pillar row leaves free, neither the row just before it
   * (no time to step aside) nor the row just after it (no lane to step into).
   */
  private static GhostLane(group: number): number {
    const before = World.OnlyFree(group * 5);
    const after = World.OnlyFree((group + 1) * 5);
    let lane = (World.Hash(group, 10) % 3) - 1;
    while (lane === before || lane === after) lane = lane === 1 ? -1 : lane + 1;
    return lane;
  }

  /** The run is a function of the row number: an event every fifth row, orbs in between. */
  static GetRow(i: number): Row {
    const slot = i & (ROW_CACHE_SIZE - 1);
    if (rowKeys[slot] === i) return rowValues[slot];
    const row = World.ComputeRow(i);
    // the recursion inside ComputeRow may have taken another slot only: this one is still ours
    rowKeys[slot] = i;
    rowValues[slot] = row;
    return row;
  }

  private static ComputeRow(i: number): Row {
    // Orbs from the first second, the first hazards a couple of seconds later.
    if (i < ORBS_FROM || i >= World.EXIT_ROW - 50) return Row.Empty;
    const group = World.DivEuclid(i, 5);
    switch (World.RemEuclid(i, 5)) {
      case 0: {
        // A gentle start: half the hazards, lane changes before jumps, the full share after a while.
        if (i < HAZARDS_FROM) return Row.Empty;
        const ramp = clamp(F(F(i - HAZARDS_FROM) / F(World.RAMP_UNTIL - HAZARDS_FROM)), 0, 1);
        // Of a hundred event rows: 38 pillars, 20 beams, 25 lava, the rest empty. Lava skips the ramp.
        const h = World.Hash(group, 2);
        const roll = h % 100;
        const lava = roll >= 75;
        if (!lava && World.Hash01(group, 7) > F(0.5 + F(0.5 * ramp))) return Row.Empty;
        // While the run is slow, a jump lasts about one event row: a jump right after a jump leaves no time to
        // land, so the second is pillars.
        const landing = i < World.RAMP_UNTIL && World.GetRow(i - 5).IsJump;
        if (roll < 38 || (roll < 58 && i < JUMPS_FROM) || ((roll < 58 || lava) && landing)) {
          let o0: number, o1: number;
          switch (World.OrbLane(group - 1)) {
            case -1: o0 = 0; o1 = 1; break;
            case 0: o0 = -1; o1 = 1; break;
            default: o0 = -1; o1 = 0; break;
          }
          switch ((h >>> 8) % 3) {
            case 0: return Row.Pillars(World.LaneBit(o0));
            case 1: return Row.Pillars(World.LaneBit(o1));
            default: return Row.Pillars(World.LaneBit(o0) | World.LaneBit(o1));
          }
        }
        if (roll >= 38 && roll <= 57) return Row.Beam;
        if (roll >= 75) return Row.Lava;
        return Row.Empty;
      }
      // Now and then the middle orb of a group is a power-up: health in one group of twelve, a surge in one of
      // sixteen, a shield in one of twelve, the ghost in 18 % of the groups after the first thirty rows.
      case 3: {
        const pick = World.Hash(group, 6) % 48;
        if (i > 30 && World.Hash(group, 9) % 100 < 18) return Row.PowerUp(World.GhostLane(group), World.GHOST);
        if (pick <= 3) return Row.PowerUp(World.OrbLane(group), World.HEALTH);
        if (pick <= 6) return Row.PowerUp(World.OrbLane(group), World.SURGE);
        if (pick <= 10) return Row.PowerUp(World.OrbLane(group), World.SHIELD);
        return Row.Orb(World.OrbLane(group));
      }
      case 2:
      case 4:
        return Row.Orb(World.OrbLane(group));
      default:
        return Row.Empty;
    }
  }

  /** How much lava lights the boundary before segment j. */
  static LavaGlow(j: number): number {
    const isLava = (i: number) => World.GetRow(i).Kind === RowKind.Lava;
    if (isLava(j) || isLava(j - 1)) return 1.0;
    if (isLava(j + 1) || isLava(j - 2)) return F(0.35);
    return 0.0;
  }

  // ---- state ----

  Phase = Phase.Attract;
  /** Distance run (double). */
  Z = 0.0;
  X = 0.0;
  Y = 0.0;
  private _vy = 0.0;
  private _lane = 0;
  Speed = 12.0;
  Time = 0.0;
  /**
   * Seconds since this run (or the title's own run) began, a JS double: Time is its float32, so the animations and
   * shaders get a few minutes of exact float, never hours.
   */
  private _clock = 0.0;
  private _orbs = 0;
  /** 1 = unhurt; a pillar takes two tenths, a beam one, lava a half; the run ends at 0. */
  Health = 1.0;
  /** Seconds left in which nothing hurts, after a hit. */
  private _invulnerable = 0.0;
  /** The distance of the last run and the best one. */
  Last = 0;
  LastDistance = 0;
  Best = 0;
  /** Rows whose orb was taken, the newest 64. */
  private readonly _collected: number[] = [];
  /** Orbs taken in a row (their rows follow each other), and the row of the last one. */
  Streak = 0;
  private _lastOrb = -10;
  /** The border's violet pulse of an orb, fading. */
  OrbPulse = 0.0;
  private _deadTimer = 0.0;
  /** 1 at a hit, fading. */
  Flash = 0.0;
  /** 1 at a portal (a new zone, a start), fading. */
  Warp = 0.0;
  Shake = 0.0;
  private _zone = 0;
  /** Sideways speed, smoothed: the camera leans into a lane change. */
  Lean = 0.0;
  private _pilotWait = 0.0;
  /** Seconds of countdown left. */
  private _count = 0.0;
  /** 0 to 1: how far the runner went down after the last hit. */
  Fall = 0.0;
  /** 1 when health was just picked up, fading: the green flash and its sparks. */
  Heal = 0.0;
  /** 1 when the ghost just took the run, fading: the pale flash. */
  Ghost = 0.0;
  /** The row of the ghost that took the run: it stays, over the fallen runner. */
  Killer: number | undefined = undefined;
  /** 0..1: a ghost is near ahead: the dungeon darkens. */
  Dread = 0.0;
  /** The ghost that lunged last. */
  private _revealed: number | undefined = undefined;
  /** Ghosts the runner has gone past (hit or not) in this run. */
  GhostsPassed = 0;
  /** Hits taken in this run (the drain is not a hit). */
  Hits = 0;
  /** Seconds the shield still holds (ten from its pickup). */
  Shield = 0.0;
  /** 1 when the shield just took a hit, fading (the golden flash). */
  ShieldBurst = 0.0;
  /** The runner reached the exit: the run ends in light, not on the floor. */
  Escaped = false;
  /** How far the world outside the door is lifted toward white (eyes used to the dark). */
  Glare = F(0.3);
  /** Seconds of the run. */
  RunTime = 0.0;
  /** The fastest escape of the session. */
  BestTime: number | undefined = undefined;
  /** 0 to 1, the white-out after the escape. */
  Escape = 0.0;
  /** 0 to 1, eased: how strong the rays of a surge are. */
  SurgeGlow = 0.0;
  /** 1 to 0 after GAME OVER: how much of its frozen picture still covers the title's run. */
  Burn = 0.0;
  /** 1 = full speed; a pillar stops the runner (0), a beam or lava slows it, then it picks up. */
  private _pace = 1.0;
  /** Seconds of surge left. */
  private _surge = 0.0;
  /** The power-up taken in the last step, until the app asks. */
  private _pickup: number | undefined = undefined;
  /** What Pilot returns: one object reused (C# returns a struct). */
  private readonly _pilotInput = new Input();

  /** How many orbs were taken (the third of a row counts double). */
  get Orbs(): number { return this._orbs; }

  /** How far the run got, in units of the dungeon (shown as meters). */
  get Distance(): number { return Math.trunc(this.Z); }

  /** Whether the orb of row i was taken. */
  Collected(i: number): boolean { return this._collected.includes(i); }

  /** The run is still in its calm start: every hazard comes with its prompt. */
  get Young(): boolean { return this.Z < World.RAMP_UNTIL * 2.0; }

  /** 0..1: how fast the run is, for the effects. */
  get Rush(): number {
    return this._surge > 0 ? 1.0 : clamp(F(F(this.Speed - START_SPEED) / F(TOP_SPEED - START_SPEED)), 0, 1);
  }

  /** The move the nearest hazard ahead asks for, from HINT_LEAD seconds before it (more while young). */
  GetHint(): Hint {
    if (this.Phase !== Phase.Playing) return Hint.None;
    const lead = F(this.Speed * (this.Young ? F(HINT_LEAD * F(1.3)) : HINT_LEAD));
    const first = Math.floor(this.Z / 2.0);
    for (let i = first; i < first + 40; i++) {
      const distance = F(i * 2.0 + 1.0 - this.Z);
      if (distance > lead) return Hint.None;
      const row = World.GetRow(i);
      let hint = Hint.None;
      if (row.IsJump && this.Y <= 0) hint = Hint.Jump;
      else if (row.Kind === RowKind.Pillars && (row.Mask & World.LaneBit(this._lane)) !== 0) hint = Hint.Lane;
      if (hint !== Hint.None && distance >= 0) return hint;
    }
    return Hint.None;
  }

  /** An orb is taken: a little health back, the borders pulse; the third orb of a row counts double. */
  private TakeOrb(row: number): void {
    this.Streak = row === this._lastOrb + 1 ? this.Streak + 1 : 1;
    this._lastOrb = row;
    const count = this.Streak === 3 ? 2 : 1;
    this._orbs += count;
    this.Health = Math.min(F(this.Health + F(ORB_HEALTH * count)), 1.0);
    const power = F(1.0 + F(F(0.3) * (Math.min(this.Streak, 3) - 1)));
    this.OrbPulse = F(F(0.55) * power);
  }

  /** The power-up taken since the last call. */
  TakePickup(): number | undefined {
    const pickup = this._pickup;
    this._pickup = undefined;
    return pickup;
  }

  private Restart(phase: Phase): void {
    this.Z = 0.0; this.X = 0.0; this.Y = 0.0; this._vy = 0.0; this._lane = 0; this._orbs = 0; this._zone = 0;
    this.Health = 1.0; this._invulnerable = 0.0; this._surge = 0.0; this._pace = 1.0; this.Fall = 0.0;
    this._collected.length = 0;
    this.Ghost = 0.0; this.Killer = undefined; this.Dread = 0.0; this._revealed = undefined; this.GhostsPassed = 0; this.Hits = 0;
    this.Escaped = false; this.RunTime = 0.0; this.Escape = 0.0; this.Glare = F(0.3);
    this.Shield = 0.0; this.ShieldBurst = 0.0;
    this.Streak = 0; this._lastOrb = -10; this.OrbPulse = 0.0;
    this._clock = 0.0; this.Time = 0.0;
    this.Phase = phase;
  }

  /** The health is gone: the runner goes down. */
  private Die(): void {
    this.Health = 0.0;
    this.Phase = Phase.Dead;
    // Under the ghost the runner lies a while longer.
    this._deadTimer = this.Killer !== undefined ? F(2.6) : F(1.6);
    this.Last = this.LastDistance = this.Distance;
    this.Best = Math.max(this.Best, this.Last);
  }

  /** A new run, through a portal. */
  Start(): void {
    this.Restart(Phase.Countdown);
    this._count = 3.0; this.Warp = F(0.35);
  }

  /** Back to the title and its own run. */
  ToTitle(): void {
    this.Restart(Phase.Attract);
    this.Burn = 1.0;
  }

  /** Seconds GAME OVER (or the view from outside) has been standing. */
  get OverFor(): number { return this.Phase === Phase.Over ? -this._deadTimer : 0.0; }

  /** The number the countdown shows: 3, 2, 1. */
  get Count(): number | undefined { return this.Phase === Phase.Countdown ? Math.max(Math.ceil(this._count), 1.0) : undefined; }

  /** One step of dt seconds; input is read and cleared (C# `ref Input`). */
  Step(dt: number, input: Input): void {
    dt = F(dt);
    this._clock += dt; this.Time = F(this._clock);
    this.Flash = Math.max(F(this.Flash - F(dt * F(1.6))), 0.0);
    this.Warp = Math.max(F(this.Warp - F(dt * F(1.1))), 0.0);
    this.Shake = Math.max(F(this.Shake - F(dt * 2.5)), 0.0);
    this._invulnerable = Math.max(F(this._invulnerable - dt), 0.0);
    this.Heal = Math.max(F(this.Heal - F(dt * F(1.1))), 0.0);
    this.Ghost = Math.max(F(this.Ghost - F(dt * F(0.7))), 0.0);
    this.ShieldBurst = Math.max(F(this.ShieldBurst - F(dt * F(1.4))), 0.0);
    const glare = this.Z >= World.EXIT ? 0.0
      : F(F(0.15) + F(F(0.15) * F(clamp((World.EXIT - this.Z) / World.EXIT_SIGHT, 0.0, 1.0))));
    this.Glare = F(this.Glare + F(F(glare - this.Glare) * ease(dt, 2.0)));
    if (this.Phase === Phase.Playing) this.Shield = Math.max(F(this.Shield - dt), 0.0);

    // The nearest ghost ahead: dread grows over the last three seconds to it, and when it is less than a second
    // away it reveals itself with a jolt.
    let dread = 0.0;
    if (this.Phase === Phase.Playing) {
      const first = Math.floor(this.Z / 2.0);
      for (let i = first; i < first + 60; i++) {
        if (World.GetRow(i).IsGhost) {
          const distance = F(i * 2.0 + 1.0 - this.Z);
          if (distance > 0) {
            dread = clamp(F(1.0 - F(distance / F(this.Speed * 3.0))), 0.0, 1.0);
            if (distance < F(this.Speed * F(0.9)) && this._revealed !== i) {
              this._revealed = i;
              this.Shake = Math.max(this.Shake, F(0.6)); this.Warp = Math.max(this.Warp, F(0.7));
            }
          }
          break;
        }
      }
    } else if (this.Killer !== undefined) {
      dread = 1.0;
    }
    this.Dread = F(this.Dread + F(F(dread - this.Dread) * ease(dt, 6.0)));
    if (this._revealed !== undefined && this.Z > this._revealed * 2.0 + 1.5) {
      this.GhostsPassed += 1;
      this._revealed = undefined;
    }
    this.OrbPulse = Math.max(F(this.OrbPulse - F(dt * 4.5)), 0.0);

    // Full for the first second of a surge, then fading with the time left.
    const surging = this.Phase !== Phase.Dead ? clamp(F(this._surge / 3.0), 0.0, 1.0) : 0.0;
    this.SurgeGlow = F(this.SurgeGlow + F(F(surging - this.SurgeGlow) * ease(dt, 5.0)));
    if (this.SurgeGlow < F(0.004)) this.SurgeGlow = 0.0;
    if (this.Phase !== Phase.Over) this.Burn = Math.max(F(this.Burn - F(dt / BURN_SECONDS)), 0.0);
    // Down, the picture stays red.
    this.Flash = Math.max(this.Flash, F(F(0.3) * this.Fall));

    let left = input.Left, right = input.Right, jump = input.Jump;
    input.Left = input.Right = input.Jump = false;
    switch (this.Phase) {
      case Phase.Dead:
        left = right = jump = false;
        this.Speed = F(this.Speed * F(Math.exp(F(-dt * 4.0))));
        this._deadTimer = F(this._deadTimer - dt);
        if (this.Escaped) {
          // Drifts on into the light, slowing.
          this.Speed = F(this.Speed * F(Math.exp(F(-dt * F(1.2)))));
          this.Escape = Math.min(F(this.Escape + F(dt / F(1.4))), 1.0);
        } else {
          this.Fall = Math.min(F(this.Fall + F(dt / F(1.1))), 1.0);
        }
        if (this._deadTimer <= 0) this.Phase = Phase.Over;
        break;
      case Phase.Over:
        left = right = jump = false;
        this.Speed = this.Escaped ? F(this.Speed * F(Math.exp(F(-dt * F(1.2))))) : 0.0;
        this._deadTimer = F(this._deadTimer - dt);
        if (this.Escaped) this.Escape = Math.min(F(this.Escape + F(dt / F(1.4))), 1.0);
        // GAME OVER and the view from outside stay until a key or a tap (ToTitle).
        break;
      case Phase.Countdown: {
        left = right = jump = false; this.Speed = 0.0;
        const before = Math.ceil(this._count);
        this._count = F(this._count - dt);
        if (this._count <= 0) { this.Phase = Phase.Playing; this.Warp = 1.0; } // off, through a portal
        else if (Math.ceil(this._count) !== before) this.Warp = Math.max(this.Warp, F(0.35));
        break;
      }
      case Phase.Attract: {
        const taken = this.Pilot(dt);
        left = taken.Left; right = taken.Right; jump = taken.Jump;
        this.Speed = 14.0;
        // The title's run never shows the end: it starts over before the exit's light.
        if (this.Z >= World.EXIT - 700.0) this.Restart(Phase.Attract);
        break;
      }
      case Phase.Playing:
        this.Speed = Math.min(F(START_SPEED + F(F(this.Z) * F(0.012))), TOP_SPEED);
        this.RunTime = F(this.RunTime + dt);
        // The run wears the runner down: a cell of health every DRAIN_SECONDS.
        this.Health = F(this.Health - F(dt / (DRAIN_SECONDS * 10.0)));
        if (this.Health < F(0.005)) this.Die();
        if (this.Z >= World.EXIT + 1.0) {
          // Out, into the light: the run ends like a death without the fall.
          this.Escaped = true; this.Phase = Phase.Dead; this._deadTimer = F(1.8); this.Warp = 1.0;
          this.Last = this.LastDistance = this.Distance;
          this.BestTime = this.BestTime !== undefined ? Math.min(this.BestTime, this.RunTime) : this.RunTime;
        }
        break;
    }
    if (this._surge > 0 && this.Phase !== Phase.Dead) {
      this._surge = F(this._surge - dt);
      this.Speed = F(this.Speed * 1.5);
    }

    if (left) this._lane = Math.max(this._lane - 1, -1);
    if (right) this._lane = Math.min(this._lane + 1, 1);
    if (jump && this.Y <= 0) this._vy = F(7.6);
    const beforeX = this.X;
    this.X = F(this.X + F(F(this._lane * World.LANE - this.X) * ease(dt, 13.0)));
    const sideways = F(F(this.X - beforeX) / Math.max(dt, F(1e-4)));
    this.Lean = F(this.Lean + F(F(F(sideways * F(0.018)) - this.Lean) * ease(dt, 10.0)));
    this.Y = F(this.Y + F(this._vy * dt));
    this._vy = F(this._vy - F(22.0 * dt));
    if (this.Y <= 0) { this.Y = 0.0; this._vy = Math.max(this._vy, 0.0); }

    // The runner is a point half a unit ahead of the camera; what it passed through this step.
    this._pace = Math.min(F(this._pace + F(dt / F(1.1))), 1.0);
    const p0 = this.Z + 0.5, p1 = this.Z + F(F(F(this.Speed * this._pace) * this._pace) * dt) + 0.5;
    this.Z = p1 - 0.5;
    if (this.Phase === Phase.Playing || this.Phase === Phase.Attract) {
      const from = Math.floor(p0 / 2.0), to = Math.floor(p1 / 2.0);
      for (let i = from; i <= to; i++) {
        const z0 = i * 2.0;
        const touches = (a: number, b: number) => p1 >= z0 + a && p0 <= z0 + b;
        const near = (lane: number, reach: number) => Math.abs(F(this.X - lane * World.LANE)) < reach;
        const kind = World.GetRow(i);
        let damage = 0.0;
        switch (kind.Kind) {
          case RowKind.Pillars:
            if (touches(0.4, 1.6))
              for (let lane = -1; lane <= 1; lane++)
                if ((kind.Mask & World.LaneBit(lane)) !== 0 && near(lane, 1.0)) { damage = F(0.2); break; }
            break;
          case RowKind.Beam:
            if (touches(0.85, 1.15) && this.Y < 0.75) damage = F(0.1);
            break;
          case RowKind.Lava:
            if (touches(0.15, 1.85) && this.Y < F(0.05)) damage = F(0.05);
            break;
          case RowKind.Orb:
          case RowKind.Power:
            // The ghost is not collected: a surge or the grace after a hit passes through it, and the one that
            // takes the run stays over the fallen runner.
            if (kind.Kind === RowKind.Power && kind.Power === World.GHOST) {
              if (touches(0.5, 1.5) && near(kind.Lane, F(0.9)) && this.Y < F(1.7)) damage = F(0.3);
              break;
            }
            if (touches(0.5, 1.5) && near(kind.Lane, F(0.9)) && this.Y < F(1.7) && !this._collected.includes(i)) {
              if (this._collected.length >= 64) this._collected.shift();
              this._collected.push(i);
              if (kind.Kind === RowKind.Power) {
                if (kind.Power === World.HEALTH) { this.Health = Math.min(F(this.Health + F(0.15)), 1.0); this.Heal = 1.0; }
                else if (kind.Power === World.SHIELD) this.Shield = SHIELD_SECONDS;
                else { this._surge = 4.0; this.Warp = 1.0; }
                this._pickup = kind.Power;
              } else {
                this.TakeOrb(i);
              }
            }
            break;
        }
        // The title's run cannot be hurt, a surge goes through everything.
        const shielded = this.Shield > 0 && (kind.Kind === RowKind.Pillars || kind.IsGhost);
        if (damage > 0 && this.Phase === Phase.Playing && this._invulnerable <= 0 && this._surge <= 0 && shielded) {
          // The shield takes a pillar or a ghost: nothing lost, no stumble, a golden burst.
          this.Shield = 0.0; this.ShieldBurst = 1.0; this._invulnerable = F(0.8); this.Shake = F(0.4);
        } else if (damage > 0 && this.Phase === Phase.Playing && this._invulnerable <= 0 && this._surge <= 0) {
          this.Health = F(this.Health - damage);
          this.Hits += 1;
          this.Flash = F(F(0.4) + F(damage * 2.0)); this.Shake = F(F(0.5) + F(damage * 2.5)); this._invulnerable = F(0.8);
          if (kind.IsGhost) {
            // The ghost: a blackout, no red flash. When it takes the last of the health it stays in front of the
            // camera, over the runner going down.
            this.Ghost = 1.0; this.Flash = 0.0; this.Shake = F(1.2); this.Warp = 1.0;
            if (this.Health < F(0.005)) {
              this.Killer = i;
              this.Z = z0 - 2.2; this._lane = kind.Lane; this.X = kind.Lane * World.LANE; this._pace = 0.0;
            } else {
              this._pace = F(0.6);
            }
          } else if (kind.Kind === RowKind.Pillars) {
            // A pillar stops the run: thrown back in front of it and aside into the nearest free lane, then up to
            // speed again.
            this._pace = 0.0;
            this.Z = z0 - 0.7;
            let free: number | null = null;
            for (let lane = -1; lane <= 1; lane++)
              if ((kind.Mask & World.LaneBit(lane)) === 0 && (free === null || Math.abs(lane - this._lane) < Math.abs(free - this._lane)))
                free = lane; // the first of equally near lanes, as Rust's min_by_key
            if (free !== null) this._lane = free;
          } else {
            this._pace = F(0.6);
          }
          if (this.Health < F(0.005)) this.Die();
          if (this._pace === 0) break;
        }
      }
    }

    const zone = Math.floor(this.Z / ZONE);
    if (zone !== this._zone) { this._zone = zone; this.Warp = 1.0; }
  }

  /**
   * The title's player: follows the orbs (their lane is the one the next pillars leave free) and jumps what must be
   * jumped. Returns one Input object the world reuses: read it before the next call.
   */
  Pilot(dt: number): Input {
    const input = this._pilotInput;
    input.Left = input.Right = input.Jump = false;
    this._pilotWait = F(this._pilotWait - F(dt));
    // Inside an event row it still wants the lane that row leaves free.
    const group = World.DivEuclid(Math.floor(this.Z / 2.0) - 1, 5);
    const evt = (group + 1) * 5;
    const distance = F(evt * 2.0 + 1.0 - this.Z);
    if (World.GetRow(evt).IsJump && distance > 0 && distance < F(F(this.Speed * F(0.36)) + F(0.3))) input.Jump = true;
    let want = World.OrbLane(group);
    // A ghost, or a shield it has no use for, in the wanted lane: the next lane over until it is passed.
    const avoid = group * 5 + 3;
    const row = World.GetRow(avoid);
    if (row.Kind === RowKind.Power && (row.Power === World.GHOST || row.Power === World.SHIELD) && row.Lane === want && this.Z < avoid * 2.0 + 1.5)
      want = want === 1 ? 0 : want + 1;
    if (want !== this._lane && this._pilotWait <= 0) {
      input.Left = want < this._lane; input.Right = want > this._lane;
      this._pilotWait = F(0.16);
    }
    return input;
  }

  /** The color of the torches where the runner is: the light of the zone. */
  Light(rgb: Float32Array | number[], offset = 0): void { this.Palette(0, rgb, offset); }

  /**
   * The orb flash at the screen's borders: the color of the orbs where the runner is (the zone's accent, channels
   * turned: uAccent.gbr) with as much light as the first flash (the sum of its channels).
   */
  OrbFlash(rgb: Float32Array | number[], offset = 0): void {
    const accent = orbAccent;
    this.Palette(1, accent);
    const c0 = accent[1], c1 = accent[2], c2 = accent[0];
    const k = F(F(F(FIRST_FLASH[0] + FIRST_FLASH[1]) + FIRST_FLASH[2]) / Math.max(F(F(c0 + c1) + c2), F(0.01)));
    rgb[offset] = F(c0 * k);
    rgb[offset + 1] = F(c1 * k);
    rgb[offset + 2] = F(c2 * k);
  }

  /** Torch (0), accent (1) or fog (2) of where the runner is; the last tenth of a zone turns into the next. */
  Palette(which: number, rgb: Float32Array | number[], offset = 0): void {
    const at = this.Z / ZONE;
    const zone = Math.floor(at);
    const t = clamp(F(F(F(at - zone) - F(0.9)) / F(0.1)), 0.0, 1.0);
    const a = PALETTES[zone % PALETTES.length][which];
    const b = PALETTES[(zone + 1) % PALETTES.length][which];
    for (let j = 0; j < 3; j++) rgb[offset + j] = F(a[j] + F(F(b[j] - a[j]) * t));
  }
}

const orbAccent = new Float32Array(3);
