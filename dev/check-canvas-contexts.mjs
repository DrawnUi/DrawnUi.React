// GPU objects never outlive their WebGL context unnoticed (as DrawnUi.Net Cells 81b89f1a), checked in Playwright's WebKit
// against a running dev server (`node dev/check-canvas-contexts.mjs [base url]`, default http://localhost:5173, the demo
// served by `npm run dev`): a control keeps its GPU, Image and Operations caches, its canvas goes, the control is shown
// on a new canvas, then disposed. Every cache made on the first canvas's context is made again on the second (a texture
// of another WebGL context draws nothing), nothing throws, and the console stays clean.
import { createRequire } from "node:module";

const { webkit } = createRequire(import.meta.url)("playwright-core");
const base = (process.argv[2] ?? "http://localhost:5173").replace(/\/$/, "");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (name, ok, detail = "") => { if (!ok) failures++; console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`); };

const browser = await webkit.launch();
try {
  const page = await (await browser.newContext({ viewport: { width: 400, height: 400 } })).newPage();
  const logs = [];
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") logs.push(`${m.type()}: ${m.text().slice(0, 160)}`); });
  page.on("pageerror", (e) => logs.push(`pageerror: ${String(e).slice(0, 160)}`));
  await page.goto(`${base}/?r=home#/home`);
  await sleep(3000);
  const out = await page.evaluate(async (src) => {
    const m = await import(src);
    const make = () => { const el = document.createElement("canvas"); el.style.cssText = "position:fixed;left:0;top:0;width:200px;height:200px;z-index:9999"; document.body.appendChild(el); return el; };
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const red = (canvas, el) => {
      canvas.DrawNow();
      const gl = el.getContext("webgl2") ?? el.getContext("webgl");
      const p = new Uint8Array(4);
      gl.readPixels(20, el.height - 20, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, p);
      return p[0] > 200 && p[3] > 200;
    };
    const results = {};
    for (const cache of ["GPU", "Image", "Operations"]) {
      const shape = new m.SkiaShape();
      shape.WidthRequest = 100; shape.HeightRequest = 100; shape.BackgroundColor = "#FF0000"; shape.UseCache = cache;
      const el1 = make();
      const c1 = new m.Canvas(el1); c1.RenderingMode = "Accelerated";
      c1.Content = shape; c1.Update();
      await wait(300);
      const first = red(c1, el1);
      c1.Content = undefined; // the app keeps the control; its canvas goes
      c1.Dispose(); el1.remove();
      const el2 = make();
      const c2 = new m.Canvas(el2); c2.RenderingMode = "Accelerated";
      c2.Content = shape; c2.Update();
      await wait(300);
      const second = red(c2, el2);
      let thrown = "";
      try { c2.Content = undefined; shape.Dispose(); c2.Dispose(); } catch (e) { thrown = String(e).slice(0, 160); }
      el2.remove();
      results[cache] = { first, second, thrown };
    }
    return results;
  }, `${base}/@fs/${process.cwd().replace(/\\/g, "/")}/src/index.ts`);
  for (const [cache, r] of Object.entries(out)) {
    check(`${cache} cache: drawn on its canvas, drawn again on a new canvas after the first went, disposed without errors`, r.first && r.second && !r.thrown,
      `first ${r.first}, on the new canvas ${r.second}${r.thrown ? `, threw ${r.thrown}` : ""}`);
  }
  check("console clean", logs.length === 0, logs.join(" | "));
} finally {
  await browser.close();
}
console.log(failures ? `FAIL: ${failures} checks` : "OK: GPU caches follow their canvas's WebGL context");
process.exit(failures ? 1 : 0);
