// A child removed from an ImageComposite parent leaves no stale pixels (DrawnUi.Net 5e552b2e, CompositeRemovedChildTests:
// the same object added back elsewhere before the next draw took the erase area with it), checked in Node
// (`npm run check:composite-removed`): pooled "bricks" in a composite-cached layer; one is removed and the SAME control is
// added back at another place (in the same layer, in another layer) before the next frame; ClearChildren and a new
// children set too. Its old place must show the background, every frame after. Also a brick moved by its translation (a
// partial record): drawn at its new place (the composite takes the new area from the current values, not the last render).
import { Super, SKRect, SkiaAccessibilityManager, HoverManager, SkiaLayer, SkiaShape, Thickness, type AnimatorBase, type Canvas, type SkiaCacheType } from "../src/index.ts";

declare const CanvasKitInit: (o: { locateFile: () => string }) => Promise<any>;
const ROOT = process.cwd();
const W = 300, H = 200;
let failures = 0;
const check = (name: string, ok: boolean, detail = "") => { if (!ok) failures++; console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`); };

class FakeCanvas {
  readonly AccessibilityManager = new SkiaAccessibilityManager();
  readonly Hover = new HoverManager();
  readonly AnimatingControls = new Map<number, AnimatorBase>();
  RenderingScale = 1;
  GpuEpoch = 0;
  readonly queue: { Dispose(): void }[] = [];
  Update(): void {}
  DisposeObject(o: { Dispose(): void }): void { this.queue.push(o); }
  RegisterAnimator(a: AnimatorBase): boolean { this.AnimatingControls.set(a.Uid, a); return true; }
  UnregisterAnimator(uid: number): void { this.AnimatingControls.delete(uid); }
  ControlLeft(): void {}
}

(async () => {
  const CK = await CanvasKitInit({ locateFile: () => `${ROOT}/node_modules/canvaskit-wasm/bin/full/canvaskit.wasm` });
  (Super as unknown as { CK: unknown }).CK = CK;

  const brick = (x: number, y: number) => { const b = new SkiaShape(); b.WidthRequest = 40; b.HeightRequest = 20; b.BackgroundColor = "#FF0000"; b.Margin = new Thickness(x, y, 0, 0); return b; };

  const scene = (cache: SkiaCacheType) => {
    const fake = new FakeCanvas();
    const root = new SkiaLayer(); root.WidthRequest = W; root.HeightRequest = H; root.BackgroundColor = "#000000";
    const board = new SkiaLayer(); board.WidthRequest = W; board.HeightRequest = 120; board.UseCache = cache;
    const shelf = new SkiaLayer(); shelf.WidthRequest = W; shelf.HeightRequest = 60; shelf.Margin = new Thickness(0, 130, 0, 0);
    root.AddSubView(board); root.AddSubView(shelf);
    const bricks = [brick(10, 10), brick(60, 10), brick(110, 10), brick(10, 50), brick(60, 50)];
    for (const b of bricks) board.AddSubView(b);
    root._superview = fake as unknown as Canvas;
    const surface = CK.MakeSurface(W, H);
    const frame = () => {
      surface.getCanvas().clear(CK.BLACK);
      root.Measure(W, H, 1); root.Arrange(new SKRect(0, 0, W, H), W, H, 1);
      root.Render({ Context: { Canvas: surface.getCanvas(), Surface: surface }, Destination: new SKRect(0, 0, W, H), Scale: 1 });
      for (const o of fake.queue.splice(0)) o.Dispose();
      const px = surface.makeImageSnapshot().readPixels(0, 0, { width: W, height: H, colorType: CK.ColorType.RGBA_8888, alphaType: CK.AlphaType.Unpremul, colorSpace: CK.ColorSpace.SRGB }) as Uint8Array;
      return (x: number, y: number) => px[(y * W + x) * 4] > 128;
    };
    frame(); frame();
    return { board, shelf, bricks, frame, done: () => surface.delete() };
  };

  for (const cache of ["ImageComposite", "Image", "None"] as SkiaCacheType[]) {
    {
      const s = scene(cache);
      const b = s.bricks[0];
      s.board.RemoveSubView(b); b.Margin = new Thickness(200, 70, 0, 0); b.Update(); s.board.AddSubView(b); // the same object, elsewhere, before the next draw
      let red = s.frame(); red = s.frame();
      check(`${cache}: a brick re-added elsewhere in the same layer leaves no pixels at its old place`, !red(30, 20) && red(220, 80) && red(80, 20), `old ${red(30, 20)}, new ${red(220, 80)}, neighbour ${red(80, 20)}`);
      s.done();
    }
    {
      const s = scene(cache);
      const b = s.bricks[1];
      s.board.RemoveSubView(b); b.Margin = new Thickness(10, 10, 0, 0); b.Update(); s.shelf.AddSubView(b); // moved to another layer
      const red = s.frame();
      check(`${cache}: a brick moved to another layer leaves no pixels in the board`, !red(80, 20) && red(30, 140), `old ${red(80, 20)}, shelf ${red(30, 140)}`);
      s.done();
    }
    {
      const s = scene(cache);
      const pool = [...s.bricks];
      s.board.ClearChildren();
      // a level change: the same pooled bricks, other places, fewer of them
      pool[0].Margin = new Thickness(200, 10, 0, 0); pool[1].Margin = new Thickness(250, 10, 0, 0); pool[0].Update(); pool[1].Update();
      s.board.AddSubView(pool[0]); s.board.AddSubView(pool[1]);
      let red = s.frame(); red = s.frame();
      check(`${cache}: ClearChildren and the same bricks re-added elsewhere: the old places are empty`, !red(30, 20) && !red(80, 20) && !red(130, 20) && !red(30, 60) && red(220, 20) && red(270, 20),
        `old ${[red(30, 20), red(80, 20), red(130, 20), red(30, 60)].join("/")}, new ${red(220, 20)}/${red(270, 20)}`);
      s.done();
    }
  }

  {
    // a brick that only moves (a repaint-only transform) is recorded partially: its old area is erased too
    const s = scene("ImageComposite");
    const b = s.bricks[2];
    b.TranslationX = 100; b.TranslationY = 60; b.RepaintComposition();
    const red = s.frame();
    const mode = (s.board as unknown as { LastCompositeRecord?: { Mode: string } }).LastCompositeRecord?.Mode;
    const later = [s.frame(), s.frame(), s.frame()];
    check("ImageComposite: a brick moved by its translation (a partial record) draws at its new place, none at the old one, on every frame",
      mode === "partial" && !red(130, 20) && red(230, 80) && later.every((f) => !f(130, 20) && f(230, 80)), `record ${mode}, old ${red(130, 20)}, new ${red(230, 80)}`);
    s.done();
  }

  console.log(failures ? `FAIL: ${failures} checks` : "OK: removed children leave no stale pixels");
  process.exit(failures ? 1 : 0);
})();
