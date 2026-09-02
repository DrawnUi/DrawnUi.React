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
    <SkiaButton Text="Tap me" HorizontalOptions="Center" Tapped={() => setCount((c) => c + 1)} />
  </SkiaStack>
</Canvas>
```

## Layout

- `src/drawnui/core` — `Super` (startup, CanvasKit, fonts), `SkiaControl` (measure/arrange/render), `Canvas` (host, surface, frame loop), value types.
- `src/drawnui/core/Gestures.ts` — gesture value types (`SkiaGesturesParameters`, `GestureEventProcessingInfo`, ...); raw input lives in `Canvas`.
- `src/drawnui/controls` — `SkiaLayout` (+ `SkiaStack`/`SkiaRow`/`SkiaLayer`), `SkiaLabel`, `SkiaHotspot`, `SkiaButton`.
- `src/drawnui/react` — reconciler host config + typed JSX tags + `<Canvas>` bridge component.
- `src/sample` — hello world.

What is intentionally missing: see [SKIPPED.md](SKIPPED.md).

## Run

```
npm install
npm run dev
```
