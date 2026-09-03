// Copies the maintainer's local public skill (~/.claude/skills/drawnui-react/SKILL.md) into skills/drawnui-react/
// and refuses to copy anything that looks internal (machine paths, accounts, tokens, dev tooling).
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { checkPublic } from "./sync-skills-guard.mjs";

const source = join(homedir(), ".claude", "skills", "drawnui-react", "SKILL.md");
if (!existsSync(source)) throw new Error(`local skill not found: ${source}`);
const text = readFileSync(source, "utf8");
checkPublic(text, source);
mkdirSync("skills/drawnui-react", { recursive: true });
copyFileSync(source, "skills/drawnui-react/SKILL.md");
console.log(`synced ${source} -> skills/drawnui-react/SKILL.md (${text.length} chars, clean)`);
