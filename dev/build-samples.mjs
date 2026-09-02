// Builds every sample under samples/<name>/ (any folder with an index.html) into dist/<name>/
// and writes a dist/index.html listing them. BASE_PATH (default "/") is the site root prefix, e.g. /DrawnUi.React/.
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const base = (process.env.BASE_PATH ?? "/").replace(/\/?$/, "/");
const samples = readdirSync("samples", { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(join("samples", d.name, "index.html")))
  .map((d) => d.name);

for (const name of samples) {
  console.log(`\n=== building sample: ${name} ===`);
  execSync(`npx vite build samples/${name}`, { stdio: "inherit", env: { ...process.env, BASE_PATH: `${base}${name}/` } });
}

mkdirSync("dist", { recursive: true });
writeFileSync(
  "dist/index.html",
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>DrawnUi.React samples</title>
<style>body{font:16px system-ui;margin:2rem;color:#222}a{display:block;margin:.4rem 0}</style></head>
<body><h1>DrawnUi.React samples</h1>
${samples.map((n) => `<a href="${base}${n}/">${n}</a>`).join("\n")}
<p><a href="https://github.com/DrawnUi/DrawnUi.React">github.com/DrawnUi/DrawnUi.React</a></p></body></html>\n`,
);
console.log(`\nbuilt ${samples.length} sample(s) into dist/ with base ${base}`);
