// A password field (SkiaEditor.IsPassword) never tells its text to screen readers (as DrawnUi.Net), checked in Node
// (`npm run check:password-a11y`): its accessibility name is only its placeholder, and no node of the overlay carries the
// typed text; a plain field is named by its text.
import { readFileSync } from "node:fs";
import { Super, SKRect, SkiaAccessibilityManager, HoverManager, SkiaLayer, SkiaLabel, SkiaShape, SkiaStack, SkiaEditor, Aria, Thickness, type AnimatorBase, type Canvas } from "../src/index.ts";

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

  const surface = CK.MakeSurface(W, H);
  const snapshot = (password: boolean, text: string, placeholder: string) => {
    const fake = new FakeCanvas(); fake.AccessibilityManager.MinUpdateIntervalMs = 0;
    const editor = new SkiaEditor(); editor.WidthRequest = 300; editor.HeightRequest = 44; editor.MaxLines = 1; editor.IsPassword = password; editor.PlaceholderText = placeholder; editor.Text = text;
    const root = new SkiaStack(); root.WidthRequest = W; root.HeightRequest = H; root.AddSubView(editor);
    root._superview = fake as unknown as Canvas;
    root.Measure(W, H, 1); root.Arrange(new SKRect(0, 0, W, H), W, H, 1);
    root.Render({ Context: { Canvas: surface.getCanvas(), Surface: surface }, Destination: new SKRect(0, 0, W, H), Scale: 1 });
    fake.AccessibilityManager.OnFrameEnd(1, W, H, () => {});
    return fake.AccessibilityManager.Snapshot.map((n) => [n.Label ?? "", n.Hint ?? "", n.Value?.Text ?? ""].join("/"));
  };
  {
    const s = snapshot(true, "hunter22", "Password");
    check("a password field never exposes its text: no node says it", !s.some((x) => x.includes("hunter22")), s.join(" | "));
    check("a password field is named by its placeholder", s.some((x) => x.startsWith("Password/")), s.join(" | "));
  }
  { const s = snapshot(true, "hunter22", ""); check("a password field without a placeholder still says no text", !s.some((x) => x.includes("hunter22")), s.join(" | ")); }
  { const s = snapshot(false, "Ada", "Name"); check("a plain field is named by its text", s.some((x) => x.startsWith("Ada/")), s.join(" | ")); }
  surface.delete();
  console.log(failures ? `FAIL: ${failures} checks` : "OK: a password field never tells its text to screen readers");
  process.exit(failures ? 1 : 0);
})();
