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
| 2026-09-02 | Text | `SkiaLabel` engine: word wrap, `MaxLines` + ellipsis, `LineBreakMode`, H/V alignment, `LineSpacing`/`LineHeight`, `FontWeight`/`FontAttributes` through weight-registered faces (`AddFont(src, alias, weight)`), synthetic italic, `TextTransform`, `Padding`; shared `Super.GetFont` cache; Text snippet |
| 2026-09-02 | Shapes | `SkiaShape`/`SkiaFrame`: Rectangle (per-corner radii), Circle, Ellipse, Arc, Polygon, Line, Path; inside stroke, hollow, children clipped; `SkiaButton` rebuilt on a `BtnShape` frame (`CornerRadius`, stroke); Shapes snippet, round cell avatars, rounded root cards |
| 2026-09-02 | Caching | `UseCache` None/Operations/Image (+aliases), `CachedObject`, invalidation contract (`Update` stales caches up the tree, `Repaint` keeps them), `Measure` memo, `Canvas.DisposeObject` after flush, `Canvas.FrameTime`/`FPS`; cells sample cached as `Image`. A/B on the light demo cells: no measurable change (0.7 ms/frame both) — payoff expected on heavy cells |
| 2026-09-02 | Demo shell | `samples/demo`: root menu (logo, gradient, buttons) + pages Images / SVG / Recycled cells; React-level `SkiaShell` (`Routes`, `GoToAsync`/`GoBackAsync`, nav bar with Back, `useShell()`); `FillGradient` (linear); colors parsed MAUI-style `#AARRGGBB` via `Super.ParseColor` |
| 2026-09-02 | Recycled cells | Templated `SkiaLayout` (`ItemsSource`/`ItemTemplate`/`RecyclingTemplate`/`MeasureFirst`+`MeasureAll`), `ViewsAdapter` pool, `BindingContext` + `SkiaDynamicDrawnCell.SetContent`, `SkiaScroll.ScrollToIndex`, `FirstVisibleIndex`/`DebugString`; sample = Cells fiddle shape with 100 000 items |
| 2026-09-02 | Scrolling | `SkiaScroll` plain content: pan, deceleration fling cut at edges, rubber-band + spring bounce, wheel, `ScrollTo*`, `Scrolled`; physics classes `ScrollFlingAnimator`, `DecelerationTimingParameters`, `SpringWithVelocityAnimator`, `VelocityAccumulator`, `RubberBandUtils` |

## In progress

- nothing

## Next

1. ~~`SkiaShape`~~ done (Rectangle/Circle/Ellipse, `CornerRadius`, stroke, children clipped) → real `SkiaButton` templating (`BtnShape`/`BtnText`).
2. `SkiaLabel` spans (`TextSpan`: color/size/bold/underline/strikeout/tap) + `FontFamilyFallback` for symbols/emoji; then `SkiaRichLabel` (markdown).
3. `SkiaLayout` Grid, then Wrap.
4. `MeasureVisible` for uneven rows; `ImageDoubleBuffered` as a real double buffer.
5. `SkiaLabel` wrapping, `MaxLines`, alignment, font weights.
6. Transforms (`TranslationX/Y`, `Rotation`, `Scale`, `Opacity`) + gesture mapping through them.
7. `MeasureVisible` + virtualization, windowed `ItemsSource`.

## Web-specific divergences (deliberate)

- No SVG module in CanvasKit npm → `SkiaSvg` rasterizes via the browser per displayed size.
- Single-threaded: no offscreen bake threads; anything "background" in DrawnUi becomes a frame-budgeted job here.
- Gesture events are queued and processed at frame start (DrawnUi rule) but delivered by the browser at pointer-event rate.
