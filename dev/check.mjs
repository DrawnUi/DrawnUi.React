// Runs an engine check (dev/check-*.ts) in Node: bundled against the sources (CanvasKit's ?url wasm import stubbed,
// CanvasKitInit a global) into the temp folder. Usage: node dev/check.mjs dev/check-recycling.ts
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import esbuild from "esbuild";

const ck = createRequire(import.meta.url).resolve("canvaskit-wasm/bin/full/canvaskit.js");
const entry = process.argv[2];
const outfile = join(tmpdir(), `drawnui-${basename(entry, ".ts")}.cjs`);
await esbuild.build({
  entryPoints: [entry], outfile, bundle: true, platform: "node", format: "cjs", target: "node20", logLevel: "warning",
  banner: { js: `globalThis.CanvasKitInit = require(${JSON.stringify(ck)}); globalThis.window ??= globalThis;` },
  plugins: [{ name: "stub-wasm-url", setup(b) { b.onResolve({ filter: /\?url$/ }, (a) => ({ path: a.path, namespace: "stub" })); b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: "export default ''", loader: "js" })); } }],
});
execFileSync(process.execPath, [outfile], { stdio: "inherit" });
