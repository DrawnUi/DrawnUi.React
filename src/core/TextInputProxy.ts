import type { SkiaEditor } from "../controls/SkiaEditor";

/**
 * Hidden DOM textarea standing in for the focused SkiaEditor so IME composition, mobile soft keyboards,
 * autocorrect, native copy / cut / paste and undo reach the drawn editor. Not part of DrawnUi.Blazor (which has no
 * DOM input): the textarea mirrors the editor's text + selection, and every `input` event is diffed against the
 * editor and applied through the same stub methods the physical keyboard uses (`StubSelectRange` + `StubTypeText`
 * / `StubBackspace`, a line break through `StubPressEnter`). Keys that the textarea turns into input events
 * (characters, Backspace, Delete, Enter, clipboard shortcuts) are skipped by the KeyboardManager path while the
 * proxy is active; navigation keys keep going through `KeyDown`.
 */
export class TextInputProxy {
  private static element?: HTMLTextAreaElement;
  private static owner?: SkiaEditor;
  private static composing = false;
  /** The field took focus from a touch tap: its keys come from the soft keyboard (the return key ends editing). */
  private static byTouch = false;
  /** Set by the canvas while it runs a touch release's gestures (a field focused by them was focused by a touch). */
  static TouchGesture = false;
  private static applying = false;

  /** The textarea (created on first use); KeyboardManager recognizes it through `data-drawnui-text-input`. */
  static get Element(): HTMLTextAreaElement | undefined { return TextInputProxy.element; }
  static IsActive(editor: SkiaEditor): boolean { return TextInputProxy.owner === editor; }
  static IsProxyTarget(target: EventTarget | null): boolean { return !!target && target === TextInputProxy.element; }

  private static Create(): HTMLTextAreaElement | undefined {
    if (typeof document === "undefined") return undefined;
    const el = document.createElement("textarea");
    el.dataset.drawnuiTextInput = "1";
    el.setAttribute("aria-hidden", "true");
    el.tabIndex = -1;
    el.autocomplete = "off";
    el.setAttribute("autocorrect", "off");
    el.setAttribute("autocapitalize", "off");
    el.rows = 1;
    // a fixed 1x1 box (where it sits: Place): invisible, still focusable, the 16px font keeps iOS from zooming the page
    el.style.cssText = "position:fixed;left:0;top:0;width:1px;height:1px;padding:0;border:0;margin:0;opacity:0.01;font-size:16px;line-height:1;resize:none;overflow:hidden;outline:none;background:transparent;color:transparent;caret-color:transparent;pointer-events:none;z-index:-1;";
    el.addEventListener("compositionstart", () => { TextInputProxy.composing = true; });
    el.addEventListener("compositionend", () => { TextInputProxy.composing = false; TextInputProxy.ApplyFromElement(); });
    el.addEventListener("input", () => TextInputProxy.ApplyFromElement());
    el.addEventListener("blur", () => {
      TextInputProxy.keyboardUp = false;
      // focus moved to another DOM text field (a page input): the drawn editor loses focus like C# BlurExternalTextInput
      queueMicrotask(() => {
        const a = document.activeElement as HTMLElement | null;
        const owner = TextInputProxy.owner;
        if (owner && a && a !== el && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.isContentEditable)) owner.IsFocused = false;
      });
    });
    document.body.appendChild(el);
    return el;
  }

  /** The editor took focus: the textarea mirrors it and gets DOM focus (soft keyboard, IME). */
  static Attach(editor: SkiaEditor): void {
    const el = TextInputProxy.element ?? (TextInputProxy.element = TextInputProxy.Create());
    if (!el) return;
    TextInputProxy.owner = editor;
    TextInputProxy.composing = false;
    TextInputProxy.byTouch = TextInputProxy.TouchGesture || !!editor.Superview?.TouchPressed;
    TextInputProxy.Configure(editor, el);
    TextInputProxy.Sync(editor);
    // a touch press: the input takes focus in its touchend (FocusFromTap), the only place iOS opens the keyboard from; a
    // focus taken earlier would leave it focused with no keyboard
    if (editor.Superview?.TouchPressed) return;
    el.focus({ preventScroll: true });
    TextInputProxy.focusedNow = true;
    queueMicrotask(() => { TextInputProxy.focusedNow = false; });
  }

  /** The input got DOM focus in the task running now (Attach): a tap that focused the field needs nothing more. */
  private static focusedNow = false;

  /**
   * The canvas calls it at the end of a tap's release (the pointerup, the user gesture iOS requires to open the soft
   * keyboard): a tap on the focused field gives its input DOM focus inside that gesture, so the keyboard opens on the first
   * tap and comes back on a tap after the user closed it. A touch anywhere else leaves it as it is: the keyboard the user
   * closed stays closed while the page is scrolled. True when the tap was on the focused field (its input has focus now).
   */
  static FocusFromTap(clientX: number, clientY: number, touch = false): boolean {
    const owner = TextInputProxy.owner, el = TextInputProxy.element;
    if (!owner || !el || !owner.IsFocused) return false;
    const canvas = owner.Superview?.Element;
    if (!canvas) return false;
    const b = canvas.getBoundingClientRect(), k = owner.RenderingScale || 1, r = owner.GetAccessibilityPixelRect();
    const x = (clientX - b.left) * k, y = (clientY - b.top) * k;
    if (x < r.Left || x > r.Right || y < r.Top || y > r.Bottom) return false;
    TextInputProxy.byTouch = touch;
    if (!TextInputProxy.focusedNow && !(touch && TextInputProxy.keyboardUp && document.activeElement === el)) {
      // focus() on the input that has focus already does not open the keyboard: take it off and back on, inside the tap
      if (document.activeElement === el) el.blur();
      el.focus({ preventScroll: true });
    }
    if (touch) TextInputProxy.keyboardUp = true;
    TextInputProxy.Sync(owner);
    return true;
  }

  static Detach(editor: SkiaEditor): void {
    if (TextInputProxy.owner !== editor) return;
    TextInputProxy.owner = undefined;
    const el = TextInputProxy.element;
    if (!el || document.activeElement !== el) return;
    // a touch press may be moving to another field: the input keeps focus (the keyboard stays up, no hide and show) until
    // the touch ends (AfterTouchEnd); with no field then, it lets go
    if (TextInputProxy.TouchGesture || editor.Superview?.TouchPressed) { TextInputProxy.blurAfterTouch = true; return; }
    el.blur();
  }
  private static blurAfterTouch = false;
  /** The input has focus from a touch release (its keyboard is up): a tap on another field needs no blur and focus. */
  private static keyboardUp = false;

  /** The canvas calls it at the end of each touch release, after FocusFromTap: a field left during the press lets go now. */
  static AfterTouchEnd(): void {
    if (!TextInputProxy.blurAfterTouch) return;
    TextInputProxy.blurAfterTouch = false;
    const el = TextInputProxy.element;
    if (!TextInputProxy.owner && el && document.activeElement === el) el.blur();
  }

  private static Configure(editor: SkiaEditor, el: HTMLTextAreaElement): void {
    const modes: Record<string, string> = { Default: "text", Numeric: "numeric", Decimal: "decimal", Phone: "tel", Email: "email" };
    el.inputMode = modes[editor.KeyboardType] ?? "text";
    const hints: Record<string, string> = { Done: "done", Go: "go", Next: "next", Search: "search", Send: "send" };
    el.enterKeyHint = hints[editor.ReturnType] ?? (editor.IsMultiline ? "enter" : "done");
    el.spellcheck = editor.IsSpellCheckEnabled;
  }

  /** Editor text / selection changed: mirror it (never while an IME composition is in flight). */
  static Sync(editor: SkiaEditor): void {
    const el = TextInputProxy.element;
    if (!el || TextInputProxy.owner !== editor || TextInputProxy.composing || TextInputProxy.applying) return;
    if (el.value !== editor.Text) el.value = editor.Text;
    const start = editor.CursorPosition, end = start + editor.SelectionLength;
    if (el.selectionStart !== start || el.selectionEnd !== end) el.setSelectionRange(start, end);
    TextInputProxy.Place(editor, el);
  }

  /**
   * Where the hidden input sits: a field focused by a touch keeps it fixed at the top-left corner, never over the field (as
   * the DrawnUi.Net web heads), so iOS never pans the page to reveal it (a scroll with AdaptToKeyboardAuto moves the
   * field above the keyboard); a field focused by a mouse or the keyboard has it over the field, so a desktop input
   * method opens its candidate window next to the text.
   */
  private static Place(editor: SkiaEditor, el: HTMLTextAreaElement): void {
    let left = 0, top = 0;
    const canvas = editor.Superview?.Element;
    if (!TextInputProxy.byTouch && canvas) {
      const b = canvas.getBoundingClientRect(), scale = editor.RenderingScale || 1, r = editor.GetAccessibilityPixelRect();
      left = Math.round(b.left + r.Left / scale); top = Math.round(b.top + r.Top / scale);
    }
    if (left === TextInputProxy.placedLeft && top === TextInputProxy.placedTop) return;
    TextInputProxy.placedLeft = left; TextInputProxy.placedTop = top;
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }
  private static placedLeft = 0;
  private static placedTop = 0;

  /**
   * After each frame of the canvas: a focused field that moved (its page scrolled) takes its hidden input along, so a
   * desktop input method keeps its window next to the text. Nothing to do while no field is focused.
   */
  static AfterFrame(canvas: unknown): void {
    const owner = TextInputProxy.owner, el = TextInputProxy.element;
    if (!owner || !el || TextInputProxy.byTouch || owner.Superview !== canvas) return;
    TextInputProxy.Place(owner, el);
  }

  /** The textarea changed (typing, IME commit, paste, undo): diff against the editor and replay through the stubs. */
  private static ApplyFromElement(): void {
    const el = TextInputProxy.element, editor = TextInputProxy.owner;
    if (!el || !editor || TextInputProxy.composing) return;
    const next = el.value, prev = editor.Text;
    if (next === prev) { TextInputProxy.Sync(editor); return; }
    let start = 0;
    const max = Math.min(prev.length, next.length);
    while (start < max && prev.charCodeAt(start) === next.charCodeAt(start)) start++;
    let endPrev = prev.length, endNext = next.length;
    while (endPrev > start && endNext > start && prev.charCodeAt(endPrev - 1) === next.charCodeAt(endNext - 1)) { endPrev--; endNext--; }
    const inserted = next.slice(start, endNext);
    TextInputProxy.applying = true;
    try {
      editor.StubSelectRange(start, endPrev - start);
      if (inserted.includes("\n") && (!editor.IsMultiline || editor.ShouldSubmitOnEnter)) {
        // Enter on a single-line editor (or a Send editor): submit instead of inserting the break
        const text = inserted.replace(/\n/g, "");
        if (text) editor.StubTypeText(text); else if (endPrev > start) editor.StubBackspace();
        editor.StubPressEnter(false, false);
        // the soft keyboard's return key (done / go / search / send) in a single-line field ends editing and closes the
        // keyboard, as a MAUI single-line field; a physical keyboard's Enter keeps the field focused (the Blazor rule)
        if (TextInputProxy.byTouch && !editor.IsMultiline && ["done", "go", "search", "send"].includes(el.enterKeyHint)) editor.IsFocused = false;
      } else if (inserted) editor.StubTypeText(inserted);
      else editor.StubBackspace();
    } finally { TextInputProxy.applying = false; }
    TextInputProxy.Sync(editor);
  }
}
