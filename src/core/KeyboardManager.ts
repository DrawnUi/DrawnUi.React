/**
 * Mirrors DrawnUi KeyboardManager (Blazor / Wasm heads, drawnui-keyboard.js): window-level keydown / keyup
 * capture listeners feeding `KeyDown` / `KeyUp` (the DOM `event.code`, e.g. "KeyA", "Backspace", "ArrowLeft")
 * and `KeyChar` (a printable character, no Ctrl / Alt / Meta), plus the modifier state. A drawn editor
 * subscribes while focused. Characters typed into the hidden TextInputProxy textarea (IME, soft keyboard) arrive
 * as input events there, so its key events are not forwarded as KeyChar here (a React-port addition over
 * DrawnUi.Blazor, which has no DOM text input).
 */
export type InputKey = string;

export class KeyboardManager {
  private static attached = false;
  private static readonly pressed = new Set<InputKey>();
  private static readonly keyDown = new Set<(key: InputKey, e: KeyboardEvent) => void>();
  private static readonly keyUp = new Set<(key: InputKey, e: KeyboardEvent) => void>();
  private static readonly keyChar = new Set<(ch: string, e: KeyboardEvent) => void>();

  static get IsShiftPressed(): boolean { return KeyboardManager.pressed.has("ShiftLeft") || KeyboardManager.pressed.has("ShiftRight"); }
  static get IsControlPressed(): boolean { return KeyboardManager.pressed.has("ControlLeft") || KeyboardManager.pressed.has("ControlRight") || KeyboardManager.pressed.has("MetaLeft") || KeyboardManager.pressed.has("MetaRight"); }
  static get IsAltPressed(): boolean { return KeyboardManager.pressed.has("AltLeft") || KeyboardManager.pressed.has("AltRight"); }

  /** C# AttachToKeyboardAsync / JS attachGlobalKeyboard: idempotent. */
  static AttachToKeyboard(): void {
    if (KeyboardManager.attached || typeof window === "undefined") return;
    KeyboardManager.attached = true;
    // inside a cross-frame iframe the embedding page keeps DOM focus: a pointerdown pulls it to this window
    window.addEventListener("pointerdown", () => window.focus(), true);
    window.addEventListener("keydown", (e) => {
      const code = e.code || "";
      KeyboardManager.pressed.add(code);
      for (const h of [...KeyboardManager.keyDown]) h(code, e);
      const proxied = (e.target as HTMLElement | null)?.dataset?.drawnuiTextInput === "1"; // TextInputProxy: characters come through its input events
      if (!proxied && e.key && e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) for (const h of [...KeyboardManager.keyChar]) h(e.key, e);
    }, true);
    window.addEventListener("keyup", (e) => {
      const code = e.code || "";
      KeyboardManager.pressed.delete(code);
      for (const h of [...KeyboardManager.keyUp]) h(code, e);
    }, true);
    window.addEventListener("blur", () => KeyboardManager.pressed.clear());
  }

  static Subscribe(down: (key: InputKey, e: KeyboardEvent) => void, char: (ch: string, e: KeyboardEvent) => void, up?: (key: InputKey, e: KeyboardEvent) => void): void {
    KeyboardManager.AttachToKeyboard();
    KeyboardManager.keyDown.add(down); KeyboardManager.keyChar.add(char); if (up) KeyboardManager.keyUp.add(up);
  }
  static Unsubscribe(down: (key: InputKey, e: KeyboardEvent) => void, char: (ch: string, e: KeyboardEvent) => void, up?: (key: InputKey, e: KeyboardEvent) => void): void {
    KeyboardManager.keyDown.delete(down); KeyboardManager.keyChar.delete(char); if (up) KeyboardManager.keyUp.delete(up);
  }

  /**
   * Hooks observe keys, they never take them from the element that owns them (C# 845b26e9, GitHub #231). True when a
   * focused DOM element is the key's target: a page input, textarea, select, button, link or contenteditable, an
   * accessibility overlay node, the drawn editor's hidden textarea. False when the key goes to the page itself (body,
   * html) or the canvas. A handler that acts on keys (edits, moves, calls preventDefault) skips owned keys, except
   * those of its own element.
   */
  static IsOwnedByElement(e: KeyboardEvent): boolean {
    const tag = (e.target as { tagName?: string } | null)?.tagName;
    return !!tag && tag !== "BODY" && tag !== "HTML" && tag !== "CANVAS";
  }

  /**
   * The key belongs to the input method (an IME composition, a soft keyboard): isComposing, keyCode 229, key "Process"
   * or "Unidentified". Its result arrives as input events (TextInputProxy), never act on the key itself.
   */
  static IsInputMethodKey(e: KeyboardEvent): boolean {
    return e.isComposing || e.keyCode === 229 || e.key === "Process" || e.key === "Unidentified";
  }

  /** JS blurExternalTextInput: a page text input outside the canvas would keep receiving the keys. */
  static BlurExternalTextInput(): void {
    const a = typeof document !== "undefined" ? document.activeElement as HTMLElement | null : null;
    if (a && a.dataset?.drawnuiTextInput !== "1" && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.isContentEditable) && !a.closest("canvas")) a.blur();
  }
}
