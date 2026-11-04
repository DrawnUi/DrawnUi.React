// Accessibility audit of the demo in Chrome (`npm run audit:a11y -- <base url> [routes...]`): opens every catalog
// route in its own window of a Chrome started with --remote-debugging-port (env CDP, default http://127.0.0.1:9222),
// scrolls each page to its end (25 wheel pages at most: a 100 000 item list repeats one template) and reads Chrome's own
// accessibility tree (what screen readers get) after every step. Fails on:
// - hello-app rule 11: a control role (button, switch, slider, textbox...) with an empty name;
// - a range role (slider, progressbar, spinbutton, scrollbar, meter) without min < max, or its value outside them;
// - a focusable node that is neither named nor given a role;
// - console errors or warnings.
// - a caption that repeats the name of the control next to it (hello-app rule: the caption is presentation);
// Reported, not failed: a name said twice by two other nodes in a row (a shell bar title and the page heading).
import { readFileSync } from "node:fs";

const CDP = process.env.CDP ?? "http://127.0.0.1:9222";
const WAIT = Number(process.env.WAIT ?? 6000);
const MAX_PAGES = Number(process.env.MAX_PAGES ?? 25);
const [base = "http://localhost:5173", ...only] = process.argv.slice(2);
const catalog = readFileSync(new URL("../samples/demo/pages/catalog.ts", import.meta.url), "utf8");
const routes = only.length ? only : ["", ...[...catalog.matchAll(/route: "(\w+)"/g)].map((m) => m[1])];

const CONTROL_ROLES = new Set(["button", "checkbox", "switch", "radio", "slider", "spinbutton", "textbox", "searchbox", "combobox",
  "listbox", "option", "menuitem", "menuitemcheckbox", "menuitemradio", "tab", "link", "treeitem", "gridcell"]);
const RANGE_ROLES = new Set(["slider", "progressbar", "spinbutton", "scrollbar", "meter"]);

const version = await (await fetch(`${CDP}/json/version`)).json();
const ws = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let id = 0; const pending = new Map(); let logs = [];
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === "Runtime.consoleAPICalled" && (m.params.type === "error" || m.params.type === "warning")) logs.push(`${m.params.type}: ${m.params.args.map((a) => a.value ?? a.description).join(" ")}`);
  if (m.method === "Runtime.exceptionThrown") logs.push(`exception: ${m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text}`);
});
const send = (method, params = {}, sessionId) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params, sessionId })); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const { result: { targetId } } = await send("Target.createTarget", { url: "about:blank", newWindow: true, background: false });
let failed = 0, controls = 0;
try {
  const { result: { windowId } } = await send("Browser.getWindowForTarget", { targetId });
  await send("Browser.setWindowBounds", { windowId, bounds: { width: 1000, height: 900 } });
  const { result: { sessionId } } = await send("Target.attachToTarget", { targetId, flatten: true });
  const S = (m, p) => send(m, p, sessionId);
  await S("Runtime.enable"); await S("Page.enable"); await S("Accessibility.enable"); await S("Page.bringToFront");
  const prop = (n, name) => n.properties?.find((p) => p.name === name)?.value?.value;

  for (const route of routes) {
    logs = [];
    await S("Page.navigate", { url: route ? `${base}/?r=${route}#/${route}` : `${base}/` });
    await sleep(WAIT);
    const problems = new Set(), twice = new Set(), seen = new Set();
    let still = 0;
    for (let page = 0; page <= MAX_PAGES && still < 3; page++) {
      const { result } = await S("Accessibility.getFullAXTree");
      let fresh = 0;
      for (const n of result.nodes) {
        if (n.ignored) continue;
        const role = n.role?.value ?? "", name = (n.name?.value ?? "").trim();
        const key = `${role}|${name}|${prop(n, "valuemin")}|${prop(n, "valuemax")}`;
        if (!seen.has(key)) { seen.add(key); fresh++; }
        if (CONTROL_ROLES.has(role)) {
          controls++;
          if (!name) problems.add(`rule 11: ${role} without a name`);
        }
        if (RANGE_ROLES.has(role)) {
          const min = prop(n, "valuemin"), max = prop(n, "valuemax"), now = prop(n, "valuenow");
          if (min === undefined || max === undefined || !(Number(min) < Number(max))) problems.add(`${role} "${name}": min ${min} max ${max}`);
          else if (now !== undefined && (Number(now) < Number(min) || Number(now) > Number(max))) problems.add(`${role} "${name}": value ${now} outside ${min}..${max}`);
        }
        if (prop(n, "focusable") && !name && (role === "generic" || role === "none" || !role) && !n.childIds?.length) {
          const d = (await S("DOM.describeNode", { backendNodeId: n.backendDOMNodeId })).result?.node;
          problems.add(`a focusable ${role || "node"} with neither a name nor a role: <${d?.nodeName?.toLowerCase()} ${(d?.attributes ?? []).join(" ")}>`);
        }
      }
      // names said twice in a row, from the overlay's own order (its elements are in reading order; Chrome's AX list
      // leaves a text element unnamed): a caption next to the control it names fails, other repeats are reported
      const pairs = (await S("Runtime.evaluate", { returnByValue: true, expression: `(() => {
        const out = []; let prev;
        for (const e of document.querySelectorAll('.drawnui-a11y-overlay > *')) {
          const role = e.getAttribute('role') || '', name = (e.getAttribute('aria-label') || (role === 'text' ? e.textContent : '') || '').trim();
          if (!name) continue;
          if (prev && prev.name === name) out.push([name, prev.role, role]);
          prev = { name, role };
        }
        return out; })()` })).result.result.value ?? [];
      for (const [name, a, b] of pairs) {
        if (CONTROL_ROLES.has(a) !== CONTROL_ROLES.has(b)) problems.add(`"${name}" is said by a caption and by the ${CONTROL_ROLES.has(a) ? a : b} next to it`);
        else twice.add(name);
      }
      still = fresh === 0 ? still + 1 : 0;
      // the next page down: the wheel at the middle goes to the innermost scroll there, the page margin to the page
      for (const x of [500, 30]) await S("Input.dispatchMouseEvent", { type: "mouseWheel", x, y: 600, deltaX: 0, deltaY: 700 });
      await sleep(1200); // the overlay rebuilds at most once a second
    }
    const errors = [...problems, ...logs];
    if (errors.length) failed++;
    console.log(`${route || "root"}: ${errors.length ? `FAIL\n  ${errors.join("\n  ")}` : "ok"}${twice.size ? `\n  said twice in a row: ${[...twice].join(", ")}` : ""}`);
  }
} finally {
  await send("Target.closeTarget", { targetId });
  ws.close();
}
console.log(failed ? `FAIL: ${failed} of ${routes.length} pages` : `OK: ${routes.length} pages, ${controls} control nodes read, every one named, every range valid`);
process.exit(failed ? 1 : 0);
