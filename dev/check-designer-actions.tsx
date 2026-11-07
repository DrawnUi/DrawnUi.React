// Designer actions (C# DrawnUi.Draw.DesignerActions), checked in Node (`npm run check:designer-actions`): designerAction
// adds a named action and returns its remover, the same path replaces it in place, paths keep their declaration order,
// Run calls it (false for an unknown path), Changed is raised on each change; useDesignerAction keeps an action while its
// component is mounted and runs the latest function given; <DesignerAction Name onRun /> does the same as an element.
import { useState } from "react";
import { SkiaLayer, SkiaStack, useDesignerAction, designerAction, DesignerActions, DesignerAction } from "../src/react/index.tsx";
import { createDrawnRoot } from "../src/react/reconciler.ts";
import { Super, SkiaAccessibilityManager, HoverManager, type SkiaControl, type AnimatorBase, type Canvas } from "../src/index.ts";

declare const CanvasKitInit: (o: { locateFile: () => string }) => Promise<any>;
const ROOT = process.cwd();
let failures = 0;
const check = (name: string, ok: boolean, detail = "") => { if (!ok) failures++; console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class FakeCanvas {
  readonly AccessibilityManager = new SkiaAccessibilityManager();
  readonly Hover = new HoverManager();
  readonly AnimatingControls = new Map<number, AnimatorBase>();
  RenderingScale = 1; GpuEpoch = 0; Content?: SkiaControl;
  Update(): void {}
  DisposeObject(o: { Dispose(): void }): void { o.Dispose(); }
  RegisterAnimator(a: AnimatorBase): boolean { this.AnimatingControls.set(a.Uid, a); return true; }
  UnregisterAnimator(uid: number): void { this.AnimatingControls.delete(uid); }
  ControlLeft(): void {}
}

let level = 0;
let bump: (() => void) | undefined;
function LevelScreen() {
  const [n, setN] = useState(3);
  bump = () => setN((x) => x + 1);
  useDesignerAction("Levels/Current", () => { level = n; });
  return <SkiaLayer />;
}

(async () => {
  const CK = await CanvasKitInit({ locateFile: () => `${ROOT}/node_modules/canvaskit-wasm/bin/full/canvaskit.wasm` });
  (Super as unknown as { CK: unknown }).CK = CK;

  let changes = 0;
  const onChanged = () => { changes++; };
  DesignerActions.Changed.add(onChanged);
  const ran: string[] = [];
  const removeL1 = designerAction("Levels/Level 1", () => ran.push("L1"));
  designerAction("Levels/Level 2", () => ran.push("L2"));
  designerAction("Dialogs/Options", () => ran.push("Options"));
  check("paths in declaration order", DesignerActions.Paths.join("|") === "Levels/Level 1|Levels/Level 2|Dialogs/Options", DesignerActions.Paths.join("|"));
  check("Changed raised once per add", changes === 3, `${changes}`);
  designerAction("Levels/Level 1", () => ran.push("L1 again"));
  check("the same path replaces it in place", DesignerActions.Paths.join("|") === "Levels/Level 1|Levels/Level 2|Dialogs/Options" && DesignerActions.Run("Levels/Level 1") && ran.join() === "L1 again", ran.join());
  removeL1();
  check("an old remover does not remove the replacement", DesignerActions.Paths.includes("Levels/Level 1"));
  check("Run of an unknown path: false", DesignerActions.Run("Levels/Level 9") === false);
  DesignerActions.Remove("Dialogs/Options");
  check("Remove takes it out and raises Changed", !DesignerActions.Paths.includes("Dialogs/Options") && changes === 5, `${changes}`);
  let threw = false; try { designerAction("  ", () => {}); } catch { threw = true; }
  check("an empty path is refused", threw);

  const root = createDrawnRoot(new FakeCanvas() as unknown as Canvas);
  root.render(<LevelScreen />);
  await sleep(50);
  check("useDesignerAction: declared while mounted", DesignerActions.Paths.includes("Levels/Current"));
  bump!(); await sleep(50);
  DesignerActions.Run("Levels/Current");
  check("it runs the latest function given (state 4)", level === 4, `${level}`);
  root.render(<SkiaLayer />);
  await sleep(50);
  check("unmounted: the action is gone", !DesignerActions.Paths.includes("Levels/Current"), DesignerActions.Paths.join("|"));
  let options = 0;
  root.render(<SkiaStack><SkiaLayer /><DesignerAction Name="Dialogs/Options" onRun={() => { options++; }} /></SkiaStack>);
  await sleep(50);
  check("<DesignerAction>: declared while mounted, draws nothing, runs onRun", DesignerActions.Run("Dialogs/Options") && options === 1, `${options}`);
  root.render(<SkiaStack><SkiaLayer /></SkiaStack>);
  await sleep(50);
  check("<DesignerAction> unmounted: gone", !DesignerActions.Paths.includes("Dialogs/Options"));
  root.unmount();
  DesignerActions.Changed.delete(onChanged);

  console.log(failures ? `FAIL: ${failures} checks` : "OK: designer actions");
  process.exit(failures ? 1 : 0);
})();
