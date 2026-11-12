// Public types of the 3D add-on (DrawnUi.Add3d Add3dTypes, drawnui-add3d).
import type { Image } from "canvaskit-wasm";
import { DecodeImage, ImagePixels, type Image3D } from "./scene";

/** How 3D is drawn (SkiaModel3D.Look, SkiaScene3D.Look). */
export enum Look {
  /** Shaded by a light and the sky (the default). */
  Lit = 0,
  /** Two tones, lit and shade, like a cartoon. */
  Toon = 1,
  /** Each color as it is, no shading: an illustration (with an outline). */
  Flat = 2,
}

/** What a tap on a SkiaModel3D hit: the node and the material under the finger, and the point in the scene (scene units). */
export interface ModelHit { Node: string; Material: string; Point: [number, number, number] }

/** Where loading a model's Source stands. */
export enum LoadState3D {
  /** The file is on its way. */
  Loading = "Loading",
  /** The model is shown (also a model given as bytes or made in code). */
  Ready = "Ready",
  /** It could not be loaded or read: the reason is in Error. */
  Failed = "Failed",
}

/** Where a 3D point of a model shows in its control: points from its top left, and whether the model's own surface hides it. */
export interface PointOnScreen { X: number; Y: number; Occluded: boolean }

/** What a tap on a SkiaScene3D hit: the object by its name, and the node and material of its model under the finger. */
export interface SceneHit { Object: string; Node: string; Material: string }

/** An object's animation played with PlayOnce or Hold ended (SkiaScene3D.AnimationEnded). */
export interface SceneAnimationEnded { Object: string; Animation: string }

/**
 * An image to put on a material (SetMaterialImage): a PNG / JPEG / WebP file, or any CanvasKit image (a photo, a pattern
 * drawn in code). One copy of its pixels is uploaded once per GPU context, however many materials and controls show it.
 * It wraps by the surface's texture coordinates and is multiplied by the material's color: a white material shows it
 * as it is.
 */
export class Texture3D {
  private constructor(readonly Pixels: Image3D) {}

  /** From encoded bytes (PNG, JPEG, WebP); undefined when they are not an image. */
  static Decode(encoded: Uint8Array | ArrayBuffer): Texture3D | undefined {
    const pixels = DecodeImage(encoded instanceof Uint8Array ? encoded : new Uint8Array(encoded));
    return pixels ? new Texture3D(pixels) : undefined;
  }

  /** From a CanvasKit image (decoded, or drawn on a surface); undefined when its pixels cannot be read. */
  static FromImage(image: Image): Texture3D | undefined {
    const pixels = ImagePixels(image);
    return pixels ? new Texture3D(pixels) : undefined;
  }

  /** From RGBA pixels (unpremultiplied, 4 bytes per pixel, rows top down). */
  static FromPixels(rgba: Uint8Array, width: number, height: number): Texture3D {
    return new Texture3D({ Rgba: rgba, Width: width, Height: height });
  }

  get Width(): number { return this.Pixels.Width; }
  get Height(): number { return this.Pixels.Height; }
}
