// Label text placed where DrawnUi.Net puts it (drawnui-cross, Nick "text - match .net if possible"), checked in Node
// (`npm run check:label-baseline`): a line is round((ascent + descent) * LineHeight) pixels high and its baseline sits at
// the line's bottom minus the descent, LineHeight's extra space split above and below the text. Pinned with Orbitron
// Black 38 (ascent 38.418, descent 9.234: lines of 48 px): "GAME OVER" in a 256 x 160 layout, centered vertically,
// draws "GAME" on rows 44-70 (baseline 70.766, as .NET). The line rule of every engine (drawnui-cross 6bm, Nick): each line
// its own height by default (LineHeightUniform true = every line as tall as the tallest); a line's height is its spans'
// largest ascent + largest descent, rounded once; a font with Leading puts Leading * LineSpacing between lines.
import { readFileSync } from "node:fs";
import { Super, SKRect, SkiaAccessibilityManager, HoverManager, SkiaLabel, SkiaLayer, TextSpan, type AnimatorBase, type Canvas } from "../src/index.ts";

declare const CanvasKitInit: (o: { locateFile: () => string }) => Promise<any>;
const ROOT = process.cwd();
const W = 256, H = 160;
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
  const face = CK.Typeface.MakeFreeTypeFaceFromData(readFileSync(`${ROOT}/dev/fonts/Orbitron-Black.ttf`).buffer);
  Super.Fonts.set("Orbitron", new Map([[400, face]])); Super.DefaultTypeface = face; Super.DefaultFontAlias = "Orbitron";
  const sans = CK.Typeface.MakeFreeTypeFaceFromData(readFileSync(`${ROOT}/samples/public/fonts/OpenSans-Regular.ttf`).buffer);
  Super.Fonts.set("OpenSans", new Map([[400, sans]]));
  // the same Orbitron with a line gap of 0.2 em (hhea, and OS/2 sTypoLineGap: the font sets USE_TYPO_METRICS): a font with Leading
  const gapped = new Uint8Array(readFileSync(`${ROOT}/dev/fonts/Orbitron-Black.ttf`));
  const dv = new DataView(gapped.buffer);
  for (let i = 0, n = dv.getUint16(4); i < n; i++) {
    const rec = 12 + i * 16;
    const tag = String.fromCharCode(...gapped.subarray(rec, rec + 4));
    if (tag === "hhea") dv.setInt16(dv.getUint32(rec + 8) + 8, 200);
    if (tag === "OS/2") dv.setInt16(dv.getUint32(rec + 8) + 72, 200);
  }
  const leadFace = CK.Typeface.MakeFreeTypeFaceFromData(gapped.buffer);
  Super.Fonts.set("OrbitronGap", new Map([[400, leadFace]]));
  const metrics = (tf: unknown, size: number) => { const m = new CK.Font(tf, size).getMetrics(); return { a: -m.ascent, d: m.descent, lead: m.leading as number }; };
  const span = (text: string, size?: number, family?: string) => { const t = new TextSpan(); t.Text = text; if (size) t.FontSize = size; if (family) t.FontFamily = family; return t; };

  /** Lit rows (white text on black, red > 128) between y0 and y1, as "first-last", and the label. */
  const draw = (setup: (l: SkiaLabel) => void, y0 = 0, y1 = H) => {
    const root = new SkiaLayer(); root.WidthRequest = W; root.HeightRequest = H; root.BackgroundColor = "#000000";
    const label = new SkiaLabel(); label.FontFamily = "Orbitron"; label.FontSize = 38; label.TextColor = "#FFFFFF";
    label.HorizontalOptions = "Fill"; label.HorizontalTextAlignment = "Center"; label.UseCache = "None";
    setup(label);
    root.AddSubView(label);
    root._superview = new FakeCanvas() as unknown as Canvas;
    const surface = CK.MakeSurface(W, H);
    for (let i = 0; i < 2; i++) {
      surface.getCanvas().clear(CK.BLACK);
      root.Measure(W, H, 1); root.Arrange(new SKRect(0, 0, W, H), W, H, 1);
      root.Render({ Context: { Canvas: surface.getCanvas(), Surface: surface }, Destination: new SKRect(0, 0, W, H), Scale: 1 });
    }
    const px = surface.makeImageSnapshot().readPixels(0, 0, { width: W, height: H, colorType: CK.ColorType.RGBA_8888, alphaType: CK.AlphaType.Unpremul, colorSpace: CK.ColorSpace.SRGB }) as Uint8Array;
    surface.delete();
    let first = -1, last = -1;
    for (let y = y0; y < y1; y++) for (let x = 0; x < W; x++) if (px[(y * W + x) * 4] > 128) { if (first < 0) first = y; last = y; break; }
    return { rows: `${first}-${last}`, label };
  };

  // DrawnUi.Net reference rows (DrawnUi 296a144c, drawnui-cross 6bm): bottom rows (the baselines) and heights exact, the top
  // row within one (SkiaSharp and CanvasKit antialias the cap edge differently: .NET row 43 has coverage 162 here under 128)
  const asNet = (rows: string, net: string) => { const [t, b] = rows.split("-").map(Number), [nt, nb] = net.split("-").map(Number); return b === nb && Math.abs(t - nt) <= 1; };
  const over = draw((l) => { l.Text = "GAME OVER"; l.VerticalOptions = "Center"; }, 0, 80);
  check('"GAME OVER" centered in 256 x 160: "GAME" on rows 44-70 (.NET 43-70)', over.rows === "44-70" && asNet(over.rows, "43-70"), over.rows);
  check("two lines of 48 px", over.label.MeasuredSize.Pixels.Height === 96 && over.label.MeasuredLineHeight === 48, `${over.label.MeasuredSize.Pixels.Height}, line ${over.label.MeasuredLineHeight}`);
  const top = draw((l) => { l.Text = "GAME"; });
  check("one line at the top: baseline 48 - 9.234 = 38.766, rows 12-38", top.rows === "12-38", top.rows);
  check("one line is 48 px high (rounded)", top.label.MeasuredSize.Pixels.Height === 48, `${top.label.MeasuredSize.Pixels.Height}`);
  const tall = draw((l) => { l.Text = "GAME"; l.LineHeight = 1.5; });
  // a line of round(47.652 * 1.5) = 71 px; the text's own 47.33 px centered in it: baseline 71 - 11.83 - 9.234 = 49.93
  check("LineHeight 1.5: the extra space split above and below, rows 23-49 (.NET 22-49)", tall.rows === "23-49" && asNet(tall.rows, "22-49") && tall.label.MeasuredSize.Pixels.Height === 71, `${tall.rows}, height ${tall.label.MeasuredSize.Pixels.Height}`);

  // .NET reference: label 14 px, spans "OVER" + line break (14) and "GAME" (40), ParagraphSpacing 0: lines 18 + 50, height 68,
  // "OVER" rows 5-14, "GAME" rows 29-57
  const ref = draw((l) => { l.FontSize = 14; l.ParagraphSpacing = 0; l.AddSubView(span("OVER\n")); l.AddSubView(span("GAME", 40)); });
  const refOver = draw((l) => { l.FontSize = 14; l.ParagraphSpacing = 0; l.AddSubView(span("OVER\n")); l.AddSubView(span("GAME", 40)); }, 0, 18).rows;
  const refGame = draw((l) => { l.FontSize = 14; l.ParagraphSpacing = 0; l.AddSubView(span("OVER\n")); l.AddSubView(span("GAME", 40)); }, 18, H).rows;
  check('a 14 px line and a 40 px line: 18 + 50 = 68 high, "OVER" rows 5-14, "GAME" rows 29-57, as .NET', ref.label.MeasuredSize.Pixels.Height === 68 && asNet(refOver, "5-14") && asNet(refGame, "29-57"), `height ${ref.label.MeasuredSize.Pixels.Height}, OVER ${refOver}, GAME ${refGame}`);

  // ParagraphSpacing: 0.25 by default (as .NET), lines of the label's font (as .NET and Rust), not of the paragraph's line
  const paras = draw((l) => { l.Text = "GAME\nOVER"; });
  check("two paragraphs, default ParagraphSpacing 0.25: 48 + 12 + 48 = 108", paras.label.ParagraphSpacing === 0.25 && paras.label.MeasuredSize.Pixels.Height === 108, `${paras.label.MeasuredSize.Pixels.Height}`);
  const lines2 = draw((l) => { l.Text = "GAME OVER"; });
  check("a line break inside a paragraph (U+2028) adds no paragraph space: 96", lines2.label.MeasuredSize.Pixels.Height === 96, `${lines2.label.MeasuredSize.Pixels.Height}`);
  const bigPara = draw((l) => { l.FontSize = 14; l.AddSubView(span("OVER\n")); l.AddSubView(span("GAME", 40)); });
  check("a 40 px paragraph after a 14 px label line: a quarter of the label's 18 px line above it, 18 + 4.5 + 50 -> 73", bigPara.label.MeasuredSize.Pixels.Height === 73, `${bigPara.label.MeasuredSize.Pixels.Height}`);

  // a 20 px line and a 38 px line: their own heights by default; LineHeightUniform: both 48 px, the first line's baseline
  // at its bottom minus its descent
  const m20 = metrics(face, 20);
  const mixed = (uniform: boolean) => draw((l) => { l.FontSize = 20; l.ParagraphSpacing = 0; l.LineHeightUniform = uniform; l.AddSubView(span("OVER\n")); l.AddSubView(span("GAME", 38)); }, 0, 48);
  const uni = mixed(true), own = draw((l) => { l.FontSize = 20; l.ParagraphSpacing = 0; l.AddSubView(span("OVER\n")); l.AddSubView(span("GAME", 38)); }, 0, 48);
  const b1 = 48 - m20.d, low = uni.rows.split("-").map(Number)[1];
  check("LineHeightUniform: a 20 px line and a 38 px line, both 48 px high", uni.label.MeasuredSize.Pixels.Height === 96 && uni.label.MeasuredLineHeight === 48, `${uni.label.MeasuredSize.Pixels.Height}, line ${uni.label.MeasuredLineHeight}`);
  check(`LineHeightUniform: the 20 px line sits on the bottom of its 48 px line (baseline ${b1.toFixed(2)})`, low >= Math.floor(b1) - 1 && low <= Math.floor(b1), `rows ${uni.rows}`);
  const own20 = Math.round(m20.a + m20.d);
  check(`by default each line its own height (${own20} + 48)`, own.label.MeasuredSize.Pixels.Height === own20 + 48, `${own.label.MeasuredSize.Pixels.Height}`);

  // a line of two fonts: the larger ascent plus the larger descent, rounded once (not the larger of their rounded heights)
  const o44 = metrics(face, 44), s40 = metrics(sans, 40);
  const perSpan = Math.max(Math.round(o44.a + o44.d), Math.round(s40.a + s40.d)), summed = Math.round(Math.max(o44.a, s40.a) + Math.max(o44.d, s40.d));
  const two = draw((l) => { l.FontSize = 10; l.AddSubView(span("GAME", 44)); l.AddSubView(span("go", 40, "OpenSans")); });
  check(`two fonts on a line: ${summed} high (not ${perSpan})`, perSpan !== summed && two.label.MeasuredSize.Pixels.Height === summed, `${two.label.MeasuredSize.Pixels.Height}`);
  // a line of a small span takes that span's height, not the label font's
  const m12 = metrics(face, 12), h12 = Math.round(m12.a + m12.d);
  const small = draw((l) => { l.FontSize = 38; l.AddSubView(span("go", 12)); });
  check(`a line of a 12 px span is ${h12} px high`, small.label.MeasuredSize.Pixels.Height === h12, `${small.label.MeasuredSize.Pixels.Height}`);

  // a font with Leading: Leading * LineSpacing between lines
  const g = metrics(leadFace, 38), glh = Math.round(g.a + g.d);
  const gap1 = draw((l) => { l.FontFamily = "OrbitronGap"; l.ParagraphSpacing = 0; l.Text = "GAME\nOVER"; });
  check(`a font with Leading ${g.lead.toFixed(2)}: two lines are ${glh} + ${g.lead.toFixed(2)} + ${glh}`, g.lead > 0 && gap1.label.MeasuredSize.Pixels.Height === Math.ceil(2 * glh + g.lead), `${gap1.label.MeasuredSize.Pixels.Height}`);
  const gap15 = draw((l) => { l.FontFamily = "OrbitronGap"; l.ParagraphSpacing = 0; l.Text = "GAME\nOVER"; l.LineSpacing = 1.5; });
  check("Leading with LineSpacing 1.5: 1.5 x Leading between the lines", gap15.label.MeasuredSize.Pixels.Height === Math.ceil(2 * glh + g.lead * 1.5), `${gap15.label.MeasuredSize.Pixels.Height}`);
  const plain15 = draw((l) => { l.ParagraphSpacing = 0; l.Text = "GAME\nOVER"; l.LineSpacing = 1.5; });
  check("no Leading, LineSpacing 1.5: half a line between the lines", plain15.label.MeasuredSize.Pixels.Height === 48 * 2 + 24, `${plain15.label.MeasuredSize.Pixels.Height}`);

  console.log(failures ? `FAIL: ${failures} checks` : "OK: label lines and baselines as .NET");
  process.exit(failures ? 1 : 0);
})();
