# Progress

Living status of the DrawnUi → React/TypeScript port. Updated with every feature landed.
Detailed per-feature omissions: [SKIPPED.md](SKIPPED.md). Live sample: https://helloreact.drawnui.net

## Done

| Date | Feature | Notes |
|---|---|---|
| 2026-09-02 | Engine core | `SkiaControl` measure/arrange/render, `Canvas` host (WebGL surface, on-demand frames, sync redraw on resize, GrContext reused), value types (`Thickness`, `SKRect`, `ScaledSize`, `Colors`) |
| 2026-09-02 | Startup | `Super.UseDrawnUi().ConfigureFonts(...).BuildAsync()` on CanvasKit |
| 2026-09-02 | Layouts | `SkiaLayout` Absolute/Column/Row + `SkiaStack`/`SkiaRow`/`SkiaLayer`, `Spacing`, `Padding`, `LockRatio` |
| 2026-09-02 | Text | `SkiaLabel` single line |
| 2026-09-02 | React | `react-reconciler` renderer, PascalCase props 1:1, `<Canvas>` bridge, `drawnui-react` / `drawnui-react/core` entry points |
| 2026-09-02 | Gestures | `Canvas.Gestures`, pointer → Down/Panning/Tapped/Up state machine, `ProcessGestures`, `Tapped`/`ChildTapped`/`ConsumeGestures`, `InputTransparent`, `BlockGesturesBelow`, `LockChildrenGestures`, hit helpers |
| 2026-09-02 | Controls | `SkiaHotspot`, `SkiaButton` (default look, `ApplyEffect`) |
| 2026-09-02 | Animators | `AnimatorBase` / `SkiaValueAnimator` / `RenderingAnimator`, `PostAnimators`, `Easing`, `RippleAnimator`, `AnimationTapped` / `TouchEffectColor` |
| 2026-09-02 | Images | `SkiaImage` (all `TransformAspect` but Tile, alignments, `Success`/`Error`), `SkiaImageManager` cache/preload |
| 2026-09-02 | SVG | `SkiaSvg` (browser-decoded, rasterized per displayed size, `TintColor`) |
| 2026-09-02 | Infra | repo layout `src/` + `samples/<name>/`, Cloudflare Pages deploy on push (`.github/workflows/deploy.yml`) |

| 2026-09-02 | Scrolling | `SkiaScroll` plain content: pan, deceleration fling cut at edges, rubber-band + spring bounce, wheel, `ScrollTo*`, `Scrolled`; physics classes `ScrollFlingAnimator`, `DecelerationTimingParameters`, `SpringWithVelocityAnimator`, `VelocityAccumulator`, `RubberBandUtils` |

## In progress

- nothing

## Next

1. `ItemsSource` / `ItemTemplate` on `SkiaLayout` (templated children, `RecyclingTemplate`, `MeasureItemsStrategy` `MeasureAll`/`MeasureFirst`) → recycled cells inside `SkiaScroll`; validate against the **Cells** fiddle snippet.
2. `SkiaShape` (Rectangle/Circle/Ellipse, `CornerRadius`, stroke, children clipped) → real `SkiaButton` templating (`BtnShape`/`BtnText`).
3. `UseCache` (`Operations` / `Image`) — first real performance layer.
4. `SkiaLayout` Grid, then Wrap.
5. `SkiaLabel` wrapping, `MaxLines`, alignment, font weights.
6. Transforms (`TranslationX/Y`, `Rotation`, `Scale`, `Opacity`) + gesture mapping through them.
7. `MeasureVisible` + virtualization, windowed `ItemsSource`.

## Web-specific divergences (deliberate)

- No SVG module in CanvasKit npm → `SkiaSvg` rasterizes via the browser per displayed size.
- Single-threaded: no offscreen bake threads; anything "background" in DrawnUi becomes a frame-budgeted job here.
- Gesture events are queued and processed at frame start (DrawnUi rule) but delivered by the browser at pointer-event rate.
