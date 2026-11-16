// The soft keyboard of a drawn text field on touch (iOS WebKit rules: focus() on a text input opens the keyboard only inside
// the touch's pointerup / touchend), checked in Playwright's WebKit and Chromium against a running dev server
// (`node dev/check-editor-keyboard.mjs [base url]`, default http://localhost:5173): dev/fixtures/EditorFixture.tsx is mounted
// over the demo and touch presses are sent to the canvas as pointer events.
// 1. a tap on the field focuses its hidden text input inside that tap's pointerup (the keyboard opens on the first tap);
// 2. the keyboard closed by the user (the input blurred), a drag elsewhere on the page scrolls and does NOT focus the input
//    again (the keyboard does not pop back on every touch);
// 3. a tap on the field again focuses it inside the tap (the keyboard comes back);
// 4. a mouse click on the field focuses the input (desktop typing, IME).
import { createRequire } from "node:module";
const { webkit, chromium } = createRequire(import.meta.url)("playwright-core");
const base = (process.argv[2] ?? "http://localhost:5173").replace(/\/$/, "");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (name, ok, detail = "") => { if (!ok) failures++; console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${JSON.stringify(detail)})` : ""}`); };

const PAGE = `(async () => {
  const ed = window.__ed, el = ed.Canvas.Element, wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const proxy = () => document.querySelector('[data-drawnui-text-input]');
  // focus events of the hidden input, and whether they came inside a pointerup dispatch (the user gesture iOS requires)
  let inUp = false, log = [];
  window.addEventListener('pointerup', () => { inUp = true; }, true);
  window.addEventListener('pointerup', () => { inUp = false; });
  document.addEventListener('focusin', (e) => { if (e.target?.dataset?.drawnuiTextInput === '1') log.push(inUp ? 'focus in pointerup' : 'focus outside'); }, true);
  let id = 70;
  const at = () => { const r = ed.Editor.GetAccessibilityPixelRect(), k = ed.Canvas.RenderingScale, b = el.getBoundingClientRect(); return { x: b.left + (r.Left + r.Right) / 2 / k, y: b.top + (r.Top + r.Bottom) / 2 / k }; };
  const touch = async (x, y, x2 = x, y2 = y) => {
    const pid = ++id, o = (cx, cy, buttons) => ({ clientX: cx, clientY: cy, bubbles: true, cancelable: true, pointerId: pid, pointerType: 'touch', isPrimary: true, button: 0, buttons });
    el.dispatchEvent(new PointerEvent('pointerdown', o(x, y, 1)));
    for (let i = 1; i <= 6 && (x2 !== x || y2 !== y); i++) { await wait(16); el.dispatchEvent(new PointerEvent('pointermove', o(x + (x2 - x) * i / 6, y + (y2 - y) * i / 6, 1))); }
    await wait(40);
    el.dispatchEvent(new PointerEvent('pointerup', o(x2, y2, 0)));
    await wait(400);
  };
  const out = {};
  // 1. first tap on the field
  let p = at(); log = [];
  await touch(p.x, p.y);
  out.first = { log: [...log], focused: ed.Editor.IsFocused, active: document.activeElement === proxy() };
  // 2. the user closes the keyboard, then drags elsewhere
  proxy().blur(); await wait(100); log = [];
  const top = ed.Canvas.Element.getBoundingClientRect();
  await touch(200, top.top + 450, 200, top.top + 250); await wait(600);
  out.drag = { log: [...log], active: document.activeElement === proxy(), editorFocused: ed.Editor.IsFocused };
  // scroll back so the field is under the finger again
  await touch(200, top.top + 250, 200, top.top + 550); await wait(800);
  // 3. a tap on the field again
  p = at(); log = [];
  await touch(p.x, p.y);
  out.again = { log: [...log], active: document.activeElement === proxy() };
  return out;
})()`;

for (const [name, type] of [["webkit", webkit], ["chromium", chromium]]) {
  const browser = await type.launch();
  try {
    const page = await (await browser.newContext({ viewport: { width: 800, height: 700 }, hasTouch: true })).newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));
    await page.goto(`${base}/?r=a11y#/a11y`); await sleep(3000);
    await page.evaluate(async (src) => { (await import(src)).Mount(); }, `${base}/@fs/${process.cwd().replace(/\\/g, "/")}/dev/fixtures/EditorFixture.tsx?v=${Date.now()}`);
    await sleep(2500);
    const out = await page.evaluate(PAGE);
    check(`${name}: a first tap on the field focuses its input inside the tap (the keyboard opens)`, out.first.focused && out.first.active && out.first.log.includes("focus in pointerup"), out.first);
    check(`${name}: the keyboard closed by the user, a drag elsewhere does not focus the input again`, !out.drag.active && out.drag.log.length === 0, out.drag);
    check(`${name}: a tap on the field again focuses the input inside the tap`, out.again.active && out.again.log.includes("focus in pointerup"), out.again);
    // 4. desktop: a mouse click on the field
    await page.evaluate(() => { document.querySelector("[data-drawnui-text-input]").blur(); window.__ed.Editor.IsFocused = false; });
    await sleep(300);
    const p = await page.evaluate(() => { const ed = window.__ed, r = ed.Editor.GetAccessibilityPixelRect(), k = ed.Canvas.RenderingScale, b = ed.Canvas.Element.getBoundingClientRect(); return { x: b.left + (r.Left + r.Right) / 2 / k, y: b.top + (r.Top + r.Bottom) / 2 / k }; });
    await page.mouse.click(p.x, p.y); await sleep(500);
    await page.keyboard.type("hi"); await sleep(300);
    const typed = await page.evaluate(() => ({ active: document.activeElement?.dataset?.drawnuiTextInput === "1", text: window.__ed.Editor.Text }));
    check(`${name}: a mouse click on the field focuses its input and typing reaches it`, typed.active && typed.text.endsWith("hi"), typed);
    check(`${name}: no page errors`, errors.length === 0, errors.join(" | "));
  } finally { await browser.close(); }
}
console.log(failures ? `FAIL: ${failures} checks` : "OK: the soft keyboard opens on the first tap and stays closed when the user closed it");
process.exit(failures ? 1 : 0);
