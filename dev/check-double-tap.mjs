// A double tap on touch reaches the drawn controls as two taps in every browser, checked in Playwright's WebKit and
// Chromium against a running dev server (`node dev/check-double-tap.mjs [base url]`, default http://localhost:5173):
// dev/fixtures/TextSelectionFixture.tsx is mounted over the demo and its button counts its taps.
// 1. iOS Safari's sequence, measured on an iPhone (iOS 26.6.1): the first tap sends pointer and touch events, the second
//    sends NONE of them, only click, click, dblclick (WebKit's double-tap recognizer takes the touch): the link must
//    still get two taps;
// 2. Android Chrome's sequence: both taps send their pointer and touch events, then a dblclick: exactly two taps, the
//    dblclick adds none;
// 3. a mouse double click: two taps, the dblclick adds none.
import { createRequire } from "node:module";
const { webkit, chromium } = createRequire(import.meta.url)("playwright-core");
const base = (process.argv[2] ?? "http://localhost:5173").replace(/\/$/, "");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (name, ok, detail = "") => { if (!ok) failures++; console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${JSON.stringify(detail)})` : ""}`); };

const PAGE = `(async () => {
  const sel = window.__sel, el = sel.Canvas.Element, wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const b = [...document.querySelectorAll('[role=button]')].find((x) => x.getAttribute('aria-label') === 'Button').getBoundingClientRect();
  const p = { X: b.x + b.width / 2, Y: b.y + b.height / 2 };
  let id = 300;
  const tap = async () => {
    const o = (b) => ({ clientX: p.X, clientY: p.Y, bubbles: true, cancelable: true, pointerId: ++id, pointerType: 'touch', isPrimary: true, button: 0, buttons: b });
    const pid = id + 1;
    el.dispatchEvent(new PointerEvent('pointerdown', { ...o(1), pointerId: pid }));
    await wait(40);
    el.dispatchEvent(new PointerEvent('pointerup', { ...o(0), pointerId: pid }));
    const end = new Event('touchend', { bubbles: true, cancelable: true }); Object.defineProperty(end, 'changedTouches', { value: [{ clientX: p.X, clientY: p.Y }] }); el.dispatchEvent(end);
  };
  const mouse = (t) => el.dispatchEvent(new MouseEvent(t, { clientX: p.X, clientY: p.Y, bubbles: true, cancelable: true, detail: t === 'dblclick' ? 2 : 1 }));
  const out = {};
  sel.ButtonTaps = 0;
  await tap(); await wait(50); mouse('click'); mouse('click'); mouse('dblclick');
  await wait(800); out.safari = sel.ButtonTaps;
  await wait(800); sel.ButtonTaps = 0;
  await tap(); await wait(80); await tap(); await wait(50); mouse('click'); mouse('click'); mouse('dblclick');
  await wait(800); out.chrome = sel.ButtonTaps;
  return out;
})()`;

for (const [name, type] of [["webkit", webkit], ["chromium", chromium]]) {
  const browser = await type.launch();
  try {
    const page = await (await browser.newContext({ viewport: { width: 900, height: 800 }, hasTouch: true })).newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));
    await page.goto(`${base}/?r=a11y#/a11y`); await sleep(3000);
    await page.evaluate(async (src) => { (await import(src)).Mount(); }, `${base}/@fs/${process.cwd().replace(/\\/g, "/")}/dev/fixtures/TextSelectionFixture.tsx?v=${Date.now()}`);
    await sleep(2500);
    // the link opens a page only through its own Tapped; Super.OpenLink is not involved
    const out = await page.evaluate(PAGE);
    check(`${name}: iOS Safari's double tap (no touch events for the second tap, only click, click, dblclick) gives two taps`, out.safari === 2, out);
    check(`${name}: a double tap whose two taps both send their events gives exactly two taps`, out.chrome === 2, out);
    await page.evaluate(() => { window.__sel.ButtonTaps = 0; });
    const p = await page.evaluate(() => { const b = [...document.querySelectorAll("[role=button]")].find((x) => x.getAttribute("aria-label") === "Button").getBoundingClientRect(); return { X: b.x + b.width / 2, Y: b.y + b.height / 2 }; });
    await page.mouse.dblclick(p.X, p.Y); await sleep(1500);
    const m = await page.evaluate(() => window.__sel.ButtonTaps);
    check(`${name}: a mouse double click gives two taps (its dblclick adds none)`, m === 2, m);
    check(`${name}: no page errors`, errors.length === 0, errors.join(" | "));
  } finally { await browser.close(); }
}
console.log(failures ? `FAIL: ${failures} checks` : "OK: a double tap reaches the controls as two taps in every browser");
process.exit(failures ? 1 : 0);
