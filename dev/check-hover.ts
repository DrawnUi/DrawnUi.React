// Hover (drawnui-cross 6m; C# HoverTests, Rust hover.rs), checked in Node (`npm run check:hover`): a card and the
// button inside it are both hovered; only opted-in controls hover (never because of a tap handler); while a scroll
// glides under a still mouse nothing changes, one check follows when it stops; leaving ends hover at once, also
// mid-glide; a scroll jump, a hidden card and a popup over the list are checked again; nothing while pressed.
import { readFileSync } from "node:fs";
import {
  Super, SKRect, Thickness, SkiaAccessibilityManager, HoverManager, SkiaLayer, SkiaShape, SkiaButton, SkiaScroll, SkiaStack,
  type SkiaControl, type AnimatorBase, type Canvas,
} from "../src/index.ts";

declare const CanvasKitInit: (o: { locateFile: () => string }) => Promise<any>;
const ROOT = process.cwd();
const W = 400, H = 400;
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
  Super.Fonts.set("FontText", new Map([[400, face]]));
  Super.DefaultTypeface = face; Super.DefaultFontAlias = "FontText";

  const host = (root: SkiaControl) => {
    const fake = new FakeCanvas();
    root._superview = fake as unknown as Canvas;
    const surface = CK.MakeSurface(W, H);
    let pressed = false;
    const frame = () => {
      for (const a of [...fake.AnimatingControls.values()]) a.TickFrame(performance.now() * 1e6);
      const canvas = surface.getCanvas();
      root.Measure(W, H, 1);
      root.Arrange(new SKRect(0, 0, W, H), root.WidthRequest, root.HeightRequest, 1);
      root.Render({ Context: { Canvas: canvas, Surface: surface }, Destination: new SKRect(0, 0, W, H), Scale: 1 });
      for (const o of fake.disposeQueue.splice(0)) o.Dispose();
      fake.Hover.AfterFrame(root, pressed);
    };
    const frames = async (n: number) => { for (let i = 0; i < n; i++) { frame(); await new Promise((r) => setTimeout(r, 16)); } };
    const move = async (x: number, y: number) => { fake.Hover.Move(root, x, y); await frames(1); };
    return { fake, frame, frames, move, press: (on: boolean) => { pressed = on; } };
  };
  const card = (h: number, color: string) => { const c = new SkiaShape(); c.HeightRequest = h; c.HorizontalOptions = "Fill"; c.BackgroundColor = color; return c; };

  // a card and the button inside it: both hovered, the card does not flicker
  {
    const root = new SkiaLayer(); root.VerticalOptions = "Fill";
    const shape = new SkiaShape(); shape.WidthRequest = 300; shape.HeightRequest = 200; shape.BackgroundColor = "#808080";
    const events: boolean[] = [];
    shape.HoverChanged = (_, on) => events.push(on);
    const button = new SkiaButton(); button.Text = "x"; button.WidthRequest = 60; button.HeightRequest = 40; button.Margin = new Thickness(220, 10, 0, 0);
    button.HorizontalOptions = "Start"; button.VerticalOptions = "Start";
    shape.AddSubView(button); root.AddSubView(shape);
    const h = host(root);
    await h.frames(3);
    await h.move(50, 150);
    check("card only", shape.IsHovered && !button.IsHovered);
    await h.move(250, 30);
    check("the button inside the card: both", shape.IsHovered && button.IsHovered);
    check("the card did not flicker", events.join() === "true", events.join());
    await h.move(380, 380);
    check("outside: none", !shape.IsHovered && !button.IsHovered && events.join() === "true,false", events.join());
  }

  // only opted-in controls hover
  {
    const root = new SkiaLayer(); root.VerticalOptions = "Fill";
    const tappable = new SkiaShape(); tappable.WidthRequest = 150; tappable.HeightRequest = 150; tappable.BackgroundColor = "#808080"; tappable.Tapped = () => {};
    tappable.HorizontalOptions = "Start"; tappable.VerticalOptions = "Start";
    const off = new SkiaButton(); off.Text = "Off"; off.ReceivesHover = false; off.WidthRequest = 150; off.HeightRequest = 60; off.Margin = new Thickness(200, 0, 0, 0);
    off.HorizontalOptions = "Start"; off.VerticalOptions = "Start";
    root.AddSubView(tappable); root.AddSubView(off);
    const h = host(root);
    await h.frames(3);
    await h.move(50, 50);
    check("a tap handler does not make a control hover", !tappable.IsHovered);
    await h.move(250, 20);
    check("ReceivesHover=false on a button turns its hover off", !off.IsHovered);
    check("defaults: SkiaButton yes, SkiaShape no", new SkiaButton().ReceivesHover && !new SkiaShape().ReceivesHover);
  }

  // a list in a scroll: hover waits while the content glides, one check when it stops; a jump and a hidden card re-check
  const list = () => {
    const scroll = new SkiaScroll(); scroll.VerticalOptions = "Fill"; scroll.Orientation = "Vertical";
    const stack = new SkiaStack(); stack.Spacing = 0;
    const cards = Array.from({ length: 30 }, (_, i) => card(50, i % 2 ? "#404040" : "#808080"));
    let changes = 0;
    for (const c of cards) { c.HoverChanged = () => { changes++; }; stack.AddSubView(c); }
    scroll.Content = stack;
    return { scroll, cards, changes: () => changes, reset: () => { changes = 0; } };
  };
  {
    const l = list();
    const h = host(l.scroll);
    await h.frames(3);
    await h.move(100, 75);
    check("list: card 1 hovered", l.cards[1].IsHovered);
    l.reset();
    l.scroll.ScrollTo(0, -500, 0.5);
    await h.frames(2);
    check("the scroll glides", l.scroll.IsScrolling);
    for (let i = 0; i < 5; i++) await h.move(100, 75 + i);
    check("while it glides nothing changes", l.cards[1].IsHovered && l.changes() === 0, `${l.changes()} changes`);
    for (let i = 0; i < 120 && l.scroll.IsScrolling; i++) await h.frames(1);
    await h.frames(3);
    const hovered = l.cards.filter((c) => c.IsHovered);
    check("after it stops: one check at the last pointer position", hovered.length === 1 && l.cards[11].IsHovered, `card ${l.cards.findIndex((c) => c.IsHovered)}, offset ${l.scroll.ViewportOffsetY}`);
    l.scroll.ScrollTo(0, 0, 0);
    await h.frames(2);
    check("an instant scroll jump re-checks", l.cards[1].IsHovered && !l.cards[11].IsHovered, `card ${l.cards.findIndex((c) => c.IsHovered)}`);
    l.cards[1].IsVisible = false;
    l.cards[1].Update();
    await h.frames(2);
    check("a hovered card hidden: re-checked", !l.cards[1].IsHovered && l.cards[2].IsHovered, `card ${l.cards.findIndex((c) => c.IsHovered)}`);
    l.cards[1].IsVisible = true;
    l.cards[1].Update();
    await h.frames(2);
    const before = l.cards.findIndex((c) => c.IsHovered);
    h.press(true);
    l.scroll.ScrollTo(0, -100, 0);
    await h.frames(2);
    check("no check while pressed", l.cards.findIndex((c) => c.IsHovered) === before, `card ${l.cards.findIndex((c) => c.IsHovered)}, was ${before}`);
    h.press(false);
  }

  // leaving the canvas clears hover at once, also mid-glide; no check after the glide ends
  {
    const l = list();
    l.cards.forEach((c) => { c.HoverChanged = undefined; c.ReceivesHover = true; });
    const h = host(l.scroll);
    await h.frames(3);
    await h.move(100, 25);
    check("leave: a card hovered first", h.fake.Hover.Hovered.length === 1 && l.cards[0].IsHovered);
    l.scroll.ScrollTo(0, -500, 0.5);
    await h.frames(3);
    h.fake.Hover.Leave();
    await h.frames(1);
    check("leave mid-glide: nothing hovered", !l.cards[0].IsHovered && h.fake.Hover.Hovered.length === 0);
    for (let i = 0; i < 120 && l.scroll.IsScrolling; i++) await h.frames(1);
    await h.frames(3);
    check("no check after the glide: the mouse is gone", h.fake.Hover.Hovered.length === 0);
  }

  // a popup over the list (BlocksGesturesBelow) takes the hover from it
  {
    const root = new SkiaLayer(); root.VerticalOptions = "Fill";
    const l = list();
    root.AddSubView(l.scroll);
    const h = host(root);
    await h.frames(3);
    await h.move(100, 75);
    check("popup: list card hovered first", l.cards[1].IsHovered);
    const popup = new SkiaLayer(); popup.VerticalOptions = "Fill"; popup.HorizontalOptions = "Fill"; popup.BlockGesturesBelow = true; popup.BackgroundColor = "#00000080";
    root.AddSubView(popup);
    await h.frames(2);
    check("a popup over the list clears the list's hover", !l.cards[1].IsHovered && h.fake.Hover.Hovered.length === 0);
  }

  console.log(failures ? `FAIL: ${failures} checks` : "OK: hover");
  process.exit(failures ? 1 : 0);
})();
