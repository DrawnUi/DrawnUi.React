// A stack child's margins on the cross axis are taken once (arkanoid repro, DrawnUi.Net fix), checked in Node
// (`npm run check:stack-margins`): in a Row a child with Margin (1, 1, 3, 3) and HeightRequest 7.5 draws 7.5 pt high, its
// inner Fill shape (Margin 5, 1.5) fills it less its own margins; in a Column a child with WidthRequest 26 draws 26 pt
// wide, also as templated cells. At scale 2.
import { Super, SKRect, SkiaAccessibilityManager, HoverManager, SkiaLayer, SkiaRow, SkiaStack, SkiaShape, Thickness, type SkiaControl, type AnimatorBase, type Canvas } from "../src/index.ts";

declare const CanvasKitInit: (o: { locateFile: () => string }) => Promise<any>;
const ROOT = process.cwd();
const SCALE = 2;
let failures = 0;
const check = (name: string, ok: boolean, detail = "") => { if (!ok) failures++; console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`); };

class FakeCanvas {
  readonly AccessibilityManager = new SkiaAccessibilityManager();
  readonly Hover = new HoverManager();
  readonly AnimatingControls = new Map<number, AnimatorBase>();
  RenderingScale = SCALE;
  GpuEpoch = 0;
  Update(): void {}
  DisposeObject(o: { Dispose(): void }): void { o.Dispose(); }
  RegisterAnimator(a: AnimatorBase): boolean { this.AnimatingControls.set(a.Uid, a); return true; }
  UnregisterAnimator(uid: number): void { this.AnimatingControls.delete(uid); }
}

(async () => {
  const CK = await CanvasKitInit({ locateFile: () => `${ROOT}/node_modules/canvaskit-wasm/bin/full/canvaskit.wasm` });
  (Super as unknown as { CK: unknown }).CK = CK;

  const layout = (stack: SkiaControl) => {
    const root = new SkiaLayer(); root.WidthRequest = 300; root.HeightRequest = 300; root.AddSubView(stack);
    root._superview = new FakeCanvas() as unknown as Canvas;
    const surface = CK.MakeSurface(300 * SCALE, 300 * SCALE);
    for (let i = 0; i < 2; i++) {
      root.Measure(300 * SCALE, 300 * SCALE, SCALE); root.Arrange(new SKRect(0, 0, 300 * SCALE, 300 * SCALE), -1, -1, SCALE);
      root.Render({ Context: { Canvas: surface.getCanvas(), Surface: surface }, Destination: new SKRect(0, 0, 300 * SCALE, 300 * SCALE), Scale: SCALE });
    }
    surface.delete();
  };
  /** The repro's child: 26 x 7.5 pt, Margin (1, 1, 3, 3), an inner Fill shape with Margin (5, 1.5). */
  const child = () => {
    const s = new SkiaShape(); s.WidthRequest = 26; s.HeightRequest = 7.5; s.Margin = new Thickness(1, 1, 3, 3); s.BackgroundColor = "#808080";
    const inner = new SkiaShape(); inner.HorizontalOptions = "Fill"; inner.VerticalOptions = "Fill"; inner.Margin = new Thickness(5, 1.5); inner.BackgroundColor = "#FFFFFF";
    s.AddSubView(inner);
    return s;
  };
  const inner = (c: SkiaControl) => (c as unknown as { Views: SkiaControl[] }).Views[0];
  const px = (n: number) => Math.round(n * 100) / 100;

  {
    const row = new SkiaRow(); row.Spacing = 3;
    const a = child(), b = child(); row.AddSubView(a); row.AddSubView(b);
    layout(row);
    check("Row: the child draws 7.5 pt high (15 px), its vertical margins taken once", px(a.DrawingRect.Height) === 15 && px(b.DrawingRect.Height) === 15, `${px(a.DrawingRect.Height)} / ${px(b.DrawingRect.Height)} px`);
    check("Row: the inner Fill shape is 7.5 - 3 pt high (9 px)", px(inner(a).DrawingRect.Height) === 9, `${px(inner(a).DrawingRect.Height)} px`);
    check("Row: the child's top is its margin below the row's (2 px)", px(a.DrawingRect.Top - row.DrawingRect.Top) === 2, `${px(a.DrawingRect.Top - row.DrawingRect.Top)} px`);
  }
  {
    // a Fill child without a request in a 20 pt high row: 20 pt less its margins (1 + 3), once
    const row = new SkiaRow(); row.Spacing = 3; row.HeightRequest = 20;
    const a = child(); a.HeightRequest = -1; a.VerticalOptions = "Fill"; row.AddSubView(a);
    layout(row);
    check("Row 20 pt high, a Fill child: 16 pt (32 px)", px(a.DrawingRect.Height) === 32, `${px(a.DrawingRect.Height)} px`);
  }
  {
    const column = new SkiaStack(); column.Spacing = 3;
    const a = child(), b = child(); a.Margin = b.Margin = new Thickness(3, 1, 1, 3); column.AddSubView(a); column.AddSubView(b);
    layout(column);
    check("Column: the child draws 26 pt wide (52 px), its horizontal margins taken once", px(a.DrawingRect.Width) === 52 && px(b.DrawingRect.Width) === 52, `${px(a.DrawingRect.Width)} / ${px(b.DrawingRect.Width)} px`);
    check("Column: the inner Fill shape is 26 - 10 pt wide (32 px)", px(inner(a).DrawingRect.Width) === 32, `${px(inner(a).DrawingRect.Width)} px`);
  }
  {
    const column = new SkiaStack(); column.Spacing = 3;
    column.ItemTemplate = () => { const c = child(); c.Margin = new Thickness(3, 1, 1, 3); return c; };
    column.ItemsSource = [1, 2, 3];
    layout(column);
    const cells = (column as unknown as { Views: SkiaControl[] }).Views;
    const widths = cells.map((c) => px(c.DrawingRect.Width));
    check("templated Column: every cell draws 26 pt wide (52 px)", cells.length === 3 && widths.every((w) => w === 52), widths.join(" / "));
    const rowT = new SkiaRow(); rowT.Spacing = 3;
    rowT.ItemTemplate = child; rowT.ItemsSource = [1, 2, 3];
    layout(rowT);
    const heights = (rowT as unknown as { Views: SkiaControl[] }).Views.map((c) => px(c.DrawingRect.Height));
    check("templated Row: every cell draws 7.5 pt high (15 px)", heights.length === 3 && heights.every((h) => h === 15), heights.join(" / "));
  }

  console.log(failures ? `FAIL: ${failures} checks` : "OK: stack margins taken once on the cross axis");
  process.exit(failures ? 1 : 0);
})();
