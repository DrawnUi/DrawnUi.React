import { readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineSample } from "../vite.shared";

// The 3D gallery has a site of its own: its own public folder (models, textures, fonts, favicon).
const config = defineSample(import.meta.url);
const publicDir = fileURLToPath(new URL("./public", import.meta.url));
config.publicDir = publicDir;

// The loader's progress: the bytes of what the gallery waits for before its first frame, the engine's wasm, the fonts and
// every model and image (Theme.Load reads them all before the first frame).
const wasm = statSync(createRequire(import.meta.url).resolve("canvaskit-wasm/bin/full/canvaskit.wasm")).size;
const folder = (name: string, files: RegExp) => readdirSync(join(publicDir, name)).filter((f) => files.test(f)).reduce((sum, f) => sum + statSync(join(publicDir, name, f)).size, 0);
config.define = { ...config.define, __ADD3D_BYTES__: JSON.stringify(wasm + folder("fonts", /\.ttf$/) + folder("assets", /\.(glb|jpg)$/)) };

export default config;
