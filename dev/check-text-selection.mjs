// Text selection drawn by the label, as every DrawnUI engine (drawnui-cross 6cc), checked with real mouse and keys in
// Playwright's WebKit and Chromium (both launched by Playwright) against a running dev server
// (`node dev/check-text-selection.mjs [base url] [webkit|chromium]`, default http://localhost:5173):
// dev/fixtures/TextSelectionFixture.tsx is mounted over the demo. The overlay is for screen readers and the keyboard only
// (no node takes the pointer, nothing is ever selected in the DOM). Cases:
// 1. a press 3 px left of a label and a drag over it select from its start;
// 2. a drag from above the first label to the middle of the last selects across them, the link too; Ctrl+C copies them
//    joined by new lines; a click elsewhere clears it;
// 3. a drag from a label across the link selects its text and does not open it, a plain click opens it; the link's menu
//    opened with the mouse, Tab into it, Enter on its item: the keyboard goes to nothing, not to a page control;
// 4. a double click selects a word, a right click keeps it;
// 5. a drag inside the scroll over its labels selects and does not scroll; held past its bottom edge it scrolls on;
// 6. a drag on the scroll's empty space: what it does is printed (the scroll holds text, so it selects, .NET's rule).
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
    const at = (text, index) => page.evaluate(([t, i]) => window.__sel.At(t, i), [text, index]);
    const rect = (text) => page.evaluate((t) => { const s = window.__sel, l = s.Find(t), k = s.Canvas.RenderingScale, e = s.Canvas.Element.getBoundingClientRect(), r = l.GetAccessibilityPixelRect(); return { x: e.left + r.Left / k, y: e.top + r.Top / k, w: r.Width / k, h: r.Height / k }; }, text);
    const selected = () => page.evaluate(() => window.__sel.Canvas.SelectedText);
    const label = (text) => page.evaluate((t) => window.__sel.Find(t).SelectedText, text);
    const clear = async () => { await page.mouse.click(560, 690); await sleep(150); };
    const drag = async (x1, y1, x2, y2, hold = 0) => { await page.mouse.move(x1, y1); await page.mouse.down(); await page.mouse.move(x2, y2, { steps: 12 }); if (hold) await sleep(hold); await page.mouse.up(); await sleep(200); };
    const domSelected = () => page.evaluate(() => String(getSelection()));

    // the overlay takes no pointer
    const takers = await page.evaluate(() => [...document.querySelectorAll(".drawnui-a11y-overlay, .drawnui-a11y-overlay *")].filter((e) => getComputedStyle(e).pointerEvents !== "none").length);
    check(`${name}: no overlay element takes the pointer`, takers === 0, takers);

    // 1. from 3 px left of the label
    await clear();
    const a = await rect("Alpha label one"), mid = await at("Alpha label one", 8);
    await drag(a.x - 3, a.y + a.h / 2, mid.X, mid.Y);
    check(`${name}: a press 3 px left of a label and a drag over it select from its start`, (await selected()) === "Alpha la", await selected());

    // 2. across labels, the link too
    await clear();
    const c = await at("Charlie label three", 7);
    await drag(a.x + 5, a.y - 12, c.X, c.Y);
    const s2 = await selected();
    check(`${name}: a drag from above the first label to the middle of the last selects across them, the link too`, s2 === "Alpha label one\nBravo label two\nDelta link\nCharlie", s2);
    await page.evaluate(() => { window.__sel.Copied.length = 0; });
    await page.keyboard.press(process.platform === "darwin" ? "Meta+c" : "Control+c"); await sleep(100);
    const copied = await page.evaluate(() => window.__sel.Copied.at(-1));
    check(`${name}: Ctrl+C copies them joined by new lines`, copied === s2, copied);
    check(`${name}: nothing is selected in the DOM`, (await domSelected()) === "", await domSelected());
    await clear();
    check(`${name}: a click elsewhere clears it`, (await selected()) === "", await selected());

    // 3. the link
    await page.evaluate(() => { window.__sel.LinkTaps = 0; });
    const b = await at("Bravo label two", 0), dEnd = await at("Delta link", 9);
    await drag(b.X, b.Y, dEnd.X + 4, dEnd.Y);
    const tapsAfterDrag = await page.evaluate(() => window.__sel.LinkTaps);
    check(`${name}: a drag from a label across the link selects the link's text`, (await selected()).startsWith("Bravo label two\nDelta lin"), await selected());
    await clear();
    const d = await at("Delta link", 3);
    await page.mouse.click(d.X, d.Y); await sleep(300);
    const tapsAfterClick = await page.evaluate(() => window.__sel.LinkTaps);
    check(`${name}: a plain click opens the link, a drag ending on it does not`, tapsAfterDrag === 0 && tapsAfterClick === 1, `after the drag ${tapsAfterDrag}, after a click ${tapsAfterClick}`);

    // 3b. the link's menu opened with the mouse, the keyboard Tabs into it, Enter chooses its item: the menu closes and the
    //     keyboard goes to nothing (its layer is gone), never to a page control (that would scroll the page to it)
    await clear();
    await page.mouse.click(d.X, d.Y, { button: "right" }); await sleep(300);
    await page.keyboard.press("Tab"); await sleep(300);
    const inMenu = await page.evaluate(() => document.activeElement?.getAttribute("aria-label"));
    await page.keyboard.press("Enter"); await sleep(700);
    const chosen = await page.evaluate(() => ({ chosen: window.__sel.LinkMenuChosen, label: document.activeElement?.getAttribute("aria-label") ?? null, node: !!document.activeElement?.dataset?.a11yId }));
    check(`${name}: an item chosen with the keyboard in a menu opened with the mouse leaves the keyboard on nothing`, inMenu === "Copy Link" && chosen.chosen === 1 && !chosen.node, { inMenu, ...chosen });

    // 4. double click, right click
    await clear();
    const w = await at("Charlie label three", 10);
    await page.mouse.dblclick(w.X, w.Y); await sleep(200);
    check(`${name}: a double click selects the word`, (await label("Charlie label three")) === "label", await label("Charlie label three"));
    await page.mouse.click(w.X, w.Y, { button: "right" }); await sleep(200);
    await page.keyboard.press("Escape"); await sleep(100);
    check(`${name}: a right click keeps it`, (await label("Charlie label three")) === "label", await label("Charlie label three"));

    // 5. inside the scroll, over its text
    await clear();
    const l0 = await at("Scroll line 0", 0), l2 = await at("Scroll line 2", 7), top0 = (await rect("Scroll line 0")).y;
    await drag(l0.X, l0.Y, l2.X, l2.Y);
    const s5 = await selected(), moved = (await rect("Scroll line 0")).y - top0;
    check(`${name}: a drag over the scroll's text selects it and does not scroll`, s5.startsWith("Scroll line 0\nScroll line 1\nScroll ") && Math.abs(moved) < 2, { selection: s5, moved });
    await clear();
    const before = (await rect("Scroll line 0")).y;
    await drag(l0.X, l0.Y, l0.X + 40, l0.Y + 260, 1200);
    const after = (await rect("Scroll line 0")).y, s6 = await selected();
    check(`${name}: a selection drag held past the scroll's bottom scrolls it on`, after < before - 20 && s6.includes("Scroll line 9"), { moved: after - before, selection: s6.slice(-40) });

    // 6. the scroll's empty space
    await clear();
    const b0 = (await rect("Scroll line 0")).y;
    await drag(520, b0 + 60, 520, b0 - 20);
    console.log(`info ${name}: a mouse drag on the scroll's empty space moved its content ${Math.round((await rect("Scroll line 0")).y - b0)} px, selected ${JSON.stringify((await selected()).slice(0, 30))}`);
    check(`${name}: no page errors`, errors.length === 0, errors.join(" | "));
  } finally { await browser.close(); }
}

if (!only || only === "webkit") await run("webkit", webkit);
if (!only || only === "chromium") await run("chromium", chromium);
console.log(failures ? `FAIL: ${failures} checks` : "OK: text selection drawn by the label works like a web page");
process.exit(failures ? 1 : 0);
