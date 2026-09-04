import type { Plugin } from "vite";
import { defineSample } from "../vite.shared";
import { SAMPLES } from "./pages/catalog";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * Crawlers (and AI bots) do not run the canvas: the served index.html gets a real, visible HTML list of the
 * sample pages below the canvas, generated from the same catalog the root menu draws its cards from.
 * Replaces the <!-- samples-list --> placeholder in index.html at dev and build time; never hand-written.
 */
function samplesList(): Plugin {
  return {
    name: "drawnui-samples-list",
    transformIndexHtml(html) {
      const items = SAMPLES.map((s) => `      <li><a href="#/${s.route}"><b>${esc(s.title)}</b> ${esc(s.text)}</a></li>`).join("\n");
      return html.replace("<!-- samples-list -->", `<ul>\n${items}\n    </ul>`);
    },
  };
}

const config = defineSample(import.meta.url);
config.plugins!.push(samplesList());
export default config;
