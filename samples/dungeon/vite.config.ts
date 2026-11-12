import { readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineSample } from "../vite.shared";

// Dungeon Run has a site of its own: its own public folder (fonts, favicon, og image, robots, sitemap).
const config = defineSample(import.meta.url);
const publicDir = fileURLToPath(new URL("./public", import.meta.url));
config.publicDir = publicDir;

// The loader's progress: the bytes of what the game waits for, the engine's wasm and the fonts.
const wasm = statSync(createRequire(import.meta.url).resolve("canvaskit-wasm/bin/full/canvaskit.wasm")).size;
const fonts = readdirSync(join(publicDir, "fonts")).reduce((sum, f) => sum + statSync(join(publicDir, "fonts", f)).size, 0);
config.define = { ...config.define, __DUNGEON_BYTES__: JSON.stringify(wasm + fonts) };

export default config;
