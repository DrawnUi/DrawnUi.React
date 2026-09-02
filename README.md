# DrawnUi.React

Prototype of the [DrawnUi](https://drawnui.net) engine rewritten in TypeScript on top of
[CanvasKit](https://skia.org/docs/user/modules/canvaskit/) (Skia for the browser), composed with React
through a custom `react-reconciler` renderer.

Goal: the same API surface and semantics as DrawnUi (.NET) — same control names, same PascalCase
property names, same measure/arrange/paint contract — so knowledge and docs transfer 1:1.

```tsx
await Super.UseDrawnUi()
  .ConfigureFonts((fonts) => fonts.AddFont("fonts/OpenSans-Regular.ttf", "FontText"))
  .BuildAsync();

<Canvas BackgroundColor={Colors.DarkSlateBlue} RenderingMode="Accelerated" Gestures="Enabled">
  <SkiaStack Spacing={8} Padding={new Thickness(16)} VerticalOptions="Center">
    <SkiaLabel Text="Hello World" FontSize={32} TextColor={Colors.White} HorizontalOptions="Center" />
    <SkiaButton Text="Tap me" ApplyEffect="Ripple" HorizontalOptions="Center" Tapped={() => setCount((c) => c + 1)} />
  </SkiaStack>
</Canvas>
```

## Layout

- `src/` — the library, imported by samples as `drawnui-react` (React tags + all engine types) or `drawnui-react/core` (engine only).
  - `src/core` — `Super` (startup, CanvasKit, fonts), `SkiaControl` (measure/arrange/render/gestures), `Canvas` (host, surface, frame loop, input), animators, value types.
  - `src/controls` — `SkiaLayout` (+ `SkiaStack`/`SkiaRow`/`SkiaLayer`), `SkiaLabel`, `SkiaHotspot`, `SkiaButton`.
  - `src/react` — reconciler host config + typed JSX tags + `<Canvas>` bridge component.
- `samples/<name>/` — one folder per sample: `index.html`, `main.tsx`, two-line `vite.config.ts` (`defineSample`). Shared assets (fonts) in `samples/public`.
- `dev/build-samples.mjs` — builds every sample into `dist/<name>/` + a `dist/index.html` list; used by the Pages workflow.

What is intentionally missing: see [SKIPPED.md](SKIPPED.md).

## Run

```
npm install
npm run dev              # samples/helloworld at http://localhost:5173
npx vite samples/<name>  # any other sample
npm run build            # typecheck + build all samples into dist/<name>/
```

## Publishing

Every push to `master` runs `.github/workflows/deploy.yml`: build `samples/helloworld`, deploy `dist/helloworld`
to the Cloudflare Pages project `helloreact-drawnui` → **https://helloreact.drawnui.net**.

Repository secrets used by the workflow:

| Secret | What it is | Where to get it |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | Cloudflare API token with **Account → Cloudflare Pages → Edit** (deploy needs nothing else). | dash.cloudflare.com → My Profile → API Tokens → Create Token → "Edit Cloudflare Workers" template or custom with the Pages permission; copy the value once. Set with `gh secret set CLOUDFLARE_API_TOKEN --repo DrawnUi/DrawnUi.React` (paste the value on stdin). |
| `CLOUDFLARE_ACCOUNT_ID` | The Cloudflare account that owns the Pages project. | dash.cloudflare.com → any zone → Overview → right column "Account ID", or `npx wrangler whoami`. `gh secret set CLOUDFLARE_ACCOUNT_ID --repo DrawnUi/DrawnUi.React`. |

Adding another published sample = one more `wrangler pages deploy dist/<name> --project-name <project>` step and a Pages project + custom domain for it.
