# Screen readers by ear: the script for HelloReact

The run Nick does with each screen reader on https://helloreact.drawnui.net (or a local build). The same five steps on
every head (drawnui-cross accessibility-plan A1 / A2), so the results fill the "Checked" table of ACCESSIBILITY.md the
same way. Note per step: what was said, and anything said twice, missing or wrong.

| Reader | Browser | Start / stop | Next / previous item | Activate | Adjust a slider |
|---|---|---|---|---|---|
| NVDA (Windows) | Chrome | Ctrl+Alt+N / Insert+Q | Down / Up (browse mode); Tab / Shift+Tab | Enter or Space | Tab to it (focus mode), Right / Left |
| Narrator (Windows) | Edge | Win+Ctrl+Enter | Caps Lock+Right / Left (scan mode on with Caps Lock+Space); Tab | Enter or Caps Lock+Enter | Tab to it, Right / Left |
| VoiceOver (macOS) | Safari | Cmd+F5 | VO+Right / Left (VO = Ctrl+Option); Tab | VO+Space | VO+Up / Down |
| TalkBack (Android) | Chrome | volume up + down, 3 s | swipe right / left | double tap | swipe up / down on it |

Before starting: turn the reader on, then load the page; set the browser zoom to 100 %.

1. **Catalog** (home page). Move through the page from the top.
   Expected: the image "DrawnUI logo", the heading "DrawnUI for React", then each card once as one button with its title and text
   ("Recycled cells, 100 000 items ...", button). No card read twice, no empty items.
   Open "Common Controls" with Activate.
2. **Common Controls.** Move to the first card's switch and toggle it.
   Expected: "Wi-Fi, switch, on", after Activate "off". The checkbox "Remember me, checkbox, checked". The slider
   "Volume, slider, 65"; Adjust once: "66" (or the reader's own step). The progress bar "Download, 65 %".
   Go Back with the page's Back button.
3. **A list.** Open "Recycled cells". Tab into the list, then Down a few times, then PageDown.
   Expected: the list is one Tab stop; Down reads the next item by name; PageDown moves about one screen and reads the
   item there; the page scrolls with the focus. Go Back.
4. **A dialog.** Open "Tooltips & Menus". Tab to "File" and Activate.
   Expected: the File menu opens on its first line ("New, Ctrl+N, menu item"); Down reads the next line; Escape
   closes it and the reader is back on "File". Then Tab to "Choose a fruit", Activate: the list opens on "Apple";
   Escape: back on the button.
   Optional, a shell dialog: on the "Shell" page, "Push modal": the modal's text and buttons are read; its
   "PopModalAsync()" closes it. (Shell modals are not announced as dialogs yet: note what the reader says.)
5. **Back.** From any page, the page's Back button, and the browser's Back.
   Expected: the catalog is read again from where the reader lands; nothing from the closed page is still read.

Write the result per reader: reader + version, browser + version, OS, date, and per step "ok" or what was heard.
