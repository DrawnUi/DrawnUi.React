# Publishing (maintainers)

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
