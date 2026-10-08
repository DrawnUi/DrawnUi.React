// ImageComposite redraws a change at any depth by its area (drawnui-cross 6m; C# CompositeDeepChangeTests, Rust
// composite_deep_change.rs), checked in Node through the real reconciler (`npm run check:composite`): a list whose cards
// sit in an uncached inner stack; a card's color change erases and redraws only that card's area, the other cards are
// not even drawn; a moved card (transform on the way) is redrawn where it was and where it is now, overflow included;
// an effect on the way draws the inner stack whole; a layout change or too many areas record whole. Every state's
// pixels equal a render of the same state without the composite.
import { readFileSync } from "node:fs";
import { SkiaLabel, SkiaShape, SkiaStack } from "../src/react/index.tsx";
import { createDrawnRoot } from "../src/react/reconciler.ts";
import {
  Super, SKRect, Thickness, SkiaAccessibilityManager, HoverManager, SkiaEffect, SkiaControl, SkiaLayer as SkiaLayerCtrl, SkiaStack as SkiaStackCtrl, type SkiaCacheType,
  type DrawingContext, type SkiaShape as SkiaShapeCtrl, type AnimatorBase, type Canvas,
} from "../src/index.ts";

declare const CanvasKitInit: (o: { locateFile: () => string }) => Promise<any>;
const ROOT = process.cwd();
const W = 300, H = 400;
let failures = 0;
const check = (name: string, ok: boolean, detail = "") => { if (!ok) failures++; console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`); };

/** Stands in for the engine Canvas: what controls, animators and the reconciler call on it. */
class FakeCanvas {
  readonly AccessibilityManager = new SkiaAccessibilityManager();
  readonly Hover = new HoverManager();
  readonly AnimatingControls = new Map<number, AnimatorBase>();
  RenderingScale = 1;
  GpuEpoch = 0;
  private content?: SkiaControl;
  get Content(): SkiaControl | undefined { return this.content; }
  set Content(v: SkiaControl | undefined) { this.content = v; if (v) { v.Parent = undefined; v._superview = this as unknown as Canvas; } }
  Update(): void {}
  readonly disposeQueue: { Dispose(): void }[] = [];
  DisposeObject(o: { Dispose(): void }): void { this.disposeQueue.push(o); }
  RegisterAnimator(a: AnimatorBase): boolean { this.AnimatingControls.set(a.Uid, a); return true; }
  UnregisterAnimator(uid: number): void { this.AnimatingControls.delete(uid); }
}

const PADDING = new Thickness(12);
const COLORS = ["#4682B4", "#FFA500", "#2E8B57", "#800080", "#FFD700"];
type State = { count?: number; colors?: Record<number, string>; tx?: Record<number, number>; height?: Record<number, number>; caption?: string; effect?: boolean };

(async () => {
  const CK = await CanvasKitInit({ locateFile: () => `${ROOT}/node_modules/canvaskit-wasm/bin/full/canvaskit.wasm` });
  (Super as unknown as { CK: unknown }).CK = CK;
  Super.Fonts.set("FontText", new Map([[400, CK.Typeface.MakeFreeTypeFaceFromData(readFileSync(`${ROOT}/samples/public/fonts/OpenSans-Regular.ttf`).buffer)]]));
  Super.DefaultFontAlias = "FontText";
  const effect = new SkiaEffect();
  const withEffect = [effect], noEffects: SkiaEffect[] = [];

  /** A caption, then the cards in an uncached inner stack: the shape of DrawnCamera's Background panel. */
  const host = (composite: boolean) => {
    const fake = new FakeCanvas();
    const root = createDrawnRoot(fake as unknown as Canvas);
    const surface = CK.MakeSurface(W, H);
    const refs: { list?: SkiaStackCtrl; inner?: SkiaStackCtrl; caption?: SkiaControl; cards: SkiaShapeCtrl[] } = { cards: [] };
    const tree = (s: State) => {
      const count = s.count ?? 5;
      refs.cards = [];
      return (
        <SkiaStack ref={(c: SkiaStackCtrl | null) => { if (c) refs.list = c; }} Padding={PADDING} Spacing={8} UseCache={composite ? "ImageComposite" : "None"}>
          <SkiaLabel ref={(c: SkiaControl | null) => { if (c) refs.caption = c; }} Text="Presets" TextColor={s.caption ?? "#FFFFFF"} FontSize={14} />
          <SkiaStack ref={(c: SkiaStackCtrl | null) => { if (c) refs.inner = c; }} Spacing={8} VisualEffects={s.effect ? withEffect : noEffects}>
            {Array.from({ length: count }, (_, i) => (
              <SkiaShape key={i} ref={(c: SkiaShapeCtrl | null) => { if (c) refs.cards[i] = c; }} CornerRadius={10} HeightRequest={s.height?.[i] ?? (count > 5 ? 10 : 40)}
                HorizontalOptions="Fill" BackgroundColor={s.colors?.[i] ?? COLORS[i % COLORS.length]} StrokeColor="#FFFFFF" StrokeWidth={1} UseCache="Image" TranslationX={s.tx?.[i] ?? 0} />
            ))}
          </SkiaStack>
        </SkiaStack>
      );
    };
    const frame = () => {
      const canvas = surface.getCanvas();
      canvas.clear(CK.BLACK);
      const list = fake.Content!;
      list.Measure(W, H, 1);
      list.Arrange(new SKRect(0, 0, W, H), list.WidthRequest, list.HeightRequest, 1);
      list.Render({ Context: { Canvas: canvas, Surface: surface }, Destination: new SKRect(0, 0, W, H), Scale: 1 });
      surface.flush();
      for (const o of fake.disposeQueue.splice(0)) o.Dispose();
    };
    const render = async (s: State, frames = 2) => { root.render(tree(s)); await new Promise((r) => setTimeout(r, 20)); for (let i = 0; i < frames; i++) frame(); };
    const pixels = () => surface.getCanvas().readPixels(0, 0, { width: W, height: H, colorType: CK.ColorType.RGBA_8888, alphaType: CK.AlphaType.Unpremul, colorSpace: CK.ColorSpace.SRGB }) as Uint8Array;
    return { refs, render, pixels };
  };

  const main = host(true);
  /** Pixels of the same state drawn from scratch without a composite: the partial record must give these. */
  const sameAsFull = async (s: State) => {
    const ref = host(false);
    await ref.render(s, 3);
    const a = main.pixels(), b = ref.pixels();
    let different = 0, drawn = 0;
    for (let i = 0; i < a.length; i += 4) {
      if (Math.abs(a[i] - b[i]) > 2 || Math.abs(a[i + 1] - b[i + 1]) > 2 || Math.abs(a[i + 2] - b[i + 2]) > 2) different++;
      if (b[i] + b[i + 1] + b[i + 2] > 0) drawn++;
    }
    return { different, drawn: drawn / (W * H) };
  };
  const pixelsCheck = async (name: string, s: State) => {
    const r = await sameAsFull(s);
    check(`${name}: pixels equal a full render`, r.different === 0 && r.drawn > 0.2, `${r.different} px differ, ${(r.drawn * 100).toFixed(0)}% drawn`);
  };
  const rec = () => main.refs.list!.LastCompositeRecord;

  // a card in the uncached stack: only its area
  await main.render({}, 3);
  check("first record is full", rec().Mode === "full");
  let renders = 0;
  const card0 = main.refs.cards[0];
  const render0 = card0.Render.bind(card0);
  card0.Render = (ctx) => { renders++; render0(ctx); };
  await main.render({ colors: { 2: "#FF0000" } });
  let r = rec();
  const card2 = main.refs.cards[2], m = card2.DrawingRect;
  check("card in an uncached stack: partial", r.Mode === "partial", r.Mode);
  check("card in an uncached stack: one area, the card", r.Areas.length === 1 && r.Changed.length === 1 && r.Changed[0] === card2, `${r.Areas.length} areas`);
  check("the area is the card's drawn bounds", r.Areas.length === 1 && r.Areas[0].Left <= m.Left && r.Areas[0].Top <= m.Top && r.Areas[0].Right >= m.Right && r.Areas[0].Bottom >= m.Bottom
    && r.Areas[0].Height < m.Height + 8, r.Areas.map((a) => `${a.Left},${a.Top},${a.Right},${a.Bottom}`).join(";"));
  check("the inner stack is redrawn clipped, the caption is not", r.Dirty.includes(main.refs.inner!) && !r.Dirty.includes(main.refs.caption!));
  check("the other cards are not even drawn", renders === 0, `card 0 drawn ${renders}x`);
  await pixelsCheck("one card", { colors: { 2: "#FF0000" } });

  // two cards: two areas
  await main.render({});
  await main.render({ colors: { 0: "#FF0000", 4: "#FFFFFF" } });
  r = rec();
  check("two cards changed: two areas", r.Mode === "partial" && r.Areas.length === 2 && r.Changed.length === 2, `${r.Mode}, ${r.Areas.length} areas, changed ${r.Changed.length}`);
  await pixelsCheck("two cards", { colors: { 0: "#FF0000", 4: "#FFFFFF" } });

  // a transform on the way: by area, where it was and where it is now; the overflow past the stack is drawn and erased
  await main.render({ colors: { 0: "#FF0000", 4: "#FFFFFF" }, tx: { 1: 20 } });
  r = rec();
  check("card moved by a transform: by area", r.Mode === "partial" && r.Changed.length === 1 && r.Changed[0] === main.refs.cards[1], `${r.Mode}, changed ${r.Changed.length}`);
  await pixelsCheck("card moved past its stack's edge", { colors: { 0: "#FF0000", 4: "#FFFFFF" }, tx: { 1: 20 } });
  await main.render({ colors: { 0: "#FF0000", 4: "#FFFFFF" } });
  await pixelsCheck("card moved back (overflow erased)", { colors: { 0: "#FF0000", 4: "#FFFFFF" } });

  // a direct child: whole, as before
  await main.render({ colors: { 0: "#FF0000", 4: "#FFFFFF" }, caption: "#FFFF00" });
  r = rec();
  check("direct child change: the child whole", r.Mode === "partial" && r.Changed.length === 0 && r.Dirty.includes(main.refs.caption!), `${r.Mode}`);
  await pixelsCheck("caption", { colors: { 0: "#FF0000", 4: "#FFFFFF" }, caption: "#FFFF00" });

  // an effect on the way: the inner stack whole
  await main.render({ effect: true }, 3);
  await main.render({ effect: true, colors: { 3: "#FF0000" } });
  r = rec();
  check("an effect on the way: the child whole", r.Mode === "partial" && r.Changed.length === 0 && r.Dirty.includes(main.refs.inner!), `${r.Mode}, changed ${r.Changed.length}`);
  await pixelsCheck("effect on the way", { effect: true, colors: { 3: "#FF0000" } });

  // a layout change: whole
  await main.render({}, 3);
  await main.render({ height: { 1: 60 } });
  check("a layout change records whole", rec().Mode === "full", rec().Mode);
  await pixelsCheck("layout change", { height: { 1: 60 } });

  // more areas than MaxCompositionAreas: one full record
  const many = (await import("../src/index.ts")).SkiaControl.MaxCompositionAreas + 4;
  await main.render({ count: many }, 3);
  await main.render({ count: many, colors: Object.fromEntries(Array.from({ length: many }, (_, i) => [i, "#FF0000"])) });
  check("many changes: one full record", rec().Mode === "full", rec().Mode);
  await pixelsCheck("many changes", { count: many, colors: Object.fromEntries(Array.from({ length: many }, (_, i) => [i, "#FF0000"])) });

  // a cache follows an effects margin that moves sides or grows (C# 97683f19, Rust paint_caches.rs): a 20 x 20 red
  // control with a 10 px yellow glow outside its rect on one side, its margin on that side, above a sibling square in a
  // cached stack as wide as they are, so the glow sticks out of the cache on that side
  class Glow extends SkiaControl {
    Side: "none" | "left" | "right" = "left";
    constructor() { super(); this.WidthRequest = 20; this.HeightRequest = 20; this.HorizontalOptions = "Start"; this.VerticalOptions = "Start"; }
    override ComputeEffectsMargin(scale: number): Thickness { return new Thickness(this.Side === "left" ? 10 * scale : 0, 0, this.Side === "right" ? 10 * scale : 0, 0); }
    protected override Paint(ctx: DrawingContext): void {
      const c = ctx.Context.Canvas, r = this.DrawingRect, p = new CK.Paint();
      p.setColor(CK.RED); c.drawRect(CK.LTRBRect(r.Left, r.Top, r.Right, r.Bottom), p);
      p.setColor(CK.YELLOW);
      if (this.Side === "left") c.drawRect(CK.LTRBRect(r.Left - 10, r.Top, r.Left, r.Bottom), p);
      if (this.Side === "right") c.drawRect(CK.LTRBRect(r.Right, r.Top, r.Right + 10, r.Bottom), p);
      p.delete();
    }
  }
  const glowScene = (cache: SkiaCacheType, side: Glow["Side"]) => {
    const fake = new FakeCanvas();
    const parent = new SkiaStackCtrl(); parent.UseCache = cache; parent.Spacing = 4; parent.Margin = new Thickness(40, 10, 0, 0);
    parent.HorizontalOptions = "Start"; parent.VerticalOptions = "Start";
    const glow = new Glow(); glow.Side = side;
    const square = new SkiaLayerCtrl(); square.BackgroundColor = "#00FF00"; square.WidthRequest = 20; square.HeightRequest = 20;
    square.HorizontalOptions = "Start"; square.VerticalOptions = "Start";
    parent.AddSubView(glow); parent.AddSubView(square);
    const root = new SkiaLayerCtrl(); root.AddSubView(parent);
    root._superview = fake as unknown as Canvas;
    const surface = CK.MakeSurface(160, 80);
    const frame = () => {
      const canvas = surface.getCanvas();
      canvas.clear(CK.BLACK);
      root.Measure(160, 80, 1); root.Arrange(new SKRect(0, 0, 160, 80), -1, -1, 1);
      root.Render({ Context: { Canvas: canvas, Surface: surface }, Destination: new SKRect(0, 0, 160, 80), Scale: 1 });
      for (const o of fake.disposeQueue.splice(0)) o.Dispose();
    };
    const pixels = () => surface.getCanvas().readPixels(0, 0, { width: 160, height: 80, colorType: CK.ColorType.RGBA_8888, alphaType: CK.AlphaType.Unpremul, colorSpace: CK.ColorSpace.SRGB }) as Uint8Array;
    return { glow, frame, pixels };
  };
  const invalidations: [string, (g: Glow) => void][] = [
    ["Update", (g) => g.Update()],
    ["UpdateDraw", (g) => g.UpdateDraw()],
    ["InvalidateEffectsMargin + InvalidateCache + RepaintComposition", (g) => { g.InvalidateEffectsMargin(); g.InvalidateCache(); g.RepaintComposition(); }],
  ];
  for (const cache of ["ImageComposite", "Image"] as SkiaCacheType[]) {
    for (const [from, to] of [["left", "right"], ["none", "left"]] as [Glow["Side"], Glow["Side"]][]) {
      for (const [how, invalidate] of invalidations) {
        const s = glowScene(cache, from);
        for (let i = 0; i < 3; i++) s.frame();
        s.glow.Side = to; invalidate(s.glow);
        for (let i = 0; i < 3; i++) s.frame();
        const ref = glowScene("None", to);
        for (let i = 0; i < 3; i++) ref.frame();
        const a = s.pixels(), b = ref.pixels();
        let different = 0;
        for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) > 2 || Math.abs(a[i + 1] - b[i + 1]) > 2 || Math.abs(a[i + 2] - b[i + 2]) > 2) different++;
        check(`${cache}: glow ${from} -> ${to} after ${how} equals a fresh render`, different === 0, `${different} px differ`);
      }
    }
  }

  console.log(failures ? `FAIL: ${failures} checks` : "OK: composite redraws deep changes by area");
  process.exit(failures ? 1 : 0);
})();
