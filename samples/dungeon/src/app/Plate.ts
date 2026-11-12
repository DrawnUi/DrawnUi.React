// The plate every button is made of (port of examples/dungeon/src/plate.rs): a SkiaShape whose line is quiet at
// rest and takes the main color, with a glow, under the pointer or a press.

import { type Color, type GestureEventProcessingInfo, type SkiaControl, type SkiaGesturesParameters, SkiaShadow, SkiaShape } from "drawnui-react/core";

export class Plate extends SkiaShape {
  private readonly _rest: Color;
  private readonly _lit: Color;
  private _on = false;

  /** A plate stroked with `rest`, and with `lit` while hovered or pressed. */
  constructor(rest: Color, lit: Color) {
    super();
    this._rest = rest;
    this._lit = lit;
    this.UseCache = "Operations";
    this.StrokeColor = rest;
    this.ReceivesHover = true;
  }

  private Light(on: boolean): void {
    if (on === this._on) return;
    this._on = on;
    this.StrokeColor = on ? this._lit : this._rest;
    // the Shadows setter redraws the plate
    this.Shadows = on ? [new SkiaShadow({ Color: this._lit, X: 0, Y: 0, Blur: 12, Opacity: 0.85 })] : [];
  }

  override ApplyHover(on: boolean): void {
    this.Light(on);
    super.ApplyHover(on);
  }

  override ProcessGestures(args: SkiaGesturesParameters, apply: GestureEventProcessingInfo): SkiaControl | null {
    if (args.Type === "Down") this.Light(true);
    // A finger leaves; a mouse is still over the button.
    else if (args.Type === "Up" && args.Event.Pointer?.DeviceType === "Touch") this.Light(false);
    return super.ProcessGestures(args, apply);
  }
}
