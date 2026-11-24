// A shrunk tile keeps its thin lines in the browser (WebGL), checked in Playwright's Chromium (real GPU) and WebKit against
// a running dev server (`node dev/check-tiles-thin-lines.mjs [base url]`, default http://localhost:5173): the fixture
// dev/fixtures/TilesFixture.tsx draws a 512 px pattern with 2 px lines every 32 px as 64 px tiles. Every 4 px period of
// the result holds the same darkness (the mipmapped area average), as the plain SkiaImage shrunk beside it does.
import { createRequire } from "node:module";
const { chromium, webkit } = createRequire(import.meta.url)("playwright-core");
const base = (process.argv[2] ?? "http://localhost:5173").replace(/\/$/, "");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (name, ok, detail = "") => { if (!ok) failures++; console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`); };

for (const [name, type, args] of [["chromium", chromium, ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"]], ["webkit", webkit, []]]) {
  const browser = await type.launch({ args });
  try {
    const page = await (await browser.newContext({ viewport: { width: 800, height: 600 }, deviceScaleFactor: 1 })).newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));
    await page.goto(`${base}/?r=shapes#/shapes`); await sleep(3000);
    await page.evaluate(async (src) => { (await import(src)).Mount(); }, `${base}/@fs/${process.cwd().replace(/\\/g, "/")}/dev/fixtures/TilesFixture.tsx?v=${Date.now()}`);
    await sleep(2500);
    // the middle row of the screenshot, decoded by the page itself (a WebGL canvas cannot be read back)
    const shot = (await page.screenshot({ clip: { x: 0, y: 0, width: 256, height: 64 } })).toString("base64");
    const row = await page.evaluate(async (b64) => {
      const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode();
      const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
      const g = c.getContext("2d"); g.drawImage(img, 0, 0);
      return Array.from(g.getImageData(0, 32, img.width, 1).data);
    }, shot);
    const dark = (x) => 255 - row[x * 4];
    const periods = (from, to) => { const s = []; for (let x = from; x < to; x += 4) s.push(dark(x) + dark(x + 1) + dark(x + 2) + dark(x + 3)); return s; };
    const tiles = periods(0, 128), plain = periods(160, 224);
    const spread = (a) => Math.max(...a) - Math.min(...a);
    check(`${name}: every thin line keeps its weight in the shrunk tiles`, Math.min(...tiles) > 40 && spread(tiles) <= 12, `tiles ${Math.min(...tiles)}..${Math.max(...tiles)}, plain ${Math.min(...plain)}..${Math.max(...plain)}`);
    check(`${name}: the tiles match the plain shrunk image`, Math.abs(tiles[0] - plain[0]) <= 12, `${tiles[0]} vs ${plain[0]}`);
    check(`${name}: no page errors`, errors.length === 0, errors.join(" | "));
  } finally { await browser.close(); }
}
console.log(failures ? `FAIL: ${failures} checks` : "OK: a shrunk tile keeps its thin lines in the browser");
process.exit(failures ? 1 : 0);
