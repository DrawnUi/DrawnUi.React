import { ActionOnTickAnimator } from "../core/Animators";
import { type InputKey, KeyboardManager } from "../core/KeyboardManager";
import { SkiaLayout } from "./SkiaLayout";

/**
 * Mirrors DrawnUi.Gaming DrawnGame (SharedGame/DrawnGame.cs + Game.Input.cs): a layout that runs a game loop.
 * `StartLoop()` / `StopLoop()`, override `GameLoop(deltaSeconds)` for the game and `OnKeyDown` / `OnKeyUp` for keys
 * (DOM `event.code` names, e.g. "ArrowLeft", "Space"). The loop is an `ActionOnTickAnimator`, ticked once per drawn
 * frame; started before the game is attached it waits for the first layout, like C#.
 * Not ported: `FrameTimeInterpolator` (C# disables it on BROWSER too, the raw frame delta is used).
 */
export class DrawnGame extends SkiaLayout {
  private appLoop?: ActionOnTickAnimator;
  protected LastFrameTimeNanos = 0;
  private isPaused = false;

  private readonly onKeyDown = (key: InputKey) => this.OnKeyDown(key);
  private readonly onKeyChar = () => {};
  private readonly onKeyUp = (key: InputKey) => this.OnKeyUp(key);

  constructor() {
    super();
    KeyboardManager.Subscribe(this.onKeyDown, this.onKeyChar, this.onKeyUp);
  }

  protected override OnDisposing(): void {
    KeyboardManager.Unsubscribe(this.onKeyDown, this.onKeyChar, this.onKeyUp);
    this.appLoop?.Dispose();
    this.appLoop = undefined;
    super.OnDisposing();
  }

  protected OnResumed(): void {}
  protected OnPaused(): void {}

  /** Override this for your game. `deltaSeconds` is the time elapsed between the previous frame and this one. */
  GameLoop(_deltaSeconds: number): void {}

  /** Stops the game loop. */
  StopLoop(): void { this.appLoop?.Stop(); }

  /** Starts the game loop. */
  StartLoop(delayMs = 0): void {
    this.appLoop ??= new ActionOnTickAnimator(this, (t) => this.GameTick(t));
    this.appLoop.Start(delayMs);
  }

  /** Internal, override `GameLoop` for your game. Frame time is in nanoseconds. */
  protected GameTick(frameTimeNanos: number): void {
    const deltaSeconds = (frameTimeNanos - this.LastFrameTimeNanos) / 1_000_000_000;
    this.LastFrameTimeNanos = frameTimeNanos;
    this.GameLoop(deltaSeconds);
  }

  get IsPaused(): boolean { return this.isPaused; }
  set IsPaused(value: boolean) { this.isPaused = value; }

  Pause(): void {
    this.IsPaused = true;
    this.OnPaused();
  }

  Resume(): void {
    this.LastFrameTimeNanos = Math.round(performance.now() * 1_000_000);
    this.IsPaused = false;
    this.OnResumed();
  }

  /** Override this to process game keys. */
  OnKeyDown(_key: InputKey): void {}

  /** Override this to process game keys. */
  OnKeyUp(_key: InputKey): void {}
}
