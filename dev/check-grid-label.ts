// drawnui-cross 6p (C# 7cf1007c, Rust label_spacing_grid.rs), checked in Node (`npm run check:grid-label`): a label
// wrapping in the star column of a "*,Auto" grid is measured at its column width and its Auto row grows to the
// wrapped lines (no one-line cut with a trail); a cut line stays inside the label's width, also when the cut falls
// inside a later span. CharacterSpacing is not ported here (SKIPPED), so the spaced cases of 6p do not apply.
import { readFileSync } from "node:fs";
import {
  Super, SKRect, Thickness, SkiaAccessibilityManager, HoverManager, SkiaGrid, SkiaLayout, SkiaLabel, SkiaShape, SkiaStack, SkiaWrap, TextSpan,
  type SkiaControl, type AnimatorBase, type Canvas,
} from "../src/index.ts";

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

const TEXT = "A long caption that needs two lines in its column";
const lines = (l: SkiaLabel) => ((l as unknown as { lines: { Runs: { Text: string }[] }[] }).lines).map((x) => x.Runs.map((r) => r.Text).join(""));

(async () => {
  const CK = await CanvasKitInit({ locateFile: () => `${ROOT}/node_modules/canvaskit-wasm/bin/full/canvaskit.wasm` });
  (Super as unknown as { CK: unknown }).CK = CK;
  const face = CK.Typeface.MakeFreeTypeFaceFromData(readFileSync(`${ROOT}/samples/public/fonts/OpenSans-Regular.ttf`).buffer);
  const bold = CK.Typeface.MakeFreeTypeFaceFromData(readFileSync(`${ROOT}/samples/public/fonts/OpenSans-Semibold.ttf`).buffer);
  Super.Fonts.set("FontText", new Map([[400, face], [700, bold]]));
  Super.DefaultTypeface = face; Super.DefaultFontAlias = "FontText";

  /** Lays out and draws `root` on a W x H canvas at `scale`, 4 frames; returns the rightmost column with ink. */
  const draw = (root: SkiaControl, W: number, H: number, scale = 1) => {
    const fake = new FakeCanvas(); fake.RenderingScale = scale;
    root._superview = fake as unknown as Canvas;
    const surface = CK.MakeSurface(W, H);
    for (let i = 0; i < 4; i++) {
      const canvas = surface.getCanvas();
      canvas.clear(CK.BLACK);
      root.Measure(W, H, scale); root.Arrange(new SKRect(0, 0, W, H), root.WidthRequest, root.HeightRequest, scale);
      root.Render({ Context: { Canvas: canvas, Surface: surface }, Destination: new SKRect(0, 0, W, H), Scale: scale });
      for (const o of fake.disposeQueue.splice(0)) o.Dispose();
    }
    const px = surface.getCanvas().readPixels(0, 0, { width: W, height: H, colorType: CK.ColorType.RGBA_8888, alphaType: CK.AlphaType.Unpremul, colorSpace: CK.ColorSpace.SRGB }) as Uint8Array;
    surface.delete();
    for (let x = W - 1; x >= 0; x--) for (let y = 0; y < H; y++) if (px[(y * W + x) * 4] > 80) return x;
    return -1;
  };

  // (1) Grid Auto row: the label wraps in its star column and the row grows (C# GridAutoRowWrapTests)
  for (const vertical of ["Center", "Fill"] as const) {
    const grid = new SkiaGrid(); grid.HorizontalOptions = "Fill"; grid.ColumnSpacing = 0; grid.ColumnDefinitions = "*,Auto";
    const label = new SkiaLabel(); label.Text = TEXT; label.FontSize = 16; label.MaxLines = 3; label.TextColor = "#FFFFFF"; label.VerticalOptions = vertical;
    const shape = new SkiaShape(); shape.WidthRequest = 220; shape.HeightRequest = 30; shape.BackgroundColor = "#808080"; shape.Column = 1;
    grid.AddSubView(label); grid.AddSubView(shape);
    draw(grid, 400, 300);
    const l = lines(label);
    check(`grid "*,Auto", label ${vertical}: wraps to 2+ lines`, label.LinesCount >= 2, l.join(" | "));
    check(`grid "*,Auto", label ${vertical}: no line cut with a trail`, l.every((x) => !x.endsWith("…")), l.join(" | "));
    check(`grid "*,Auto", label ${vertical}: label inside its 180 px column`, label.MeasuredSize.Pixels.Width <= 181, `${label.MeasuredSize.Pixels.Width}`);
    check(`grid "*,Auto", label ${vertical}: the row is as tall as the label`, grid.MeasuredSize.Pixels.Height >= label.MeasuredSize.Pixels.Height,
      `grid ${grid.MeasuredSize.Pixels.Height}, label ${label.MeasuredSize.Pixels.Height}`);
    // the label's own lines fit the row: a vertical Fill label on an Auto row is measured unbounded, the row grows to it
    const content = (label as unknown as { BlockHeight(): number }).BlockHeight();
    check(`grid "*,Auto", label ${vertical}: the row holds the wrapped lines`, grid.MeasuredSize.Pixels.Height >= content - 0.5, `grid ${grid.MeasuredSize.Pixels.Height}, lines ${content.toFixed(1)}`);
  }

  // (1) the FiltersCamera title row without spacing: MaxLines 2, right padding 12, a 151 pt star column at 1.25
  {
    const scale = 1.25, column = 151;
    const grid = new SkiaGrid(); grid.HorizontalOptions = "Fill"; grid.Margin = new Thickness(20, 0, 20, 12); grid.ColumnSpacing = 0; grid.ColumnDefinitions = "*,Auto";
    const label = new SkiaLabel(); label.Text = "ESTILIZAR UMA FOTO DE PERFIL AGORA"; label.FontSize = 12; label.MaxLines = 2; label.TextColor = "#FFFFFF";
    label.Padding = new Thickness(0, 8, 12, 8); label.HorizontalOptions = "Start"; label.VerticalOptions = "Center"; label.UseCache = "Image";
    const shape = new SkiaShape(); shape.WidthRequest = 402 - 40 - column; shape.HeightRequest = 38; shape.HorizontalOptions = "End"; shape.Column = 1;
    grid.AddSubView(label); grid.AddSubView(shape);
    const ink = draw(grid, Math.round(402 * scale), Math.round(200 * scale), scale) + 1;
    const right = Math.round((20 + column - 12) * scale);
    check("title row at 1.25: 2 lines, none cut", label.LinesCount === 2 && lines(label).every((x) => !x.endsWith("…")), lines(label).join(" | "));
    check("title row at 1.25: ink inside the column less the padding", ink > 0 && ink <= right + 1, `ink ends at ${ink}, text area ends at ${right}`);
  }

  // (3) a one-line cut stays inside the label: plain text, two spans, and a cut inside the second span
  const makers: [string, () => SkiaLabel][] = [
    ["plain", () => { const l = new SkiaLabel(); l.Text = "ESTILIZAR UMA FOTO"; return l; }],
    ["two spans", () => { const l = new SkiaLabel(); const a = new TextSpan(); a.Text = "ESTILIZAR "; const b = new TextSpan(); b.Text = "UMA FOTO"; b.IsBold = true; l.AddSubView(a); l.AddSubView(b); return l; }],
    ["cut inside the second span", () => { const l = new SkiaLabel(); const a = new TextSpan(); a.Text = "ESTI "; const b = new TextSpan(); b.Text = "LIZARUMAFOTOLONGWORD"; b.IsBold = true; l.AddSubView(a); l.AddSubView(b); return l; }],
  ];
  for (const [name, make] of makers) {
    for (const maxLines of [1, 2]) {
      const label = make(); label.FontSize = 20; label.MaxLines = maxLines; label.WidthRequest = 150; label.TextColor = "#FFFFFF";
      label.HorizontalOptions = "Start"; label.VerticalOptions = "Start";
      const host = new SkiaLayout(); host.HorizontalOptions = "Fill"; host.VerticalOptions = "Fill"; host.AddSubView(label);
      const ink = draw(host, 400, 100) + 1;
      check(`${name}, MaxLines ${maxLines}, width 150: ink inside the label`, ink > 0 && ink <= 151, `ink ends at ${ink}; ${lines(label).join(" | ")}`);
    }
  }

  {
    // a grid of a set height, "Auto,*,Auto" rows in its default Auto column: the last row is a full-width stack holding a
    // wrap of buttons, one line at an unbounded width, three at the grid's (the 3D gallery Boss page). The star row keeps
    // what the wrapped row leaves; the rows never run past the grid
    const grid = new SkiaGrid(); grid.RowDefinitions = "Auto,*,Auto"; grid.RowSpacing = 10; grid.Padding = new Thickness(20); grid.HeightRequest = 500;
    const top = new SkiaShape(); top.HeightRequest = 50; top.Row = 0;
    const star = new SkiaShape(); star.HorizontalOptions = "Fill"; star.VerticalOptions = "Fill"; star.Row = 1;
    const wrap = new SkiaWrap(); wrap.Spacing = 8; wrap.HorizontalOptions = "Center";
    for (let i = 0; i < 7; i++) { const b = new SkiaShape(); b.WidthRequest = 100; b.HeightRequest = 40; wrap.AddSubView(b); }
    const controls = new SkiaStack(); controls.AddSubView(wrap); controls.Row = 2;
    grid.AddSubView(top); grid.AddSubView(star); grid.AddSubView(controls);
    (grid as unknown as { _superview: unknown })._superview = new FakeCanvas();
    grid.Measure(360, Infinity, 1); grid.Arrange(new SKRect(0, 0, 360, 600), -1, -1, 1);
    const rows = (grid.GridStructure as unknown as { Rows: { Size: number }[] }).Rows.map((r) => Math.round(r.Size));
    check("a wrap that grows its Auto row at the final width takes its room from the star row: the rows fit the grid", rows[2] === 136 && rows[0] + rows[1] + rows[2] + 2 * 10 + 2 * 20 === 500 && controls.DrawingRect.Bottom <= grid.DrawingRect.Bottom - 20 + 0.5, `rows ${rows.join(",")}, controls bottom ${controls.DrawingRect.Bottom}, grid bottom ${grid.DrawingRect.Bottom}`);
  }

  // C# GridAutoRowsNarrowTests (5acd8ae4): a full-height grid "Auto,*,Auto,Auto" on a phone and a desktop: the Auto rows
  // (a wrapping subtitle, two button wraps) take their content at the screen width, the star row what is left
  const LONG = "A glTF model drawn in 3D inside DrawnUI, driven by the app. Drag it to turn it, tap it to hit it.";
  for (const [columns, width, height, subtitleLines, movesH, skinsH] of [[undefined, 390, 844, 2, 136, 88], ["*", 390, 844, 2, 136, 88], [undefined, 1280, 796, 1, 40, 40], ["*", 1280, 796, 1, 40, 40]] as [string | undefined, number, number, number, number, number][]) {
    const buttons = (n: number) => { const w = new SkiaWrap(); w.Spacing = 8; w.HorizontalOptions = "Center"; for (let i = 0; i < n; i++) { const b = new SkiaShape(); b.WidthRequest = 100; b.HeightRequest = 40; w.AddSubView(b); } return w; };
    const label = (t: string, size: number) => { const l = new SkiaLabel(); l.Text = t; l.FontSize = size; l.HorizontalOptions = "Center"; return l; };
    const grid = new SkiaGrid(); grid.Padding = new Thickness(20); grid.RowSpacing = 10; grid.VerticalOptions = "Fill"; grid.RowDefinitions = "Auto,*,Auto,Auto";
    if (columns) grid.ColumnDefinitions = columns;
    const head = new SkiaStack(); head.Spacing = 8; head.Row = 0;
    const subtitle = label(LONG, 15); subtitle.HorizontalTextAlignment = "Center";
    head.AddSubView(label("BOSS FIGHT", 30)); head.AddSubView(subtitle);
    const star = new SkiaLayout(); star.HorizontalOptions = "Fill"; star.VerticalOptions = "Fill"; star.Row = 1;
    const news = label("Tap the dragon to hit it.", 15); news.Row = 2;
    const bottom = new SkiaStack(); bottom.Spacing = 10; bottom.Row = 3;
    const moves = buttons(7), skins = buttons(6);
    bottom.AddSubView(label("MOVES", 13)); bottom.AddSubView(moves); bottom.AddSubView(label("SKIN", 13)); bottom.AddSubView(skins);
    grid.AddSubView(head); grid.AddSubView(star); grid.AddSubView(news); grid.AddSubView(bottom);
    (grid as unknown as { _superview: unknown })._superview = new FakeCanvas();
    for (let i = 0; i < 2; i++) { grid.Measure(width, height, 1); grid.Arrange(new SKRect(0, 0, width, height), -1, -1, 1); }
    const name = `GridAutoRowsNarrow [${columns ?? "Auto"}] ${width}x${height}`;
    check(`${name}: subtitle ${subtitleLines} line(s), moves ${movesH}, skins ${skinsH}`, lines(subtitle).length === subtitleLines && Math.abs(moves.DrawingRect.Height - movesH) <= 1 && Math.abs(skins.DrawingRect.Height - skinsH) <= 1,
      `lines ${lines(subtitle).length}, moves ${moves.DrawingRect.Height}, skins ${skins.DrawingRect.Height}`);
    check(`${name}: the Auto rows end at the bottom padding, the star row takes the rest`, Math.abs(skins.DrawingRect.Bottom - (height - 20)) <= 1 && star.DrawingRect.Height > 100 && Math.abs(star.DrawingRect.Bottom + 10 - news.DrawingRect.Top) <= 1,
      `skins bottom ${skins.DrawingRect.Bottom}, star ${star.DrawingRect.Height}, news top ${news.DrawingRect.Top}`);
  }

  console.log(failures ? `FAIL: ${failures} checks` : "OK: grid Auto rows and label cuts");
  process.exit(failures ? 1 : 0);
})();
