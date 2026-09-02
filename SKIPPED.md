# Skipped vs DrawnUi (.NET)

Ledger of what the prototype deliberately does not port yet. Everything that IS ported keeps the
DrawnUi name and semantics; nothing here is a redesign, only an omission.

## Engine

| Area | Status | Notes |
|---|---|---|
| Caching (`UseCache`, SkPicture/Image/GPU caches, double buffering) | skipped | Every dirty frame re-measures, re-arranges and re-paints the whole tree. |
| Incremental invalidation / dirty regions | skipped | `Update()` / `InvalidateMeasure()` / `Repaint()` all just request a full frame. |
| Gestures core: `Canvas.Gestures` (Disabled/Enabled/Lock), `ProcessGestures(args, apply)`, `ConsumeGestures`, `Tapped`/`ChildTapped`, `InputTransparent`, `BlockGesturesBelow`, `LockChildrenGestures`, `HitBoxAuto`/`HitIsInside`/`IsGestureForChild`, `SkiaGesturesParameters`/`GestureEventProcessingInfo`/`SkiaGesturesInfo`/`ControlTappedEventArgs` | ported | Pointer events -> per-pointer `OnTouchAction` state machine (port of DrawnUi.Blazor) -> Down/Panning/Tapped/Up, queued and processed at frame start. Tap slop = 16pt like AppoMobi TouchEffect. |
| Gestures: `LongPressing`, `Wheel`, `Pointer` (hover), multi-touch pinch, velocity, `SoftLock`, `AddGestures` attached props, `OnGestures` delegate, transform-aware mapping (`HasTransform`, cache offsets `TranslateInputCoords`) | skipped | Enum members exist for parity, never produced. `ChildOffset` is always zero (no caches/transforms yet). |
| C# multi-subscriber `event`s | changed shape | One callback per event prop (`Tapped={fn}`), same names. `Command*` (ICommand) variants not ported. |
| `Opacity`, `Rotation`, `TranslationX/Y`, `Scale`, transforms | skipped | |
| Clipping to bounds, `ClipEffect`, `IsClippedToBounds` | skipped | Children can overflow their parent. |
| `Padding` on base `SkiaControl` | skipped | Only `SkiaLayout.Padding` exists. |
| `MinimumWidthRequest`/`MaximumWidthRequest` (+Height) | skipped | |
| `LockRatio` | ported | Same `SmartMax`/`SmartMin` rule as C# (sign decides larger/smaller side, infinite side loses). |
| `HorizontalFillRatio`/`VerticalFillRatio` | skipped | |
| `ZIndex` | skipped | Children draw in declaration order. |
| Styles / `ConfigureStyles` | skipped | |
| Animators core: `AnimatorBase` / `SkiaValueAnimator` / `RenderingAnimator` (`IOverlayEffect`), `Canvas.RegisterAnimator`/`AnimatingControls`, `PostAnimators` + `ExecutePostAnimators`, `Easing` (Linear/Cubic*) | ported | Frame-driven: a running animator keeps frames coming, idle canvas draws nothing. |
| Touch feedback: `AnimationTapped="Ripple"` + `TouchEffectColor` + `AnimationTappedSpeed` on any control, `SkiaButton.ApplyEffect="Ripple"` (on Down), `PlayRippleAnimation`, `RippleAnimator`, `ClipEffects`/`CreateClip` | ported | Same numbers as C#: 500ms CubicIn, radius 300pt, opacity 0.20 fading over 1.15x progress. |
| `Shimmer` touch animation, `ShimmerAnimator`, `ClippedEffectsWith`, `TransformView`, `DelayCallbackMs`, `removePrevious`, `Pause`/`Resume`, `UseInterpolator`, spring/deceleration timing, `AnimateExtensions` (`FadeToAsync`, `TranslateToAsync`, ...) | skipped | |
| `VisualEffects`, shadows, shaders, `SkiaBackdrop` | skipped | |
| Multithreading / offscreen rendering | skipped | Browser main thread only. |
| Hot reload hook | skipped | Vite HMR reloads the page. |
| Second measure pass / fill-in-auto re-measure rules | skipped | Column/Row give children an infinite main axis; cross axis = available. |
| `ScaledSize` as class with `IsEmpty` etc. | partial | Only `Pixels`/`Units`. |
| `Colors` | partial | Small subset; any CSS hex/rgb() string works. Named CSS colors ("red") do not. |

## Canvas / host

| Area | Status | Notes |
|---|---|---|
| `RenderingMode` | partial | `Accelerated` (WebGL) with automatic fallback to software; read once at first surface creation. |
| `Gestures` param | ported | Enabled applies `touch-action:none; user-select:none`; Lock also blocks `touchmove` default. |
| Keyboard, focus (`FocusedChild`) | skipped | |
| FPS / rendering stats (`Super.EnableRenderingStats`, `SkiaLabelFps`) | skipped | |
| Insets / safe areas | skipped | N/A in browser for now. |

## Controls

| Control | Status | Notes |
|---|---|---|
| `SkiaLayout` Absolute / Column / Row (+ `SkiaStack`, `SkiaRow`, `SkiaLayer`) | ported | `Spacing`, `Padding`, `Children`/`Views`, `AddSubView`/`RemoveSubView`/`InsertSubView`. |
| `SkiaLayout` Grid / Wrap, `Split`, `ItemsSource`/`ItemTemplate`, recycling, virtualization | skipped | |
| `SkiaLabel` | partial | Single line, `Text`, `FontSize`, `TextColor`, `FontFamily`. No wrap, `MaxLines`, alignment, spans, `AutoSize`, font weight. |
| `SkiaHotspot` | ported | Fill/Fill, `Tapped`, `Down`, `Up`, `LockPanning`, `TouchDown`; consumes only Tapped like the C# one. No `AnimationTapped`/ripple/shimmer. |
| `SkiaButton` | partial | Default look only: rounded frame radius 8 (hardcoded like the C# default content), centered label, `Text`/`TextColor`/`FontSize`/`FontFamily`/`BackgroundColor`/`IsPressed`/`IsDisabled`/`LockPanning`, `Tapped`/`Down`/`Up`. `IsPressed` is tracked but has no visual; press feedback = `ApplyEffect="Ripple"`. No `ButtonStyle` platform looks, icons, `TextCase`, elevation, shimmer, `BtnText`/`BtnShape` templating. |
| `SkiaImage` | partial | `Source` (URL), `Aspect` (all `TransformAspect` values except `Tile`, same `RescaleAspect` math), `HorizontalAlignment`/`VerticalAlignment`, `Success`/`Error`, `IsLoading`, `LoadedSource`, `DisplayRect`, `AspectScale`; overflow clipped to the box. Not ported: `LoadSourceOnFirstDraw`, `PreviewBase64`, `ImageBitmap`/`LoadedImageSource`, `RescaleSource`/`CacheRescaledSource`/`RescalingQuality`, all adjustments (`Brightness`…`Blur`, `ColorTint`, gradient, `Zoom*`, offsets), sprites, `DrawWhenEmpty`, `EraseChangedContent`, `UseAssembly`. Measure: bounded box taken as is, unbounded axis from source aspect; no `NeedAutoWidth/Height` from Start alignment. |
| `SkiaImageManager` | partial | `Instance.LoadImageAsync(url)`, `PreloadImages(urls)`, `ReuseBitmaps`, `Clear()`; in-memory cache of decoded images only. No `CacheLongevitySecs` eviction, no platform loaders, no `LoadImageOnlineAsync` retry policy. |
| `SkiaSvg` | partial | `Source` (URL) / `SvgString`, `Aspect` (default `AspectFitFill`, uses the shared `RescaleAspect` math, not SkiaSvg's own matrix path), alignments, `TintColor` (SrcIn), `Success`/`Error`, `IsLoading`, `DisplayRect`. Rendering: browser decodes the SVG, rasterized at the displayed pixel size and cached per size (CanvasKit npm has no SVG module). Not ported: shadows, FontAwesome duotone colors, `FillGradient`, `Zoom*`/offsets/`InflateAmount`, `IconFilePath`/embedded resources, `UseCache=Operations` default (no caching yet). |
| `SkiaShape`, `SkiaScroll`, everything else | skipped | |

## Startup

| Area | Status | Notes |
|---|---|---|
| `Super.UseDrawnUi().ConfigureFonts(f => f.AddFont(src, alias)).BuildAsync()` | ported | Same shape as DrawnUi.Net/OpenTK. |
| `AddFont(src, alias, weight)`, font fallback, emoji | skipped | |
| `PreloadAssets`, `ConfigureStyles` | skipped | |

## React layer

| Area | Status | Notes |
|---|---|---|
| Custom `react-reconciler` renderer, PascalCase props mapped 1:1 to control properties | ported | |
| React context bridging across the `<Canvas>` boundary | skipped | Contexts from the DOM tree are not visible inside the drawn tree. |
| Refs to engine controls from JSX | skipped | `getPublicInstance` returns the control, `ref` not wired/typed. |
| Fluent code-behind API (`.Assign`, `.OnTapped`, `.ObserveProperty`) | skipped | Engine classes are plain TS classes; React is the composition layer. |
