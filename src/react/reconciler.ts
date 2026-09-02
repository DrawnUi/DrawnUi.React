import { createContext, type ReactNode } from "react";
import Reconciler from "react-reconciler";
import { ConcurrentRoot, DefaultEventPriority } from "react-reconciler/constants";
import type { Canvas } from "../core/Canvas";
import { SkiaControl } from "../core/SkiaControl";
import { SkiaLabel } from "../controls/SkiaLabel";
import { SkiaLayer, SkiaLayout, SkiaRow, SkiaStack } from "../controls/SkiaLayout";
import { SkiaHotspot } from "../controls/SkiaHotspot";
import { SkiaButton } from "../controls/SkiaButton";
import { SkiaImage } from "../controls/SkiaImage";
import { SkiaSvg } from "../controls/SkiaSvg";
import { SkiaScroll } from "../controls/SkiaScroll";

/** JSX tag name -> engine class. Add a control here to expose it to React. */
export const Registry: Record<string, new () => SkiaControl> = {
  SkiaLayout, SkiaStack, SkiaRow, SkiaLayer, SkiaLabel, SkiaHotspot, SkiaButton, SkiaImage, SkiaSvg, SkiaScroll,
};

type Props = Record<string, unknown>;
const SKIP = new Set(["children", "key", "ref"]);

/**
 * Assigns changed props straight onto the control (same names as the C# properties).
 * Handler props (functions) are swapped without invalidating: inline arrows change identity every render.
 */
function applyProps(inst: SkiaControl, prev: Props | null, next: Props): void {
  let changed = false;
  for (const k in next) {
    if (SKIP.has(k) || (prev && prev[k] === next[k])) continue;
    (inst as unknown as Props)[k] = next[k];
    if (typeof next[k] !== "function") changed = true;
  }
  if (prev) for (const k in prev) if (!SKIP.has(k) && !(k in next)) {
    (inst as unknown as Props)[k] = (new (inst.constructor as new () => SkiaControl)() as unknown as Props)[k];
    changed = true;
  }
  if (changed && prev) inst.Update();
}

let currentUpdatePriority: number = DefaultEventPriority;
const noop = () => {};

/** React requires a non-null host context object. */
type HostContext = Record<string, never>;
const hostContext: HostContext = {};

type Cfg = Reconciler.HostConfig<string, Props, Canvas, SkiaControl, never, never, never, never, SkiaControl, HostContext, null, number, -1, null>;

// Record<string, unknown> absorbs members that react-reconciler 0.33 reads but @types 0.32 does not declare yet.
const hostConfig: Cfg & Record<string, unknown> = {
  supportsMutation: true,
  supportsPersistence: false,
  supportsHydration: false,
  isPrimaryRenderer: false,
  warnsIfNotActing: false,
  noTimeout: -1 as const,
  scheduleTimeout: setTimeout,
  cancelTimeout: clearTimeout,
  supportsMicrotasks: true,
  scheduleMicrotask: queueMicrotask,

  createInstance(type: string, props: Props) {
    const ctor = Registry[type];
    if (!ctor) throw new Error(`DrawnUi: unknown control <${type}>`);
    const inst = new ctor();
    applyProps(inst, null, props);
    return inst;
  },
  createTextInstance(text: string): never {
    throw new Error(`DrawnUi: raw text "${text}" is not allowed, use <SkiaLabel Text="..." />`);
  },
  appendInitialChild: (parent: SkiaControl, child: SkiaControl) => parent.AddSubView(child),
  appendChild: (parent: SkiaControl, child: SkiaControl) => parent.AddSubView(child),
  insertBefore: (parent: SkiaControl, child: SkiaControl, before: SkiaControl) => {
    const index = parent instanceof SkiaLayout ? parent.Views.indexOf(before) : 0;
    parent.InsertSubView(index, child);
  },
  removeChild: (parent: SkiaControl, child: SkiaControl) => parent.RemoveSubView(child),
  appendChildToContainer: (canvas: Canvas, child: SkiaControl) => { canvas.Content = child; },
  insertInContainerBefore: (canvas: Canvas, child: SkiaControl) => { canvas.Content = child; },
  removeChildFromContainer: (canvas: Canvas, child: SkiaControl) => { if (canvas.Content === child) canvas.Content = undefined; },
  clearContainer: (canvas: Canvas) => { canvas.Content = undefined; },

  commitUpdate: (inst: SkiaControl, _type: string, prev: Props, next: Props) => applyProps(inst, prev, next),
  commitTextUpdate: noop,
  commitMount: noop,
  finalizeInitialChildren: () => false,
  shouldSetTextContent: () => false,
  resetTextContent: noop,
  hideInstance: (inst: SkiaControl) => { inst.IsVisible = false; inst.Update(); },
  unhideInstance: (inst: SkiaControl) => { inst.IsVisible = true; inst.Update(); },
  hideTextInstance: noop,
  unhideTextInstance: noop,

  getRootHostContext: () => hostContext,
  getChildHostContext: (ctx: HostContext) => ctx,
  getPublicInstance: (inst: SkiaControl) => inst,
  prepareForCommit: () => null,
  resetAfterCommit: noop,
  preparePortalMount: noop,
  getInstanceFromNode: () => null,
  beforeActiveInstanceBlur: noop,
  afterActiveInstanceBlur: noop,
  prepareScopeUpdate: noop,
  getInstanceFromScope: () => null,
  detachDeletedInstance: noop,

  setCurrentUpdatePriority: (p: number) => { currentUpdatePriority = p; },
  getCurrentUpdatePriority: () => currentUpdatePriority,
  resolveUpdatePriority: () => currentUpdatePriority || DefaultEventPriority,
  shouldAttemptEagerTransition: () => false,
  trackSchedulerEvent: noop,
  resolveEventType: () => null,
  resolveEventTimeStamp: () => -1.1,
  requestPostPaintCallback: noop,
  maySuspendCommit: () => false,
  maySuspendCommitOnUpdate: () => false,
  maySuspendCommitInSyncRender: () => false,
  preloadInstance: () => true,
  startSuspendingCommit: noop,
  suspendInstance: noop,
  suspendOnActiveViewTransition: noop,
  waitForCommitToBeReady: () => null,
  getSuspendedCommitReason: () => null,
  resetFormInstance: noop,
  NotPendingTransition: null,
  HostTransitionContext: createContext(null) as unknown as Cfg["HostTransitionContext"],
};

const reconciler = Reconciler(hostConfig);

const onError = (e: unknown) => console.error("DrawnUi.React:", e);

/** Creates a React root whose container is an engine Canvas. */
export function createDrawnRoot(canvas: Canvas) {
  const container = reconciler.createContainer(canvas, ConcurrentRoot, null, false, null, "", onError, onError, onError, noop, null);
  return {
    render(children: ReactNode) { reconciler.updateContainer(children, container, null, null); },
    unmount() { reconciler.updateContainer(null, container, null, null); },
  };
}
