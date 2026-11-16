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
    // fixed 1x1 box over the caret: invisible, still focusable, 16px font keeps iOS from zooming the page
    el.style.cssText = "position:fixed;left:0;top:0;width:1px;height:1px;padding:0;border:0;margin:0;opacity:0.01;font-size:16px;line-height:1;resize:none;overflow:hidden;outline:none;background:transparent;color:transparent;caret-color:transparent;pointer-events:none;z-index:-1;";
    el.addEventListener("compositionstart", () => { TextInputProxy.composing = true; });
    el.addEventListener("compositionend", () => { TextInputProxy.composing = false; TextInputProxy.ApplyFromElement(); });
    el.addEventListener("input", () => TextInputProxy.ApplyFromElement());
    el.addEventListener("blur", () => {
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
    TextInputProxy.Configure(editor, el);
    TextInputProxy.Sync(editor);
    TextInputProxy.WatchKeyboard();
    // the keyboard may be open already (a move from one field to another): the new field goes above it too
    setTimeout(() => TextInputProxy.EnsureAboveKeyboard(), 50);
    // a touch press: the input takes focus in its touchend (FocusFromTap), the only place iOS opens the keyboard from; a
    // focus taken earlier would leave it focused with no keyboard
    if (editor.Superview?.TouchPressed) return;
    el.focus({ preventScroll: true });
    TextInputProxy.focusedNow = true;
    queueMicrotask(() => { TextInputProxy.focusedNow = false; });
  }

  private static watchedViewport?: VisualViewport;
  /** Follows the visual viewport (it shrinks when a phone's soft keyboard opens, drawnui-cross 6cj). */
  private static WatchKeyboard(): void {
    const vv = typeof window !== "undefined" ? window.visualViewport ?? undefined : undefined;
    if (!vv || vv === TextInputProxy.watchedViewport) return;
    TextInputProxy.watchedViewport?.removeEventListener("resize", TextInputProxy.onViewport);
    TextInputProxy.watchedViewport = vv;
    vv.addEventListener("resize", TextInputProxy.onViewport);
  }
  private static readonly onViewport = () => TextInputProxy.EnsureAboveKeyboard();

  /**
   * The focused field stays in the part of the page the soft keyboard leaves visible (the visual viewport): when the
   * keyboard opens over it, the drawn scrolls around it move it up, 16 px clear of the keyboard (never past its own top).
   */
  static EnsureAboveKeyboard(): void {
    const owner = TextInputProxy.owner, vv = typeof window !== "undefined" ? window.visualViewport : undefined;
    if (!owner || !owner.IsFocused || !vv) return;
    const canvas = owner.Superview?.Element;
    if (!canvas) return;
    const b = canvas.getBoundingClientRect(), k = owner.RenderingScale || 1, r = owner.GetAccessibilityPixelRect();
    const top = b.top + r.Top / k, bottom = b.top + r.Bottom / k;
    const margin = 16, visibleTop = vv.offsetTop, visibleBottom = vv.offsetTop + vv.height;
    let dy = bottom + margin - visibleBottom; // CSS px = points the content moves up
    dy = Math.min(dy, top - visibleTop - margin);
    if (dy <= 0.5) return;
    for (let p = owner.Parent; p && dy > 0.5; p = p.Parent) {
      const scroll = p as unknown as { ScrollTo?(x: number, y: number, secs: number): void; ViewportOffsetX: number; ViewportOffsetY: number; ContentOffsetBounds?: { Top: number } };
      if (typeof scroll.ScrollTo !== "function" || scroll.ViewportOffsetY === undefined) continue;
      const target = Math.max(scroll.ContentOffsetBounds?.Top ?? -Infinity, scroll.ViewportOffsetY - dy);
      const moved = scroll.ViewportOffsetY - target;
      if (moved > 0) { scroll.ScrollTo(scroll.ViewportOffsetX, target, 0.25); dy -= moved; }
    }
  }

  /** The input got DOM focus in the task running now (Attach): a tap that focused the field needs nothing more. */
  private static focusedNow = false;

  /**
   * The canvas calls it at the end of a tap's release (the pointerup, the user gesture iOS requires to open the soft
   * keyboard): a tap on the focused field gives its input DOM focus inside that gesture, so the keyboard opens on the first
   * tap and comes back on a tap after the user closed it. A touch anywhere else leaves it as it is: the keyboard the user
   * closed stays closed while the page is scrolled. True when the tap was on the focused field (its input has focus now).
   */
  static FocusFromTap(clientX: number, clientY: number): boolean {
    const owner = TextInputProxy.owner, el = TextInputProxy.element;
    if (!owner || !el || !owner.IsFocused) return false;
    const canvas = owner.Superview?.Element;
    if (!canvas) return false;
    const b = canvas.getBoundingClientRect(), k = owner.RenderingScale || 1, r = owner.GetAccessibilityPixelRect();
    const x = (clientX - b.left) * k, y = (clientY - b.top) * k;
    if (x < r.Left || x > r.Right || y < r.Top || y > r.Bottom) return false;
    if (!TextInputProxy.focusedNow) {
      // focus() on the input that has focus already does not open the keyboard: take it off and back on, inside the tap
      if (document.activeElement === el) el.blur();
      el.focus({ preventScroll: true });
      TextInputProxy.Sync(owner);
    }
    return true;
  }

  static Detach(editor: SkiaEditor): void {
    if (TextInputProxy.owner !== editor) return;
    TextInputProxy.owner = undefined;
    const el = TextInputProxy.element;
    if (el && document.activeElement === el) el.blur();
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

  /** Puts the textarea over the editor so mobile browsers scroll the right spot into view. */
  private static Place(editor: SkiaEditor, el: HTMLTextAreaElement): void {
    const canvas = editor.Superview?.Element;
    if (!canvas) return;
    const b = canvas.getBoundingClientRect();
    const scale = editor.RenderingScale || 1;
    const r = editor.DrawingRect;
    el.style.left = `${Math.round(b.left + r.Left / scale)}px`;
    el.style.top = `${Math.round(b.top + r.Top / scale)}px`;
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
      } else if (inserted) editor.StubTypeText(inserted);
      else editor.StubBackspace();
    } finally { TextInputProxy.applying = false; }
    TextInputProxy.Sync(editor);
  }
}
