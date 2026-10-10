// Controls outside the clip are not drawn (C# layout Virtualisation, DrawnUi.Rust "skipped with its subtree"), checked
// in Node (`npm run check:culling`): a scroll of 200 cards draws only the cards in its viewport at any offset, once
// their caches are recorded (a stale cache is recorded outside the clip too); a card above the viewport whose shadow
// reaches into it is still drawn; the pixels are the cards' own.
import { readFileSync } from "node:fs";
import { Super, SKRect, SkiaAccessibilityManager, HoverManager, SkiaScroll, SkiaStack, SkiaShape, type AnimatorBase, type Canvas } from "../src/index.ts";

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
  readonly disposeQueue: { Dispose(): void }[] = [];
  DisposeObject(o: { Dispose(): void }): void { this.disposeQueue.push(o); }
  RegisterAnimator(a: AnimatorBase): boolean { this.AnimatingControls.set(a.Uid, a); return true; }
  UnregisterAnimator(uid: number): void { this.AnimatingControls.delete(uid); }
}

(async () => {
  const CK = await CanvasKitInit({ locateFile: () => `${ROOT}/node_modules/canvaskit-wasm/bin/full/canvaskit.wasm` });
  (Super as unknown as { CK: unknown }).CK = CK;
  const face = CK.Typeface.MakeFreeTypeFaceFromData(readFileSync(`${ROOT}/samples/public/fonts/OpenSans-Regular.ttf`).buffer);
  Super.Fonts.set("FontText", new Map([[400, face]])); Super.DefaultTypeface = face; Super.DefaultFontAlias = "FontText";

  const W = 300, H = 400, CARD = 60, GAP = 8;
  const painted = new Set<SkiaShape>();
  // drawn = its paint or its cache's blit ran (RenderContent), whatever the cache
  type Drawable = { RenderContent(...a: unknown[]): void };
  const proto = SkiaShape.prototype as unknown as Drawable, renderContent = proto.RenderContent;
  proto.RenderContent = function (this: SkiaShape, ...a: unknown[]) { painted.add(this); renderContent.apply(this, a); };

  const fake = new FakeCanvas();
  const stack = new SkiaStack(); stack.Spacing = GAP;
  const cards: SkiaShape[] = [];
  for (let i = 0; i < 200; i++) {
    const card = new SkiaShape(); card.HeightRequest = CARD; card.HorizontalOptions = "Fill";
    card.BackgroundColor = `#${(i % 256).toString(16).padStart(2, "0")}8040`;
    cards.push(card); stack.AddSubView(card);
  }
  // card 50 casts a shadow 40 pt down: above the viewport its shadow still shows
  cards[50].Shadows = [{ X: 0, Y: 40, Blur: 4, Color: "#FF0000", Opacity: 1 }];
  const scroll = new SkiaScroll(); scroll.Orientation = "Vertical"; scroll.Content = stack;
  scroll._superview = fake as unknown as Canvas;
  const surface = CK.MakeSurface(W, H);
  const frame = () => {
    painted.clear();
    const c = surface.getCanvas(); c.clear(CK.BLACK);
    scroll.Measure(W, H, 1); scroll.Arrange(new SKRect(0, 0, W, H), -1, -1, 1);
    scroll.Render({ Context: { Canvas: c, Surface: surface }, Destination: new SKRect(0, 0, W, H), Scale: 1 });
  };
  const pixel = (x: number, y: number) => { const p = surface.getCanvas().readPixels(x, y, { width: 1, height: 1, colorType: CK.ColorType.RGBA_8888, alphaType: CK.AlphaType.Unpremul, colorSpace: CK.ColorSpace.SRGB }) as Uint8Array; return `${p[0]},${p[1]},${p[2]}`; };
  const indexes = () => [...painted].map((c) => cards.indexOf(c)).sort((a, b) => a - b);

  frame();
  check("the first frame records every card's cache, outside the clip too (as before: no recording moves into the scroll)", indexes().length === 200, `${indexes().length}`);
  frame();
  const first = indexes();
  check("then only the cards in the viewport are drawn", first.length <= 7 && first[0] === 0, first.join(","));
  for (const at of [1000, 5000, 13000]) {
    scroll.ViewportOffsetY = -at; frame();
    const seen = indexes(), lo = Math.floor(at / (CARD + GAP)), hi = Math.floor((at + H) / (CARD + GAP));
    const expected = Array.from({ length: hi - lo + 1 }, (_, k) => lo + k).filter((i) => i < 200);
    const top = cards[lo], row = Math.round(top.DrawingRect.Top) + CARD / 2;
    check(`at ${at} pt: the cards in the viewport are drawn, no other`, seen.join() === expected.join(), `${seen.join(",")} vs ${expected.join(",")}`);
    if (row >= 0 && row < H) check(`at ${at} pt: the pixels are the card's`, pixel(150, row) === `${lo % 256},128,64`, `${pixel(150, row)}`);
  }
  // card 50 spans 3400..3460: viewport from 3470, its shadow reaches 3500
  scroll.ViewportOffsetY = -3470; frame();
  check("a card above the viewport whose shadow shows inside it is drawn", painted.has(cards[50]), indexes().join(","));
  scroll.ViewportOffsetY = -3600; frame();
  check("once its shadow is out too it is skipped", !painted.has(cards[50]), indexes().join(","));

  surface.delete();
  console.log(failures ? `FAIL: ${failures} checks` : "OK: controls outside the clip are not drawn");
  process.exit(failures ? 1 : 0);
})();
