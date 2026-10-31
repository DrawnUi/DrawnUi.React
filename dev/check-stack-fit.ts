// Stacks that size themselves on their cross axis are as wide (Column) / tall (Row) as their children need, Fill
// children included (drawnui-cross 6an, Nick 2026-10-31: "fit-content for all engines for stacks which have autosize in
// that direction"), checked in Node (`npm run check:stack-fit`): each child counts with its fit-content size, the Fill
// ones are then laid out at the stack's size and re-measured, nothing overlaps; an empty Fill child never widens it.
import { readFileSync } from "node:fs";
import {
  Super, SKRect, SkiaAccessibilityManager, HoverManager, SkiaLayout, SkiaLabel, SkiaShape, SkiaButton, Thickness,
  type Canvas, type AnimatorBase, type SkiaControl,
} from "../src/index.ts";

declare const CanvasKitInit: (o: { locateFile: () => string }) => Promise<any>;
const ROOT = process.cwd();
const W = 1000, H = 1200;
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

const LONG = "DrawnUI draws every pixel itself: text is shaped and rasterized by Skia, so a label wraps by words, respects MaxLines with an ellipsis, aligns horizontally and vertically, and never leaves the canvas for a native view.";

(async () => {
  const CK = await CanvasKitInit({ locateFile: () => `${ROOT}/node_modules/canvaskit-wasm/bin/full/canvaskit.wasm` });
  (Super as unknown as { CK: unknown }).CK = CK;
  const face = Super.LoadFace(readFileSync(`${ROOT}/samples/public/fonts/OpenSans-Regular.ttf`))!;
  Super.Fonts.set("FontText", new Map([[400, face]])); Super.DefaultTypeface = face; Super.DefaultFontAlias = "FontText";

  /** Lays `control` out at the top left of a W x H canvas, twice (as frames do), and draws it once. */
  const layout = (control: SkiaControl) => {
    const root = new SkiaLayout(); root.WidthRequest = W; root.HeightRequest = H; root.AddSubView(control);
    root._superview = new FakeCanvas() as unknown as Canvas;
    for (let f = 0; f < 2; f++) {
      const surface = CK.MakeSurface(W, H);
      root.Measure(W, H, 1); root.Arrange(new SKRect(0, 0, W, H), W, H, 1);
      root.Render({ Context: { Canvas: surface.getCanvas(), Surface: surface }, Destination: new SKRect(0, 0, W, H), Scale: 1 });
      surface.delete();
    }
  };
  const column = (center = true) => { const c = new SkiaLayout(); c.Type = "Column"; c.Spacing = 16; if (center) c.HorizontalOptions = "Center"; return c; };
  const text = (t: string, fill = true) => { const l = new SkiaLabel(); l.Text = t; l.FontSize = 16; l.TextColor = "#FFFFFF"; if (fill) l.HorizontalOptions = "Fill"; return l; };
  const card = (t: string) => {
    const s = new SkiaShape(); s.BackgroundColor = "#333333"; s.HorizontalOptions = "Fill"; s.Padding = new Thickness(12);
    s.AddSubView(text(t)); return s;
  };
  /** No two children overlap and the spacing between them is kept. */
  const spaced = (c: SkiaLayout) => {
    const v = c.Views.filter((x) => x.IsVisible);
    for (let i = 1; i < v.length; i++) if (Math.abs(v[i].DrawingRect.Top - v[i - 1].DrawingRect.Bottom - c.Spacing) > 0.5) return false;
    return true;
  };

  {
    // 6a: a centered Column, max 640, Fill cards of long wrapping text plus a row of 3 buttons -> 640 wide, spacing kept
    const c = column(); c.MaximumWidthRequest = 640;
    c.AddSubView(card(LONG)); c.AddSubView(card(LONG + " " + LONG));
    const row = new SkiaLayout(); row.Type = "Row"; row.Spacing = 8;
    for (const t of ["One", "Two", "Three"]) { const b = new SkiaButton(); b.Text = t; row.AddSubView(b); }
    c.AddSubView(row);
    layout(c);
    const cards = c.Views.slice(0, 2);
    const labels = cards.map((k) => (k as SkiaLayout).Views[0]);
    check("centered Column max 640 with Fill cards of wrapping text and a button row: 640 wide, centered", Math.round(c.DrawingRect.Width) === 640 && Math.abs(c.DrawingRect.Left - (W - 640) / 2) <= 1,
      `width ${c.DrawingRect.Width}, left ${c.DrawingRect.Left}`);
    check("the Fill cards take the stack's width, the spacing is kept and nothing overlaps", cards.every((k) => Math.abs(k.DrawingRect.Width - 640) < 0.5) && spaced(c),
      cards.map((k) => `${k.DrawingRect.Top}..${k.DrawingRect.Bottom}`).join(", ") + `, row ${row.DrawingRect.Top}`);
    check("each card is as tall as its text wrapped at the card's width", cards.every((k, i) => Math.abs(k.DrawingRect.Height - (labels[i].DrawingRect.Height + 24)) < 1),
      cards.map((k, i) => `${k.DrawingRect.Height} vs ${labels[i].DrawingRect.Height} + 24`).join(", "));
  }
  {
    // 6b: a short title plus a Fill divider -> the title's width
    const c = column();
    const title = text("Settings", false);
    const divider = new SkiaShape(); divider.HorizontalOptions = "Fill"; divider.HeightRequest = 1; divider.BackgroundColor = "#888888";
    c.AddSubView(title); c.AddSubView(divider);
    layout(c);
    check("a short title plus a Fill divider: the stack is as wide as the title, the divider too", Math.abs(c.DrawingRect.Width - title.DrawingRect.Width) < 0.5 && Math.abs(divider.DrawingRect.Width - title.DrawingRect.Width) < 0.5 && c.DrawingRect.Width < 200,
      `stack ${c.DrawingRect.Width}, title ${title.DrawingRect.Width}, divider ${divider.DrawingRect.Width}`);
  }
  {
    // a Fill card of short text: the stack is as wide as the card's content and padding, not the whole width
    const c = column();
    const k = card("Hi there");
    c.AddSubView(k);
    layout(c);
    const label = k.Views[0];
    check("a Fill card of short text: the stack is as wide as the text plus the card's padding", Math.abs(c.DrawingRect.Width - (label.DrawingRect.Width + 24)) < 1 && c.DrawingRect.Width < 200,
      `stack ${c.DrawingRect.Width}, text ${label.DrawingRect.Width}`);
  }
  {
    // the widest child sets the width; a Fill card of short text below it takes that width and nothing overlaps
    const c = column(false);
    const wide = new SkiaShape(); wide.WidthRequest = 300; wide.HeightRequest = 40; wide.BackgroundColor = "#555555";
    const k = card("A shorter line");
    const after = text("after", false);
    c.AddSubView(wide); c.AddSubView(k); c.AddSubView(after);
    layout(c);
    check("a Fill card of short text under a 300 px child: the stack and the card are 300 wide, nothing overlaps", Math.abs(c.DrawingRect.Width - 300) < 0.5 && Math.abs(k.DrawingRect.Width - 300) < 0.5 && spaced(c) && Math.abs(k.DrawingRect.Height - (k.Views[0].DrawingRect.Height + 24)) < 1,
      `stack ${c.DrawingRect.Width}, card ${k.DrawingRect.Width} x ${k.DrawingRect.Height}, text ${k.Views[0].DrawingRect.Height}`);
  }
  {
    // a Row that sizes its height: a Fill vertical divider takes the row's height without making it taller
    const r = new SkiaLayout(); r.Type = "Row"; r.Spacing = 8;
    const a = text("Left", false), b = text("Right", false);
    const bar = new SkiaShape(); bar.VerticalOptions = "Fill"; bar.WidthRequest = 1; bar.BackgroundColor = "#888888";
    r.AddSubView(a); r.AddSubView(bar); r.AddSubView(b);
    layout(r);
    check("a Row with a Fill vertical divider is as tall as its text, the divider too", Math.abs(r.DrawingRect.Height - a.DrawingRect.Height) < 0.5 && Math.abs(bar.DrawingRect.Height - a.DrawingRect.Height) < 0.5,
      `row ${r.DrawingRect.Height}, text ${a.DrawingRect.Height}, bar ${bar.DrawingRect.Height}`);
  }
  {
    // a Fill stack keeps its size: it still takes the width it is given
    const c = column(false); c.HorizontalOptions = "Fill";
    c.AddSubView(text("Short", false));
    layout(c);
    check("a Fill Column keeps the whole width", Math.abs(c.DrawingRect.Width - W) < 0.5, `${c.DrawingRect.Width}`);
  }

  {
    // a Fill Column on an unbounded axis (inside a Row) sizes by content too: its Fill divider takes the title's width
    const row = new SkiaLayout(); row.Type = "Row";
    const c = column(false); c.HorizontalOptions = "Fill";
    const title = text("Fill on an unbounded axis", false);
    const divider = new SkiaShape(); divider.HorizontalOptions = "Fill"; divider.HeightRequest = 1; divider.BackgroundColor = "#888888";
    c.AddSubView(title); c.AddSubView(divider); row.AddSubView(c);
    layout(row);
    check("a Fill Column in a Row (unbounded width) is as wide as its title, the divider too", Math.abs(c.DrawingRect.Width - title.DrawingRect.Width) < 0.5 && Math.abs(divider.DrawingRect.Width - title.DrawingRect.Width) < 0.5,
      `stack ${c.DrawingRect.Width}, title ${title.DrawingRect.Width}, divider ${divider.DrawingRect.Width}`);
  }

  console.log(failures ? `FAIL: ${failures} checks` : "OK: fit-content stacks");
  process.exit(failures ? 1 : 0);
})();
