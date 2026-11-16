// A long press on touch raises the context menu once (drawnui-cross 6cb), checked in Playwright's WebKit and Chromium
// against a running dev server (`node dev/check-touch-contextmenu.mjs [base url]`, default http://localhost:5173):
// dev/fixtures/TextSelectionFixture.tsx is mounted over the demo. Touch presses are sent to the canvas as pointer events;
// "android" also sends the browser's own contextmenu half a second into the press (Android Chrome does), "ios" sends none
// (iOS Safari). For each: a press on a control (not text), a press on unselected selectable text (the word there is
// selected by the label, then the menu comes with it), a press over the current selection (kept). Each press gives exactly
// one ContextMenu with Source "touch". No handler takes the menu here, so the label's drawn Copy button shows: a tap on it
// copies the word and clears the selection.
import { createRequire } from "node:module";

const args = process.argv.slice(2);
const base = (args.find((a) => !a.startsWith("--")) ?? "http://localhost:5173").replace(/\/$/, "");
let failures = 0;
const check = (name, ok, detail = "") => { if (!ok) failures++; console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`); };

// runs in the page: returns per mode and case { menus, sources, selected }
const PAGE = `(async () => {
  const sel = window.__sel, el = sel.Canvas.Element;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  let id = 40;
  const press = async (x, y, android, hold = 1900) => {
    const pid = ++id, o = { clientX: x, clientY: y, bubbles: true, cancelable: true, pointerId: pid, pointerType: 'touch', isPrimary: true, button: 0, buttons: 1 };
    el.dispatchEvent(new PointerEvent('pointerdown', o));
    await wait(Math.min(500, hold));
    if (android) el.dispatchEvent(new PointerEvent('contextmenu', { ...o, button: 2, buttons: 0 }));
    await wait(hold - Math.min(500, hold)); // past the long press and its frame
    el.dispatchEvent(new PointerEvent('pointerup', { ...o, buttons: 0 }));
    await wait(300);
  };
  const label = sel.Find('Bravo label two');
  const out = {};
  for (const mode of ['ios', 'android']) {
    const android = mode === 'android';
    const b = el.getBoundingClientRect();
    // a control: the button (no selectable text there)
    sel.Canvas.ClearTextSelection(); sel.Menus.length = 0;
    const button = [...document.querySelectorAll('[role=button]')].find((n) => n.textContent === 'Button' || n.getAttribute('aria-label') === 'Button').getBoundingClientRect();
    await press(button.left + button.width / 2, button.top + button.height / 2, android);
    out[mode + ' control'] = { menus: sel.Menus.length, sources: sel.Menus.map((m) => m.Source) };
    // unselected selectable text: the word there gets selected
    sel.Canvas.ClearTextSelection(); sel.Menus.length = 0;
    let p = sel.At('Bravo label two', 8);
    await press(p.X, p.Y, android);
    out[mode + ' plain text'] = { menus: sel.Menus.length, sources: sel.Menus.map((m) => m.Source), selected: sel.Menus[0]?.Selected ?? '' };
    // the drawn Copy button copies and clears
    const cb = label.copyButton, k = sel.Canvas.RenderingScale, r = label.GetAccessibilityPixelRect();
    sel.Copied.length = 0;
    if (cb.Width > 0) await press(b.left + (r.Left + (cb.Left + cb.Right) / 2) / k, b.top + (r.Top + (cb.Top + cb.Bottom) / 2) / k, false, 120);
    out[mode + ' copy'] = { shown: cb.Width > 0, copied: sel.Copied.at(-1) ?? '', left: label.SelectedText };
    // over the current selection: kept
    label.Select(0, 11); sel.Menus.length = 0;
    p = sel.At('Bravo label two', 3);
    await press(p.X, p.Y, android);
    out[mode + ' selection'] = { menus: sel.Menus.length, sources: sel.Menus.map((m) => m.Source), selected: sel.Menus[0]?.Selected ?? '' };
  }
  return out;
})()`;

const { webkit, chromium } = createRequire(import.meta.url)("playwright-core");
for (const [name, type] of [["webkit", webkit], ["chromium", chromium]]) {
  const browser = await type.launch();
  try {
    const page = await (await browser.newContext({ viewport: { width: 900, height: 800 }, hasTouch: true })).newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));
    await page.goto(`${base}/?r=a11y#/a11y`);
    await new Promise((r) => setTimeout(r, 3000));
    await page.evaluate(async (src) => { (await import(src)).Mount(); }, `${base}/@fs/${process.cwd().replace(/\\/g, "/")}/dev/fixtures/TextSelectionFixture.tsx?v=${Date.now()}`);
    await new Promise((r) => setTimeout(r, 2500));
    const out = await page.evaluate(PAGE);
    for (const mode of ["ios", "android"]) {
      const c = out[`${mode} control`], t = out[`${mode} plain text`], y = out[`${mode} copy`], s = out[`${mode} selection`];
      check(`${name} ${mode}: a long press on a control raises one ContextMenu (touch)`, c.menus === 1 && c.sources[0] === "touch", JSON.stringify(c));
      check(`${name} ${mode}: a long press on unselected text selects the word, then one ContextMenu with it`, t.menus === 1 && t.sources[0] === "touch" && t.selected === "label", JSON.stringify(t));
      check(`${name} ${mode}: the drawn Copy button shows; a tap on it copies the word and clears`, y.shown && y.copied === "label" && y.left === "", JSON.stringify(y));
      check(`${name} ${mode}: a long press over the selection keeps it, one ContextMenu with it`, s.menus === 1 && s.selected === "Bravo label", JSON.stringify(s));
    }
    check(`${name}: no page errors`, errors.length === 0, errors.join(" | "));
  } finally {
    await browser.close();
  }
}
console.log(failures ? `FAIL: ${failures} checks` : "OK: a long press on touch raises the context menu once");
process.exit(failures ? 1 : 0);
