// Label drawing that depends on the text direction, checked in Node (`npm run check:label-direction`): synthetic italic
// keeps its slant in an Image cache (cached ink right == uncached ink right, widths unchanged); HorizontalTextAlignment
// Start / End follow each paragraph's direction (drawnui-cross 6am): "مرحبا بكم" with Start ends at the label's right
// padding, with End starts at its left padding, a label with an Arabic and a Latin paragraph aligns each by its own
// direction; an editor's right-aligned Arabic line keeps its caret and selection on the glyphs.
import { readFileSync } from "node:fs";
import {
  Super, SKRect, SkiaAccessibilityManager, HoverManager, SkiaLayout, SkiaLabel, SkiaEditor, TextSpan, Thickness,
  type Canvas, type AnimatorBase, type SkiaControl, type SkiaCacheType,
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
  DisposeObject(o: { Dispose(): void }): void { o.Dispose(); }
  RegisterAnimator(a: AnimatorBase): boolean { this.AnimatingControls.set(a.Uid, a); return true; }
  UnregisterAnimator(uid: number): void { this.AnimatingControls.delete(uid); }
}

/** The hidden textarea the editor mirrors its text and caret into (TextInputProxy), as far as the editor uses it. */
const field = { value: "", selectionStart: 0, selectionEnd: 0, style: {} as Record<string, string>, dataset: {} as Record<string, string>, inputMode: "", enterKeyHint: "", spellcheck: false,
  setSelectionRange(a: number, b: number) { this.selectionStart = a; this.selectionEnd = b; }, focus() {}, blur() {}, addEventListener() {}, setAttribute() {} };
const g = globalThis as unknown as Record<string, unknown>;
g.window = Object.assign(g.window ?? {}, { addEventListener() {}, removeEventListener() {}, focus() {}, setInterval, clearInterval, setTimeout, clearTimeout });
g.document = { createElement: () => field, body: { appendChild() {} }, activeElement: null };

(async () => {
  const CK = await CanvasKitInit({ locateFile: () => `${ROOT}/node_modules/canvaskit-wasm/bin/full/canvaskit.wasm` });
  (Super as unknown as { CK: unknown }).CK = CK;
  const font = (file: string, alias: string) => { const face = Super.LoadFace(readFileSync(`${ROOT}/${file}`))!; Super.Fonts.set(alias, new Map([[400, face]])); return face; };
  const text = font("samples/public/fonts/OpenSans-Regular.ttf", "FontText");
  font("samples/public/fonts/NotoSansArabic-Subset.ttf", "FontArabic");
  Super.DefaultTypeface = text; Super.DefaultFontAlias = "FontText";

  /** Draws `control` at the top left of a black W x H canvas (frames: a cache is made on the first, used on the next). */
  const draw = (control: SkiaControl, W: number, H: number, frames = 3) => {
    const root = new SkiaLayout(); root.WidthRequest = W; root.HeightRequest = H; root.AddSubView(control);
    root._superview = new FakeCanvas() as unknown as Canvas;
    let px = new Uint8Array();
    for (let f = 0; f < frames; f++) {
      const surface = CK.MakeSurface(W, H);
      surface.getCanvas().clear(CK.BLACK);
      root.Measure(W, H, 1); root.Arrange(new SKRect(0, 0, W, H), W, H, 1);
      root.Render({ Context: { Canvas: surface.getCanvas(), Surface: surface }, Destination: new SKRect(0, 0, W, H), Scale: 1 });
      px = surface.makeImageSnapshot().readPixels(0, 0, { width: W, height: H, colorType: CK.ColorType.RGBA_8888, alphaType: CK.AlphaType.Unpremul, colorSpace: CK.ColorSpace.SRGB }) as Uint8Array;
      surface.delete();
    }
    /** First and last column with ink between rows y0 and y1. */
    const ink = (y0 = 0, y1 = H): [number, number] => {
      let lo = -1, hi = -1;
      for (let x = 0; x < W; x++) for (let y = y0; y < y1; y++) { const i = (y * W + x) * 4; if (px[i] + px[i + 1] + px[i + 2] > 60) { if (lo < 0) lo = x; hi = x; break; } }
      return [lo, hi];
    };
    return { ink };
  };

  {
    // the measurement drawnui-smart reported: FontSize 40, one italic span, 400 x 120
    const italic = (cache: SkiaCacheType) => {
      const l = new SkiaLabel(); l.FontSize = 40; l.TextColor = "#FFFFFF"; l.UseCache = cache;
      const s = new TextSpan(); s.Text = "Hello world"; s.IsItalic = true; l.AddSubView(s);
      const r = draw(l, 400, 120);
      return { right: r.ink()[1], width: l.DrawingRect.Width };
    };
    const none = italic("None"), ops = italic("Operations"), image = italic("Image");
    check("synthetic italic keeps its slant in an Image cache: cached ink right == uncached ink right", none.right > 0 && image.right === none.right && ops.right === none.right,
      `None ${none.right}, Operations ${ops.right}, Image ${image.right}, label width ${none.width}`);
    check("the slant is drawing room only: the label's width does not change", image.width === none.width && none.right > none.width, `width ${none.width}, ink to ${none.right}`);
  }

  const W = 400, PAD = 10;
  const label = (value: string, align?: "Start" | "End" | "Center") => {
    const l = new SkiaLabel(); l.Text = value; l.FontSize = 20; l.TextColor = "#FFFFFF"; l.FontFamilyFallback = "FontArabic";
    l.HorizontalOptions = "Fill"; l.Padding = new Thickness(PAD); if (align) l.HorizontalTextAlignment = align;
    return l;
  };
  {
    const start = draw(label("مرحبا بكم"), W, 80).ink(), end = draw(label("مرحبا بكم", "End"), W, 80).ink(), center = draw(label("مرحبا بكم", "Center"), W, 80).ink();
    check("right-to-left paragraph, default Start: the ink ends at the label's right padding", Math.abs(start[1] - (W - PAD)) <= 2 && start[0] > W / 2, `ink ${start}`);
    check("right-to-left paragraph, End: the ink starts at the left padding", Math.abs(end[0] - PAD) <= 2 && end[1] < W / 2, `ink ${end}`);
    check("Center stays centered", Math.abs((center[0] + center[1]) / 2 - W / 2) <= 2, `ink ${center}`);
    const latin = draw(label("Hello world"), W, 80).ink();
    check("left-to-right text with Start: unchanged, at the left padding", Math.abs(latin[0] - PAD) <= 2, `ink ${latin}`);
    const digits = draw(label("12345"), W, 80).ink();
    check("a paragraph with no strong letter is left to right", Math.abs(digits[0] - PAD) <= 2, `ink ${digits}`);
  }
  {
    // one Arabic and one Latin paragraph: each aligned by its own direction
    const l = label("مرحبا بكم\nHello world");
    const r = draw(l, W, 120);
    const lines = l.GetLineBoxes();
    const first = r.ink(Math.floor(lines[0].Top), Math.floor(lines[0].Top + lines[0].Height)), second = r.ink(Math.ceil(lines[1].Top), Math.floor(lines[1].Top + lines[1].Height));
    check("mixed label: the Arabic paragraph at the right, the Latin one at the left (Start)", Math.abs(first[1] - (W - PAD)) <= 2 && Math.abs(second[0] - PAD) <= 2, `Arabic ${first}, Latin ${second}`);
    const e = label("مرحبا بكم\nHello world", "End");
    const re = draw(e, W, 120);
    const el = e.GetLineBoxes();
    const f2 = re.ink(Math.floor(el[0].Top), Math.floor(el[0].Top + el[0].Height)), s2 = re.ink(Math.ceil(el[1].Top), Math.floor(el[1].Top + el[1].Height));
    check("mixed label with End: the Arabic paragraph at the left, the Latin one at the right", Math.abs(f2[0] - PAD) <= 2 && Math.abs(s2[1] - (W - PAD)) <= 2, `Arabic ${f2}, Latin ${s2}`);
  }
  {
    // a multiline editor: its Arabic line sits at the right, the caret and the selection stay on the glyphs
    const editor = new SkiaEditor(); editor.WidthRequest = 300; editor.MaxLines = 3; editor.FontSize = 20; editor.FontFamily = "FontText"; editor.FontFamilyFallback = "FontArabic";
    editor.Text = "مرحبا بكم";
    draw(editor, 400, 120);
    const c = editor as unknown as { CaretPlace(i: number): { X: number } };
    const boxes = editor.Label.GetGlyphBoxes();
    const first = boxes.find((b) => b.Index === 0)!, last = boxes.filter((b) => b.Width > 0).pop()!;
    const labelW = editor.Label.DrawingRect.Width;
    check("editor: a right-to-left line sits at the right of the field", first.Left + first.Width > labelW - 3, `first letter ends ${(first.Left + first.Width).toFixed(1)}, label ${labelW.toFixed(1)}`);
    check("editor: caret at 0 on the right edge of the first letter, at the end on the left edge of the last",
      Math.abs(c.CaretPlace(0).X - (first.Left + first.Width)) < 0.5 && Math.abs(c.CaretPlace(9).X - last.Left) < 0.5, `x0 ${c.CaretPlace(0).X.toFixed(1)}, x9 ${c.CaretPlace(9).X.toFixed(1)}`);
    const sel = boxes.filter((b) => b.Index >= 0 && b.Index < 5 && b.Width > 0);
    const lo = Math.min(...sel.map((b) => b.Left)), hi = Math.max(...sel.map((b) => b.Left + b.Width));
    check("editor: the selection of the first word covers its glyphs at the right", Math.abs(hi - (first.Left + first.Width)) < 0.5 && lo > labelW / 2, `${lo.toFixed(1)}..${hi.toFixed(1)}`);
  }

  console.log(failures ? `FAIL: ${failures} checks` : "OK: label direction");
  process.exit(failures ? 1 : 0);
})();
