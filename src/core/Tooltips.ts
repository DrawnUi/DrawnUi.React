import type { DrawingContext, SkiaControl } from "./SkiaControl";
import type { Thickness } from "./Types";
import { SKPoint } from "./Gestures";
import { SKRect } from "./Types";
import { KeyboardManager } from "./KeyboardManager";

/** What the tooltip controller reads from a style (the TooltipStyle class in the controls implements it). */
export interface TooltipStyleLike {
  MaxWidth: number;
  ShowDelayMs: number;
  FollowWindowMs: number;
  AtCursor: boolean;
  OffsetX: number;
  OffsetY: number;
  CreateTooltip?: (text: string) => SkiaControl;
  CreateDefault(text: string): SkiaControl;
}

/** The canvas side the controller needs. */
interface TooltipHostCanvas {
  readonly RenderingScale: number;
  Update(): void;
  DisposeObject(o: { Dispose(): void }): void;
  readonly TooltipStyleUsed: TooltipStyleLike;
}

/** Where a control is on the canvas now, in pixels: through caches, scroll offsets and transforms (C# OnScreenRect). */
function OnScreenRect(control: SkiaControl): SKRect {
  const r = control.GetAccessibilityPixelRect();
  return r.Width > 0 || r.Height > 0 ? r : control.DrawingRect;
}

/**
 * The tooltip of one canvas (drawnui-cross 6ar, C# DrawnView.Tooltip): after the mouse rests on the innermost control
 * with tooltip text, its tooltip shows, attached to it; the next one shows at once while one is shown or just closed.
 * It closes on leave, press, wheel, key, content moving under the pointer and window blur, never on touch, and after a
 * press stays closed until the mouse reaches another control. Separate from hover. Drawn last, inside the canvas, with
 * no input and no accessibility node.
 */
export class TooltipController {
  private owner?: SkiaControl;
  private text?: string;
  private suppressed?: SkiaControl;
  private shownText?: string;
  private anchor = SKRect.Empty;
  private pointer = SKPoint.Empty;
  private cursor = SKPoint.Empty;
  private closedAt = 0;
  private timer = 0;
  private keysHooked = false;

  private view?: SkiaControl;
  private viewText?: string;
  private viewRect = SKRect.Empty;
  private viewScale = 0;

  constructor(private readonly canvas: TooltipHostCanvas) {}

  /** The text of the tooltip shown now, undefined when none is shown. */
  get ShownText(): string | undefined { return this.shownText; }

  /**
   * The mouse moved, nothing pressed: `path` is the hover hit path (root first), (x, y) the pointer in canvas pixels.
   * The innermost control with tooltip text wins.
   */
  OnPointerMove(path: readonly SkiaControl[], x: number, y: number): void {
    let owner: SkiaControl | undefined, text: string | undefined;
    for (let i = path.length - 1; i >= 0; i--) {
      const c = path[i];
      if (!c.MayHaveTooltip || c.IsDisposed) continue;
      text = c.GetTooltipText();
      if (text) { owner = c; break; }
    }
    // a press closed it: it stays closed until the mouse leaves that control
    if (this.suppressed) {
      if (owner === this.suppressed) return;
      this.suppressed = undefined;
    }
    if (!owner || !text) {
      this.owner = undefined; this.text = undefined;
      this.Hide();
      return;
    }
    this.pointer = new SKPoint(x, y);
    if (owner === this.owner && text === this.text) return; // still on the same control: the tooltip stays where it opened
    this.owner = owner; this.text = text;
    this.HookKeys(true);
    const style = this.canvas.TooltipStyleUsed;
    this.CancelTimer();
    if (this.shownText !== undefined || (this.closedAt !== 0 && performance.now() - this.closedAt < style.FollowWindowMs)) {
      // moving from one tooltip to the next: no new wait
      this.Show();
      return;
    }
    this.timer = window.setTimeout(() => { this.timer = 0; if (this.owner) this.Show(); }, Math.max(0, style.ShowDelayMs));
  }

  private Show(): void {
    if (!this.owner || !this.text) return;
    this.shownText = this.text;
    this.anchor = OnScreenRect(this.owner);
    this.cursor = this.pointer;
    this.canvas.Update();
  }

  private CancelTimer(): void { if (this.timer) { clearTimeout(this.timer); this.timer = 0; } }

  /** Closes the tooltip and cancels a pending one. */
  private Hide(): void {
    this.CancelTimer();
    if (!this.owner) this.HookKeys(false);
    if (this.shownText === undefined) return;
    this.shownText = undefined;
    this.closedAt = performance.now();
    this.canvas.Update();
  }

  /** Any input that is not a plain mouse move (press, wheel, key, window blur): closed until the mouse reaches another control. */
  CloseOnInput(): void {
    if (!this.owner && this.shownText === undefined) return;
    this.suppressed = this.owner;
    this.owner = undefined; this.text = undefined;
    this.Hide();
    this.HookKeys(false);
  }

  /** The pointer left the canvas, content moves under it or a popup opened: closed, its control forgotten. */
  Reset(): void {
    this.owner = undefined; this.text = undefined; this.suppressed = undefined;
    this.Hide();
    this.HookKeys(false);
  }

  private readonly onKey = () => this.CloseOnInput();
  private readonly onChar = () => {};
  private HookKeys(on: boolean): void {
    if (on === this.keysHooked) return;
    this.keysHooked = on;
    if (on) KeyboardManager.Subscribe(this.onKey, this.onChar);
    else KeyboardManager.Unsubscribe(this.onKey, this.onChar);
  }

  /** Draws the tooltip over everything, inside `bounds` (canvas pixels). */
  Draw(ctx: DrawingContext, bounds: SKRect): void {
    const text = this.shownText;
    if (text === undefined) {
      if (this.view) { this.canvas.DisposeObject(this.view); this.view = undefined; this.viewText = undefined; }
      return;
    }
    const scale = ctx.Scale;
    if (!this.view || this.viewText !== text || this.viewScale !== scale) {
      if (this.view) this.canvas.DisposeObject(this.view);
      const style = this.canvas.TooltipStyleUsed;
      const view = style.CreateTooltip?.(text) ?? style.CreateDefault(text);
      view._superview = this.canvas as unknown as SkiaControl["_superview"];
      view.Parent = undefined;
      view.InputTransparent = true;
      this.view = view; this.viewText = text; this.viewScale = scale;
      // a finite width lets long text wrap: MaxWidth, never wider than the canvas
      const margin: Thickness = view.Margin;
      const maxWidth = Math.min(bounds.Width, (style.MaxWidth + margin.HorizontalThickness) * scale);
      const measured = view.Measure(maxWidth, Infinity, scale).Pixels;
      const width = measured.Width, height = measured.Height;
      // attached to its control (centered above it, below where there is no room) or at the cursor (below right of the
      // pointer, above where there is no room); the offsets shift it, the vertical one mirrored on the flipped side
      const boxWidth = width - margin.HorizontalThickness * scale, boxHeight = height - margin.VerticalThickness * scale;
      const gap = 6 * scale, offsetX = style.OffsetX * scale, offsetY = style.OffsetY * scale;
      const anchor = this.anchor, cursor = this.cursor;
      let boxLeft: number, boxTop: number, flippedTop: number;
      if (style.AtCursor) {
        boxLeft = cursor.X + 4 * scale + offsetX;
        boxTop = cursor.Y + 20 * scale + offsetY; // clear of the pointer's arrow
        flippedTop = cursor.Y - gap - boxHeight - offsetY;
      } else {
        boxLeft = (anchor.Left + anchor.Right) / 2 - boxWidth / 2 + offsetX;
        boxTop = anchor.Top - gap - boxHeight + offsetY;
        flippedTop = anchor.Bottom + gap - offsetY;
      }
      if (style.AtCursor ? boxTop + boxHeight > bounds.Bottom : boxTop < bounds.Top) boxTop = flippedTop;
      boxLeft = Math.max(bounds.Left, Math.min(boxLeft, bounds.Right - boxWidth));
      boxTop = Math.max(bounds.Top, Math.min(boxTop, bounds.Bottom - boxHeight));
      const left = boxLeft - margin.Left * scale, top = boxTop - margin.Top * scale;
      this.viewRect = new SKRect(left, top, left + width, top + height);
      view.Arrange(this.viewRect, view.WidthRequest, view.HeightRequest, scale);
    }
    this.view.Render({ Context: ctx.Context, Destination: this.viewRect, Scale: scale });
  }

  Dispose(): void {
    this.CancelTimer();
    this.HookKeys(false);
    if (this.view) { this.view.Dispose(); this.view = undefined; }
  }
}
