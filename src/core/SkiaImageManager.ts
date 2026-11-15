import type { Image } from "canvaskit-wasm";
import { Super } from "./Super";

/** C# LoadPriority: order of the managed load queue. */
export type LoadPriority = "Low" | "Normal" | "High";

interface QueueItem { key: string; source: string; priority: LoadPriority; signal?: AbortSignal; resolve: (i: Image | undefined) => void }

const PRIORITY_RANK: Record<LoadPriority, number> = { High: 0, Normal: 1, Low: 2 };

/** A decoded image the manager made: in the cache or not, and how many holders (controls) draw it. */
interface Entry {
  Image: Image;
  Key: string;
  Bytes: number;
  /** In the cache (the cache's own reference). */
  Cached: boolean;
  /** performance.now() after which the cache drops it. */
  Expires: number;
  /** When it was last handed out or let go: the budget drops the one held longest ago first. */
  Shown: number;
  /** Controls (and other holders) drawing it: while above 0 it is never deleted. */
  Holders: number;
}

/**
 * Mirrors DrawnUi SkiaImageManager (DrawnUi.Net): loads and decodes image sources, keeps the decoded images in a cache
 * by source for `CacheLongevitySecs`, and shares one decoded image between every control on the same source
 * (`ReuseBitmaps`; off, each caller gets a copy of its own of the one cached copy). `LoadImageManagedAsync` caches and
 * goes through the priority queue (High > Normal > Low, at most `MaxParallelLoads` fetches in flight; the same source
 * requested twice is fetched once); `LoadImageAsync` is a direct load that does not touch the cache. The cache keeps
 * at most `CacheBudgetMb` megabytes of decoded pixels: over it, images no control holds go, the one held longest ago first
 * (as DrawnUI for Rust's image cache); images a control holds never go. Keys are case-insensitive and local paths
 * normalized (backslashes, a leading slash). Sources are URLs (absolute, or relative to the page like
 * "images/photo.jpg").
 *
 * Ownership: CanvasKit images must be deleted by hand. The manager deletes an image it made once no holder draws it
 * and the cache no longer keeps it; a control holds the image it shows (`Hold`) and lets it go (`Free`). Removing an
 * entry from the cache (`RemoveFromCache`, `ClearCache`, expiry, the budget) never deletes an image a control holds.
 */
export class SkiaImageManager {
  static readonly Instance = new SkiaImageManager();

  /** Share one decoded image between every control on the same source (DrawnUi ReuseBitmaps, on by default). */
  static ReuseBitmaps = true;
  /** Use the cache at all (DrawnUi UseCache): off, every load fetches and decodes again. */
  static UseCache = true;
  /** Seconds a cached image is kept before the next load fetches it again (DrawnUi, 30 minutes). */
  static CacheLongevitySecs = 1800;
  /**
   * Most megabytes of decoded pixels the cache keeps (DrawnUi CacheBudgetMb, 128 as DrawnUI for Rust; 0 or less = no
   * limit). Images a control holds never go for it.
   */
  static CacheBudgetMb = 128;
  /** Fetches in flight at once through the managed queue (C# CreateSemaphoreForLocalFiles: 5). */
  static MaxParallelLoads = 5;
  /** Retry a failed load (DrawnUi EnableHttpRetry): up to HttpRetryMaxAttempts more times, 100, 200, 400 ms apart. */
  static EnableHttpRetry = true;
  static HttpRetryMaxAttempts = 3;
  /** Base address of relative sources (DrawnUi HttpBaseAddress); unset, they resolve against the page. */
  static HttpBaseAddress?: string;

  /**
   * C# CanReload: raised when a load failed (with its source and why) so the caller may retry later, and when
   * `IsLoadingLocked` is turned off (no arguments).
   */
  CanReload?: (source?: string, error?: Error) => void;

  private readonly cache = new Map<string, Entry>();
  /** Every image the manager made and still tracks: cached ones and the copies it handed out. */
  private readonly owned = new Map<Image, Entry>();
  private readonly inflight = new Map<string, Promise<Image | undefined>>();
  private readonly queue: QueueItem[] = [];
  private readonly waiting = new Map<string, QueueItem[]>();
  private readonly registered = new Map<string, string>();
  private running = 0;
  private used = 0;
  private tick = 0;
  private locked = false;
  private unlocked: Promise<void> = Promise.resolve();
  private unlock?: () => void;

  /** Queue diagnostics. */
  get QueuedCount(): number { return this.queue.length; }
  get RunningCount(): number { return this.running; }
  /** Megabytes of decoded pixels the cache holds now (DrawnUi CacheMemoryMb). */
  get CacheMemoryMb(): number { return this.used / (1 << 20); }
  /** The browser says it has no network. */
  get IsOffline(): boolean { return typeof navigator !== "undefined" && navigator.onLine === false; }

  /** While true, managed loads wait (DrawnUi IsLoadingLocked); turning it off lets them go and raises CanReload. */
  get IsLoadingLocked(): boolean { return this.locked; }
  set IsLoadingLocked(value: boolean) {
    if (this.locked === value) return;
    this.locked = value;
    if (value) this.unlocked = new Promise((r) => { this.unlock = r; });
    else { this.unlock?.(); this.unlock = undefined; this.CanReload?.(); }
  }

  /** Registers a source under a name of its own (DrawnUi RegisterImage): loading `alias` loads `source`. */
  RegisterImage(alias: string, source?: string): void {
    if (!alias) throw new Error("Image source URL cannot be empty.");
    this.registered.set(SkiaImageManager.Key(alias), source ?? alias);
  }

  /** Cache key: case-insensitive, a local path with forward slashes and no leading slash (DrawnUi GetCacheKey). */
  static Key(source: string): string {
    if (!source || source.includes("://")) return source.toLowerCase();
    let key = source.replace(/\\/g, "/");
    if (key.startsWith("/") && !key.startsWith("//")) key = key.replace(/^\/+/, "");
    return key.toLowerCase();
  }

  // ---- holders ----

  /** A holder (a control) draws this image now: it is not deleted until let go. Images the manager did not make are ignored. */
  Hold(image: Image | undefined): void {
    const entry = image && this.owned.get(image);
    if (entry) { entry.Holders++; entry.Shown = ++this.tick; }
  }

  /** The holder no longer draws it: an image no holder draws and the cache does not keep is deleted. */
  Free(image: Image | undefined): void {
    const entry = image && this.owned.get(image);
    if (!entry) return;
    entry.Holders = Math.max(0, entry.Holders - 1);
    entry.Shown = ++this.tick;
    this.Forget(entry);
  }

  /** Deletes an image nobody keeps any more. */
  private Forget(entry: Entry): void {
    if (entry.Holders > 0 || entry.Cached) return;
    this.owned.delete(entry.Image);
    if (!entry.Image.isDeleted()) entry.Image.delete();
  }

  private Track(image: Image, key: string): Entry {
    let entry = this.owned.get(image);
    if (!entry) {
      entry = { Image: image, Key: key, Bytes: image.width() * image.height() * 4, Cached: false, Expires: 0, Shown: ++this.tick, Holders: 0 };
      this.owned.set(image, entry);
    }
    return entry;
  }

  /** A copy of an image of its own (ReuseBitmaps off), tracked so its holder frees it. */
  private Copy(image: Image, key: string): Image | undefined {
    const CK = Super.CK;
    const info = { width: image.width(), height: image.height(), colorType: CK.ColorType.RGBA_8888, alphaType: CK.AlphaType.Premul, colorSpace: CK.ColorSpace.SRGB };
    const pixels = image.readPixels(0, 0, info);
    const copy = pixels instanceof Uint8Array ? CK.MakeImage(info, pixels, info.width * 4) : null;
    if (!copy) return undefined;
    this.Track(copy, key);
    return copy;
  }

  /** What a caller gets of a cached image: the shared one, or a copy of its own (ReuseBitmaps off). */
  private HandOut(image: Image | undefined, key: string): Image | undefined {
    if (!image) return undefined;
    return SkiaImageManager.ReuseBitmaps ? image : this.Copy(image, key);
  }

  // ---- the cache ----

  /** Puts an image in the cache for `cacheLongevitySecs` (DrawnUi AddToCache); false when cached already or caching is off. */
  AddToCache(uri: string, image: Image, cacheLongevitySecs = SkiaImageManager.CacheLongevitySecs): boolean {
    if (!SkiaImageManager.UseCache || !uri || !image) return false;
    const key = SkiaImageManager.Key(uri);
    this.CleanupExpired(key);
    if (this.cache.has(key)) return false;
    const entry = this.Track(image, key);
    entry.Cached = true;
    entry.Expires = performance.now() + cacheLongevitySecs * 1000;
    entry.Shown = ++this.tick;
    this.cache.set(key, entry);
    this.used += entry.Bytes;
    this.Trim();
    return true;
  }

  /** Replaces the cached image of a source (DrawnUi UpdateInCache, minutes as .NET). */
  UpdateInCache(uri: string, image: Image, cacheLongevityMinutes: number): void {
    this.RemoveFromCache(uri);
    this.AddToCache(uri, image, cacheLongevityMinutes * 60);
  }

  /** Drops the image from the cache, so the next load reads it again (DrawnUi RemoveFromCache); false when it was not cached. */
  RemoveFromCache(uri: string): boolean {
    if (!uri) return false;
    const entry = this.cache.get(SkiaImageManager.Key(uri));
    if (!entry) return false;
    this.Drop(entry);
    return true;
  }

  /** Drops every cached image; images controls still show stay until they let them go. */
  ClearCache(): void { for (const entry of [...this.cache.values()]) this.Drop(entry); }

  /** RemoveFromCache(source) or ClearCache(). */
  Clear(source?: string): void { if (source) this.RemoveFromCache(source); else this.ClearCache(); }

  private Drop(entry: Entry): void {
    if (!entry.Cached) return;
    this.cache.delete(entry.Key);
    this.used -= entry.Bytes;
    entry.Cached = false;
    this.Forget(entry);
  }

  private CleanupExpired(key: string): void {
    const entry = this.cache.get(key);
    if (entry && entry.Expires <= performance.now()) this.Drop(entry);
  }

  /** Over the budget: the cached images no holder draws go, the one held longest ago first (DrawnUI for Rust trim). */
  Trim(): void {
    const budget = SkiaImageManager.CacheBudgetMb * (1 << 20);
    if (SkiaImageManager.CacheBudgetMb <= 0 || this.used <= budget) return;
    const idle = [...this.cache.values()].filter((e) => e.Holders === 0).sort((a, b) => a.Shown - b.Shown);
    for (const entry of idle) {
      if (this.used <= budget) break;
      this.Drop(entry);
    }
  }

  /** The cached image of a source, or undefined (DrawnUi GetFromCache): the shared one, or a copy (ReuseBitmaps off). */
  GetFromCache(url: string): Image | undefined {
    return this.HandOut(this.GetFromCacheInternal(url), SkiaImageManager.Key(url));
  }

  /** The cached image itself, whatever ReuseBitmaps says (DrawnUi GetFromCacheInternal). */
  GetFromCacheInternal(url: string): Image | undefined {
    if (!SkiaImageManager.UseCache || !url) return undefined;
    const key = SkiaImageManager.Key(url);
    this.CleanupExpired(key);
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    entry.Shown = ++this.tick;
    return entry.Image;
  }

  // ---- loading ----

  /** The address a source is fetched from: its registered file, against HttpBaseAddress, stamped (Super.ResolveAssetUrl). */
  private Address(source: string): string {
    const file = this.registered.get(SkiaImageManager.Key(source)) ?? source;
    const base = SkiaImageManager.HttpBaseAddress;
    return Super.ResolveAssetUrl(base && !file.includes("://") ? new URL(file, base).href : file);
  }

  /** Fetches and decodes a source, retried when it fails (EnableHttpRetry); undefined when it could not be loaded. */
  private async Fetch(source: string, signal?: AbortSignal): Promise<{ Image?: Image; Error?: Error }> {
    const attempts = SkiaImageManager.EnableHttpRetry ? SkiaImageManager.HttpRetryMaxAttempts : 0;
    let error: Error | undefined;
    for (let attempt = 0; attempt <= attempts; attempt++) {
      if (signal?.aborted) return { Error: new Error("DrawnUi: image load cancelled") };
      try {
        const response = await fetch(this.Address(source), signal ? { signal } : undefined);
        if (!response.ok) error = new Error(`DrawnUi: ${response.status} loading image '${source}'`);
        else {
          const image = Super.CK.MakeImageFromEncoded(await response.arrayBuffer());
          if (image) return { Image: image };
          error = new Error(`DrawnUi: cannot decode image '${source}'`);
        }
      } catch (e) {
        if (signal?.aborted) return { Error: new Error("DrawnUi: image load cancelled") };
        error = e instanceof Error ? e : new Error(String(e));
      }
      if (attempt < attempts) await new Promise((r) => setTimeout(r, 2 ** attempt * 100));
    }
    return { Error: error };
  }

  /**
   * Direct load without the queue and the cache (C# LoadImageAsync): a new image the caller owns (delete it, or hand it
   * to a control that holds it); undefined when it could not be loaded.
   */
  async LoadImageAsync(source: string, signal?: AbortSignal): Promise<Image | undefined> {
    const { Image: image } = await this.Fetch(source, signal);
    if (image) this.Track(image, SkiaImageManager.Key(source));
    return image;
  }

  /**
   * Queued, cached load (C# LoadImageManagedAsync): a cached image resolves at once, the rest wait their turn by priority;
   * one fetch serves every request of the same source. Resolves to the shared image (ReuseBitmaps) or a copy of its own,
   * undefined when it could not be loaded (CanReload hears why).
   */
  async LoadImageManagedAsync(source: string, signal?: AbortSignal, priority: LoadPriority = "Normal"): Promise<Image | undefined> {
    if (!source) return undefined;
    while (this.locked) await this.unlocked;
    const key = SkiaImageManager.Key(source);
    if (!SkiaImageManager.UseCache) return this.Enqueue(key, source, priority, signal, false);
    const cached = this.GetFromCacheInternal(key);
    if (cached) return this.HandOut(cached, key);
    let task = this.inflight.get(key);
    if (!task) {
      task = this.Enqueue(key, source, priority, signal, true);
      this.inflight.set(key, task);
      void task.finally(() => this.inflight.delete(key));
    }
    return this.HandOut(await task, key);
  }

  private Enqueue(key: string, source: string, priority: LoadPriority, signal: AbortSignal | undefined, cache: boolean): Promise<Image | undefined> {
    return new Promise<Image | undefined>((resolve) => {
      const item: QueueItem = { key, source, priority, signal, resolve: cache ? (image) => resolve(image && this.Cached(key, image)) : resolve };
      const same = cache ? this.waiting.get(key) : undefined;
      if (same) { same.push(item); return; } // already queued: one fetch serves every requester
      if (cache) this.waiting.set(key, [item]);
      const rank = PRIORITY_RANK[priority];
      let at = this.queue.length;
      while (at > 0 && PRIORITY_RANK[this.queue[at - 1].priority] > rank) at--;
      this.queue.splice(at, 0, item);
      this.Pump();
    });
  }

  /** A fresh image goes into the cache; the cached one (an equal source loaded meanwhile) wins. */
  private Cached(key: string, image: Image): Image {
    if (this.AddToCache(key, image)) return image;
    const existing = this.GetFromCacheInternal(key);
    if (existing && existing !== image) { this.Forget(this.Track(image, key)); return existing; }
    return image;
  }

  private Pump(): void {
    while (this.running < SkiaImageManager.MaxParallelLoads && this.queue.length > 0) {
      const item = this.queue.shift()!;
      const requesters = this.waiting.get(item.key) ?? [item];
      if (this.waiting.get(item.key)?.includes(item)) this.waiting.delete(item.key);
      if (item.signal?.aborted) { for (const r of requesters) r.resolve(undefined); continue; }
      this.running++;
      void this.Fetch(item.source, item.signal).then(({ Image: image, Error: error }) => {
        if (image) this.Track(image, item.key);
        else this.CanReload?.(item.source, error);
        // the first requester caches it; the others get what is cached
        for (const r of requesters) r.resolve(image);
      }).finally(() => { this.running--; this.Pump(); });
    }
  }

  /** C# PreloadImage: warms the cache for one source; failures are ignored. */
  async PreloadImage(source: string, priority: LoadPriority = "Normal"): Promise<void> {
    const image = await this.LoadImageManagedAsync(source, undefined, priority);
    // a copy of its own (ReuseBitmaps off, or no cache) nobody will draw
    if (image && this.owned.get(image)?.Cached !== true) this.Forget(this.owned.get(image)!);
  }

  /** Warms the cache so first paint of these images is instant (DrawnUi PreloadImages). Failures are ignored. */
  async PreloadImages(sources: string[], priority: LoadPriority = "Normal"): Promise<void> {
    await Promise.all(sources.map((s) => this.PreloadImage(s, priority)));
  }

  /** Drops everything still waiting in the queue (C# CancelAll): those loads resolve to nothing; loads in flight finish. */
  CancelAll(): void {
    const items = this.queue.splice(0);
    for (const item of items) {
      const requesters = this.waiting.get(item.key) ?? [item];
      this.waiting.delete(item.key);
      for (const r of requesters) r.resolve(undefined);
    }
  }
}
