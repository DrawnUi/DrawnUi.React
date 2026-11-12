// The page's loader (index.html): the real download progress of what the gallery waits for (the engine's CanvasKit wasm,
// the fonts, the models and images), and its fade when the gallery draws its first frame.
declare const __ADD3D_BYTES__: number;

const loader = document.getElementById("loader");
const fetchBefore = window.fetch;

/** Counts the bytes of the engine and the fonts as they arrive (their sizes are known at build time). */
export function TrackDownloads(): void {
  const total = typeof __ADD3D_BYTES__ === "number" ? __ADD3D_BYTES__ : 0;
  if (!loader || !total) return;
  let got = 0;
  const show = () => {
    const pct = Math.min(99, Math.floor((got * 100) / total));
    document.documentElement.style.setProperty("--load-pct", pct + "%");
    document.documentElement.style.setProperty("--load-pct-text", `"${pct}%"`);
  };
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const res = await fetchBefore(input, init);
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!/\.(wasm|ttf|glb|jpg)(\?|$)/.test(url) || !res.body) return res;
    const reader = res.body.getReader();
    const counted = new ReadableStream<Uint8Array>({
      async pull(controller) {
        const { done, value } = await reader.read();
        if (done) { controller.close(); return; }
        got += value.byteLength;
        show();
        controller.enqueue(value);
      },
      cancel(reason) { return reader.cancel(reason); },
    });
    return new Response(counted, { status: res.status, statusText: res.statusText, headers: res.headers });
  };
}

/** The first frame is drawn: the loader fades out and leaves the page. */
export function HideLoader(): void {
  window.fetch = fetchBefore;
  if (!loader || loader.classList.contains("done")) return;
  loader.classList.add("done");
  setTimeout(() => loader.remove(), 400);
}
