/**
 * Vite helpers for DrawnUi.React apps: `import { drawnUiStatic } from "drawnui-react/vite"`.
 * Build-time only; the runtime bundle never imports this module and the frame loop knows nothing about it.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Plugin, ResolvedConfig } from "vite";

export interface DrawnUiStaticOptions {
  /**
   * Pages to generate, as URL hashes / paths appended to the site root ("" = the root page, "#/shapes"...).
   * Default: the root page plus every page a button on the root page navigates to (discovered by clicking it
   * in the headless browser and reading the new location).
   */
  routes?: string[];
  /** Id of the element the app mounts into; the generated HTML goes inside it. Default "root". */
  container?: string;
  /** Chrome executable. Default: the installed Google Chrome (playwright-core `channel: "chrome"`), or $CHROME_PATH. */
  executablePath?: string;
  /** Milliseconds the accessibility tree must stay unchanged before a page is read (the engine rebuilds it at most every 300 ms). Default 800. */
  settleMs?: number;
  /** Text of the generated top heading. Default: the document <title>. */
  heading?: string;
}

/** One accessible control as read from the running app (the engine's accessibility snapshot, exposed as DOM). */
export interface StaticNode { Role: string; Label: string; Hint?: string; Href?: string }

/**
 * Generates visible, semantic HTML for crawlers and AI agents from the app's own accessibility tree, at build time.
 *
 * After `vite build` it serves the build (`vite preview`), opens it in headless Chrome, lets the engine measure,
 * arrange and draw, reads the accessibility snapshot of every page (root + the pages its buttons open, or the
 * `routes` you list) and writes ordinary HTML into the mount element of `dist/index.html`: a heading becomes a
 * heading, a button becomes a link to the page it opened, a label becomes a paragraph, a form control becomes a
 * list item naming it. The overlay's own markup (transparent text over an `aria-hidden` canvas) is deliberately
 * NOT copied — in a static file that reads as hidden text; this output is plain flow content, nothing hidden.
 *
 * It is the pre-hydration state of the page: `createRoot(container).render(...)` replaces the mount element's
 * children on the first React render, so a person sees it only while CanvasKit loads and never twice. If the
 * app fails to boot it stays. Nothing runs at runtime and nothing is added to the frame loop; an app that does
 * not use the plugin pays nothing.
 *
 * Two things to know:
 * - Verify with `curl` or view-source, not DevTools after boot: the app replaced it.
 * - Crawlers that do not run JavaScript (GPTBot, ClaudeBot, CCBot, curl, link previews) read this HTML.
 *   Googlebot renders JavaScript: it sees the booted page, i.e. the accessibility overlay (roles, labels, text).
 *   Both come from the same accessibility tree, so they cannot drift — but a control without an
 *   `AccessibilityRole` is invisible to both.
 *
 * Needs `playwright-core` (dev dependency of your app) and a Chrome to drive; GitHub's ubuntu runners have one.
 * Usage: `plugins: [react(), drawnUiStatic()]`.
 */
export function drawnUiStatic(options: DrawnUiStaticOptions = {}): Plugin {
  const container = options.container ?? "root";
  const settleMs = options.settleMs ?? 800;
  let config: ResolvedConfig;
  return {
    name: "drawnui-static",
    apply: "build",
    configResolved(c) { config = c; },
    async closeBundle() {
      const file = resolve(config.root, config.build.outDir, "index.html");
      const html = readFileSync(file, "utf8");
      const slot = new RegExp(`(<div\\b[^>]*\\bid="${container}"[^>]*>)\\s*(</div>)`);
      if (!slot.test(html)) { config.logger.warn(`drawnui-static: no empty <div id="${container}"> in ${file}, nothing generated`); return; }

      const { preview } = await import("vite");
      const server = await preview({ configFile: config.configFile, root: config.root, mode: config.mode, logLevel: "warn", preview: { port: 0, strictPort: false, open: false } });
      const origin = server.resolvedUrls?.local[0]?.replace(/\/$/, "") ?? "";
      const base = config.base.replace(/\/$/, "");
      const { chromium } = await import("playwright-core");
      const browser = await chromium.launch(options.executablePath ?? process.env.CHROME_PATH ? { executablePath: options.executablePath ?? process.env.CHROME_PATH } : { channel: "chrome" });
      try {
        const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
        const errors: string[] = [];
        page.on("pageerror", (e) => errors.push(String(e)));
        const url = (route: string) => `${origin}${base}/${route}`;

        // the engine rebuilds the accessibility snapshot at most every 300 ms and only after a drawn frame:
        // wait until the overlay has stopped changing
        const readTree = async (): Promise<StaticNode[]> => {
          let last = "", stableSince = Date.now(), started = Date.now();
          for (;;) {
            const nodes = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>(".drawnui-a11y-node")].map((e) => ({
              Role: e.getAttribute("role") ?? "", Label: e.getAttribute("aria-label") ?? e.textContent ?? "", Hint: e.getAttribute("title") ?? undefined,
            })));
            const key = JSON.stringify(nodes);
            if (key !== last) { last = key; stableSince = Date.now(); }
            else if (nodes.length && Date.now() - stableSince >= settleMs) return nodes;
            if (Date.now() - started > 20000) return nodes;
            await page.waitForTimeout(150);
          }
        };

        await page.goto(url(""));
        const root = await readTree();
        const pages = new Map<string, StaticNode[]>([["", root]]);
        if (options.routes) {
          for (const r of options.routes) { if (r === "") continue; await page.goto(url(r)); pages.set(r, await readTree()); }
        } else {
          // a button becomes a link to wherever it takes the user: click it, read the new location, come back
          for (let i = 0; i < root.length; i++) {
            if (root[i].Role !== "button") continue;
            await page.goto(url(""));
            await readTree();
            // activate through the overlay node (routed to the control as a Tapped), so buttons below the fold work too
            const activated = await page.evaluate((i) => { const el = document.querySelectorAll<HTMLElement>(".drawnui-a11y-node")[i]; if (!el) return false; el.click(); return true; }, i);
            if (!activated) continue;
            await page.waitForTimeout(400);
            const route = await page.evaluate(() => location.hash);
            if (!route || pages.has(route)) continue;
            root[i].Href = route;
            pages.set(route, await readTree());
          }
        }
        if (errors.length) config.logger.warn(`drawnui-static: page errors while generating: ${errors.join("; ")}`);

        const heading = options.heading ?? /<title>([^<]*)<\/title>/.exec(html)?.[1] ?? "";
        const markup = renderStatic(heading, pages);
        writeFileSync(file, html.replace(slot, `$1\n${markup}\n$2`));
        config.logger.info(`drawnui-static: ${pages.size} page(s), ${[...pages.values()].reduce((n, p) => n + p.length, 0)} nodes → #${container} in ${file}`);
      } finally {
        await browser.close();
        await server.close();
      }
    },
  };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Accessibility nodes -> visible semantic HTML. One <section> per page; roles map to ordinary elements. */
export function renderStatic(heading: string, pages: Map<string, StaticNode[]>): string {
  const out: string[] = [`<div class="drawnui-static">`];
  if (heading) out.push(`<h1>${esc(heading)}</h1>`);
  for (const [route, nodes] of pages) {
    const titleNode = nodes.find((n) => n.Role === "heading" && n.Label.trim());
    out.push(`<section${route ? ` id="${esc(route.replace(/^#\/?/, ""))}"` : ""}>`);
    if (route && titleNode) out.push(`<h2>${esc(titleNode.Label.trim())}</h2>`);
    let list: string[] = [];
    const flush = () => { if (list.length) { out.push(`<ul>${list.join("")}</ul>`); list = []; } };
    for (const n of nodes) {
      const label = n.Label.trim();
      if (!label || (n === titleNode && route)) continue;
      const hint = n.Hint?.trim();
      switch (n.Role) {
        case "heading": flush(); out.push(route ? `<h3>${esc(label)}</h3>` : `<h2>${esc(label)}</h2>`); break;
        case "button": case "link": case "tab": case "menuitem":
          list.push(`<li>${n.Href ? `<a href="${esc(n.Href)}"><b>${esc(label)}</b>` : `<b>${esc(label)}</b>`}${hint ? ` ${esc(hint)}` : ""}${n.Href ? "</a>" : ""}</li>`); break;
        case "text": case "status": case "alert": flush(); out.push(`<p>${esc(label)}</p>`); break;
        case "img": break;
        default: list.push(`<li>${esc(label)}${hint ? ` — ${esc(hint)}` : ""} <small>(${esc(n.Role)})</small></li>`);
      }
    }
    flush();
    out.push(`</section>`);
  }
  out.push(`</div>`);
  return out.join("\n");
}
