// An editor focused from code shows its caret at once, at the end of its text (drawnui-cross 6ai, C# 2285b422
// EditorFocusFromCodeTests), checked in Node (`npm run check:editor-focus`): empty, one line and two lines; a position the
// app set before focusing is kept; typing after a focus from code appends.
import { readFileSync } from "node:fs";
import { Super, SKRect, SkiaAccessibilityManager, HoverManager, SkiaLayout, SkiaEditor, type Canvas, type AnimatorBase } from "../src/index.ts";

declare const CanvasKitInit: (o: { locateFile: () => string }) => Promise<any>;
const ROOT = process.cwd();
const W = 800, H = 600, S = 2;
let failures = 0;
const check = (name: string, ok: boolean, detail = "") => { if (!ok) failures++; console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`); };

class FakeCanvas {
  readonly AccessibilityManager = new SkiaAccessibilityManager();
  readonly Hover = new HoverManager();
  readonly AnimatingControls = new Map<number, AnimatorBase>();
  RenderingScale = S;
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
  const face = CK.Typeface.MakeFreeTypeFaceFromData(readFileSync(`${ROOT}/samples/public/fonts/OpenSans-Regular.ttf`).buffer);
  Super.Fonts.set("FontText", new Map([[400, face]])); Super.DefaultTypeface = face; Super.DefaultFontAlias = "FontText";

  /** C# Scene: a 300 wide multiline editor (MaxLines 3, FontSize 18, a placeholder, ReturnType Send), scale 2. */
  const scene = (text: string) => {
    const editor = new SkiaEditor(); editor.WidthRequest = 300; editor.MaxLines = 3; editor.FontSize = 18; editor.Text = text;
    editor.PlaceholderText = "Write a comment"; editor.ReturnType = "Send";
    const root = new SkiaLayout(); root.HorizontalOptions = "Fill"; root.VerticalOptions = "Fill"; root.AddSubView(editor);
    root._superview = new FakeCanvas() as unknown as Canvas;
    const frame = () => {
      const surface = CK.MakeSurface(W, H);
      root.Measure(W, H, S); root.Arrange(new SKRect(0, 0, W, H), W, H, S);
      root.Render({ Context: { Canvas: surface.getCanvas(), Surface: surface }, Destination: new SKRect(0, 0, W, H), Scale: S });
      const px = surface.makeImageSnapshot().readPixels(0, 0, { width: W, height: H, colorType: CK.ColorType.RGBA_8888, alphaType: CK.AlphaType.Unpremul, colorSpace: CK.ColorSpace.SRGB }) as Uint8Array;
      surface.delete();
      return px;
    };
    for (let i = 0; i < 6; i++) frame();
    /** The caret is drawn: the frame differs from the same frame with the caret hidden. */
    const caretDrawn = () => {
      const a = frame(); editor.CanShowCursor = false; editor.InvalidateCache(); const b = frame(); editor.CanShowCursor = true; editor.InvalidateCache(); frame();
      let diff = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff++;
      return diff > 0;
    };
    return { editor, frame, caretDrawn };
  };

  for (const text of ["", "Hello", "first line\nsecond"]) {
    const t = scene(text);
    const was = t.editor.IsFocused;
    t.editor.IsFocused = true;
    for (let i = 0; i < 6; i++) t.frame();
    const drawn = t.caretDrawn();
    check(`focused from code ${JSON.stringify(text)}: caret at the end and drawn, the native field there too`, !was && t.editor.CursorPosition === text.length && drawn && field.selectionStart === text.length,
      `CursorPosition ${t.editor.CursorPosition}, drawn ${drawn}, native ${field.selectionStart}`);
    t.editor.IsFocused = false;
  }
  {
    const t = scene("Hello");
    t.editor.CursorPosition = 2;
    t.editor.IsFocused = true;
    for (let i = 0; i < 6; i++) t.frame();
    check("a position the app set before focusing is kept", t.editor.CursorPosition === 2 && t.caretDrawn(), `CursorPosition ${t.editor.CursorPosition}`);
    t.editor.IsFocused = false;
  }
  {
    const t = scene("Hello");
    t.editor.IsFocused = true;
    for (let i = 0; i < 6; i++) t.frame();
    t.editor.StubTypeText("!");
    t.frame();
    check("focused from code, then typed: appends", t.editor.Text === "Hello!" && t.editor.CursorPosition === 6, `"${t.editor.Text}", CursorPosition ${t.editor.CursorPosition}`);
    t.editor.IsFocused = false;
  }

  console.log(failures ? `FAIL: ${failures} checks` : "OK: editor focused from code");
  process.exit(failures ? 1 : 0);
})();
