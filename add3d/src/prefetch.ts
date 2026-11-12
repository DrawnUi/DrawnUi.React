// Warms 3D controls before they scroll into view, the way images are preloaded (drawnui-cross 6bn): the 3D program starts
// compiling after the first frame with a 3D control on the canvas, then a control within one viewport height of the
// screen (above or below) renders once off screen after a frame, one control per frame. Its first frame on screen then
// only shows that image (or draws with everything uploaded). The same rule as DrawnUI for Rust and .NET.
import type { Canvas, SkiaControl } from "drawnui-react/core";
import { Renderer3D } from "./renderer";

/** A 3D control that can render once ahead of being seen. */
export interface IPrefetch3D {
  /** True once it rendered (ahead or on screen): nothing left to warm. */
  readonly GpuReady: boolean;
  /** Renders once off screen at its measured size: uploads its model and images, makes its target. */
  Prefetch(renderer: Renderer3D): void;
}

type Prefetchable = SkiaControl & IPrefetch3D;

export class Prefetch3D {
  private static readonly waiting = new WeakMap<Canvas, Set<WeakRef<Prefetchable>>>();

  /** Queues a measured control that has not rendered yet; false when it is on no canvas yet. */
  static Add(control: Prefetchable): boolean {
    const canvas = control.Superview;
    if (!canvas) return false;
    let set = Prefetch3D.waiting.get(canvas);
    if (!set) {
      const queue = (set = new Set());
      Prefetch3D.waiting.set(canvas, queue);
      canvas.WasDrawnListeners.add((c) => Prefetch3D.Tick(c, queue));
    }
    set.add(new WeakRef(control));
    return true;
  }

  /** After a frame: renders the first waiting control that is near the screen. */
  private static Tick(canvas: Canvas, waiting: Set<WeakRef<Prefetchable>>): void {
    if (waiting.size === 0) return;
    const renderer = Renderer3D.Of(canvas);
    if (!renderer) return;
    // the program compiles in the GPU process while the next frames go on: nothing is rendered ahead in the frame that
    // starts it, which would wait for the compile
    if (renderer.StartProgram()) { canvas.Update(); return; }
    const screen = canvas.Element.height;
    if (screen <= 0) return;
    for (const ref of waiting) {
      const control = ref.deref();
      if (!control || control.IsDisposed || control.GpuReady) { waiting.delete(ref); continue; }
      const at = Prefetch3D.Estimate(control);
      if (at && at.Height > 0 && at.Bottom > -screen && at.Top < 2 * screen) {
        waiting.delete(ref);
        control.Prefetch(renderer);
        return;
      }
    }
  }

  /** Where a control will be on the canvas, in pixels: its own last layout, else its nearest laid-out ancestor's. */
  private static Estimate(control: SkiaControl) {
    for (let c: SkiaControl | undefined = control; c; c = c.Parent) if (c.DrawingRect.Width > 0 && c.DrawingRect.Height > 0) return c.DrawingRect;
    return undefined;
  }
}
