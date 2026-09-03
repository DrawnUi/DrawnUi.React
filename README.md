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

## Install

```
npm i drawnui-react@preview react react-dom
```

`drawnui-react` = React tags + every engine type, `drawnui-react/core` = the engine only. Ships ES modules + `.d.ts`;
CanvasKit's `.wasm` is referenced with a `?url` import, so use Vite (or any bundler that understands `?url`) and
put your fonts under `public/fonts`. Preview releases carry the `preview` dist-tag (the first publish also became `latest`, as npm always does).

## Layout

- `src/` — the library, imported by samples as `drawnui-react` (React tags + all engine types) or `drawnui-react/core` (engine only).
  - `src/core` — `Super` (startup, CanvasKit, fonts), `SkiaControl` (measure/arrange/render/gestures), `Canvas` (host, surface, frame loop, input), animators, value types.
  - `src/controls` — `SkiaLayout` (+ `SkiaStack`/`SkiaRow`/`SkiaLayer`), `SkiaLabel`, `SkiaHotspot`, `SkiaButton`.
  - `src/react` — reconciler host config + typed JSX tags + `<Canvas>` bridge component.
- `samples/demo/` — the deployed demo: root menu + pages (`pages/ImagesPage.tsx`, `SvgPage.tsx`, `CellsPage.tsx` with `ContactCell.ts`) navigated by the React-level `SkiaShell`.
- `samples/<name>/` — one folder per sample: `index.html`, `main.tsx`, two-line `vite.config.ts` (`defineSample`). Shared assets (fonts) in `samples/public`.
- `dev/build-samples.mjs` — builds every sample into `dist/<name>/` + a `dist/index.html` list; used by the Pages workflow.

What is intentionally missing: see [SKIPPED.md](SKIPPED.md).

## Where React ends and DrawnUi begins

React never touches the canvas. The engine (`src/core`, `src/controls`) is plain TypeScript: `SkiaControl` trees
that measure, arrange and paint themselves on a CanvasKit surface, exactly like the .NET `SkiaControl` trees — it can
be driven from any framework, or from no framework at all (`new SkiaLabel()`, `AddSubView`, `canvas.Content = ...`).

`react-reconciler` is React's own renderer-building package: the same core that powers `react-dom` and
`react-native`, minus the DOM. You hand it a "host config" — how to create an instance for a JSX tag, how to append
/ remove / reorder children, how to apply changed props — and React does the rest: diffing, hooks, state, effects,
keys, Suspense. Our host config (`src/react/reconciler.ts`) maps every tag to an engine class (`<SkiaLabel>` →
`new SkiaLabel()`), `appendChild` to `AddSubView`, and a changed prop to a plain property assignment on the control
(`Text`, `FontSize`, `Tapped`…), after which the control invalidates itself the way it would from C#. So the JSX is
just a declarative way to build and mutate the same control tree; the render loop, caching, gestures, animators and
accessibility all live in the engine and would work identically under Vue, Svelte, Blazor-JS interop or a game loop.
That is also why the demo pages describe DrawnUi features, not React ones: the same pages are meant to be reused as
the showcase for other frameworks on this engine.

## Accessibility

Same model as DrawnUi.Blazor: the `<canvas>` is `aria-hidden`, an invisible DOM overlay mirrors every
accessible drawn control (`role`, `aria-label`, `title` hint, `aria-pressed`, `aria-live`, `tabindex`), rebuilt
at most once per second from the arranged rects. Keyboard (Tab / Enter / Space) and screen-reader activation
are routed back into the gesture pipeline as a `Tapped` on the control.

Per control (C# names): `AccessibilityRole` (enables the node; use `Aria.*`), `AccessibilityLabel`
(defaults to the control's text), `AccessibilityHint`, `AccessibilityCanInteract` (defaults to "has a
`Tapped` handler"), `AccessibilityIsPressed`, `AccessibilityLive`. `Aria.RolePresentation` hides a control that
would otherwise get a default role.

App-wide opt-in (React extension): `SkiaLabel.DefaultAccessibilityRole = Aria.RoleText` and
`SkiaButton.DefaultAccessibilityRole = Aria.RoleButton` (import the classes from `drawnui-react/core`) make every
label readable and every button focusable without touching each control.

The overlay has `pointer-events: none`, so hover and all pointer gestures still reach the canvas — the
Blazor "accessible control loses hover" limitation does not apply.

## Run

```
npm install
npm run dev              # samples/demo at http://localhost:5173
npx vite samples/<name>  # any other sample
npm run build            # typecheck + build all samples into dist/<name>/
```

## Publishing

Every push to `master` runs `.github/workflows/deploy.yml`: build `samples/demo`, deploy `dist/demo`
to the Cloudflare Pages project `helloreact-drawnui` → **https://helloreact.drawnui.net**.

Repository secrets used by the workflow:

| Secret | What it is | Where to get it |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | Cloudflare API token with **Account → Cloudflare Pages → Edit** (deploy needs nothing else). | dash.cloudflare.com → My Profile → API Tokens → Create Token → "Edit Cloudflare Workers" template or custom with the Pages permission; copy the value once. Set with `gh secret set CLOUDFLARE_API_TOKEN --repo DrawnUi/DrawnUi.React` (paste the value on stdin). |
| `CLOUDFLARE_ACCOUNT_ID` | The Cloudflare account that owns the Pages project. | dash.cloudflare.com → any zone → Overview → right column "Account ID", or `npx wrangler whoami`. `gh secret set CLOUDFLARE_ACCOUNT_ID --repo DrawnUi/DrawnUi.React`. |

Adding another published sample = one more `wrangler pages deploy dist/<name> --project-name <project>` step and a Pages project + custom domain for it.
