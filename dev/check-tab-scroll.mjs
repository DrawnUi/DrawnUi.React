// Tab and Shift+Tab reach every control of a scroll, also those outside its viewport, and bring each into view (DrawnUi.Net
// ac70a1d9), checked with the real Tab key in Playwright's WebKit and Chromium against a running dev server
// (`node dev/check-tab-scroll.mjs [base url] [webkit|chromium]`, default http://localhost:5173), dev/fixtures/TabFixture.tsx
// mounted over the demo: (1) 30 buttons in a 280 pt scroll between a header and a footer, (2) 200 recycled cells,
// (3) three 600 pt cards (image cache, operations cache, none) with a button at the top and at the bottom.
import { createRequire } from "node:module";
const { webkit, chromium } = createRequire(import.meta.url)("playwright-core");
const base = (process.argv[2] ?? "http://localhost:5173").replace(/\/$/, "");
const only = process.argv[3];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (name, ok, detail = "") => { if (!ok) failures++; console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`); };
const range = (n, f) => Array.from({ length: n }, (_, i) => f(i));

async function walk(page, keys, steps) {
  const seen = [];
  const now = () => page.evaluate(() => {
      const a = document.activeElement, s = window.__tabScroll;
      const label = a?.getAttribute?.("aria-label") ?? a?.tagName ?? "none";
      if (!s || !a?.getBoundingClientRect) return { label };
      const host = document.querySelector("canvas[data-tab]") ?? [...document.querySelectorAll("canvas")].pop();
      const b = host.getBoundingClientRect(), k = s.RenderingScale, d = s.DrawingRect, r = a.getBoundingClientRect();
      const top = b.top + d.Top / k, bottom = b.top + d.Bottom / k;
      return { label, inView: r.top >= top - 1 && r.bottom <= bottom + 1, inScroll: /^(Item|Top|Bottom)/.test(label) };
    });
  // each key, then until the focus moved and its item is in view (2 s at most): what it settles on is recorded
  let previous = (await now()).label;
  for (let i = 0; i < steps; i++) {
    await page.keyboard.press(keys);
    let s;
    for (const start = Date.now(); Date.now() - start < 2000;) {
      await sleep(80);
      s = await now();
      if (s.label !== previous && (!s.inScroll || s.inView)) break;
    }
    seen.push(s); previous = s.label;
  }
  return seen;
}

async function run(name, type) {
  const browser = await type.launch();
  try {
    for (const mode of ["plain", "recycled", "cards"]) {
      const page = await (await browser.newContext({ viewport: { width: 900, height: 800 } })).newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));
      await page.goto(`${base}/?r=shapes#/shapes`); await sleep(2500);
      await page.evaluate(async ([src, m]) => { (await import(src)).Mount(m); }, [`${base}/@fs/${process.cwd().replace(/\\/g, "/")}/dev/fixtures/TabFixture.tsx`, mode]);
      await sleep(2500);
      // start from the fixture's Back button
      await page.evaluate(() => [...document.querySelectorAll("[aria-label]")].filter((e) => e.getAttribute("aria-label") === "Back").pop()?.focus());
      await sleep(300);
      const inner = mode === "plain" ? range(30, (i) => `Item ${i}`) : mode === "recycled" ? range(200, (i) => `Item ${i}`) : range(3, (i) => [`Top ${i}`, `Bottom ${i}`]).flat();
      const expected = ["Home", ...inner, "Footer"];
      const forward = await walk(page, "Tab", expected.length);
      const got = forward.map((s) => s.label);
      const firstWrong = expected.findIndex((e, i) => got[i] !== e);
      check(`${name} ${mode}: Tab walks Back, Home, ${inner[0]}..${inner[inner.length - 1]}, Footer`, firstWrong < 0, firstWrong < 0 ? "" : `at ${firstWrong} expected ${expected[firstWrong]}, got ${got.slice(Math.max(0, firstWrong - 1), firstWrong + 3).join(", ")}`);
      const outOfView = forward.filter((s) => s.inScroll && !s.inView).map((s) => s.label);
      check(`${name} ${mode}: each focused item is inside the scroll's viewport`, outOfView.length === 0, outOfView.slice(0, 5).join(", "));
      const back = await walk(page, "Shift+Tab", expected.length);
      const gotBack = back.map((s) => s.label), expBack = [...expected].reverse().slice(1).concat("Back");
      const wrongBack = expBack.findIndex((e, i) => gotBack[i] !== e);
      check(`${name} ${mode}: Shift+Tab walks back to Back`, wrongBack < 0, wrongBack < 0 ? "" : `at ${wrongBack} expected ${expBack[wrongBack]}, got ${gotBack.slice(Math.max(0, wrongBack - 1), wrongBack + 3).join(", ")}`);
      check(`${name} ${mode}: no page errors`, errors.length === 0, errors.join(" | "));
      await page.close();
    }
  } finally { await browser.close(); }
}

if (!only || only === "webkit") await run("webkit", webkit);
if (!only || only === "chromium") await run("chromium", chromium);
console.log(failures ? `FAIL: ${failures} checks` : "OK: Tab reaches every control of a scroll");
process.exit(failures ? 1 : 0);
