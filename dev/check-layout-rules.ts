// Layout rules as DrawnUI for Rust and DrawnUi.Net (Nick: "React layout rules: match rust"; drawnui-cross 6br), checked
// in Node (`npm run check:layout-rules`), scale 1, the numbers measured headless in Rust and .NET:
// A) Fill with a WidthRequest keeps the requested width, at the start of the parent.
// B) A layer without its own size is as big as its sized children; a Fill child without content fills that size.
// C) Center with unequal margins: the box is centered in the whole space, then moved by the full margin difference.
import { readFileSync } from "node:fs";
import { Super, SKRect, SkiaAccessibilityManager, HoverManager, SkiaLayer, SkiaShape, SkiaLabel, Thickness, type AnimatorBase, type Canvas, type SkiaControl } from "../src/index.ts";

declare const CanvasKitInit: (o: { locateFile: () => string }) => Promise<any>;
const ROOT = process.cwd();
let failures = 0;
const check = (name: string, ok: boolean, detail = "") => { if (!ok) failures++; console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`); };

class FakeCanvas {
  readonly AccessibilityManager = new SkiaAccessibilityManager();
  readonly Hover = new HoverManager();
  readonly AnimatingControls = new Map<number, AnimatorBase>();
  RenderingScale = 1;
  GpuEpoch = 0;
  Update(): void {}
  DisposeObject(o: { Dispose(): void }): void { o.Dispose(); }
  RegisterAnimator(a: AnimatorBase): boolean { this.AnimatingControls.set(a.Uid, a); return true; }
  UnregisterAnimator(uid: number): void { this.AnimatingControls.delete(uid); }
}

const rect = (c: SkiaControl) => { const r = c.DrawingRect; return `${r.Left},${r.Top} ${r.Width}x${r.Height}`; };

(async () => {
  const CK = await CanvasKitInit({ locateFile: () => `${ROOT}/node_modules/canvaskit-wasm/bin/full/canvaskit.wasm` });
  (Super as unknown as { CK: unknown }).CK = CK;
  const face = CK.Typeface.MakeFreeTypeFaceFromData(readFileSync(`${ROOT}/samples/public/fonts/OpenSans-Regular.ttf`).buffer);
  Super.Fonts.set("FontText", new Map([[400, face]])); Super.DefaultTypeface = face; Super.DefaultFontAlias = "FontText";
  const host = (w: number, h: number, ...children: SkiaControl[]) => {
    const root = new SkiaLayer(); root.WidthRequest = w; root.HeightRequest = h;
    for (const c of children) root.AddSubView(c);
    root._superview = new FakeCanvas() as unknown as Canvas;
    for (let i = 0; i < 2; i++) { root.Measure(w, h, 1); root.Arrange(new SKRect(0, 0, w, h), w, h, 1); }
  };

  {
    const a = new SkiaLayer(); a.HorizontalOptions = "Fill"; a.WidthRequest = 100; a.HeightRequest = 50;
    host(400, 300, a);
    check("A: Fill + WidthRequest 100 in 400: 100 wide at the start (Rust 0,0 100x50)", rect(a) === "0,0 100x50", rect(a));
    const v = new SkiaLayer(); v.VerticalOptions = "Fill"; v.WidthRequest = 50; v.HeightRequest = 80;
    host(400, 300, v);
    check("A: Fill + HeightRequest 80 in 300: 80 tall at the start", rect(v) === "0,0 50x80", rect(v));
  }
  {
    const auto = new SkiaLayer(); auto.HorizontalOptions = "Start"; auto.VerticalOptions = "Start";
    const fill = new SkiaShape(); fill.HorizontalOptions = "Fill"; fill.VerticalOptions = "Fill";
    const fixed = new SkiaShape(); fixed.WidthRequest = 120; fixed.HeightRequest = 40;
    auto.AddSubView(fill); auto.AddSubView(fixed);
    host(400, 300, auto);
    check("B: an auto-size layer is 120x40, its Fill child 120x40 (Rust)", rect(auto) === "0,0 120x40" && rect(fill) === "0,0 120x40", `layer ${rect(auto)}, fill ${rect(fill)}`);
  }
  {
    // the hello apps' frosted-glass card: a layer with no size (Fill across, Start down) holding an empty Fill shape and
    // a Fill layer with a label: the Fill child with content still makes the layer full height (.NET: 168 x 168)
    const label = new SkiaLabel(); label.Text = "Wonnabe Frosted Glass"; label.FontSize = 20; label.HorizontalOptions = "Center"; label.VerticalOptions = "Center"; label.HorizontalTextAlignment = "Center";
    const padded = new SkiaLayer(); padded.Padding = new Thickness(8); padded.HorizontalOptions = "Fill"; padded.VerticalOptions = "Fill"; padded.AddSubView(label);
    const under = new SkiaShape(); under.HorizontalOptions = "Fill"; under.VerticalOptions = "Fill";
    const inner = new SkiaLayer(); inner.AddSubView(under); inner.AddSubView(padded);
    host(168, 168, inner);
    check("D: a layer with no size and a Fill child that has content is full size (.NET 168x168)", rect(inner) === "0,0 168x168" && rect(under) === "0,0 168x168", `layer ${rect(inner)}, empty shape ${rect(under)}`);
  }
  for (const [margin, want] of [[new Thickness(0, 110, 0, 0), "175,300 50x20"], [new Thickness(0, 0, 12, 0), "163,190 50x20"]] as const) {
    const s = new SkiaShape(); s.WidthRequest = 50; s.HeightRequest = 20; s.HorizontalOptions = "Center"; s.VerticalOptions = "Center"; s.Margin = margin;
    host(400, 400, s);
    check(`C: Center 50x20 in 400 with margin ${margin.Left},${margin.Top},${margin.Right},${margin.Bottom}: ${want} (Rust)`, rect(s) === want, rect(s));
  }

  console.log(failures ? `FAIL: ${failures} checks` : "OK: layout rules as DrawnUI for Rust");
  process.exit(failures ? 1 : 0);
})();
