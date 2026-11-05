# Accessibility

How DrawnUI for React gives screen readers and keyboards its drawn controls, what an app does for it, and where it
was checked. Per-feature parity with DrawnUI for .NET and Rust: `SKIPPED.md` and `dev/PARITY.md`.

## How it works

**One snapshot, one overlay.** The canvas is `aria-hidden`; next to it, an overlay of invisible DOM elements mirrors
every visible control that has a role (`<Canvas>` renders it, `src/react/index.tsx`). The engine builds the snapshot
(`SkiaAccessibilityManager`, `src/core/Accessibility.ts`): each control's role, name, hint, value, pressed state,
whether it takes input, its live-region politeness and its rect on screen. Nodes are in reading order: by top, and
nodes whose tops are within half the smaller height form a row, read left to right. The overlay is rebuilt at the end
of a frame, at most once a second, and on the very next frame after a screen reader or the keyboard acts (activate,
an arrow step), so the new value or state is read back at once. Screen readers read the overlay as ordinary HTML:
NVDA, JAWS and Narrator with Chrome or Edge, VoiceOver with Safari, TalkBack with Chrome.

**Roles, names, values.**

- A role comes from the control's `AccessibilityRole`, else its class default (`SkiaLabel.DefaultAccessibilityRole =
  Aria.RoleText`, `SkiaButton.DefaultAccessibilityRole = Aria.RoleButton`, set once at startup), else the control's own
  (switch, checkbox, radio, slider, progress bar, editor). No role: not in the overlay.
- The name is `AccessibilityLabel`, else the control's own text. A name is said once: a card titled by a text or
  heading inside it is not named again. A dialog keeps its name.
- A range control (slider, progress bar) has a value: `aria-valuenow`, `-valuemin`, `-valuemax`, and `aria-valuetext`
  where the number alone is not it ("20 – 80" for a range); a slider is horizontal.
- A pressed state goes on the attribute its role is read from: `aria-checked` for switch, checkbox, radio and checkable
  menu items, `aria-selected` for option and tab, `aria-pressed` for a toggle button.
- A control role that takes no input (`RespondsToGestures={false}`, `InputTransparent`, a locked parent) is read as
  unavailable (`aria-disabled`) and is no Tab stop.
- `AccessibilityLive="polite"` (or `"assertive"`) on a status text: its new text is announced, on the next frame.
- `AccessibilityTextSelectable` on a label: its lines are real selectable text in the overlay (select, copy).

**Keyboard.** The browser's own Tab order and focus ring run through the overlay:

- Tab / Shift+Tab walk the controls in reading order; Enter / Space activate (a tap at the control's center).
- A group (`Aria.RoleList`, `RoleListBox`, `RoleGrid`, `RoleToolbar`, `RoleRadioGroup`, `RoleTabList`, `RoleMenu`,
  `RoleMenuBar`) is one Tab stop that remembers its item; the arrows move by index (Up / Down in a column, Left /
  Right in a row, all four in a wrap or grid), Home / End, PageUp / PageDown by a viewport; recycled items are scrolled
  in, then focused. The group role may sit on a wrapper: the items are the children of the layout inside it. A menu,
  menubar, list, listbox or radio group whose items sit in several layouts (a title, a divider and columns) walks all
  of them in reading order.
- The focused control gets the arrow keys first: a slider steps (what a screen reader's Increment / Decrement sends in
  the browser), an editor keeps them while editing.
- The scrolls around the focused control bring it into view.
- A `SkiaEditor` is a Tab stop: Tab in takes the caret, Tab / Shift+Tab leave it.
- `<Canvas ArrowsStartKeyboardNavigation>` (off by default, so games keep their arrows): while nothing has the
  keyboard, Down / Right start at the first Tab stop, Up / Left at the last.
- When the focused control leaves the screen (its page or popup closed), no control keeps the focus and the keys
  belong to the app again; the DOM focus stays on the canvas, so the next Tab starts there and a screen reader stays
  in place.

**Menus and dialogs.**

- Popup windows (`OpenPopupWindow`: menus, dropdowns) are read and walked first while open. Opened from the keyboard,
  a popup with a menu or list takes the keyboard on its checked item, else its first one; Tab goes round inside it;
  Escape closes it and the keyboard goes back to the control it opened from.
- `AccessibilityModal` on a dialog's root: while it shows, screen readers and Tab reach only its controls (and popup
  windows over it). The overlay itself becomes the dialog (role, name, `aria-modal`) around the dialog's controls. The
  keyboard moves into it when it appears with the keyboard in use, and goes back where it was when it closes. A
  control behind the dialog counts as no focus.
- `SkiaShell` popups and modals are such dialogs while open; a popup's tap outside still closes it, and the popup
  itself is no Tab stop.

## What an app does

- Set the class defaults once at startup: `SkiaLabel.DefaultAccessibilityRole = Aria.RoleText` and
  `SkiaButton.DefaultAccessibilityRole = Aria.RoleButton`.
- Name every control that has no text of its own by what it controls, never by its role:
  `AccessibilityLabel="Wi-Fi"` on a switch, `"Volume"` on a slider, `"Download"` on a progress bar.
- Give a tappable card, row or shape a role (`AccessibilityRole={Aria.RoleButton}`) and its inner labels
  `Aria.RolePresentation`, so it is one control with one name.
- Give a list, toolbar or menu a group role: it becomes one Tab stop and the arrows walk it.
- A custom range control returns an `AccessibilityValue` (now, min, max, step, text) and steps in
  `OnAccessibilityKey`.
- `AccessibilityLive="polite"` on status text that should be read when it changes.
- `AccessibilityModal` on a dialog's root, with a backdrop that blocks taps behind it.
- Say each thing once: a caption beside a control that repeats its name, or a page title that repeats the shell bar's
  title, gets `Aria.RolePresentation`.
- Check it: `npm run audit:a11y -- <url>` in this repo reads Chrome's accessibility tree of every demo page (every
  control named, every range valid); then listen with a screen reader.

## Checked

| Platform | How | Date | Screens | Result |
|---|---|---|---|---|
| Chrome (Windows) | Chrome accessibility tree over CDP (`npm run audit:a11y`), every catalog page scrolled to its end | 2026-11-04 | all 22 | 1931 control nodes, every one named, every range with min < max; no console errors |
| Chrome (Windows) | real keys through the overlay, Chrome accessibility tree | 2026-11-04 | Common Controls, Tooltips & Menus, Shell, Editor, catalog | switch, checkbox and radio checked states; slider 65 to 66 with ArrowRight, read back 9 ms later; a live status read 12-26 ms after the key; menus by Tab, arrows, Enter, Escape; the shell's modal and popup read as dialogs with only their controls, Tab round inside, focus back on close |
| Node | the engine's checks (`npm run check:keyboard`, `check:popups-tooltips` and the others) | 2026-11-04 | | groups, reading order, values, disabled roles, popups, dialogs, focus rules |

No screen reader has been heard on DrawnUI for React yet; see "Not yet".

## Not yet

- Screen readers by ear: NVDA and Narrator with Chrome and Edge, VoiceOver with Safari, TalkBack with Chrome.
- Browsers have no scroll actions for screen readers: a reader moves through the overlay's elements and the focused
  one is scrolled into view, but a three-finger page swipe does not page a drawn scroll.
- System text size, high contrast and reduced motion are not read by the engine.
