// Markers that must never appear in anything published from this repo (skills, llms files).
export const INTERNAL_MARKERS = [
  /C:\\Dev\\/i, /C:\/Dev\//i, /C:\\Users/i, /C:\/Users/i, /scratchpad/i, /localhost:9222/i, /connectOverCDP/i,
  /wrangler/i, /CLOUDFLARE/i, /cloudflare pages/i, /npm_[A-Za-z0-9]{20,}/, /_authToken/i, /dev@drawnui\.net/i,
  /taublast/i, /gmail/i, /bypass 2FA/i, /granular token/i, /PROGRESS\.md/, /DEVELOPMENT\.md/, /gh run watch/i,
];

export function checkPublic(text, label) {
  const hits = INTERNAL_MARKERS.filter((m) => m.test(text));
  if (hits.length) throw new Error(`${label} contains internal markers: ${hits.map(String).join(", ")}`);
}
