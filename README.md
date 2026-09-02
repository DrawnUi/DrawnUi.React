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
npm run dev            # samples/helloworld at http://localhost:5173
npx vite samples/<name>  # any other sample
npm run build          # typecheck + build all samples into dist/
```

Samples are published to GitHub Pages on every push to `master` (`.github/workflows/pages.yml`).
