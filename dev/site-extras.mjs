// After `vite build samples/demo`: copies the public skills into dist/demo/skills/ and writes dist/demo/llms-full.txt
// (llms.txt + every SKILL.md inlined) so AI agents can fetch the skill from the demo site. Refuses internal content.
import { cpSync, existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { checkPublic } from "./sync-skills-guard.mjs";

const out = process.argv[2] ?? "dist/demo";
if (!existsSync(out)) throw new Error(`build output not found: ${out}`);
const skills = existsSync("skills") ? readdirSync("skills").filter((d) => existsSync(join("skills", d, "SKILL.md"))) : [];
let full = readFileSync("samples/public/llms.txt", "utf8");
for (const name of skills) {
  const text = readFileSync(join("skills", name, "SKILL.md"), "utf8");
  checkPublic(text, `skills/${name}/SKILL.md`);
  full += `\n\n---\n\n# Skill: ${name} (skills/${name}/SKILL.md)\n\n${text}`;
}
if (skills.length) cpSync("skills", join(out, "skills"), { recursive: true });
writeFileSync(join(out, "llms-full.txt"), full);
console.log(`site extras: ${skills.length} skill(s) copied, llms-full.txt ${full.length} chars`);
