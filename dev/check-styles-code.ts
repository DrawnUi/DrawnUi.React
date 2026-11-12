// Styles and controls built in code (`npm run check:styles-code`): a style registered with ConfigureStyles gives a
// control its defaults, and anything the app set itself wins, also for a control built with `new` in code-behind before
// any control of its class went through the reconciler (C# ExplicitPropertiesSet).
import { Super, SKRect, SkiaAccessibilityManager, HoverManager, SkiaLayer, SkiaLabel, StylesCollection, type AnimatorBase, type Canvas } from "../src/index.ts";

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

(async () => {
  const CK = await CanvasKitInit({ locateFile: () => `${ROOT}/node_modules/canvaskit-wasm/bin/full/canvaskit.wasm` });
  (Super as unknown as { CK: unknown }).CK = CK;
  new StylesCollection().AddStyle({ TargetType: SkiaLabel, ApplyToDerivedTypes: true, Setters: { FontFamily: "FontGame", FontSize: 15 } });

  const root = new SkiaLayer(); root.WidthRequest = 300; root.HeightRequest = 200;
  const own = new SkiaLabel(); own.Text = "own font"; own.FontFamily = "FontScore"; // set by the app: wins
  const plain = new SkiaLabel(); plain.Text = "style font"; // not set: the style's default
  const sized = new SkiaLabel(); sized.Text = "own size"; sized.FontSize = 30;
  root.AddSubView(own); root.AddSubView(plain); root.AddSubView(sized);
  root._superview = new FakeCanvas() as unknown as Canvas;
  root.Measure(300, 200, 1); root.Arrange(new SKRect(0, 0, 300, 200), 300, 200, 1);

  check("a label built in code keeps the FontFamily the app set", own.FontFamily === "FontScore", own.FontFamily);
  check("a label built in code without a FontFamily takes the style's", plain.FontFamily === "FontGame" && plain.FontSize === 15, `${plain.FontFamily} ${plain.FontSize}`);
  check("an app-set FontSize wins, the style still gives the FontFamily", sized.FontSize === 30 && sized.FontFamily === "FontGame", `${sized.FontFamily} ${sized.FontSize}`);

  console.log(failures ? `FAIL: ${failures} checks` : "OK: what the app sets in code wins over styles");
  process.exit(failures ? 1 : 0);
})();
