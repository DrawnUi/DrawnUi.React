import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

/**
 * Shared Vite setup for every sample. A sample is a folder under samples/ with its own
 * index.html + main.tsx + a two-line vite.config.ts calling defineSample(import.meta.url).
 * - "drawnui-react" resolves to the library source in src/ (no build step while developing)
 * - fonts/images shared by all samples live in samples/public
 * - BASE_PATH (e.g. /DrawnUi.React/) is prepended by CI for GitHub Pages; each sample is served under <base><name>/
 */
export function defineSample(configFileUrl: string) {
  const sampleDir = fileURLToPath(new URL(".", configFileUrl));
  const name = sampleDir.replace(/[\\/]+$/, "").split(/[\\/]/).pop()!;
  const root = fileURLToPath(new URL("../", import.meta.url));
  const base = (process.env.BASE_PATH ?? "/").replace(/\/?$/, "/");
  return defineConfig({
    root: sampleDir,
    base: `${base}${name}/`,
    publicDir: fileURLToPath(new URL("./public", import.meta.url)),
    plugins: [react()],
    resolve: {
      alias: [
        { find: "drawnui-react/core", replacement: fileURLToPath(new URL("./src/index.ts", new URL("../", import.meta.url))) },
        { find: "drawnui-react", replacement: fileURLToPath(new URL("./src/react/index.tsx", new URL("../", import.meta.url))) },
      ],
    },
    build: { target: "esnext", outDir: `${root}dist/${name}`, emptyOutDir: true },
  });
}
