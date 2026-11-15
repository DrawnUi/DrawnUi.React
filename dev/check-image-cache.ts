// The image cache as DrawnUi.Net's SkiaImageManager (Nick: "rust must match net ... react too"), checked in Node
// (`npm run check:image-cache`) with a fake fetch that serves PNGs made by CanvasKit and counts the requests:
// - removing an entry never deletes an image a control still holds; a control frees an image it owns (sharing off);
// - an entry expires after CacheLongevitySecs and is fetched again;
// - over the byte budget the images no control holds go, the one held longest ago first; held images never go;
// - ReuseBitmaps = false still caches one copy and hands each caller a copy of its own (GetFromCache too);
// - LoadImageAsync is a direct load that does not touch the cache;
// - keys are case-insensitive, local paths normalized; UseCache off caches nothing;
// - a failed load is retried (EnableHttpRetry) and resolves to nothing; RegisterImage aliases; IsLoadingLocked waits;
// - cancels as the DrawnUi.Net Blazor head: a cached load whose caller cancels rejects with an AbortError (C# throws
//   OperationCanceledException from WaitAsync), also while loading is locked; with UseCache off it resolves to nothing;
//   CancelAll resolves the waiting loads to nothing; CanReload is raised only when IsLoadingLocked turns off, with no
//   arguments, never for a failed load.
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
  (globalThis as { fetch: unknown }).fetch = async (url: string, init?: { signal?: AbortSignal }) => {
    requests.push(String(url));
    if (String(url).includes("slow")) {
      // a load that takes 150 ms and stops when its signal aborts
      await new Promise<void>((done, fail) => {
        const t = setTimeout(done, 150);
        init?.signal?.addEventListener("abort", () => { clearTimeout(t); fail(new DOMException("aborted", "AbortError")); });
      });
    }
    if (failNext > 0) { failNext--; return new Response(null, { status: 503 }); }
    if (String(url).includes("missing")) return new Response(null, { status: 404 });
    return new Response(png.slice(), { status: 200 });
  };
  const fetched = (part: string) => requests.filter((r) => r.toLowerCase().includes(part.toLowerCase())).length;
  const M = SkiaImageManager.Instance;
  const reset = () => { M.ClearCache(); requests.length = 0; SkiaImageManager.ReuseBitmaps = true; SkiaImageManager.UseCache = true; SkiaImageManager.CacheLongevitySecs = 1800; SkiaImageManager.CacheBudgetMb = 128; };

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
    SkiaImageManager.CacheBudgetMb = (BYTES * 4) / (1 << 20);
    const held = [new SkiaImage(), new SkiaImage()];
    held[0].Source = "b/1.png"; held[1].Source = "b/2.png";
    await sleep(30);
    for (const s of ["b/3.png", "b/4.png"]) await M.PreloadImage(s);
    const four = M.GetFromCacheInternal("b/4.png");
    M.GetFromCache("b/3.png");
    await M.PreloadImage("b/5.png");
    const kept = ["b/1.png", "b/2.png", "b/3.png", "b/4.png", "b/5.png"].map((s) => (M.GetFromCacheInternal(s) ? 1 : 0)).join("");
    check("over the budget the image used longest ago goes first, held ones never", kept === "11101" && !!four && four.isDeleted() && M.CacheMemoryMb * (1 << 20) <= BYTES * 4,
      `kept ${kept}, ${(M.CacheMemoryMb * (1 << 20)) / BYTES} images of bytes`);
    for (const c of held) c.Dispose();
    SkiaImageManager.CacheBudgetMb = BYTES / (1 << 20);
    M.Trim();
    check("a smaller budget trims what no control holds any more", M.CacheMemoryMb * (1 << 20) <= BYTES, `${(M.CacheMemoryMb * (1 << 20)) / BYTES} images of bytes`);
  }
  // 3b. CacheBudgetMb 0 or less: no limit
  reset();
  {
    SkiaImageManager.CacheBudgetMb = 0;
    for (const s of ["n/1.png", "n/2.png", "n/3.png"]) await M.PreloadImage(s);
    check("CacheBudgetMb 0: no limit, nothing dropped", ["n/1.png", "n/2.png", "n/3.png"].every((s) => !!M.GetFromCacheInternal(s)) && Math.abs(M.CacheMemoryMb - (3 * BYTES) / (1 << 20)) < 1e-9);
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
    check("a load that fails resolves to nothing (as .NET's null) and raises no CanReload (Blazor)", missing === undefined && reload === 0 && fetched("missing") === 1, `CanReload raised ${reload} times`);
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
    check("unlocking raises CanReload, with no arguments (Blazor)", reload === 1);
    M.CanReload = undefined;
  }
  // 6. cancels as the Blazor head
  reset();
  {
    const outcome = (p: Promise<unknown>) => p.then((v) => (v === undefined ? "nothing" : "image"), (e) => (e instanceof Error || e instanceof DOMException) && (e as Error).name === "AbortError" ? "AbortError" : `error ${e}`);
    let reload = 0;
    M.CanReload = (...a: unknown[]) => { reload++; if (a.length) reload += 100; };
    // in flight, the caller cancels
    const c1 = new AbortController();
    const inflight = outcome(M.LoadImageManagedAsync("photos/slow1.png", c1.signal));
    await sleep(30); c1.abort();
    check("a cached load the caller cancels while it runs rejects with an AbortError", (await inflight) === "AbortError", await inflight);
    // waiting in the queue behind full slots, the caller cancels
    const busy = Array.from({ length: SkiaImageManager.MaxParallelLoads }, (_, i) => M.LoadImageManagedAsync(`photos/slow-busy${i}.png`));
    const c2 = new AbortController();
    const queued = outcome(M.LoadImageManagedAsync("photos/queued.png", c2.signal));
    await sleep(10); c2.abort();
    check("a cached load the caller cancels while it waits rejects with an AbortError", (await queued) === "AbortError", await queued);
    await Promise.all(busy);
    // already cancelled
    const c3 = new AbortController(); c3.abort();
    check("a cached load asked with a cancelled signal rejects with an AbortError", (await outcome(M.LoadImageManagedAsync("photos/pre.png", c3.signal))) === "AbortError");
    // locked, the caller cancels
    M.IsLoadingLocked = true;
    const c4 = new AbortController();
    const locked = outcome(M.LoadImageManagedAsync("photos/locked2.png", c4.signal));
    await sleep(10); c4.abort();
    check("a load waiting for IsLoadingLocked that the caller cancels rejects with an AbortError", (await locked) === "AbortError", await locked);
    M.IsLoadingLocked = false;
    reload = 0;
    // UseCache off: a cancel resolves to nothing
    SkiaImageManager.UseCache = false;
    const c5 = new AbortController();
    const nocache = outcome(M.LoadImageManagedAsync("photos/slow5.png", c5.signal));
    await sleep(30); c5.abort();
    check("UseCache off: a load the caller cancels resolves to nothing", (await nocache) === "nothing", await nocache);
    SkiaImageManager.UseCache = true;
    // CancelAll: the waiting loads resolve to nothing
    const busy2 = Array.from({ length: SkiaImageManager.MaxParallelLoads }, (_, i) => M.LoadImageManagedAsync(`photos/slow-b2${i}.png`));
    const dropped = outcome(M.LoadImageManagedAsync("photos/dropped.png"));
    await sleep(10); M.CancelAll();
    check("CancelAll: a waiting load resolves to nothing", (await dropped) === "nothing", await dropped);
    await Promise.all(busy2);
    check("no CanReload for cancels", reload === 0, `${reload}`);
    M.CanReload = undefined;
  }

  console.log(failures ? `FAIL: ${failures} checks` : "OK: the image cache behaves as DrawnUi.Net's");
  process.exit(failures ? 1 : 0);
})();
