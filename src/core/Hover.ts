import type { SkiaControl } from "./SkiaControl";
import { SKPoint } from "./Gestures";

/**
 * DrawnUI hover (drawnui-cross 6m, C# DrawnView ReportHover / CommitHover): every control under the mouse that takes
 * hover (`ReceivesHover`) is hovered, a card and the button inside it alike, as CSS :hover. Decided from the hit path
 * of one pointer position, by the routing rules of ProcessGestures (visible, not InputTransparent, inside, children
 * not locked, nothing below a control that blocks gestures below).
 * While content moves under the pointer (a scroll glide, fling or pan, a carousel or drawer transition) hover is not
 * tracked and what was hovered stays; one check at the last pointer position follows when it stops, and after
 * controls are added or removed, a cell is rebound, a hovered control is hidden or a scroll jumps. Leaving the canvas
 * clears hover at once. Touch never hovers. No allocation on frames where nothing changes.
 */
export class HoverManager {
  /** The hovered controls, root first. */
  readonly Hovered: SkiaControl[] = [];
  private readonly next: SkiaControl[] = [];
  /** The controls under the pointer at the last hit test, root first, and the pointer in each one's own space. */
  readonly Path: SkiaControl[] = [];
  readonly PathX: number[] = [];
  readonly PathY: number[] = [];
  private readonly movers: SkiaControl[] = [];
  private hasPointer = false;
  private x = 0;
  private y = 0;
  private paused = false;
  private check = false;

  /**
   * The mouse (or a pen in range) moved to (x, y), canvas pixels, nothing pressed. The hit path is taken also while
   * hover waits (the cursor follows it), hover changes only when nothing moves.
   */
  Move(root: SkiaControl | undefined, x: number, y: number): void {
    this.hasPointer = true;
    this.x = x;
    this.y = y;
    this.HitTest(root);
    if (this.paused) return; // content moves under the pointer: what was hovered stays, one check when it stops
    this.check = false;
    this.Apply(true);
  }

  /** Fills Path with the controls under the pointer by the routing rules of ProcessGestures. */
  private HitTest(root: SkiaControl | undefined): void {
    const path = this.Path;
    path.length = 0; this.PathX.length = 0; this.PathY.length = 0;
    if (root && root.IsVisible && !root.InputTransparent) {
      const point = root.TransformPointToLocalSpace(new SKPoint(this.x, this.y));
      if (root.HitIsInside(point.X, point.Y)) root.CollectHovered(point, path, this.PathX, this.PathY);
    }
  }

  /** The pointer left the canvas: nothing is hovered, also while content moves. */
  Leave(): void {
    this.hasPointer = false;
    this.check = false;
    this.Path.length = 0; this.PathX.length = 0; this.PathY.length = 0;
    this.Apply(false);
  }

  /** The controls under a still pointer may have changed: checked once at the end of the frame. */
  RequestCheck(): void { if (this.hasPointer) this.check = true; }

  /** A control that moves its content (MovesContent) while drawn: hover waits while any of them moves. */
  RegisterMover(control: SkiaControl): void { if (this.movers.indexOf(control) < 0) this.movers.push(control); }

  /** End of a frame: pause while content moves, else run a pending check (at most one a frame, none while pressed). */
  AfterFrame(root: SkiaControl | undefined, pressed: boolean): void {
    let moving = false;
    for (let i = this.movers.length - 1; i >= 0; i--) {
      const m = this.movers[i];
      if (m.IsDisposed || !m.Superview) { this.movers.splice(i, 1); continue; }
      if (!moving && m.IsVisible && m.MovesContent()) moving = true;
    }
    if (moving) { this.paused = true; return; }
    if (this.paused) { this.paused = false; this.check = true; }
    // a hovered control (or an ancestor) hidden or removed under a still pointer stops being hovered
    for (let i = 0; i < this.Hovered.length && !this.check; i++) if (!HoverManager.Shown(this.Hovered[i])) this.check = true;
    if (!this.check) return;
    this.check = false;
    if (!this.hasPointer || pressed) return;
    this.HitTest(root);
    this.Apply(true);
  }

  private static Shown(control: SkiaControl): boolean {
    if (control.IsDisposed || !control.Superview) return false;
    for (let c: SkiaControl | undefined = control; c; c = c.Parent) if (!c.IsVisible) return false;
    return true;
  }

  /**
   * The hovered set becomes the controls of the hit path that take hover (`fromPath`), or none: the ones that left get
   * HoverChanged(false), then the new ones (true).
   */
  private Apply(fromPath: boolean): void {
    const now = this.Hovered, next = this.next;
    next.length = 0;
    if (fromPath) for (const c of this.Path) if (c.ReceivesHover) next.push(c);
    if (now.length === next.length) {
      let same = true;
      for (let i = 0; i < now.length && same; i++) same = now[i] === next[i];
      if (same) return;
    }
    const was = now.splice(0);
    now.push(...next);
    for (const c of was) if (now.indexOf(c) < 0) c.ApplyHover(false);
    for (const c of now) if (was.indexOf(c) < 0) c.ApplyHover(true);
  }
}
