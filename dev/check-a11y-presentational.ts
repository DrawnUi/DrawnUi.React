// The texts inside a button, a radio, a switch, a tab, a slider or an image are the control's look, not more nodes (ARIA
// "children presentational"), checked in Node (`npm run check:a11y-presentational`): a screen reader says the control's
// name once. Selectable text and controls nested in it stay; a link and a group keep their texts. Port of DrawnUi.Net
// AccessibilityPresentationalChildrenTests (add3d-heads b55f0f72).
import { readFileSync } from "node:fs";
import { Super, SKRect, SkiaAccessibilityManager, HoverManager, SkiaLayer, SkiaLabel, SkiaShape, SkiaStack, Aria, Thickness, type AnimatorBase, type Canvas } from "../src/index.ts";

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
  // a control (role, name) holding one plain text, or a selectable one
  const snapshot = (role: string, name: string, inner: string, selectable = false, nested?: string) => {
    const fake = new FakeCanvas(); fake.AccessibilityManager.MinUpdateIntervalMs = 0;
    const control = new SkiaShape(); control.WidthRequest = 120; control.HeightRequest = 40; control.AccessibilityRole = role; control.AccessibilityLabel = name;
    const text = new SkiaLabel(); text.Text = inner; text.AccessibilityTextSelectable = selectable; control.AddSubView(text);
    if (nested) { const b = new SkiaShape(); b.WidthRequest = 20; b.HeightRequest = 20; b.HorizontalOptions = "End"; b.AccessibilityRole = Aria.RoleButton; b.AccessibilityLabel = nested; b.Tapped = () => {}; control.AddSubView(b); }
    const root = new SkiaStack(); root.WidthRequest = W; root.HeightRequest = H; root.AddSubView(control);
    root._superview = fake as unknown as Canvas;
    root.Measure(W, H, 1); root.Arrange(new SKRect(0, 0, W, H), W, H, 1);
    root.Render({ Context: { Canvas: surface.getCanvas(), Surface: surface }, Destination: new SKRect(0, 0, W, H), Scale: 1 });
    fake.AccessibilityManager.OnFrameEnd(1, W, H, () => {});
    return fake.AccessibilityManager.Snapshot.map((n) => n.Label ?? "");
  };
  for (const role of ["radio", "button", "switch", "tab", "img", "slider"]) {
    const s = snapshot(role, "Linen, $1,190", "Linen");
    check(`the text inside ${/^[aeiou]/.test(role) ? "an" : "a"} ${role} is its look, not a node: the name is said once`, s.filter((x) => x === "Linen, $1,190").length === 1 && !s.includes("Linen"), s.join(" | "));
  }
  { const s = snapshot("button", "Linen, $1,190", "Linen", true); check("a selectable text inside a button stays", s.includes("Linen"), s.join(" | ")); }
  { const s = snapshot("img", "Walnut sofa, 3D view", "1", false, "Seat, hotspot"); check("a control inside an image stays, the image's text goes", s.includes("Seat, hotspot") && !s.includes("1"), s.join(" | ")); }
  for (const role of ["link", "group"]) {
    const s = snapshot(role, "Upholstery", "Linen");
    check(`the text inside a ${role} stays a node`, s.includes("Linen"), s.join(" | "));
  }
  surface.delete();
  console.log(failures ? `FAIL: ${failures} checks` : "OK: the texts inside a button, radio, switch, tab, image or slider are its look");
  process.exit(failures ? 1 : 0);
})();
