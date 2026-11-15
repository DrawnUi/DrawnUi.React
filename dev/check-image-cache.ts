// The image cache as DrawnUi.Net's SkiaImageManager (Nick: "rust must match net ... react too"), checked in Node
// (`npm run check:image-cache`) with a fake fetch that serves PNGs made by CanvasKit and counts the requests:
// - removing an entry never deletes an image a control still holds; a control frees an image it owns (sharing off);
// - an entry expires after CacheLongevitySecs and is fetched again;
// - over the byte budget the images no control holds go, the one held longest ago first; held images never go;
// - ReuseBitmaps = false still caches one copy and hands each caller a copy of its own (GetFromCache too);
// - LoadImageAsync is a direct load that does not touch the cache;
// - keys are case-insensitive, local paths normalized; UseCache off caches nothing;
// - a failed load is retried (EnableHttpRetry) and resolves to nothing; RegisterImage aliases; IsLoadingLocked waits.
import { Super, SkiaImageManager, SkiaImage } from "../src/index.ts";

declare const CanvasKitInit: (o: { locateFile: () => string }) => Promise<any>;
const ROOT = process.cwd();
let failures = 0;
const check = (name: string, ok: boolean, detail = "") => { if (!ok) failures++; console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const CK = await CanvasKitInit({ locateFile: () => `${ROOT}/node_modules/canvaskit-wasm/bin/full/canvaskit.wasm` });
  (Super as unknown as { CK: unknown }).CK = CK;
  // a 64 x 64 PNG (16 KB of pixels decoded)
  const surface = CK.MakeSurface(64, 64);
  surface.getCanvas().clear(CK.Color(200, 40, 40, 1));
  const snapshot = surface.makeImageSnapshot();
  const png: Uint8Array = snapshot.encodeToBytes();
  snapshot.delete(); surface.delete();
  const BYTES = 64 * 64 * 4;

  const requests: string[] = [];
  let failNext = 0;
  (globalThis as { fetch: unknown }).fetch = async (url: string) => {
    requests.push(String(url));
    if (failNext > 0) { failNext--; return new Response(null, { status: 503 }); }
    if (String(url).includes("missing")) return new Response(null, { status: 404 });
    return new Response(png.slice(), { status: 200 });
  };
  const fetched = (part: string) => requests.filter((r) => r.toLowerCase().includes(part.toLowerCase())).length;
  const M = SkiaImageManager.Instance;
  const reset = () => { M.ClearCache(); requests.length = 0; SkiaImageManager.ReuseBitmaps = true; SkiaImageManager.UseCache = true; SkiaImageManager.CacheLongevitySecs = 1800; SkiaImageManager.CacheBudgetBytes = 128 << 20; };

  // 1. bugs: a removed entry is not deleted while a control holds it; it goes when the control lets it go
  reset();
  {
    const a = new SkiaImage(); a.Source = "photos/a.png";
    await sleep(30);
    const image = a.LoadedSource!;
    const removed = M.RemoveFromCache("photos/a.png");
    check("RemoveFromCache drops the entry and keeps the image a control shows", removed && !!image && !image.isDeleted() && M.GetFromCache("photos/a.png") === undefined);
    a.Source = "";
    check("the image goes once no control shows it", image.isDeleted());
    a.Source = "photos/b.png"; await sleep(30);
    const b = a.LoadedSource!;
    M.Clear();
    check("Clear() (all) keeps the image a control shows", !b.isDeleted());
    a.Dispose();
    check("disposing the control lets it go", b.isDeleted());
  }
  // 1b. sharing off: each control owns its copy and frees it
  reset();
  {
    SkiaImageManager.ReuseBitmaps = false;
    const a = new SkiaImage(), b = new SkiaImage();
    a.Source = "photos/c.png"; b.Source = "photos/c.png";
    await sleep(30);
    const ia = a.LoadedSource!, ib = b.LoadedSource!;
    check("ReuseBitmaps off: one fetch, one cached copy, a copy of its own for each control", fetched("c.png") === 1 && !!ia && !!ib && ia !== ib && !!M.GetFromCache("photos/c.png") && M.GetFromCache("photos/c.png") !== ia,
      `${fetched("c.png")} fetch(es)`);
    a.Source = "";
    check("a control frees the copy it owns, the other copy stays", ia.isDeleted() && !ib.isDeleted());
    b.Dispose();
    check("disposing frees the other", ib.isDeleted());
    const second = new SkiaImage(); second.Source = "photos/c.png"; await sleep(30);
    check("a later control gets a copy from the cache, no new fetch", fetched("c.png") === 1 && !!second.LoadedSource);
    second.Dispose();
  }
  // 2. expiry
  reset();
  {
    SkiaImageManager.CacheLongevitySecs = 0.05;
    await M.PreloadImage("photos/e.png");
    const first = M.GetFromCache("photos/e.png");
    await sleep(80);
    const expired = M.GetFromCache("photos/e.png");
    await M.PreloadImage("photos/e.png");
    check("an entry expires after CacheLongevitySecs and is fetched again", !!first && expired === undefined && fetched("e.png") === 2, `${fetched("e.png")} fetches`);
  }
  // 3. budget: room for 4 images; 5 loaded, 2 held by controls; image 3 read again after 4 came, so 4 was used longest ago
  reset();
  {
    SkiaImageManager.CacheBudgetBytes = BYTES * 4;
    const held = [new SkiaImage(), new SkiaImage()];
    held[0].Source = "b/1.png"; held[1].Source = "b/2.png";
    await sleep(30);
    for (const s of ["b/3.png", "b/4.png"]) await M.PreloadImage(s);
    const four = M.GetFromCacheInternal("b/4.png");
    M.GetFromCache("b/3.png");
    await M.PreloadImage("b/5.png");
    const kept = ["b/1.png", "b/2.png", "b/3.png", "b/4.png", "b/5.png"].map((s) => (M.GetFromCacheInternal(s) ? 1 : 0)).join("");
    check("over the budget the image used longest ago goes first, held ones never", kept === "11101" && !!four && four.isDeleted() && M.MemoryBytes <= BYTES * 4,
      `kept ${kept}, ${M.MemoryBytes / BYTES} images of bytes`);
    for (const c of held) c.Dispose();
    SkiaImageManager.CacheBudgetBytes = BYTES;
    M.Trim();
    check("a smaller budget trims what no control holds any more", M.MemoryBytes <= BYTES, `${M.MemoryBytes / BYTES} images of bytes`);
  }
  // 4. direct load, keys, UseCache
  reset();
  {
    const direct = await M.LoadImageAsync("photos/d.png");
    await M.LoadImageAsync("photos/d.png");
    check("LoadImageAsync is a direct load: not cached, fetched every time", !!direct && M.GetFromCache("photos/d.png") === undefined && fetched("d.png") === 2);
    direct?.delete();
    await M.PreloadImage("Images\\Key.png");
    await M.PreloadImage("/images/key.PNG");
    check("keys are case-insensitive, backslashes and a leading slash normalized", fetched("key.png") === 1 && !!M.GetFromCache("images/key.png"));
    SkiaImageManager.UseCache = false;
    await M.PreloadImage("photos/u.png"); await M.PreloadImage("photos/u.png");
    check("UseCache off: nothing cached, every load fetches", fetched("u.png") === 2 && M.GetFromCache("photos/u.png") === undefined);
  }
  // 5. failures, retry, aliases, lock
  reset();
  {
    let reload = 0;
    M.CanReload = () => { reload++; };
    failNext = 2;
    const retried = await M.LoadImageManagedAsync("photos/r.png");
    check("a failed load is retried (EnableHttpRetry)", !!retried && fetched("r.png") === 3, `${fetched("r.png")} fetches`);
    SkiaImageManager.EnableHttpRetry = false;
    const missing = await M.LoadImageManagedAsync("photos/missing.png");
    check("a load that fails resolves to nothing (as .NET's null) and raises CanReload", missing === undefined && reload >= 1 && fetched("missing") === 1);
    SkiaImageManager.EnableHttpRetry = true;
    M.RegisterImage("logo", "art/logo-final.png");
    await M.PreloadImage("logo");
    check("RegisterImage: an alias loads its file", fetched("logo-final.png") === 1 && !!M.GetFromCache("logo"));
    M.IsLoadingLocked = true;
    let done = false;
    const waiting = M.LoadImageManagedAsync("photos/locked.png").then(() => { done = true; });
    await sleep(40);
    const whileLocked = done || fetched("locked.png") > 0;
    M.IsLoadingLocked = false;
    await waiting;
    check("IsLoadingLocked: loads wait until it is unlocked", !whileLocked && done);
    M.CanReload = undefined;
  }

  console.log(failures ? `FAIL: ${failures} checks` : "OK: the image cache behaves as DrawnUi.Net's");
  process.exit(failures ? 1 : 0);
})();
