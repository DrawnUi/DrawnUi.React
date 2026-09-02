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
| `LockRatio`, `HorizontalFillRatio`/`VerticalFillRatio` | skipped | |
| `ZIndex` | skipped | Children draw in declaration order. |
| Styles / `ConfigureStyles` | skipped | |
| Animations (`AnimatorBase`, `FadeToAsync`, ...) | skipped | |
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
| `SkiaButton` | partial | Default look only: rounded frame radius 8 (hardcoded like the C# default content), centered label, `Text`/`TextColor`/`FontSize`/`FontFamily`/`BackgroundColor`/`IsPressed`/`IsDisabled`/`LockPanning`, `Tapped`/`Down`/`Up`. Pressed = 20% black overlay, no animation. No `ButtonStyle` platform looks, icons, `TextCase`, elevation, shimmer, `BtnText`/`BtnShape` templating. |
| `SkiaShape`, `SkiaImage`, `SkiaSvg`, `SkiaScroll`, everything else | skipped | |

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
