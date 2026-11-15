// A long press on touch raises the context menu once (drawnui-cross 6cb), checked in Playwright's WebKit against a
// running dev server (`node dev/check-touch-contextmenu.mjs [base url]`, default http://localhost:5173, the demo served
// by `npm run dev`), on the demo's accessibility page (it has selectable text). Touch presses are sent as pointer events;
// "android" also sends the browser's own contextmenu half a second into the press (Android Chrome does), "ios" sends none
// (iOS Safari). For each: a press on a control (not text), a press on unselected selectable text (the word there is
// selected, then the menu comes), a press over the current selection (kept). Each press gives exactly one ContextMenu
// with Source "touch". The same page code runs in Chromium: `node dev/check-touch-contextmenu.mjs <url> --print` prints it.
import { createRequire } from "node:module";

const args = process.argv.slice(2);
const base = (args.find((a) => !a.startsWith("--")) ?? "http://localhost:5173").replace(/\/$/, "");
let failures = 0;
const check = (name, ok, detail = "") => { if (!ok) failures++; console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`); };

// runs in the page: returns per mode and case { menus, sources, selection }
export const PAGE = `(async () => {
  const url = (p) => performance.getEntriesByType('resource').map((e) => e.name).filter((n) => n.includes(p)).pop();
  // every context menu the canvas routes into its tree (the outermost ProcessContextMenu call), with what was selected then
  const { SkiaControl } = await import(url('core/SkiaControl.ts'));
  const log = [];
  let depth = 0;
  const route = SkiaControl.prototype.ProcessContextMenu;
  SkiaControl.prototype.ProcessContextMenu = function (point, e) {
    if (depth === 0) log.push({ source: e.Source, selection: String(getSelection()) });
    depth++;
    try { return route.call(this, point, e); } finally { depth--; }
  };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const span = () => [...document.querySelectorAll('.drawnui-a11y-text > span')].find((x) => x.textContent.includes('This paragraph'));
  span().scrollIntoView({ block: 'center' }); await wait(600);
  const canvasEl = document.querySelector('canvas');
  let id = 40;
  const press = async (target, x, y, android) => {
    const pid = ++id, o = { clientX: x, clientY: y, bubbles: true, cancelable: true, pointerId: pid, pointerType: 'touch', isPrimary: true, button: 0, buttons: 1 };
    target.dispatchEvent(new PointerEvent('pointerdown', o));
    await wait(500);
    if (android) target.dispatchEvent(new PointerEvent('contextmenu', { ...o, button: 2, buttons: 0 }));
    await wait(1400); // past the long press (1.5 s) and its frame
    target.dispatchEvent(new PointerEvent('pointerup', { ...o, buttons: 0 }));
    await wait(300);
  };
  const out = {};
  for (const mode of ['ios', 'android']) {
    const android = mode === 'android';
    // a control: the canvas over the page title (no selectable text there)
    const c = canvasEl.getBoundingClientRect();
    getSelection().removeAllRanges(); log.length = 0;
    await press(canvasEl, c.left + 40, c.top + 20, android);
    out[mode + ' control'] = { menus: log.length, sources: log.map((l) => l.source) };
    // unselected selectable text: the word there gets selected
    const s = span(), r = s.getBoundingClientRect();
    getSelection().removeAllRanges(); log.length = 0;
    await press(s, r.left + 8, r.top + r.height / 2, android);
    out[mode + ' plain text'] = { menus: log.length, sources: log.map((l) => l.source), selection: log[0]?.selection ?? '' };
    // over the current selection: kept
    const range = document.createRange(); range.setStart(s.firstChild, 0); range.setEnd(s.firstChild, 14);
    getSelection().removeAllRanges(); getSelection().addRange(range); log.length = 0;
    const sr = range.getClientRects()[0];
    await press(s, sr.left + sr.width / 2, sr.top + sr.height / 2, android);
    out[mode + ' selection'] = { menus: log.length, sources: log.map((l) => l.source), selection: log[0]?.selection ?? '' };
  }
  return out;
})()`;

if (args.includes("--print")) { console.log(PAGE); process.exit(0); }

const { webkit } = createRequire(import.meta.url)("playwright-core");
const browser = await webkit.launch();
try {
  const page = await (await browser.newContext({ viewport: { width: 1100, height: 850 }, hasTouch: true })).newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));
  await page.goto(`${base}/?r=a11y#/a11y`);
  await new Promise((r) => setTimeout(r, 4000));
  const out = await page.evaluate(PAGE);
  for (const mode of ["ios", "android"]) {
    const c = out[`${mode} control`], t = out[`${mode} plain text`], s = out[`${mode} selection`];
    check(`${mode}: a long press on a control raises one ContextMenu (touch)`, c.menus === 1 && c.sources[0] === "touch", JSON.stringify(c));
    check(`${mode}: a long press on unselected text selects the word, then one ContextMenu with it`, t.menus === 1 && t.sources[0] === "touch" && t.selection === "This", JSON.stringify(t));
    check(`${mode}: a long press over the selection keeps it, one ContextMenu with it`, s.menus === 1 && s.selection === "This paragraph", JSON.stringify(s));
  }
  check("no page errors", errors.length === 0, errors.join(" | "));
} finally {
  await browser.close();
}
console.log(failures ? `FAIL: ${failures} checks` : "OK: a long press on touch raises the context menu once");
process.exit(failures ? 1 : 0);
