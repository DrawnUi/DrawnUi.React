# Skipped vs DrawnUi (.NET)

Ledger of what the prototype deliberately does not port yet. Everything that IS ported keeps the
DrawnUi name and semantics; nothing here is a redesign, only an omission.

## Engine

| Area | Status | Notes |
|---|---|---|
| `UseCache` | partial | `None`, `Operations` (SkPicture replay), `Image` (offscreen surface snapshot, GPU-backed on WebGL, nearest-sampled blit). `GPU`, `ImageDoubleBuffered`, `ImageComposite`, `ImageCompositeGPU` accepted but resolve to `Image` (no double buffer, no per-child composite, no dedicated GPU path). `Super.CacheEnabled`, `RenderObject`/`CachedObject`, `InvalidateCache`, `DestroyRenderingObject`, `Canvas.DisposeObject` (deleted after flush). Defaults per C#: `SkiaLabel`/`SkiaSvg` Operations, everything else None. Not ported: `CacheSharing`, `AllowCaching`, effects margin expansion of the cache surface, `RenderObjectPrevious` fallback, offscreen bake threads, `DrawPlaceholder`, cache validity by GRContext. |
| Incremental invalidation | partial | `Measure` returns the previous size when `!NeedMeasure` and constraints+scale are unchanged; `Update()`/`InvalidateMeasure()` bubble up and stale every ancestor cache; `Repaint()` keeps caches. Arrange still runs per frame for the whole tree; no dirty regions, no `DirtyChildrenTracker`. Post-animators on a control nested INSIDE a cached ancestor are drawn only when that ancestor re-records. |
| Gestures core: `Canvas.Gestures` (Disabled/Enabled/Lock), `ProcessGestures(args, apply)`, `ConsumeGestures`, `Tapped`/`ChildTapped`, `InputTransparent`, `BlockGesturesBelow`, `LockChildrenGestures`, `HitBoxAuto`/`HitIsInside`/`IsGestureForChild`, `SkiaGesturesParameters`/`GestureEventProcessingInfo`/`SkiaGesturesInfo`/`ControlTappedEventArgs` | ported | Pointer events -> per-pointer `OnTouchAction` state machine (port of DrawnUi.Blazor) -> Down/Panning/Tapped/Up, queued and processed at frame start. Tap slop = 16pt like AppoMobi TouchEffect. |
| Gestures: `LongPressing`, `Pointer` (hover), multi-touch pinch, velocity, `SoftLock`, `AddGestures` attached props, `OnGestures` delegate, transform-aware mapping (`HasTransform`, cache offsets `TranslateInputCoords`) | skipped | Enum members exist for parity, never produced. `ChildOffset` is always zero (no caches/transforms yet). |
| C# multi-subscriber `event`s | changed shape | One callback per event prop (`Tapped={fn}`), same names. `Command*` (ICommand) variants not ported. |
| `Opacity`, `Rotation`, `TranslationX/Y`, `Scale`, transforms | skipped | |
| Clipping to bounds, `ClipEffect`, `IsClippedToBounds` | skipped | Children can overflow their parent. |
| `Padding` on base `SkiaControl` | skipped | Only `SkiaLayout.Padding` exists. |
| `MinimumWidthRequest`/`MaximumWidthRequest` (+Height) | ported | Same semantics as C#: `-1` = unset; `WidthRequest` wins over `MaximumWidthRequest`; the maximum caps both the measured size and the arranged Fill box, alignment still uses the parent's full box (a centered `Fill` child with `MaximumWidthRequest` stays centered). |
| `LockRatio` | ported | Same as C#: a single set `WidthRequest`/`HeightRequest` drives both sides (`CalculateSizeRequest`), otherwise the constraints are locked with `SmartMax`/`SmartMin` × \|ratio\| (sign decides larger/smaller side, infinite side loses). |
| `HorizontalFillRatio`/`VerticalFillRatio` | skipped | |
| `ZIndex` | skipped | Children draw in declaration order. |
| `FillGradient` | partial | Linear only, on the background of any control (`Type`, `Colors`, `Start/End*Ratio`). No radial/sweep, no `Light`, no `SkiaLabel.FillGradient` on glyphs, no `StrokeGradient`. |
| `SkiaShell` | partial (React-level) | `Routes` (route -> JSX page factory), `GoToAsync`, `GoBackAsync`, `NavigationStack`, `CanGoBack`, nav bar with Back + title, `useShell()`. Not ported: engine-level shell, page transitions, modals, popups, toasts, tabs, hardware/browser back, `RegisterRoute` by type, `ShellLayout`/`RootLayout` tags, insets. |
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
| `SkiaLayout` templated (Column only): `ItemsSource` (array), `ItemTemplate` (factory `() => SkiaControl`), `RecyclingTemplate` Enabled/Disabled, `MeasureItemsStrategy` `MeasureFirst` (uniform, O(1) for 100k items) / `MeasureAll`, `ChildrenFactory` (ViewsAdapter pool: `GetOrCreateViewForIndex`, `ReleaseViewAt`), `FirstVisibleIndex`/`LastVisibleIndex`, `DebugString`, `ApplyItemsSource`, `VirtualisationInflated`, `BindingContext`/`ContextIndex` on every control, `SkiaDynamicDrawnCell.SetContent` | ported | Cells realized/bound/arranged/drawn only for the visible viewport (+inflation) each frame. |
| Templated Row/Grid/Wrap, `Split`, `MeasureVisible` + background measurement, `ItemTemplateSelector`, `ItemTemplatePoolSize`/`ReserveTemplates`, `ItemsSourceWindow`, `ObservableCollection` change events (only whole-array replacement is observed), `UsePreparedViews`, `SkiaCachedStack`, `LoadMore*`, structure-preserving inserts/removes, measure memo | skipped | |
| `SkiaLayout` Wrap (static children) + `SkiaWrap` alias | ported | Left-to-right flow, `Spacing` between items and rows, row height = tallest item. Not ported: `Split`, main-axis `Fill` children sharing a row (1.9.7.4 flex-fill), `UseDynamicColumns`, RTL. |
| `SkiaLayout` Grid (static children) + `SkiaGrid` alias | ported | Port of `SkiaGridStructure` (MAUI grid manager): `ColumnDefinitions`/`RowDefinitions` as `"*, 2*, Auto, 100"` or arrays, `DefaultColumnDefinition`/`DefaultRowDefinition` (Auto, like C#), `ColumnSpacing`/`RowSpacing`, child `Column`/`Row`/`ColumnSpan`/`RowSpan` (plain props instead of attached properties), implicit tracks, unknown/known measure passes, span resolution, star compression, Fill-child minimums, last-track stretch when the grid fills, remeasure at final cells. Not ported: `Split`/`Invert` (templated grids), `UseDynamicColumns`, `SkiaDecoratedGrid`, `GetOrderedSubviews` ZIndex ordering. |
| `SkiaLabel` | partial | Word wrap (+ character break for long words), `MaxLines` with tail ellipsis, `LineBreakMode` (NoWrap / wraps / Tail; Head/Middle behave as Tail), `HorizontalTextAlignment` Start/Center/End (Fill* accepted, align Start), `VerticalTextAlignment`, `LineSpacing`, `LineHeight`, `FontWeight` + `FontAttributes` via faces registered per weight (`AddFont(src, alias, weight)`, nearest weight wins; italic = synthetic skew when no italic face), `TextTransform`, `Padding`, `LinesCount`; defaults as C# (`FontSize` 12, `TextColor` GreenYellow). `FontFamilyFallback` ported and extended: comma-separated chain (`"FontSymbols,FontSymbols2"`), per-codepoint run segmentation, spaces always stay on the main font; `fonts.AddSymbols()` (`FontSymbols` = Noto Sans Math subset, `FontSymbols2` = Noto Sans Symbols 2 subset) and `fonts.AddEmojis()` (`FontEmoji` = Noto Color Emoji faces+hands subset) ship the same subsets as DrawnUi.Blazor. `Spans` ported as `<TextSpan>` children: `Text`, `TextColor`/`FontSize`/`FontFamily` (unset = inherit from the label, like C# HasSetColor/HasSetSize/HasSetFont), `FontWeight`, `IsBold`, `IsItalic`, `Underline`/`UnderlineWidth`, `Strikeout`/`StrikeoutWidth`/`StrikeoutColor` (Red default), `BackgroundColor`, `Tapped` + `ForceCaptureInput` (hit-tested through per-fragment `Rects`, ripple on the label, `OnSpanTapped` overridable), mixed sizes on one line share a baseline. TextSpan not ported: `ParagraphColor`, `CommandTapped`, per-span `LineSpacing`/`LineHeight`, `AutoFindFont`, `DrawingOffset`, `Shape`/glyph shaping. Not ported: `AutoFont`, `CharacterSpacing`, `AutoSize`/`AutoSizeText`, `DropShadow*`, text `StrokeColor`/`StrokeWidth`/`StrokeGradient`, `GradientByLines`, `MonoForDigits`, `ParagraphSpacing`, `KeepSpacesOnLineBreaks`, `Format`, RTL/bidi, hyphenation, `SkiaRichLabel`/markdown. |
| `SkiaHotspot` | ported | Fill/Fill, `Tapped`, `Down`, `Up`, `LockPanning`, `TouchDown`; consumes only Tapped like the C# one. No `AnimationTapped`/ripple/shimmer. |
| `SkiaButton` | partial | Default look only: rounded frame radius 8 (hardcoded like the C# default content), centered label, `Text`/`TextColor`/`FontSize`/`FontFamily`/`BackgroundColor`/`IsPressed`/`IsDisabled`/`LockPanning`, `Tapped`/`Down`/`Up`. `IsPressed` is tracked but has no visual; press feedback = `ApplyEffect="Ripple"`. No `ButtonStyle` platform looks, icons, `TextCase`, elevation, shimmer, `BtnText`/`BtnShape` templating. |
| `SkiaImage` | partial | `Source` (URL), `Aspect` (all `TransformAspect` values except `Tile`, same `RescaleAspect` math), `HorizontalAlignment`/`VerticalAlignment`, `Success`/`Error`, `IsLoading`, `LoadedSource`, `DisplayRect`, `AspectScale`; overflow clipped to the box. Not ported: `LoadSourceOnFirstDraw`, `PreviewBase64`, `ImageBitmap`/`LoadedImageSource`, `RescaleSource`/`CacheRescaledSource`/`RescalingQuality`, all adjustments (`Brightness`…`Blur`, `ColorTint`, gradient, `Zoom*`, offsets), sprites, `DrawWhenEmpty`, `EraseChangedContent`, `UseAssembly`. Measure: bounded box taken as is, unbounded axis from source aspect; no `NeedAutoWidth/Height` from Start alignment. |
| `SkiaImageManager` | partial | `Instance.LoadImageAsync(url)`, `PreloadImages(urls)`, `ReuseBitmaps`, `Clear()`; in-memory cache of decoded images only. No `CacheLongevitySecs` eviction, no platform loaders, no `LoadImageOnlineAsync` retry policy. |
| `SkiaSvg` | partial | `Source` (URL) / `SvgString`, `Aspect` (default `AspectFitFill`, uses the shared `RescaleAspect` math, not SkiaSvg's own matrix path), alignments, `TintColor` (SrcIn), `Success`/`Error`, `IsLoading`, `DisplayRect`. Rendering: browser decodes the SVG, rasterized at the displayed pixel size and cached per size (CanvasKit npm has no SVG module). Not ported: shadows, FontAwesome duotone colors, `FillGradient`, `Zoom*`/offsets/`InflateAmount`, `IconFilePath`/embedded resources, `UseCache=Operations` default (no caching yet). |
| `SkiaScroll` | partial | `Orientation` Vertical/Horizontal/Both, single `Content`, `ViewportOffsetX/Y` (points, <= 0), pan with the C# 0.85 delta interpolation, fling on the DrawnUi deceleration curve (`FrictionScrolled`, `ChangeVelocityScrolled`, `MaxVelocity`, edge-cut duration), rubber-band overscroll (`Bounces`, `RubberEffect`) + spring bounce (`RubberDamping`, `MaxBounceVelocity`), mouse wheel (`WheelLineSize`, `AutoScrollingSpeedMs`, notches accumulate onto the running target), `ScrollTo`/`ScrollToTop`/`ScrollToBottom`/`StopScrolling`, `Scrolled`, `IgnoreWrongDirection`, `RespondsToGestures`, `IsUserPanning`/`IsScrolling`, `ContentSize`, `ContentOffsetBounds`, `OverScrolled`. Not ported: `Header`/`Footer` (sticky, parallax, behind), `RefreshIndicator`/pull-to-refresh, scroll bars, `SnapToChildren`, `TrackIndexPosition`, `ScrollToIndex` with `Center`/deferred ordered scroll for unmeasured indexes (Start/End on measured structures ported), `LoadMore*`, zoom (`ViewportZoom`, `ZoomLocked`), `ReverseGestures` (inverted chat), keyboard adaptation, `ResetScrollPositionOnContentSizeChanged`, pixel-aware fling finish, `ContentOffset`, `ScrollType`, virtualization hooks (`Virtualisation`, `UseVirtual`, windowed content bounds). |
| `SkiaShape` (+ `SkiaFrame`) | partial | `Type` Rectangle/Circle/Ellipse/Arc (`Value1` start, `Value2` sweep)/Polygon+Line (`Points` ratios)/Path (`PathData`, fitted + centered), `CornerRadius` (uniform or per-corner), `StrokeWidth` (points, negative = px) drawn inside the bounds, `StrokeColor`, `StrokeCap`, `ClipBackgroundColor`, children laid out inside the stroke and clipped to the shape, `CreateClip` = shape, `FillGradient` fill, `UseCache=Operations` default. Not ported: `Squricle`, `Custom`, `SmoothPoints`, `StrokePath` (dashes), `StrokeGradient`, `StrokeBlendMode`, `Bevel`/`BevelType`, `Shadows`, sub-1px stroke compensation, `MeasuredStrokeAware*` exposure, `LayoutChildren` override hook. |
| `SkiaButton` | partial | Now a `SkiaLayout` hosting a `SkiaShape` frame (`Tag="BtnShape"`) + `SkiaLabel` (`Tag="BtnText"`), sized from the label + Padding; `CornerRadius` (default 8), `StrokeColor`/`StrokeWidth`, `BackgroundColor`, text props, `ApplyEffect`, `Tapped`/`Down`/`Up`. Still no `ButtonStyle` looks, icons, `TextCase`, elevation, shimmer, custom templating through tags. |
| Everything else (`SkiaEditor`, `SkiaSwitch`, `SkiaCheckbox`, `SkiaSlider`, `SkiaProgress`, `SkiaCarousel`, `SkiaDrawer`, `SkiaLottie`, `SkiaGif`, `SkiaSprite`, `SkiaCamera`, `SkiaMauiElement`, ...) | skipped | |

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
| `SkiaButton.FontFamilyFallback` | React extension | Pass-through to the inner label so icon-glyph buttons render with `AddSymbols()` faces. |
| Accessibility (`ISkiaAccessibilityNode` + `SkiaAccessibilityManager` + Blazor ARIA overlay) | ported | `AccessibilityRole/Label/Hint/CanInteract/IsPressed/Live`, `Aria` constants, `IsAccessibilityElement`, `GetAccessibilityPixelRect`, `NotifyAccessibility`, `OnAccessibilityActivated` (synthetic Tapped), `OnAccessibilityFocused`, snapshot rate-limited by `MinUpdateIntervalMs`, top-left reading order, `SkiaButton` hides its inner label. Extensions: per-class `DefaultAccessibilityRole`, label/interaction defaults derived from text / `Tapped`, `pointer-events:none` overlay, detached/off-canvas nodes pruned at rebuild (no explicit unregister on removal). Not ported: `WithAccessibility*` fluent helpers, `FocusChanged` event consumers, UIA/AT-SPI (browser only), `aria-level` for headings. |
| React context bridging across the `<Canvas>` boundary | skipped | Contexts from the DOM tree are not visible inside the drawn tree. |
| Refs to engine controls from JSX | skipped | `getPublicInstance` returns the control, `ref` not wired/typed. |
| Fluent code-behind API (`.Assign`, `.OnTapped`, `.ObserveProperty`) | skipped | Engine classes are plain TS classes; React is the composition layer. |
