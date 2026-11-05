/**
 * Mirrors DrawnUi KeyboardManager (Blazor / Wasm heads, drawnui-keyboard.js): window-level keydown / keyup
 * capture listeners feeding `KeyDown` / `KeyUp` (the DOM `event.code`, e.g. "KeyA", "Backspace", "ArrowLeft")
 * and `KeyChar` (a printable character, no Ctrl / Alt / Meta), plus the modifier state. A drawn editor
 * subscribes while focused. Characters typed into the hidden TextInputProxy textarea (IME, soft keyboard) arrive
 * as input events there, so its key events are not forwarded as KeyChar here (a React-port addition over
 * DrawnUi.Blazor, which has no DOM text input).
 *
 * One key routing order on every head (drawnui-cross 6az, C# KeyboardManager.IsKeyHandled): the canvas keyboard
 * navigation gets a key first (an accessibility overlay node: activation, group arrows, slider steps; then the canvas'
 * own handlers: Escape closing a popup window, arrows starting navigation), then the app's KeyDown handlers run with
 * `IsKeyHandled` telling whether navigation used it. Tab belongs to the browser.
 */
export type InputKey = string;

export class KeyboardManager {
  private static attached = false;
  private static readonly pressed = new Set<InputKey>();
  private static readonly keyDown = new Set<(key: InputKey, e: KeyboardEvent) => void>();
  private static readonly keyUp = new Set<(key: InputKey, e: KeyboardEvent) => void>();
  private static readonly keyChar = new Set<(ch: string, e: KeyboardEvent) => void>();
  private static readonly navigation = new Set<(key: InputKey, e: KeyboardEvent) => boolean>();
  private static usedKey?: InputKey;
  private static deferred?: KeyboardEvent;

  /**
   * True while KeyDown handlers run for a key the canvas keyboard navigation already used: Enter / Space activated the
   * focused control, an arrow moved inside a list or a menu or stepped a slider, Escape closed a popup window. An app
   * handler that would act on the same key (a menu that opens on Enter) skips it, so one press does one thing.
   */
  static IsKeyHandled = false;

  /** For the accessibility overlay and canvas navigation: `key` was used, the KeyDown raised next for it reports IsKeyHandled. */
  static MarkKeyHandled(key: InputKey): void { KeyboardManager.usedKey = key; }

  static get IsShiftPressed(): boolean { return KeyboardManager.pressed.has("ShiftLeft") || KeyboardManager.pressed.has("ShiftRight"); }
  static get IsControlPressed(): boolean { return KeyboardManager.pressed.has("ControlLeft") || KeyboardManager.pressed.has("ControlRight") || KeyboardManager.pressed.has("MetaLeft") || KeyboardManager.pressed.has("MetaRight"); }
  /** True while the keydown handlers run: a popup opened now was opened from the keyboard (Alt+F). */
  static IsDispatchingKeyDown = false;

  static get IsAltPressed(): boolean { return KeyboardManager.pressed.has("AltLeft") || KeyboardManager.pressed.has("AltRight"); }

  /** C# AttachToKeyboardAsync / JS attachGlobalKeyboard: idempotent. */
  static AttachToKeyboard(): void {
    if (KeyboardManager.attached || typeof window === "undefined") return;
    KeyboardManager.attached = true;
    // inside a cross-frame iframe the embedding page keeps DOM focus: a pointerdown pulls it to this window
    window.addEventListener("pointerdown", () => window.focus(), true);
    window.addEventListener("keydown", (e) => {
      KeyboardManager.SyncModifiers(e);
      KeyboardManager.pressed.add(e.code || "");
      // a key for an overlay node: its keydown (the canvas navigation) runs first, the key is raised when it bubbles here
      if ((e.target as HTMLElement | null)?.dataset?.a11yId) { KeyboardManager.deferred = e; return; }
      KeyboardManager.RaiseKeyDown(e);
    }, true);
    window.addEventListener("keydown", (e) => {
      if (KeyboardManager.deferred !== e) return;
      KeyboardManager.deferred = undefined;
      KeyboardManager.RaiseKeyDown(e);
    });
    window.addEventListener("keyup", (e) => {
      const code = e.code || "";
      KeyboardManager.SyncModifiers(e);
      KeyboardManager.pressed.delete(code);
      if (KeyboardManager.usedKey === code) KeyboardManager.usedKey = undefined;
      for (const h of [...KeyboardManager.keyUp]) h(code, e);
    }, true);
    window.addEventListener("blur", () => KeyboardManager.pressed.clear());
  }

  /**
   * The modifier state follows each key event's own flags: a modifier pressed while the page had no focus (its keydown
   * went elsewhere) still counts, and one released elsewhere stops counting.
   */
  private static SyncModifiers(e: KeyboardEvent): void {
    const sync = (down: boolean, left: InputKey, right: InputKey) => {
      const p = KeyboardManager.pressed;
      if (!down) { p.delete(left); p.delete(right); } else if (!p.has(left) && !p.has(right)) p.add(left);
    };
    sync(!!e.altKey, "AltLeft", "AltRight");
    sync(!!e.ctrlKey, "ControlLeft", "ControlRight");
    sync(!!e.shiftKey, "ShiftLeft", "ShiftRight");
    sync(!!e.metaKey, "MetaLeft", "MetaRight");
  }

  private static RaiseKeyDown(e: KeyboardEvent): void {
    const code = e.code || "";
    let used = KeyboardManager.usedKey === code;
    KeyboardManager.usedKey = undefined;
    KeyboardManager.IsDispatchingKeyDown = true;
    try {
      // the canvas' own navigation (a popup window's Escape, arrows starting navigation), then the app with the result
      if (!used) for (const h of [...KeyboardManager.navigation]) if (h(code, e)) { used = true; break; }
      KeyboardManager.IsKeyHandled = used;
      for (const h of [...KeyboardManager.keyDown]) h(code, e);
    } finally { KeyboardManager.IsDispatchingKeyDown = false; KeyboardManager.IsKeyHandled = false; }
    const proxied = (e.target as HTMLElement | null)?.dataset?.drawnuiTextInput === "1"; // TextInputProxy: characters come through its input events
    if (!proxied && e.key && e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) for (const h of [...KeyboardManager.keyChar]) h(e.key, e);
  }

  /** For the canvas: keyboard navigation that runs before the app's KeyDown handlers; returns true when it used the key. */
  static SubscribeNavigation(handler: (key: InputKey, e: KeyboardEvent) => boolean): void { KeyboardManager.AttachToKeyboard(); KeyboardManager.navigation.add(handler); }
  static UnsubscribeNavigation(handler: (key: InputKey, e: KeyboardEvent) => boolean): void { KeyboardManager.navigation.delete(handler); }

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
    const target = e.target as { tagName?: string; dataset?: Record<string, string> } | null;
    const tag = target?.tagName;
    // the canvas host holds the DOM focus when no drawn control has it: its keys are the app's, as the canvas' own
    return !!tag && tag !== "BODY" && tag !== "HTML" && tag !== "CANVAS" && target?.dataset?.drawnuiHost !== "1";
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
