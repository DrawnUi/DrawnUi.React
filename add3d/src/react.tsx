// drawnui-react-add3d: the 3D add-on's JSX tags. Importing it registers them with the drawnui-react reconciler.
import type { FC, Ref } from "react";
import { Registry, type DrawnProps } from "drawnui-react";
import { SkiaModel3D as SkiaModel3DCtrl } from "./SkiaModel3D";
import { SkiaScene3D as SkiaScene3DCtrl } from "./SkiaScene3D";

Registry.SkiaModel3D = SkiaModel3DCtrl;
Registry.SkiaScene3D = SkiaScene3DCtrl;

type Model3DProps = DrawnProps<SkiaModel3DCtrl> & { Animation?: string; ref?: Ref<SkiaModel3DCtrl> };

/** A glTF scene (`Glb` bytes, `Source` file or address, or `Model` made in code) drawn in real 3D. */
export const SkiaModel3D = "SkiaModel3D" as unknown as FC<Model3DProps>;

/** A 3D layer over a 2D game field: many objects in one pass (add models and objects through its ref). */
export const SkiaScene3D = "SkiaScene3D" as unknown as FC<DrawnProps<SkiaScene3DCtrl> & { ref?: Ref<SkiaScene3DCtrl> }>;

export { Mesh3D, Model3D } from "./shapes";
export { Look, LoadState3D, Texture3D, type ModelHit, type PointOnScreen, type SceneHit, type SceneAnimationEnded } from "./types";
export type { SkiaModel3DCtrl, SkiaScene3DCtrl };
