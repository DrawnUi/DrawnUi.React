import { SkiaControl } from "./SkiaControl";

/** A declared set of property values: names as the C# properties (the JSX props of a control). */
export type ControlProps = Record<string, unknown>;

/** Not properties of the control: React's own keys. */
const SKIP = new Set(["children", "key", "ref"]);
/** Props that change how the subtree is composited, not what it contains: repaint, keep caches (DrawnUi RedrawCanvas). */
const REPAINT_ONLY = new Set(["TranslationX", "TranslationY", "TranslationZ", "Rotation", "RotationX", "RotationY", "RotationZ", "ScaleX", "ScaleY", "Scale", "SkewX", "SkewY", "AnchorX", "AnchorY", "Opacity"]);
/** Props that change only how a control looks, never its size (C# NeedDraw): an ImageComposite above redraws only its area. */
const isDrawOnly = (k: string) => k.endsWith("Color") || k === "FillGradient" || k === "StrokeGradient";

/**
 * Assigns the changed values of `next` straight onto the control (same names as the C# properties), as the React
 * renderer does with JSX props; a value `prev` had and `next` lacks goes back to the control's default. Handler values
 * (functions) are swapped without invalidating. Then the control is invalidated as little as the change needs: a size
 * change re-measures, a look change redraws, a transform change only repaints the composition.
 */
export function ApplyProps(inst: { Update(): void }, prev: ControlProps | null, next: ControlProps): void {
  let changed = false, repaint = false, layout = false;
  for (const k in next) {
    if (SKIP.has(k) || (prev && prev[k] === next[k])) continue;
    (inst as unknown as ControlProps)[k] = next[k];
    if (typeof next[k] === "function") continue;
    if (REPAINT_ONLY.has(k)) repaint = true;
    else { changed = true; if (!isDrawOnly(k)) layout = true; }
  }
  if (prev) for (const k in prev) if (!SKIP.has(k) && !(k in next)) {
    (inst as unknown as ControlProps)[k] = (new (inst.constructor as new () => object)() as unknown as ControlProps)[k];
    changed = layout = true;
  }
  if (changed && prev) { if (layout || !(inst instanceof SkiaControl)) inst.Update(); else inst.UpdateDraw(); }
  else if (repaint && prev) (inst as SkiaControl).RepaintComposition?.();
}
