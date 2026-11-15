// Mouse text selection like a web page (drawnui-cross 6cc), checked in Playwright's WebKit and Chromium (both launched
// by Playwright) against a running dev server (`node dev/check-text-selection.mjs [base url]`, default
// http://localhost:5173): dev/fixtures/TextSelectionFixture.tsx is mounted over the demo. Real mouse input:
// 1. a press 3 px left of a label, a drag over it: the label is selected from its start;
// 2. a drag from above the first label to the middle of the third: the first two whole, the third partly, copy joined
//    with new lines;
// 3. a drag inside the scroll over its labels: text selected, the scroll does not move; held past its bottom edge it
//    scrolls on;
// 4. a drag on the scroll's empty space still scrolls it (a scroll without text keeps mouse-drag scrolling is .NET's
//    rule; here the scroll holds text, so this reports what the browser does).
import { createRequire } from "node:module";
const { webkit, chromium } = createRequire(import.meta.url)("playwright-core");
const base = (process.argv[2] ?? "http://localhost:5173").replace(/\/$/, "");
const only = process.argv[3];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (name, ok, detail = "") => { if (!ok) failures++; console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${JSON.stringify(detail)})` : ""}`); };

async function run(name, type) {
  const browser = await type.launch();
  try {
    const page = await (await browser.newContext({ viewport: { width: 900, height: 800 } })).newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));
    await page.goto(`${base}/?r=a11y#/a11y`); await sleep(3000);
    await page.evaluate(async (src) => { (await import(src)).Mount(); }, `${base}/@fs/${process.cwd().replace(/\\/g, "/")}/dev/fixtures/TextSelectionFixture.tsx?v=${Date.now()}`);
    await sleep(2500);
    const rect = (text) => page.evaluate((t) => { const s = [...document.querySelectorAll(".drawnui-a11y-text > span")].find((x) => x.textContent.startsWith(t)); if (!s) return null; const r = s.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }, text);
    const sel = () => page.evaluate(() => String(getSelection()));
    const clear = async () => { await page.mouse.click(560, 690); await page.evaluate(() => getSelection().removeAllRanges()); };
    const drag = async (x1, y1, x2, y2, hold = 0) => { await page.mouse.move(x1, y1); await page.mouse.down(); await page.mouse.move(x2, y2, { steps: 12 }); if (hold) await sleep(hold); await page.mouse.up(); await sleep(200); };

    // 1. from 3 px left of the label
    await clear();
    const a = await rect("Alpha");
    await drag(a.x - 3, a.y + a.h / 2, a.x + a.w * 0.6, a.y + a.h / 2);
    const s1 = await sel();
    check(`${name}: a press 3 px left of a label and a drag over it selects from its start`, s1.startsWith("Alpha"), s1);

    // 2. across labels
    await clear();
    const c = await rect("Charlie");
    await drag(a.x + 5, a.y - 12, c.x + c.w * 0.4, c.y + c.h / 2);
    const s2 = await sel();
    check(`${name}: a drag from above the first label to the middle of the last selects across them, the link too`, /^Alpha label one\s*Bravo label two\s*Delta link\s*Charlie/.test(s2) && !s2.includes("three"), s2);
    // what a copy gives (a copy event, as Ctrl+C sends; the handler fills its clipboard data)
    const copy = () => page.evaluate(() => { const dt = new DataTransfer(); document.dispatchEvent(new ClipboardEvent("copy", { clipboardData: dt, bubbles: true, cancelable: true })); return dt.getData("text/plain"); });
    const copied = await copy();
    check(`${name}: copy joins the labels and the link with new lines`, /^Alpha label one\nBravo label two\nDelta link\nCharlie/.test(copied), copied);

    // 2b. a link with selectable text: a drag starting on a label and ending on the link selects the link's text too; a
    //     click that ends a selection over it does not open it, a plain click does
    await clear();
    await page.evaluate(() => { window.__linkTaps = 0; });
    const b = await rect("Bravo"), d = await rect("Delta");
    await drag(b.x + 2, b.y + b.h / 2, d.x + d.w - 2, d.y + d.h / 2);
    const s2b = await copy();
    const tapsAfterDrag = await page.evaluate(() => window.__linkTaps ?? 0);
    check(`${name}: a drag from a label across the link selects the link's text too`, /^Bravo label two\nDelta link/.test(s2b), s2b);
    await clear();
    await page.evaluate(() => { window.__linkTaps = 0; });
    await page.mouse.click(d.x + d.w / 2, d.y + d.h / 2); await sleep(400);
    const tapsAfterClick = await page.evaluate(() => window.__linkTaps ?? 0);
    check(`${name}: a plain click opens the link, a drag ending on it does not`, tapsAfterDrag === 0 && tapsAfterClick === 1, `after the drag ${tapsAfterDrag}, after a click ${tapsAfterClick}`);

    // 3. inside the scroll, over its text
    await clear();
    const l0 = await rect("Scroll line 0"), l2 = await rect("Scroll line 2");
    await drag(l0.x + 2, l0.y + l0.h / 2, l2.x + l2.w * 0.5, l2.y + l2.h / 2);
    const s3 = await sel(), l0After = await rect("Scroll line 0");
    check(`${name}: a drag over the scroll's text selects it and does not scroll`, s3.startsWith("Scroll line 0") && Math.abs(l0After.y - l0.y) < 2, { selection: s3, moved: l0After.y - l0.y });
    // held past the bottom edge: auto-scroll
    await clear();
    const before = await rect("Scroll line 0");
    await drag(before.x + 2, before.y + before.h / 2, before.x + 40, before.y + 260, 1200);
    const after = await rect("Scroll line 0"), s4 = await sel();
    check(`${name}: a selection drag held past the scroll's bottom scrolls it on`, after.y < before.y - 20, { moved: after.y - before.y, selection: s4.slice(0, 60) });

    // 4. the scroll's empty space (right of the short lines)
    await clear();
    const b0 = await rect("Scroll line 0");
    await drag(520, b0.y + 60, 520, b0.y - 20);
    const b1 = await rect("Scroll line 0");
    console.log(`info ${name}: a mouse drag on the scroll's empty space moved its content ${Math.round(b1.y - b0.y)} px`);
    check(`${name}: no page errors`, errors.length === 0, errors.join(" | "));
  } finally { await browser.close(); }
}

if (!only || only === "webkit") await run("webkit", webkit);
if (!only || only === "chromium") await run("chromium", chromium);
console.log(failures ? `FAIL: ${failures} checks` : "OK: mouse text selection works like a web page");
process.exit(failures ? 1 : 0);
