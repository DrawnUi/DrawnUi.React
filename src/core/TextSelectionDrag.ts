// Mouse text selection like a web page (drawnui-cross 6cc) for the selectable text of the accessibility overlay
// (AccessibilityTextSelectable labels are real DOM text there). The browser selects when the press is on that text; this
// covers the presses on the canvas itself: a main-button mouse press that no control takes (empty space, padding, a label
// that is not selectable, or a scroll whose content holds selectable text) and then a drag selects from the edge of the
// text where the drag came in to the text under the mouse, across labels in reading order; held past the edge of the
// scroll it is in, the scroll moves on. Copy joins the selected labels with new lines. Touch and pen are left alone.

/** A place in the overlay's text: a text node and an offset in it. */
interface TextPlace { Node: Node; Offset: number }

/** What the drag needs from the canvas (kept apart so the canvas stays the only owner of its input). */
export interface TextSelectionHost {
  /** The overlay element holding the selectable text, set by the React overlay. */
  readonly OverlayElement?: HTMLElement;
  /** Whether a press with this owner (the control that took the press, or none) may select text instead. */
  MaySelectFrom(owner: unknown): boolean;
  /** The scroll the press is in when its content holds selectable text: moved while the drag is held past its edge. */
  TextScrollAt(clientX: number, clientY: number): { Rect: DOMRect; ScrollBy(dy: number): void } | undefined;
}

const LINES = ".drawnui-a11y-text > span";
const START_DISTANCE = 4; // CSS px the mouse moves before the press becomes a selection drag

export class TextSelectionDrag {
  private press?: { Id: number; X: number; Y: number; Selecting: boolean; Native?: boolean; Anchor?: TextPlace; Scroll?: ReturnType<TextSelectionHost["TextScrollAt"]> };
  private detach?: () => void;
  private lastX = 0;
  private lastY = 0;
  private frame = 0;

  constructor(private readonly host: TextSelectionHost) {}

  /** Some selectable text is on the overlay now. */
  private get HasText(): boolean { return !!this.host.OverlayElement?.querySelector(LINES); }

  /** A pointer pressed on the canvas: a mouse main-button press is a candidate. */
  Down(e: PointerEvent): void {
    this.Stop();
    if (e.pointerType !== "mouse" || e.button !== 0 || !this.HasText) return;
    this.press = { Id: e.pointerId, X: e.clientX, Y: e.clientY, Selecting: false };
  }

  /** True while this pointer's drag from the canvas selects text: the canvas does not pass its moves on (a drag the browser started on the text is followed apart). */
  IsSelecting(pointerId: number): boolean { return !!this.press?.Selecting && !this.press.Native && this.press.Id === pointerId; }

  /**
   * A move of the pressed pointer. True when the drag selects from now on: the canvas then ends the gesture it started
   * (owner: the control that took the press, read by the canvas after its Down).
   */
  Move(e: PointerEvent, owner: () => unknown): boolean {
    const p = this.press;
    if (!p || p.Native || p.Id !== e.pointerId) return false;
    this.lastX = e.clientX; this.lastY = e.clientY;
    if (!p.Selecting) {
      if (Math.hypot(e.clientX - p.X, e.clientY - p.Y) < START_DISTANCE) return false;
      if (!this.host.MaySelectFrom(owner())) { this.press = undefined; return false; }
      p.Selecting = true;
      p.Scroll = this.host.TextScrollAt(p.X, p.Y);
      getSelection()?.removeAllRanges();
      this.Extend();
      this.AutoScroll();
      return true;
    }
    this.Extend();
    return true;
  }

  /** The pointer let go: true when it was selecting (its release is not passed on). */
  Up(e: PointerEvent): boolean {
    const was = this.IsSelecting(e.pointerId);
    if (was) this.Stop();
    return was;
  }

  /**
   * A mouse press on the overlay's selectable text: the browser selects; while the drag is held past the edge of the
   * scroll the text is in, the scroll moves on and the selection follows the mouse. (The selection is never set while the
   * browser's own drag runs over the text: changing it then stops the drag's events in Chromium.)
   */
  FollowNative(e: PointerEvent): void {
    this.Stop();
    if (e.pointerType !== "mouse" || e.button !== 0) return;
    const scroll = this.host.TextScrollAt(e.clientX, e.clientY);
    if (!scroll) return;
    this.press = { Id: e.pointerId, X: e.clientX, Y: e.clientY, Selecting: true, Native: true, Scroll: scroll };
    this.lastX = e.clientX; this.lastY = e.clientY;
    const move = (m: PointerEvent) => { if (m.pointerId === e.pointerId) { this.lastX = m.clientX; this.lastY = m.clientY; } };
    const up = (u: PointerEvent) => { if (u.pointerId === e.pointerId) this.Stop(); };
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", up, true);
    this.detach = () => { window.removeEventListener("pointermove", move, true); window.removeEventListener("pointerup", up, true); };
    this.AutoScroll();
  }

  Stop(): void {
    this.detach?.(); this.detach = undefined;
    this.press = undefined;
    if (this.frame) { cancelAnimationFrame(this.frame); this.frame = 0; }
  }

  /** The selection from the anchor (set where the drag first reaches text) to the place under the mouse. */
  private Extend(): void {
    const p = this.press;
    if (!p) return;
    const lines = this.Lines();
    if (lines.length === 0) return;
    const forward = this.lastY > p.Y || (Math.abs(this.lastY - p.Y) < 2 && this.lastX >= p.X);
    // a drag the browser started keeps the browser's anchor
    if (!p.Anchor && p.Native) { const s = getSelection(); if (s?.anchorNode) p.Anchor = { Node: s.anchorNode, Offset: s.anchorOffset }; }
    p.Anchor ??= this.EdgeFrom(lines, p.X, p.Y, forward);
    const extent = this.PlaceAt(lines, this.lastX, this.lastY, forward);
    if (!p.Anchor || !extent) return;
    getSelection()?.setBaseAndExtent(p.Anchor.Node, p.Anchor.Offset, extent.Node, extent.Offset);
  }

  /** The selectable lines in reading order (the overlay's order) with their rects. */
  private Lines(): { El: HTMLElement; Text: Node; R: DOMRect }[] {
    const out: { El: HTMLElement; Text: Node; R: DOMRect }[] = [];
    this.host.OverlayElement?.querySelectorAll<HTMLElement>(LINES).forEach((el) => {
      const text = el.firstChild;
      if (text && text.nodeType === Node.TEXT_NODE) out.push({ El: el, Text: text, R: el.getBoundingClientRect() });
    });
    return out;
  }

  /** A line comes after a point in reading order: below it, or on its row and to its right. */
  private static After(r: DOMRect, x: number, y: number): boolean {
    return r.top > y || (r.bottom >= y && r.left >= x);
  }

  /**
   * Where a drag that started off the text enters it: the start of the first line after the press when it goes forward,
   * else the end of the last line before it.
   */
  private EdgeFrom(lines: { Text: Node; R: DOMRect }[], x: number, y: number, forward: boolean): TextPlace | undefined {
    const on = this.CaretOn(lines, x, y);
    if (on) return on;
    if (forward) { const l = lines.find((l) => TextSelectionDrag.After(l.R, x, y)); return l ? { Node: l.Text, Offset: 0 } : this.End(lines[lines.length - 1]); }
    const before = lines.filter((l) => !TextSelectionDrag.After(l.R, x, y));
    return before.length ? this.End(before[before.length - 1]) : { Node: lines[0].Text, Offset: 0 };
  }

  /** The place under the mouse: the caret on the text, else the line edge the mouse is past. */
  private PlaceAt(lines: { Text: Node; R: DOMRect }[], x: number, y: number, forward: boolean): TextPlace | undefined {
    const on = this.CaretOn(lines, x, y);
    if (on) return on;
    // on a line's row, outside its text: its start or end
    const row = lines.find((l) => y >= l.R.top && y <= l.R.bottom && (x < l.R.left ? true : x > l.R.right));
    if (row) return x < row.R.left ? { Node: row.Text, Offset: 0 } : this.End(row);
    const before = lines.filter((l) => !TextSelectionDrag.After(l.R, x, y));
    if (forward) return before.length ? this.End(before[before.length - 1]) : { Node: lines[0].Text, Offset: 0 };
    const after = lines.find((l) => TextSelectionDrag.After(l.R, x, y));
    return after ? { Node: after.Text, Offset: 0 } : this.End(lines[lines.length - 1]);
  }

  private End(l: { Text: Node }): TextPlace {
    // a line's text ends with the line break between lines of one label: the place before it
    const text = l.Text.textContent ?? "";
    return { Node: l.Text, Offset: text.endsWith("\n") ? text.length - 1 : text.length };
  }

  /** The caret at a point that is on one of the lines. */
  private CaretOn(lines: { Text: Node; R: DOMRect }[], x: number, y: number): TextPlace | undefined {
    const line = lines.find((l) => x >= l.R.left && x <= l.R.right && y >= l.R.top && y <= l.R.bottom);
    if (!line) return undefined;
    const d = document as Document & { caretPositionFromPoint?(x: number, y: number): { offsetNode: Node; offset: number } | null };
    const at = d.caretPositionFromPoint?.(x, y) ?? (() => { const r = document.caretRangeFromPoint?.(x, y); return r ? { offsetNode: r.startContainer, offset: r.startOffset } : null; })();
    if (at && at.offsetNode === line.Text) return { Node: at.offsetNode, Offset: at.offset };
    // the point is on the line but the hit test found another element on top: by proportion along the line
    const len = this.End(line).Offset;
    return { Node: line.Text, Offset: Math.round(len * Math.min(1, Math.max(0, (x - line.R.left) / Math.max(1, line.R.width)))) };
  }

  /** While the drag is held past the scroll's top or bottom edge the scroll moves on, faster the farther out. */
  private AutoScroll(): void {
    const step = () => {
      this.frame = 0;
      const p = this.press;
      if (!p?.Selecting || !p.Scroll) return;
      const r = p.Scroll.Rect, y = this.lastY;
      const out = y > r.bottom ? y - r.bottom : y < r.top ? y - r.top : 0;
      if (out !== 0) { p.Scroll.ScrollBy(-Math.sign(out) * Math.min(40, 4 + Math.abs(out) / 4)); this.Extend(); }
      this.frame = requestAnimationFrame(step);
    };
    this.frame = requestAnimationFrame(step);
  }
}

/**
 * Copy of a selection in the overlay's selectable text: each label's selected part, joined with new lines in reading
 * order (the browser would run them together). True when it set the clipboard.
 */
export function CopyOverlaySelection(e: ClipboardEvent, overlay: HTMLElement | undefined): boolean {
  if (!e.clipboardData) return false;
  const parts = OverlaySelectionParts(overlay);
  if (parts.length < 2) return false; // one label: the browser's own copy is right
  e.clipboardData.setData("text/plain", parts.join("\n"));
  e.preventDefault();
  return true;
}

/** The overlay's selected text: each label's selected part in reading order (empty when nothing there is selected). */
export function OverlaySelectionParts(overlay: HTMLElement | undefined): string[] {
  const sel = typeof getSelection === "function" ? getSelection() : null;
  if (!overlay || !sel || sel.isCollapsed || sel.rangeCount === 0) return [];
  const range = sel.getRangeAt(0);
  if (!overlay.contains(range.commonAncestorContainer) && !overlay.contains(range.startContainer)) return [];
  const parts: string[] = [];
  overlay.querySelectorAll<HTMLElement>(".drawnui-a11y-text").forEach((label) => {
    if (!range.intersectsNode(label)) return;
    const r = document.createRange();
    r.selectNodeContents(label);
    if (label.contains(range.startContainer)) r.setStart(range.startContainer, range.startOffset);
    if (label.contains(range.endContainer)) r.setEnd(range.endContainer, range.endOffset);
    const text = r.toString();
    if (text) parts.push(text);
  });
  return parts;
}
