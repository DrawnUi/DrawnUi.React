// Plays a scene's animations: one main animation (looped, once and back, or held on its last frame), a cross-fade from
// the one before, and animations layered on top for other objects. Port of DrawnUi.Add3d Player3D.
import { QuatSlerp } from "./math";
import { LOCAL, type Scene3D, type Track } from "./scene";

export class Player3D {
  /** The main animation; Animation -1 = none. */
  Main: Track = { Animation: -1, Time: 0, Looped: true };
  /** The animation the main one fades from, and the seconds the fade has run. */
  private fading: Track = { Animation: -1, Time: 0, Looped: true };
  private fadeElapsed = 0;
  /** Cross-fade length, seconds. */
  Fade = 0.25;
  /** A once-only animation goes back to this looping one when it ends (-1 = none). */
  private backTo = -1;
  /** Animations playing at the same time as the main one. */
  private readonly layers: Track[] = [];
  Playing = true;
  Speed = 1;
  private old = new Float32Array(0);

  /** Loops the scene's first animation (none when it has none). */
  constructor(scene?: Scene3D) {
    if (scene && scene.Animations.length > 0) this.Main = { Animation: 0, Time: 0, Looped: true };
  }

  get HasMain(): boolean { return this.Main.Animation >= 0; }

  private Start(animation: number, looped: boolean): void {
    if (this.Main.Animation >= 0 && this.Fade > 0) { this.fading = { ...this.Main }; this.fadeElapsed = 0; }
    this.Main = { Animation: animation, Time: 0, Looped: looped };
    this.Playing = true;
  }

  /** Ends a fade at once (the first animation shows without one). */
  FadeNow(): void { this.fading.Animation = -1; }

  /** Loops `animation`, blending into it. */
  Play(animation: number): void { this.backTo = -1; this.Start(animation, true); }

  /** Plays `animation` once, then blends back into the looping one that played before it. */
  PlayOnce(animation: number): void {
    if (this.Main.Animation >= 0 && this.Main.Looped) this.backTo = this.Main.Animation;
    this.Start(animation, false);
  }

  /** Plays `animation` once and stays on its last frame. */
  Hold(animation: number): void { this.backTo = -1; this.Start(animation, false); }

  /** Loops another animation together with the main one. */
  AddLayer(animation: number): void {
    if (!this.layers.some((l) => l.Animation === animation)) this.layers.push({ Animation: animation, Time: 0, Looped: true });
    this.Playing = true;
  }

  RemoveLayer(animation: number): void {
    for (let i = this.layers.length - 1; i >= 0; i--) if (this.layers[i].Animation === animation) this.layers.splice(i, 1);
  }

  /** Something moves: the frames go on. */
  get Busy(): boolean { return this.fading.Animation >= 0 || (this.Playing && (this.Main.Animation >= 0 || this.layers.length > 0)); }

  /** One frame of time. Returns the once-only animation that just ended, -1 when none did. */
  Advance(scene: Scene3D, delta: number): number {
    if (!this.Playing) return -1;
    const step = delta * this.Speed;
    if (this.fading.Animation >= 0) {
      this.fading.Time += step;
      this.fadeElapsed += delta;
      if (this.fadeElapsed >= this.Fade) this.fading.Animation = -1;
    }
    for (const l of this.layers) l.Time += step;
    if (this.Main.Animation < 0) return -1;
    this.Main.Time += step;
    const duration = this.Main.Animation < scene.Animations.length ? scene.Animations[this.Main.Animation].Duration : 0;
    if (this.Main.Looped || this.Main.Time < duration) return -1;
    this.Main.Time = duration;
    const ended = this.Main.Animation;
    if (this.backTo >= 0) { const back = this.backTo; this.backTo = -1; this.Start(back, true); }
    else this.Playing = this.layers.length > 0; // held on its last frame (a death)
    return ended;
  }

  /** The local transform of every node (10 floats each): the file's, then the animations' (blended while fading). */
  Locals(scene: Scene3D, local: Float32Array): void {
    scene.Rest(local);
    if (this.Main.Animation >= 0) {
      if (this.fading.Animation >= 0) {
        const n = scene.Nodes.length;
        if (this.old.length < n * LOCAL) this.old = new Float32Array(n * LOCAL);
        const old = this.old;
        scene.Rest(old);
        scene.Apply(this.fading, old);
        scene.Apply(this.Main, local);
        const w = Math.min(Math.max(this.fadeElapsed / this.Fade, 0), 1);
        for (let i = 0; i < n; i++) {
          const at = i * LOCAL;
          for (const k of [0, 1, 2, 7, 8, 9]) local[at + k] = old[at + k] + (local[at + k] - old[at + k]) * w;
          const q = QuatSlerp([old[at + 3], old[at + 4], old[at + 5], old[at + 6]], [local[at + 3], local[at + 4], local[at + 5], local[at + 6]], w);
          local[at + 3] = q[0]; local[at + 4] = q[1]; local[at + 5] = q[2]; local[at + 6] = q[3];
        }
      } else scene.Apply(this.Main, local);
    }
    for (const layer of this.layers) scene.Apply(layer, local);
  }
}
