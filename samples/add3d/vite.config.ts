import { fileURLToPath } from "node:url";
import { defineSample } from "../vite.shared";

// The 3D gallery has a site of its own: its own public folder (models, textures, fonts, favicon).
const config = defineSample(import.meta.url);
config.publicDir = fileURLToPath(new URL("./public", import.meta.url));

export default config;
