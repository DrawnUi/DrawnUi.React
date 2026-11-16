// The soft keyboard of a drawn text field on touch (iOS WebKit rule: focus() on a text input opens the keyboard only inside
// the touch's touchend; a focus in pointerup was measured on an iPhone not to open it), checked in Playwright's WebKit and Chromium against a running dev server
// (`node dev/check-editor-keyboard.mjs [base url]`, default http://localhost:5173): dev/fixtures/EditorFixture.tsx is mounted
// over the demo and touch presses are sent to the canvas as pointer events followed by the touchend.
// 1. a tap on the field focuses its hidden text input inside that tap's touchend (the keyboard opens on the first tap);
// 2. the keyboard closed by the user (the input blurred), a drag elsewhere on the page scrolls and does NOT focus the input
//    again (the keyboard does not pop back on every touch);
// 3. a tap on the field again focuses it inside the tap (the keyboard comes back);
// 4. a mouse click on the field focuses the input (desktop typing, IME);
// 5. a real tap (Playwright's touchscreen: touch events and the compatibility mouse events) leaves the input focused;
// 6. the soft keyboard opening over a field in the lower half (visualViewport shrinking) scrolls the field above it;
// 7. the soft keyboard's return key (done / go / search / send) in a single-line field focused by a tap ends editing, as a
//    MAUI single-line field; a physical Enter keeps the field focused.
import { createRequire } from "node:module";
const { webkit, chromium } = createRequire(import.meta.url)("playwright-core");
const base = (process.argv[2] ?? "http://localhost:5173").replace(/\/$/, "");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (name, ok, detail = "") => { if (!ok) failures++; console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${JSON.stringify(detail)})` : ""}`); };

const PAGE = `(async () => {
  const ed = window.__ed, el = ed.Canvas.Element, wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const proxy = () => document.querySelector('[data-drawnui-text-input]');
  // focus events of the hidden input, and whether they came inside a touchend dispatch (the user gesture iOS requires)
  let inEnd = false, log = [];
  window.addEventListener('touchend', () => { inEnd = true; }, true);
  window.addEventListener('touchend', () => { inEnd = false; });
  document.addEventListener('focusin', (e) => { if (e.target?.dataset?.drawnuiTextInput === '1') log.push(inEnd ? 'focus in touchend' : 'focus outside'); }, true);
  let id = 70;
  const at = () => { const r = ed.Editor.GetAccessibilityPixelRect(), k = ed.Canvas.RenderingScale, b = el.getBoundingClientRect(); return { x: b.left + (r.Left + r.Right) / 2 / k, y: b.top + (r.Top + r.Bottom) / 2 / k }; };
  const touch = async (x, y, x2 = x, y2 = y) => {
    const pid = ++id, o = (cx, cy, buttons) => ({ clientX: cx, clientY: cy, bubbles: true, cancelable: true, pointerId: pid, pointerType: 'touch', isPrimary: true, button: 0, buttons });
    el.dispatchEvent(new PointerEvent('pointerdown', o(x, y, 1)));
    for (let i = 1; i <= 6 && (x2 !== x || y2 !== y); i++) { await wait(16); el.dispatchEvent(new PointerEvent('pointermove', o(x + (x2 - x) * i / 6, y + (y2 - y) * i / 6, 1))); }
    await wait(40);
    el.dispatchEvent(new PointerEvent('pointerup', o(x2, y2, 0)));
    const end = new Event('touchend', { bubbles: true, cancelable: true });
    Object.defineProperty(end, 'changedTouches', { value: [{ clientX: x2, clientY: y2, identifier: pid }] });
    el.dispatchEvent(end);
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
    check(`${name}: a first tap on the field focuses its input inside the tap (the keyboard opens)`, out.first.focused && out.first.active && out.first.log.join() === "focus in touchend", out.first);
    check(`${name}: the keyboard closed by the user, a drag elsewhere does not focus the input again`, !out.drag.active && out.drag.log.length === 0, out.drag);
    check(`${name}: a tap on the field again focuses the input inside the tap`, out.again.active && out.again.log.includes("focus in touchend"), out.again);
    // 4. desktop: a mouse click on the field
    await page.evaluate(() => { document.querySelector("[data-drawnui-text-input]").blur(); window.__ed.Editor.IsFocused = false; });
    await sleep(300);
    const p = await page.evaluate(() => { const ed = window.__ed, r = ed.Editor.GetAccessibilityPixelRect(), k = ed.Canvas.RenderingScale, b = ed.Canvas.Element.getBoundingClientRect(); return { x: b.left + (r.Left + r.Right) / 2 / k, y: b.top + (r.Top + r.Bottom) / 2 / k }; });
    await page.mouse.click(p.x, p.y); await sleep(500);
    await page.keyboard.type("hi"); await sleep(300);
    const typed = await page.evaluate(() => ({ active: document.activeElement?.dataset?.drawnuiTextInput === "1", text: window.__ed.Editor.Text }));
    check(`${name}: a mouse click on the field focuses its input and typing reaches it`, typed.active && typed.text.endsWith("hi"), typed);
    // 5. a real tap (the browser's own touch events, then its compatibility mouse events): the input keeps the focus the tap
    //    gave it (the canvas host must not take it back)
    await page.evaluate(() => { document.querySelector("[data-drawnui-text-input]").blur(); window.__ed.Editor.IsFocused = false; window.__fl = []; document.addEventListener("focusin", (e) => window.__fl.push(e.target?.dataset?.drawnuiTextInput ? "input" : e.target?.tagName), true); });
    await sleep(300);
    await page.touchscreen.tap(p.x, p.y); await sleep(600);
    const real = await page.evaluate(() => ({ active: document.activeElement?.dataset?.drawnuiTextInput === "1", focused: window.__ed.Editor.IsFocused, focusins: window.__fl }));
    check(`${name}: a real tap on the field leaves its input focused (no compatibility click moves the focus away)`, real.active && real.focused && real.focusins.join() === "input", real);
    // 6. the soft keyboard opens over a field in the lower half (the visual viewport shrinks to 300 px): the field is scrolled
    //    above it, 16 px clear
    const above = await page.evaluate(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const ed = window.__ed, el = ed.Canvas.Element;
      const rectOf = (c) => { const r = c.GetAccessibilityPixelRect(), k = ed.Canvas.RenderingScale, b = el.getBoundingClientRect(); return { top: b.top + r.Top / k, bottom: b.top + r.Bottom / k, x: b.left + (r.Left + r.Right) / 2 / k, y: b.top + (r.Top + r.Bottom) / 2 / k }; };
      const vv = Object.assign(new EventTarget(), { width: innerWidth, height: innerHeight, offsetTop: 0, offsetLeft: 0, pageTop: 0, scale: 1 });
      Object.defineProperty(window, "visualViewport", { value: vv, configurable: true });
      ed.Editor.IsFocused = false; await wait(200);
      const p = rectOf(ed.Lower), before = p.bottom;
      const o = (buttons) => ({ clientX: p.x, clientY: p.y, bubbles: true, cancelable: true, pointerId: 501, pointerType: "touch", isPrimary: true, button: 0, buttons });
      el.dispatchEvent(new PointerEvent("pointerdown", o(1))); await wait(30); el.dispatchEvent(new PointerEvent("pointerup", o(0)));
      const end = new Event("touchend", { bubbles: true, cancelable: true }); Object.defineProperty(end, "changedTouches", { value: [{ clientX: p.x, clientY: p.y }] }); el.dispatchEvent(end);
      await wait(300);
      vv.height = 300; vv.dispatchEvent(new Event("resize"));
      await wait(900);
      return { focused: ed.Lower.IsFocused, before: Math.round(before), after: Math.round(rectOf(ed.Lower).bottom), visibleBottom: 300 };
    });
    check(`${name}: the keyboard opening over a field in the lower half scrolls it above the keyboard`, above.focused && above.before > 300 && above.after <= 300 - 16 + 1 && above.after > 100, above);
    // 7. the soft keyboard's return key (a field focused by a touch tap, enterkeyhint done): editing ends, the keyboard closes;
    //    a physical Enter (a field focused by a mouse click) keeps the field focused
    await page.evaluate(() => { window.__ed.Lower.IsFocused = false; window.__ed.Editor.IsFocused = false; });
    await page.evaluate(() => { const ed = window.__ed; ed.Canvas.Content.ScrollTo?.(0, 0, 0); });
    await sleep(400);
    const fp = await page.evaluate(() => { const ed = window.__ed, r = ed.Editor.GetAccessibilityPixelRect(), k = ed.Canvas.RenderingScale, b = ed.Canvas.Element.getBoundingClientRect(); return { x: b.left + (r.Left + r.Right) / 2 / k, y: b.top + (r.Top + r.Bottom) / 2 / k }; });
    await page.touchscreen.tap(fp.x, fp.y); await sleep(500);
    const soft = await page.evaluate(async () => {
      const input = document.querySelector("[data-drawnui-text-input]"), ed = window.__ed;
      const hint = input.enterKeyHint, was = ed.Editor.IsFocused;
      input.value = input.value + "\n"; input.dispatchEvent(new InputEvent("input", { inputType: "insertLineBreak", bubbles: true }));
      await new Promise((r) => setTimeout(r, 300));
      return { hint, was, focused: ed.Editor.IsFocused, active: document.activeElement === input };
    });
    check(`${name}: the soft keyboard's return key in a single-line field ends editing (keyboard closes)`, soft.was && soft.hint === "done" && !soft.focused && !soft.active, soft);
    await page.mouse.click(fp.x, fp.y); await sleep(400);
    await page.keyboard.press("Enter"); await sleep(300);
    const physical = await page.evaluate(() => ({ focused: window.__ed.Editor.IsFocused }));
    check(`${name}: a physical Enter in a field focused by a mouse click keeps it focused`, physical.focused, physical);
    check(`${name}: no page errors`, errors.length === 0, errors.join(" | "));
  } finally { await browser.close(); }
}
console.log(failures ? `FAIL: ${failures} checks` : "OK: the soft keyboard opens on the first tap and stays closed when the user closed it");
process.exit(failures ? 1 : 0);
