// DrawnUI Designer hooks in a dev build (`npm run check:designer-dev`, import.meta.env.DEV true): DesignerSourceOf gives
// the React element that created a control (its owner component and source position); a control made outside React
// has none. Production builds compile the map away (checked on the demo bundle).
import { SkiaLayer, SkiaShape, DesignerSourceOf } from "../src/react/index.tsx";
import { createDrawnRoot } from "../src/react/reconciler.ts";
import { Super, SkiaAccessibilityManager, HoverManager, SkiaShape as SkiaShapeCtrl, type SkiaControl, type AnimatorBase, type Canvas } from "../src/index.ts";

declare const CanvasKitInit: (o: { locateFile: () => string }) => Promise<any>;
const ROOT = process.cwd();
let failures = 0;
const check = (name: string, ok: boolean, detail = "") => { if (!ok) failures++; console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`); };

class FakeCanvas {
  readonly AccessibilityManager = new SkiaAccessibilityManager();
  readonly Hover = new HoverManager();
  readonly AnimatingControls = new Map<number, AnimatorBase>();
  RenderingScale = 1; GpuEpoch = 0; Content?: SkiaControl;
  Update(): void {}
  DisposeObject(o: { Dispose(): void }): void { o.Dispose(); }
  RegisterAnimator(a: AnimatorBase): boolean { this.AnimatingControls.set(a.Uid, a); return true; }
  UnregisterAnimator(uid: number): void { this.AnimatingControls.delete(uid); }
}

let tile: SkiaControl | null = null;
function Card() {
  return (
    <SkiaLayer>
      <SkiaShape ref={(c: SkiaControl | null) => { if (c) tile = c; }} WidthRequest={40} HeightRequest={40} />
    </SkiaLayer>
  );
}

(async () => {
  const CK = await CanvasKitInit({ locateFile: () => `${ROOT}/node_modules/canvaskit-wasm/bin/full/canvaskit.wasm` });
  (Super as unknown as { CK: unknown }).CK = CK;
  const fake = new FakeCanvas();
  const root = createDrawnRoot(fake as unknown as Canvas);
  root.render(<Card />);
  await new Promise((r) => setTimeout(r, 50));
  const source = tile ? DesignerSourceOf(tile) : undefined;
  check("a control made by JSX knows its fiber and owner component", !!source?.Fiber && source.Component === "Card", `${source?.Component}`);
  check("its source position is the JSX line in this file", !!source?.File && /check-designer-dev/.test(source.File) && (source.Line ?? 0) > 0, `${source?.File}:${source?.Line}:${source?.Column}`);
  check("a control made outside React has no source", DesignerSourceOf(new SkiaShapeCtrl()) === undefined);
  root.unmount();
  console.log(failures ? `FAIL: ${failures} checks` : "OK: designer sources in a dev build");
  process.exit(failures ? 1 : 0);
})();
