// The FPS label in the browser (Nick, 2026-11-26: "still screens should show 0 fps"), checked in Playwright's Chromium
// and WebKit against a running dev server (`node dev/check-fps-label.mjs [base url]`, default http://localhost:5173):
// dev/fixtures/FpsFixture.tsx, a scroll with an FPS label. A still screen shows 00.0 and draws no frames; a drag shows
// the rate the canvas draws; ForceRefresh keeps the canvas drawing and shows its live rate.
import { createRequire } from "node:module";
const { chromium, webkit } = createRequire(import.meta.url)("playwright-core");
const base = (process.argv[2] ?? "http://localhost:5173").replace(/\/$/, "");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (name, ok, detail = "") => { if (!ok) failures++; console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${JSON.stringify(detail)})` : ""}`); };
const value = (text) => Number(String(text).replace("FPS ", ""));

for (const [name, type] of [["chromium", chromium], ["webkit", webkit]]) {
  const browser = await type.launch();
  try {
    const page = await (await browser.newContext({ viewport: { width: 800, height: 600 } })).newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));
    await page.addInitScript(() => { window.__raf = 0; const o = window.requestAnimationFrame.bind(window); window.requestAnimationFrame = (cb) => o((t) => { window.__raf++; cb(t); }); });
    await page.goto(`${base}/?r=shapes#/shapes`); await sleep(3000);
    await page.evaluate(async (src) => { (await import(src)).Mount(); }, `${base}/@fs/${process.cwd().replace(/\\/g, "/")}/dev/fixtures/FpsFixture.tsx?v=${Date.now()}`);
    await sleep(3000);
    const text = () => page.evaluate(() => window.__fps?.Text);
    const raf = () => page.evaluate(() => window.__raf);
    // still: the demo page under the fixture may still settle; measure after it is quiet
    await sleep(2000);
    const r0 = await raf(); await sleep(2000); const r1 = await raf();
    const still = await text();
    check(`${name}: a still screen shows 00.0`, still === "FPS 00.0", still);
    check(`${name}: a still screen draws (almost) no frames`, r1 - r0 <= 4, `${r1 - r0} rAF callbacks in 2 s`);
    // a drag on the scroll: the label shows the rate the canvas draws
    await page.mouse.move(200, 400); await page.mouse.down();
    for (let i = 0; i < 60; i++) { await page.mouse.move(200, 400 - (i % 30) * 6); await sleep(16); }
    const dragged = await text(); await page.mouse.up();
    check(`${name}: during a drag it shows the rate the canvas draws`, value(dragged) > 10, dragged);
    // ForceRefresh: the canvas keeps drawing, the label shows its live rate
    await sleep(2500);
    await page.evaluate(() => { window.__fps.ForceRefresh = true; window.__fps.Update(); });
    await sleep(1500);
    const f0 = await raf(); await sleep(1000); const f1 = await raf();
    const forced = await text();
    check(`${name}: ForceRefresh keeps the canvas drawing`, f1 - f0 > 20, `${f1 - f0} rAF callbacks in 1 s`);
    check(`${name}: ForceRefresh shows the live rate`, value(forced) > 20, forced);
    check(`${name}: no page errors`, errors.length === 0, errors.join(" | "));
  } finally { await browser.close(); }
}
console.log(failures ? `FAIL: ${failures} checks` : "OK: the FPS label shows the frames the canvas draws, ForceRefresh keeps it drawing");
process.exit(failures ? 1 : 0);
