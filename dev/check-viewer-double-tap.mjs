// A 3D viewer's double tap (ResetOnDoubleTap) is judged by when the two taps HAPPENED (the browser events' timeStamp),
// not by when a frame got to them, checked in Playwright's Chromium against the 3D gallery's dev server
// (`node dev/check-viewer-double-tap.mjs [base url]`, default http://localhost:5197). iOS Safari's double tap (measured:
// the first tap's touch events, then click, click, dblclick ~43 ms later, the second tap recovered from the dblclick)
// on the product viewer, turned first, while the frames are slow (the main thread busy for 400 ms right after the
// dblclick): the view resets. The view is read from the hotspot dots' overlay boxes, which follow the model.
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright-core");
const base = (process.argv[2] ?? "http://localhost:5197").replace(/\/$/, "");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (name, ok, detail = "") => { if (!ok) failures++; console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${JSON.stringify(detail)})` : ""}`); };

const browser = await chromium.launch();
try {
  const page = await (await browser.newContext({ viewport: { width: 402, height: 874 }, hasTouch: true })).newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));
  await page.goto(`${base}/`); await sleep(9000);
  const box = (label) => page.evaluate((label) => { const n = [...document.querySelectorAll("[aria-label]")].find((x) => x.getAttribute("aria-label") === label); if (!n) return null; const r = n.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; }, label);
  for (let i = 0; i < 30; i++) {
    const b = await box("Walnut sofa, 3D view");
    if (b && b.y > 80 && b.y < 300) break;
    await page.mouse.move(10, 400); await page.mouse.wheel(0, b ? Math.sign(b.y - 150) * Math.min(400, Math.abs(b.y - 150)) : 400); await sleep(600);
  }
  await sleep(1500);
  const view = await box("Walnut sofa, 3D view");
  const at = { x: view.x + 30, y: view.y + view.h / 2 };
  const dot = () => box("Seat, hotspot");
  const front = await dot();
  // turn the sofa with a sideways touch drag
  await page.evaluate(async ({ x, y }) => {
    const el = document.querySelector("canvas"), wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const o = (t, b, dx) => new PointerEvent(t, { clientX: x + dx, clientY: y, bubbles: true, cancelable: true, pointerId: 70, pointerType: "touch", isPrimary: true, button: 0, buttons: b });
    el.dispatchEvent(o("pointerdown", 1, 0));
    for (let i = 1; i <= 12; i++) { await wait(16); el.dispatchEvent(o("pointermove", 1, i * 12)); }
    el.dispatchEvent(o("pointerup", 0, 144));
    const te = new Event("touchend", { bubbles: true, cancelable: true }); Object.defineProperty(te, "changedTouches", { value: [{ clientX: x + 144, clientY: y }] }); el.dispatchEvent(te);
  }, at);
  await sleep(2500);
  const turned = await dot();
  // iOS Safari's double tap, then a slow frame: the main thread busy for 400 ms before the next frame handles the taps
  await page.evaluate(async ({ x, y }) => {
    const el = document.querySelector("canvas"), wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const o = (t, b) => new PointerEvent(t, { clientX: x, clientY: y, bubbles: true, cancelable: true, pointerId: 77, pointerType: "touch", isPrimary: true, button: 0, buttons: b });
    el.dispatchEvent(o("pointerdown", 1));
    await wait(56);
    el.dispatchEvent(o("pointerup", 0));
    const te = new Event("touchend", { bubbles: true, cancelable: true }); Object.defineProperty(te, "changedTouches", { value: [{ clientX: x, clientY: y }] }); el.dispatchEvent(te);
    await wait(43);
    const m = (t, d) => el.dispatchEvent(new MouseEvent(t, { clientX: x, clientY: y, bubbles: true, cancelable: true, detail: d }));
    m("mousedown", 1); m("mouseup", 1); m("click", 1); m("mousedown", 2); m("mouseup", 2); m("click", 2); m("dblclick", 2);
    const until = performance.now() + 400;
    while (performance.now() < until) { /* a slow frame */ }
  }, at);
  await sleep(2500);
  const after = await dot();
  const near = (a, b) => a && b && Math.abs(a.x - b.x) <= 3 && Math.abs(a.y - b.y) <= 3;
  check("the drag turned the sofa (the Seat dot moved)", !near(front, turned), { front, turned });
  check("a double tap followed by a slow frame resets the view (the Seat dot is back)", near(front, after), { front, after });
  check("no page errors", errors.length === 0, errors.join(" | "));
} finally { await browser.close(); }
console.log(failures ? `FAIL: ${failures} checks` : "OK: a 3D viewer's double tap counts by when the taps happened");
process.exit(failures ? 1 : 0);
