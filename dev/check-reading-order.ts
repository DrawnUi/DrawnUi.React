// The screen-reader / Tab order of a page that scrolled (`npm run check:reading-order`): a header row above a scroll, a
// footer under it, the scroll's content moved up past the header. The order stays header (left to right), the content
// in its own order, footer: a node inside a scroll is placed by the scroll's box among the nodes outside it, so content
// scrolled above the viewport never comes before the header that stays on top. Inside a scroll the order is the tree
// order (DrawnUi.Net OrderLocked): a viewer's dots never interleave with the controls beside it.
import { readFileSync } from "node:fs";
import { Super, SKRect, SkiaAccessibilityManager, HoverManager, SkiaLayer, SkiaLabel, SkiaScroll, SkiaStack, Aria, Thickness, type AnimatorBase, type Canvas } from "../src/index.ts";

declare const CanvasKitInit: (o: { locateFile: () => string }) => Promise<any>;
const ROOT = process.cwd();
const W = 400, H = 300;
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

(async () => {
  const CK = await CanvasKitInit({ locateFile: () => `${ROOT}/node_modules/canvaskit-wasm/bin/full/canvaskit.wasm` });
  (Super as unknown as { CK: unknown }).CK = CK;
  const face = CK.Typeface.MakeFreeTypeFaceFromData(readFileSync(`${ROOT}/samples/public/fonts/OpenSans-Regular.ttf`).buffer);
  Super.Fonts.set("FontText", new Map([[400, face]])); Super.DefaultTypeface = face; Super.DefaultFontAlias = "FontText";
  SkiaLabel.DefaultAccessibilityRole = Aria.RoleText;

  const fake = new FakeCanvas();
  fake.AccessibilityManager.MinUpdateIntervalMs = 0;
  const label = (text: string, o: Partial<SkiaLabel> = {}) => Object.assign(new SkiaLabel(), { Text: text, ...o });
  const root = new SkiaLayer(); root.WidthRequest = W; root.HeightRequest = H;
  // the header row: Back at the left, Home at the right, on one line
  root.AddSubView(label("Back", { Margin: new Thickness(8, 4, 0, 0) }));
  root.AddSubView(label("Home", { Margin: new Thickness(0, 4, 8, 0), HorizontalOptions: "End" }));
  const content = new SkiaStack(); content.Spacing = 0;
  for (let i = 0; i < 12; i++) content.AddSubView(label(`Item ${i}`, { HeightRequest: 30 }));
  const scroll = new SkiaScroll(); scroll.Margin = new Thickness(0, 40, 0, 0); scroll.HeightRequest = 200; scroll.HorizontalOptions = "Fill"; scroll.Content = content;
  root.AddSubView(scroll);
  root.AddSubView(label("Footer", { Margin: new Thickness(8, 270, 0, 0) }));
  root._superview = fake as unknown as Canvas;
  const surface = CK.MakeSurface(W, H);
  const frame = () => {
    root.Measure(W, H, 1); root.Arrange(new SKRect(0, 0, W, H), W, H, 1);
    root.Render({ Context: { Canvas: surface.getCanvas(), Surface: surface }, Destination: new SKRect(0, 0, W, H), Scale: 1 });
    fake.AccessibilityManager.OnFrameEnd(1, W, H, () => {});
    return fake.AccessibilityManager.Snapshot.map((n) => n.Label).join(",");
  };
  const items = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => `Item ${from + i}`).join(",");
  const top = frame();
  check("at the top: header left to right, the items, the footer", top === `Back,Home,${items(0, 11)},Footer`, top);
  scroll.ViewportOffsetY = -160; // content moved up past the header: items 0-5 are above the scroll's top
  scroll.Update();
  const scrolled = frame();
  check("scrolled: still header, the items in order, footer (no item before the header)", scrolled === `Back,Home,${items(0, 11)},Footer`, scrolled);
  {
    // inside a scroll: tree order (DrawnUi.Net OrderLocked), not position: a viewer on the left whose dots are placed at
    // different heights by a 3D view, the controls of the card on the right beside it. Every dot reads before the
    // controls, in its own order, and no dot lands between two controls
    const row = new SkiaLayer(); row.WidthRequest = W; row.HeightRequest = 400;
    const viewer = new SkiaLayer(); viewer.WidthRequest = 180; viewer.HeightRequest = 400;
    for (const [i, y] of [[0, 300], [1, 20], [2, 150]] as const) viewer.AddSubView(label(`Dot ${i}`, { Margin: new Thickness(10, y, 0, 0), AccessibilityRole: Aria.RoleButton, Tapped: () => {} }));
    const side = new SkiaStack(); side.Spacing = 40; side.Margin = new Thickness(200, 0, 0, 0);
    for (let i = 0; i < 5; i++) side.AddSubView(label(`Control ${i}`, { HeightRequest: 30 }));
    row.AddSubView(viewer); row.AddSubView(side);
    const sc = new SkiaScroll(); sc.HeightRequest = H; sc.HorizontalOptions = "Fill"; sc.Content = row;
    const page = new SkiaLayer(); page.WidthRequest = W; page.HeightRequest = H; page.AddSubView(sc);
    const own = new FakeCanvas(); own.AccessibilityManager.MinUpdateIntervalMs = 0;
    page._superview = own as unknown as Canvas;
    page.Measure(W, H, 1); page.Arrange(new SKRect(0, 0, W, H), W, H, 1);
    page.Render({ Context: { Canvas: surface.getCanvas(), Surface: surface }, Destination: new SKRect(0, 0, W, H), Scale: 1 });
    own.AccessibilityManager.OnFrameEnd(1, W, H, () => {});
    const order = own.AccessibilityManager.Snapshot.map((n) => n.Label).join(",");
    check("inside a scroll the order is the tree order: the viewer's dots, then the controls beside it", order === "Dot 0,Dot 1,Dot 2,Control 0,Control 1,Control 2,Control 3,Control 4", order);
  }
  surface.delete();

  console.log(failures ? `FAIL: ${failures} checks` : "OK: a page's reading order does not change when it scrolls");
  process.exit(failures ? 1 : 0);
})();
