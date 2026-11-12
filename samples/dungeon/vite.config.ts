import { fileURLToPath } from "node:url";
import { defineSample } from "../vite.shared";

// Dungeon Run has a site of its own: its own public folder (fonts, favicon, og image, robots, sitemap).
const config = defineSample(import.meta.url);
config.publicDir = fileURLToPath(new URL("./public", import.meta.url));
export default config;
