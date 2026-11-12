// The game control: a DrawnGame whose loop, keys and gestures go to the app (Rust: DrawnGame::new() with
// on_game_loop / on_key_down / on_key_up / consume_gestures), with the scene under the post effect inside.

import { DrawnGame, type GestureEventProcessingInfo, type InputKey, KeyboardManager, type SkiaControl, type SkiaGesturesParameters } from "drawnui-react/core";
import type { DungeonApp } from "./DungeonApp";

export class DungeonGame extends DrawnGame {
  private readonly _app: DungeonApp;
  private _started = false;

  /** F1 opens the game's help, not the browser's. */
  private readonly _ownKeys = (key: InputKey, e: KeyboardEvent) => { if (key === "F1") e.preventDefault(); };
  private readonly _noChar = () => {};

  constructor(app: DungeonApp) {
    super();
    this._app = app;
    this.HorizontalOptions = "Fill";
    this.VerticalOptions = "Fill";
    this.BackgroundColor = "#000000";
    KeyboardManager.Subscribe(this._ownKeys, this._noChar);
    this.StartLoop();
  }

  override GameLoop(deltaSeconds: number): void {
    // the first tick has no previous frame to measure from
    if (!this._started) {
      this._started = true;
      deltaSeconds = 0.0;
    }
    this._app.Tick(deltaSeconds);
  }

  override OnKeyDown(key: InputKey): void { this._app.KeyDown(key); }

  override OnKeyUp(key: InputKey): void { this._app.KeyUp(key); }

  /** The game takes every press that lands on it, so what is tapped lies over it, not in it. */
  override ProcessGestures(args: SkiaGesturesParameters, _apply: GestureEventProcessingInfo): SkiaControl | null {
    this._app.Gesture(args, this.RenderingScale);
    return this;
  }

  protected override OnDisposing(): void {
    KeyboardManager.Unsubscribe(this._ownKeys, this._noChar);
    super.OnDisposing();
  }
}
