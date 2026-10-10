/** Mirrors MAUI Easing: Ease(t) with t in 0..1 (Spring* leave 0..1 on the way). */
export class Easing {
  constructor(private readonly fn: (x: number) => number) {}
  Ease(x: number): number { return this.fn(x); }

  static readonly Linear = new Easing((x) => x);
  static readonly CubicIn = new Easing((x) => x * x * x);
  static readonly CubicOut = new Easing((x) => (x - 1) ** 3 + 1);
  static readonly CubicInOut = new Easing((x) => (x < 0.5 ? 4 * x ** 3 : (x - 1) * (2 * x - 2) ** 2 + 1));
  static readonly SinOut = new Easing((x) => Math.sin((x * Math.PI) / 2));
  static readonly SinIn = new Easing((x) => 1 - Math.cos((x * Math.PI) / 2));
  /** Half a cosine: slow at both ends. */
  static readonly SinInOut = new Easing((x) => -Math.cos(Math.PI * x) / 2 + 0.5);
  /** Leaps to the end, bounces three times and settles. */
  static readonly BounceOut = new Easing(Easing.Bounce);
  /** Bounces three times, then leaps to the end. */
  static readonly BounceIn = new Easing((x) => 1 - Easing.Bounce(1 - x));
  /** Moves away first, then leaps to the end. */
  static readonly SpringIn = new Easing((x) => x * x * ((1.70158 + 1) * x - 1.70158));
  /** Goes a little past the end and comes back. */
  static readonly SpringOut = new Easing((x) => (x - 1) * (x - 1) * ((1.70158 + 1) * (x - 1) + 1.70158) + 1);
  private static Bounce(p: number): number {
    if (p < 1 / 2.75) return 7.5625 * p * p;
    if (p < 2 / 2.75) { p -= 1.5 / 2.75; return 7.5625 * p * p + 0.75; }
    if (p < 2.5 / 2.75) { p -= 2.25 / 2.75; return 7.5625 * p * p + 0.9375; }
    p -= 2.625 / 2.75;
    return 7.5625 * p * p + 0.984375;
  }
  static readonly Default = Easing.CubicInOut;
}
