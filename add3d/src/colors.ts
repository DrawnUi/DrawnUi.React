// DrawnUi color strings (#RGB, #ARGB, #RRGGBB, #AARRGGBB, rgb(), rgba()) as the 3D shader wants them.
import { Super } from "drawnui-react/core";

/** A UI color (sRGB) as a glTF material color (linear RGBA). */
export function ColorLinear(color: string): [number, number, number, number] {
  const c = Super.ParseColor(color);
  return [Math.pow(c[0], 2.2), Math.pow(c[1], 2.2), Math.pow(c[2], 2.2), c[3]];
}

/** A color for the shader as given (sRGB RGBA, 0..1). */
export function ColorSrgb(color: string): [number, number, number, number] {
  const c = Super.ParseColor(color);
  return [c[0], c[1], c[2], c[3]];
}
