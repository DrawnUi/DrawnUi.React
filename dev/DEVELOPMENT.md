# Development (maintainers)

## Repo layout

- `src/` — the library, imported by samples as `drawnui-react` (React tags + all engine types) or `drawnui-react/core` (engine only).
  - `src/core` — `Super` (startup, CanvasKit, fonts), `SkiaControl` (measure/arrange/render/gestures), `Canvas` (host, surface, frame loop, input), animators, value types.
  - `src/controls` — `SkiaLayout` (+ `SkiaStack`/`SkiaRow`/`SkiaLayer`), `SkiaLabel`, `SkiaHotspot`, `SkiaButton`.
  - `src/react` — reconciler host config + typed JSX tags + `<Canvas>` bridge component.
- `samples/demo/` — the deployed demo: root menu + pages (`pages/ImagesPage.tsx`, `SvgPage.tsx`, `CellsPage.tsx` with `ContactCell.ts`) navigated by the React-level `SkiaShell`.
- `samples/<name>/` — one folder per sample: `index.html`, `main.tsx`, two-line `vite.config.ts` (`defineSample`). Shared assets (fonts) in `samples/public`.
- `skills/` — public agent skills, synced from the maintainer's local copy (`npm run sync:skills`, leak-guarded) and served by the demo site.
- `dev/` — maintainer material: `build-samples.mjs` builds every sample into `dist/<name>/` + a `dist/index.html` list; used by the Pages workflow.

What is intentionally missing: see [SKIPPED.md](SKIPPED.md). Maintainer notes live in `dev/`: [PARITY.md](dev/PARITY.md) (where and why the port diverges from DrawnUi.Net) and [PROGRESS.md](dev/PROGRESS.md) (work log).

## Run

```
npm install
npm run dev              # samples/demo at http://localhost:5173
npx vite samples/<name>  # any other sample
npm run build            # typecheck + build all samples into dist/<name>/ (+ site extras for the demo)
npm run build:lib        # library build into dist/ (what npm publish ships)
npm run sync:skills      # copy the maintainer's local drawnui-react skill into skills/ (leak-guarded)
```

Ledgers: `SKIPPED.md` (root, per control: ported / partial / skipped and what exactly), `dev/PROGRESS.md` (work log),
`dev/PARITY.md` (where and why the port diverges from DrawnUi.Net). Update them with every stage.

## Public skill + llms.txt

`skills/drawnui-react/SKILL.md` is the public agent skill, synced from the maintainer's local copy by
`dev/sync-skills.mjs`, which refuses internal markers (`dev/sync-skills-guard.mjs`). `dev/site-extras.mjs` runs after
the demo build (locally and in the workflow): it copies `skills/` into `dist/demo/skills/` and writes
`llms-full.txt` = `samples/public/llms.txt` + every skill, so agents can fetch them from the demo site.

## Publishing

Every push to `master` runs `.github/workflows/deploy.yml`: build `samples/demo`, deploy `dist/demo`
to the Cloudflare Pages project `helloreact-drawnui` → **https://helloreact.drawnui.net**.

Repository secrets used by the workflow:

| Secret | What it is | Where to get it |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | Cloudflare API token with **Account → Cloudflare Pages → Edit** (deploy needs nothing else). | dash.cloudflare.com → My Profile → API Tokens → Create Token → "Edit Cloudflare Workers" template or custom with the Pages permission; copy the value once. Set with `gh secret set CLOUDFLARE_API_TOKEN --repo DrawnUi/DrawnUi.React` (paste the value on stdin). |
| `CLOUDFLARE_ACCOUNT_ID` | The Cloudflare account that owns the Pages project. | dash.cloudflare.com → any zone → Overview → right column "Account ID", or `npx wrangler whoami`. `gh secret set CLOUDFLARE_ACCOUNT_ID --repo DrawnUi/DrawnUi.React`. |

Adding another published sample = one more `wrangler pages deploy dist/<name> --project-name <project>` step and a Pages project + custom domain for it.

## npm package

`drawnui-react` is published from a maintainer machine by the npm user `drawnui` (scope `@drawnui` is reserved by
that username). npm requires either 2FA on the account or a granular access token with "bypass 2FA" to publish.

1. Bump `version` in `package.json` (previews: `0.1.0-preview.N`, dist-tag `preview`).
2. `npm run build:lib` (also run by `prepublishOnly`), optionally `npm pack` and install the tarball in a throwaway
   Vite app to check `exports`, types and the CanvasKit `.wasm` asset.
3. `npm publish --access public --tag preview` (with 2FA: add `--otp=<code>`; with a token: pass it through an env
   override, never write it to `.npmrc`).
4. `npm view drawnui-react version dist-tags` (the registry lags ~20 s).
