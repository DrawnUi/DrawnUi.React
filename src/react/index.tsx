import { type CSSProperties, type FC, type ReactNode, useLayoutEffect, useRef } from "react";
import { Canvas as CanvasView } from "../core/Canvas";
import type { SkiaControl } from "../core/SkiaControl";
import type { SkiaLabel as SkiaLabelCtrl } from "../controls/SkiaLabel";
import type { SkiaLayout as SkiaLayoutCtrl } from "../controls/SkiaLayout";
import type { SkiaHotspot as SkiaHotspotCtrl } from "../controls/SkiaHotspot";
import type { SkiaButton as SkiaButtonCtrl } from "../controls/SkiaButton";
import type { SkiaImage as SkiaImageCtrl } from "../controls/SkiaImage";
import type { SkiaSvg as SkiaSvgCtrl } from "../controls/SkiaSvg";
import type { Color, RenderingModeType } from "../core/Types";
import type { GesturesMode } from "../core/Gestures";
import { createDrawnRoot } from "./reconciler";

/** Public settable properties of a control become its JSX props, same PascalCase names as C#. */
type PropsOf<T> = Partial<{
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  [K in keyof T as T[K] extends Function ? never : K extends "Children" | "Views" | "Parent" | "Superview" | "DrawingRect" | "MeasuredSize" | "RenderingScale" | "NeedMeasure" | "_superview" | "HitBoxAuto" | "TotalDown" | "TotalTapped" | "TouchDown" | "PostAnimators" | "LoadedSource" | "IsLoading" | "DisplayRect" | "AspectScale" ? never : K]: T[K];
}>;

type LeafProps<T> = PropsOf<T>;
type LayoutProps<T> = PropsOf<T> & { children?: ReactNode };

/** Typed JSX tags resolved by the reconciler Registry. */
export const SkiaLayout = "SkiaLayout" as unknown as FC<LayoutProps<SkiaLayoutCtrl>>;
export const SkiaStack = "SkiaStack" as unknown as FC<LayoutProps<SkiaLayoutCtrl>>;
export const SkiaRow = "SkiaRow" as unknown as FC<LayoutProps<SkiaLayoutCtrl>>;
export const SkiaLayer = "SkiaLayer" as unknown as FC<LayoutProps<SkiaLayoutCtrl>>;
export const SkiaLabel = "SkiaLabel" as unknown as FC<LeafProps<SkiaLabelCtrl>>;
export const SkiaHotspot = "SkiaHotspot" as unknown as FC<LeafProps<SkiaHotspotCtrl>>;
export const SkiaButton = "SkiaButton" as unknown as FC<LeafProps<SkiaButtonCtrl>>;
export const SkiaImage = "SkiaImage" as unknown as FC<LeafProps<SkiaImageCtrl>>;
export const SkiaSvg = "SkiaSvg" as unknown as FC<LeafProps<SkiaSvgCtrl>>;

export interface CanvasProps {
  BackgroundColor?: Color;
  RenderingMode?: RenderingModeType;
  /** Disabled (default) / Enabled / Lock, like DrawnUi Canvas.Gestures. */
  Gestures?: GesturesMode;
  children?: ReactNode;
  style?: CSSProperties;
  className?: string;
}

/**
 * Mirrors DrawnUi Canvas: the bridge between the DOM (react-dom) and the drawn tree (DrawnUi reconciler).
 * Requires Super.UseDrawnUi()...BuildAsync() to have completed.
 */
export function Canvas({ BackgroundColor, RenderingMode, Gestures, children, style, className }: CanvasProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const view = useRef<CanvasView>(null);
  const root = useRef<ReturnType<typeof createDrawnRoot>>(null);

  useLayoutEffect(() => {
    const v = new CanvasView(ref.current!);
    if (RenderingMode) v.RenderingMode = RenderingMode;
    view.current = v;
    root.current = createDrawnRoot(v);
    return () => { root.current?.unmount(); v.Dispose(); view.current = null; root.current = null; };
    // RenderingMode is read once at surface creation, like DrawnUi.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useLayoutEffect(() => {
    const v = view.current!;
    if (BackgroundColor !== undefined && v.BackgroundColor !== BackgroundColor) { v.BackgroundColor = BackgroundColor; v.Update(); }
    v.Gestures = Gestures ?? "Disabled";
    root.current!.render(children);
  });

  return <canvas ref={ref} className={className} style={{ display: "block", width: "100%", height: "100%", ...style }} />;
}

export type { SkiaControl };

// One import for apps: React tags + every engine type (Colors, Thickness, Super, gestures, animators...).
// The engine `Canvas` class is shadowed by the React <Canvas> above; reach it via "drawnui-react/core".
export * from "../index";
