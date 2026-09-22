import type { SkiaControl } from "../core/SkiaControl";
import type { GestureEventProcessingInfo, SkiaGesturesParameters } from "../core/Gestures";
import { type PrebuiltControlStyle, ResolveControlStyle, type ResolvedControlStyle } from "../core/ControlStyle";
import { type Color, Colors, type ScaledSize } from "../core/Types";
import { SkiaLayout } from "./SkiaLayout";

/**
 * Mirrors DrawnUi SkiaToggle: base of SkiaSwitch / SkiaCheckbox / SkiaRadioButton. Tapped flips IsToggled,
 * `Toggled` reports user changes, `ControlStyle` selects the look the default content is built with (at first
 * measure, like C# CreateDefaultContent; a later change rebuilds it, C# RebuildDefaultContent). Colors left unset
 * take the style defaults (C# SetStyleDefault).
 */
export abstract class SkiaToggle extends SkiaLayout {
  private controlStyle: PrebuiltControlStyle = "Unset";
  get ControlStyle(): PrebuiltControlStyle { return this.controlStyle; }
  set ControlStyle(v: PrebuiltControlStyle) {
    if (this.controlStyle === v) return;
    this.controlStyle = v;
    this.RebuildDefaultContent();
  }
  /** Fires on every IsToggled change; C# fires only on user/external changes, not on DefaultValue application. */
  Toggled?: (sender: SkiaToggle, value: boolean) => void;
  DefaultValue = false;
  IsAnimated = true;
  RespondsToGestures = true;

  private isToggled = false;
  private colorThumbOn?: Color;
  private colorFrameOn?: Color;
  private colorThumbOff?: Color;
  private colorFrameOff?: Color;
  protected contentCreated = false;
  protected usingStyle: ResolvedControlStyle = "Unset";

  constructor() {
    super();
    this.Type = "Absolute";
  }

  get UsingControlStyle(): ResolvedControlStyle { return this.contentCreated ? this.usingStyle : ResolveControlStyle(this.ControlStyle); }

  get IsToggled(): boolean { return this.isToggled; }
  set IsToggled(v: boolean) {
    if (this.isToggled === v) return;
    this.isToggled = v;
    this.OnToggledChanged();
  }

  // C# defaults: thumb White / frame Red (on), thumb White / frame DarkGray (off); styles override the unset ones
  get ColorThumbOn(): Color { return this.colorThumbOn ?? this.StyleDefault("ColorThumbOn") ?? Colors.White; }
  set ColorThumbOn(v: Color) { this.colorThumbOn = v; this.ApplyProperties(); }
  get ColorFrameOn(): Color { return this.colorFrameOn ?? this.StyleDefault("ColorFrameOn") ?? Colors.Red; }
  set ColorFrameOn(v: Color) { this.colorFrameOn = v; this.ApplyProperties(); }
  get ColorThumbOff(): Color { return this.colorThumbOff ?? this.StyleDefault("ColorThumbOff") ?? Colors.White; }
  set ColorThumbOff(v: Color) { this.colorThumbOff = v; this.ApplyProperties(); }
  get ColorFrameOff(): Color { return this.colorFrameOff ?? this.StyleDefault("ColorFrameOff") ?? Colors.DarkGray; }
  set ColorFrameOff(v: Color) { this.colorFrameOff = v; this.ApplyProperties(); }

  /** Per-style color defaults (C# SetStyleDefault); undefined = the SkiaToggle default. */
  protected StyleDefault(_name: "ColorThumbOn" | "ColorFrameOn" | "ColorThumbOff" | "ColorFrameOff"): Color | undefined { return undefined; }

  protected OnToggledChanged(): void {
    this.ApplyProperties();
    this.Toggled?.(this, this.isToggled);
    this.NotifyAccessibility();
  }

  /** Builds the look (C# CreateDefaultContent) — subclasses add their views here; called again after a rebuild. */
  protected abstract CreateDefaultContent(): void;
  /** Pushes IsToggled + colors into the views (C# ApplyProperties). */
  abstract ApplyProperties(): void;

  /** Size requests the style pinned (C# SetDefaultContentSize / SetDefaultMinimumContentSize); a rebuild releases only these. */
  private stylePinned: ("WidthRequest" | "HeightRequest" | "MinimumHeightRequest")[] = [];

  /** C# SetDefaultContentSize: the style's size, only where the app left the request unset. */
  protected SetContentSize(w: number, h: number): void {
    if (this.WidthRequest < 0) { this.WidthRequest = w; this.stylePinned.push("WidthRequest"); }
    if (this.HeightRequest < 0) { this.HeightRequest = h; this.stylePinned.push("HeightRequest"); }
  }

  /** C# SetDefaultMinimumContentSize (height only): the style's minimum, only where the app left it unset. */
  protected SetMinimumContentHeight(h: number): void {
    if (this.MinimumHeightRequest < 0) { this.MinimumHeightRequest = h; this.stylePinned.push("MinimumHeightRequest"); }
  }

  /**
   * C# RebuildDefaultContent: drops the content built for the previous style and the sizes it pinned (the app's own
   * requests stay), so the next Measure builds the current style. No-op before the first build.
   */
  RebuildDefaultContent(): void {
    if (!this.contentCreated) return;
    this.Children = [];
    for (const p of this.stylePinned) this[p] = -1;
    this.stylePinned = [];
    this.contentCreated = false;
    this.Update();
  }

  /** Content (and the size requests the style sets) must exist before Measure reads WidthRequest/HeightRequest. */
  override Measure(widthConstraint: number, heightConstraint: number, scale: number): ScaledSize {
    if (!this.contentCreated) {
      this.contentCreated = true;
      this.usingStyle = ResolveControlStyle(this.ControlStyle);
      this.CreateDefaultContent();
      this.ApplyProperties();
    }
    return super.Measure(widthConstraint, heightConstraint, scale);
  }

  protected override DefaultAccessibilityCanInteract(): boolean { return this.RespondsToGestures; }
  override get AccessibilityIsPressed(): boolean | undefined { return this.isToggled; }
  override set AccessibilityIsPressed(_v: boolean | undefined) { /* derived from IsToggled */ }

  override ProcessGestures(args: SkiaGesturesParameters, apply: GestureEventProcessingInfo): SkiaControl | null {
    if (args.Type === "Tapped" && this.RespondsToGestures) { this.IsToggled = !this.IsToggled; return this; }
    return super.ProcessGestures(args, apply);
  }
}
