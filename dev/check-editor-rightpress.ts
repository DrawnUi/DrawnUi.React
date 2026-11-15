// A press with a mouse button other than the main one leaves an editor's caret and selection as they are (DrawnUi.Net
// b6d65b8b, DrawnUI for Rust), checked in Node (`npm run check:editor-rightpress`): the app's context menu then sees
// what the user had selected. All text selected, then a right press, a right drag and a right long press: all still
// selected. A left click places the caret, a right press elsewhere: the caret stays, nothing gets selected. A right press
// on an unfocused editor focuses it.
import { readFileSync } from "node:fs";
import {
  Super, SKRect, SKPoint, Canvas, SkiaAccessibilityManager, HoverManager, SkiaLayer, SkiaEditor, PointerData,
  SkiaGesturesParameters, TouchActionEventArgs, type SkiaControl, type AnimatorBase, type TouchActionResult, type MouseButton,
} from "../src/index.ts";

declare const CanvasKitInit: (o: { locateFile: () => string }) => Promise<any>;
const ROOT = process.cwd();
let failures = 0;
const check = (name: string, ok: boolean, detail = "") => { if (!ok) failures++; console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`); };

// the keyboard listens on the window when a field takes the focus
const g = globalThis as unknown as Record<string, unknown>;
g.window = Object.assign(g.window ?? {}, { addEventListener() {}, removeEventListener() {}, focus() {}, setInterval, clearInterval, setTimeout, clearTimeout });

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
  ControlLeft(): void {}
  ReportFocus(): void {}
}

(async () => {
  const CK = await CanvasKitInit({ locateFile: () => `${ROOT}/node_modules/canvaskit-wasm/bin/full/canvaskit.wasm` });
  (Super as unknown as { CK: unknown }).CK = CK;
  const face = CK.Typeface.MakeFreeTypeFaceFromData(readFileSync(`${ROOT}/samples/public/fonts/OpenSans-Regular.ttf`).buffer);
  Super.Fonts.set("FontText", new Map([[400, face]])); Super.DefaultTypeface = face; Super.DefaultFontAlias = "FontText";

  const make = () => {
    const editor = new SkiaEditor(); editor.WidthRequest = 380; editor.HeightRequest = 40; editor.MaxLines = 1; editor.Text = "hello wide world of text";
    const root = new SkiaLayer(); root.WidthRequest = 400; root.HeightRequest = 100; root.AddSubView(editor);
    root._superview = new FakeCanvas() as unknown as Canvas;
    root.Measure(400, 100, 1); root.Arrange(new SKRect(0, 0, 400, 100), -1, -1, 1);
    const canvas = Object.create(Canvas.prototype) as Canvas & { gestureOwner: SkiaControl | null; activeTouchIds: Set<number> };
    canvas.gestureOwner = null; canvas.activeTouchIds = new Set();
    (canvas as unknown as { ReportFocus(): void }).ReportFocus = () => {};
    const send = (type: TouchActionResult, x: number, button: MouseButton = "Left") => {
      const a = new TouchActionEventArgs(); a.Location = new SKPoint(x, 20); a.StartingLocation = a.Location; a.Scale = 1;
      a.Pointer = Object.assign(new PointerData(), { Button: button, ButtonNumber: button === "Right" ? 2 : 1 });
      if (type === "Down") canvas.activeTouchIds.add(1);
      (canvas as unknown as { ProcessGestures(r: SkiaControl, p: SkiaGesturesParameters): SkiaControl | null }).ProcessGestures(root, SkiaGesturesParameters.Create(type, a));
      if (type === "Up") canvas.activeTouchIds.delete(1);
    };
    return { editor, send };
  };

  {
    const { editor, send } = make();
    send("Down", 50); send("Up", 50); send("Tapped", 50);
    editor.SelectAll();
    const all = editor.Text.length;
    send("Down", 120, "Right"); send("Up", 120, "Right");
    check("all text selected, a right press: still all selected", editor.CursorPosition === 0 && editor.SelectionLength === all, `caret ${editor.CursorPosition}, selected ${editor.SelectionLength} of ${all}`);
    send("Down", 120, "Right"); send("Panning", 200, "Right"); send("Up", 200, "Right");
    check("a right drag: still all selected", editor.CursorPosition === 0 && editor.SelectionLength === all, `caret ${editor.CursorPosition}, selected ${editor.SelectionLength}`);
    send("Down", 120, "Right"); send("LongPressing", 120, "Right"); send("Up", 120, "Right");
    check("a right long press: still all selected", editor.CursorPosition === 0 && editor.SelectionLength === all, `caret ${editor.CursorPosition}, selected ${editor.SelectionLength}`);
  }
  {
    const { editor, send } = make();
    send("Down", 40); send("Up", 40); send("Tapped", 40);
    const caret = editor.CursorPosition;
    send("Down", 250, "Right"); send("Up", 250, "Right"); send("Tapped", 250, "Right");
    check("a left click, then a right press elsewhere: the caret stays, nothing selected", editor.CursorPosition === caret && editor.SelectionLength === 0, `caret ${caret} -> ${editor.CursorPosition}, selected ${editor.SelectionLength}`);
  }
  {
    const { editor, send } = make();
    send("Down", 60, "Right"); send("Up", 60, "Right");
    check("a right press on an unfocused editor focuses it", editor.IsFocused);
  }

  console.log(failures ? `FAIL: ${failures} checks` : "OK: a right press leaves an editor's caret and selection");
  process.exit(failures ? 1 : 0);
})();
