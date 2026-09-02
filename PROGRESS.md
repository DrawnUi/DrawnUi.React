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
| 2026-09-02 | Glyph fallback | `SkiaLabel.FontFamilyFallback` chain (per-codepoint runs, spaces on main font), `ConfigureFonts` `AddSymbols()` / `AddEmojis()` with the Blazor Noto subsets (`FontSymbols`, `FontSymbols2`, `FontEmoji`); Text snippet card |
| 2026-09-02 | Responsive demo | `MinimumWidthRequest`/`MaximumWidthRequest` (+Height), `SkiaLayout` Wrap + `SkiaWrap`; demo pages fluid on 390-px phones (verified in an iframe harness at 390 and 760): root cards, Images/Shapes wrap, Text alignment rows wrap, cells toolbar wraps at the bottom, nav title reserves Back space |
| 2026-09-02 | Spans | `TextSpan` as `<SkiaLabel>` children (reconciler mounts non-control children): inherit-or-override color/size/family, weight/bold/italic, underline, strikeout, background, `Tapped` with per-fragment hit rects + ripple; line height per line from the tallest run, glued fragments wrap as one word; Text snippet card |
| 2026-09-02 | Accessibility | Port of the DrawnUi.Blazor model: `Accessibility*` props on `SkiaControl`, `Aria` constants, `Canvas.AccessibilityManager` snapshot (≤1 rebuild/s, deferred frame on an on-demand renderer), `<Canvas>` renders an `aria-hidden` canvas + ARIA overlay with keyboard/AT activation routed as `Tapped`; `DefaultAccessibilityRole` statics; demo: labels readable, cards/buttons focusable, headings, logo img. Verified with the browser accessibility tree + Tab/Enter/Space + mouse click through the overlay |
| 2026-09-02 | Image effects + clipping | `SkiaImage.AddEffect` family (color matrices ported from `SkiaImageEffects`), `Blur`, `ZoomX/Y`, offsets; `IsClippedToBounds` / `ClipEffects` with subtree effects-margin aggregation; Images snippet "Effects" row, Layouts snippet clip card |
| 2026-09-02 | Shadows | `SkiaShape.Shadows` (`SkiaShadow`), drop-shadow image filter per shadow, hollow-shape shadows, caches expanded by the effects margin (`ComputeEffectsMargin`); style shadows on button frames, switch thumbs and slider thumbs; Shapes snippet "Shadows" row |
| 2026-09-02 | Carousel: looped, templated, preload, dynamic size, speeds | `SkiaCarousel` now covers the rest of the C# surface: `IsLooped` (virtual anchors, wrap both ways, teleport after the wrap), `ItemsSource`/`ItemTemplate` recycled slides, `PreloadNeighboors`, `DynamicSize`, `SwipeSpeed`, `LinearSpeedMs`, `ItemAppearing`/`ItemDisappearing`, `ScrollAmount`/`TransitionProgress`/`LastIndex`; `SnappingLayout` gained the C# transition rules (`CheckTransitionEnded` false while a snap animator runs, per-frame `InTransition`, silent stop on interrupt) and overridable snap tuning. `SkiaButton.ApplyEffect` defaults to `Ripple` like C#. Snippet: Sandbox-style playground (Loop / Bounces / PreloadNeighboors / IsVertical / SidesOffset toggles, Prev/Next/ScrollTo, indicators, status, SwipeSpeed 0.5/1/2), looped templated card (12 recycled cells), DynamicSize card; drawer header with top-only `CornerRadius(20, 20, 0, 0)`. Verified: Prev at 0 → 3 / 11 (wrap), Next → 0, swipes 0→1→2, vertical swipe → 1, DynamicSize 80 → 160 pt, bounces + 2.0x, arrows via `FontFamilyFallback` |
| 2026-09-02 | Carousel & Drawer | `SnappingLayout` base (anchors by velocity, spring/linear snap, rubber clamp) + `SkiaCarousel` (static children, `SidesOffset` peek, `SelectedIndex`, `GoNext/GoPrev/ScrollTo`) + `SkiaDrawer` (`Direction`, `HeaderSize`, `IsOpen`, `Open/Close`, drag + velocity snap); "Carousel & Drawer" snippet: two carousels, bottom drawer over the page. Verified: swipe → index 1, Next → 2, ScrollTo(3) → 3, button opens, header drag down closes, drag up opens, inner Close button closes |
| 2026-09-02 | Platform Looks (small controls) | `SkiaToggle` base + `SkiaSwitch`, `SkiaCheckbox`, `SkiaRadioButton` (groups), `SkiaProgress`, `SkiaSlider` (single + range, drag, click-on-trail), `SkiaButton.ControlStyle`; every control carries the Default / Windows / Cupertino / Material / Material3 looks of the C# style builders; "Platform Looks" snippet = port of the Fiddle preset (one card per style). Verified: tap toggles, radio exclusivity, slider click 24 → drag 77, a11y roles switch/checkbox/radio (`aria-checked`), progressbar, slider |
| 2026-09-02 | LoadMore + incremental ItemsSource | `SkiaScroll.LoadMoreCommand/LoadMoreTopCommand` (+offsets) with C# arming rules; `ItemsSource` array diff keeps measured heights on append, shifts indices and anchors the scroll offset on prepend (`ItemsInsertedAtStart`); Uneven cells snippet pages 100 more at the bottom and 30 older at the top (chat-style), verified: 200→300→400 appends land at the end, prepend keeps Post 1 in place, 60 fps |
| 2026-09-02 | SkiaRichLabel | Markdown → spans: headings, paragraphs, lists, fenced/inline code, bold/italic/strike, links with `LinkTapped`; style props as C# (`LinkColor`, `CodeTextColor`, `HeadingTextColor`, `Code*BackgroundColor`, `PrefixBullet/Numbered`, `UnderlineLink/Width`, `MarkdownEnabled`); Text snippet card. Fix: empty `FontFamily` now resolves to the first registered family with its weights + synthetic bold when no bold face |
| 2026-09-02 | Layouts snippet | Absolute (SkiaLayer alignment grid + icon/text pattern), Column, Row demos next to Grid and Wrap |
| 2026-09-02 | MeasureVisible | Uneven recycled rows: viewport-filling initial pass, exact prefix + average estimate, on-demand measurement of visible cells, idle-time background pass (`requestIdleCallback`, budgeted), `ScrollToIndex` on estimates; `ImageDoubleBuffered` keeps the previous cache + `DrawPlaceholder`; "Uneven cells" snippet: 10 000 rows of 1–6 lines, 10k measured in ~2 s idle, 60 fps, HOME/MIDDLE/END land correctly |
| 2026-09-02 | Transforms | `TranslationX/Y`, `Rotation`, `ScaleX/Y`/`Scale`, `SkewX/Y`, `AnchorX/Y`, `Opacity` applied at render (C# `ApplyTransforms` order, `saveLayer` alpha); gestures map through the inverse `RenderTransformMatrix`; `*ToAsync` animations (Promise + AbortSignal); `RepaintComposition()` stales ancestor caches only; React transform props repaint without invalidating; Transforms snippet (tiles, rotated+scaled tappable button, animated logo, spin loop) |
| 2026-09-02 | Accessibility snippet | Dedicated page: snapshot status (live region), buttons with hint / custom label / disabled, toggles (`aria-pressed`), shape-as-button, img, presentation opt-out, headings. Keyboard reaches off-screen nodes: `SkiaScroll.EnsureVisible(control)` scrolls the focused control into view, overlay stays pinned; pooled recycled cells are detached (`Parent = undefined`) so they never appear as ghost nodes |
| 2026-09-02 | Fix | `LockRatio` + `WidthRequest`: requests are locked before constraints (C# `CalculateSizeRequest`), a 40pt circle no longer balloons to a tall grid row |
| 2026-09-02 | Grid | `SkiaLayout` Type=Grid + `SkiaGrid`: 1:1 port of `SkiaGridStructure` (star/Auto/absolute tracks, spans, spacing, implicit tracks, last-track stretch, final-cell remeasure); child `Column`/`Row`/`ColumnSpan`/`RowSpan`; Layouts snippet (grid + wrap) |
| 2026-09-02 | Scrolling | `SkiaScroll` plain content: pan, deceleration fling cut at edges, rubber-band + spring bounce, wheel, `ScrollTo*`, `Scrolled`; physics classes `ScrollFlingAnimator`, `DecelerationTimingParameters`, `SpringWithVelocityAnimator`, `VelocityAccumulator`, `RubberBandUtils` |

## In progress

- nothing

## Next

1. ~~`SkiaShape`~~ done (Rectangle/Circle/Ellipse, `CornerRadius`, stroke, children clipped) → real `SkiaButton` templating (`BtnShape`/`BtnText`).
2. ~~`SkiaLabel` spans~~ ~~`SkiaRichLabel`~~ done → `SkiaEditor`/text input.
3. ~~`SkiaLayout` Grid~~ done, ~~Wrap~~ done → templated `Split` grids, `SkiaDecoratedGrid`.
4. ~~`MeasureVisible`~~ done; ~~`ImageDoubleBuffered`~~ previous-cache + placeholder (sync record, as Blazor).
5. `SkiaLabel` wrapping, `MaxLines`, alignment, font weights.
6. ~~Transforms + gesture mapping~~ done → 3D (`RotationX/Y`, `Perspective`), `Left`/`Top` cache offsets.
7. ~~`LoadMore`, structure-preserving inserts~~ done; `ItemsSourceWindow` judged unnecessary (see SKIPPED) → `SkiaEditor`/text input, ~~`SkiaSlider`/`SkiaSwitch`/`SkiaCheckbox`~~ done, ~~`SkiaCarousel`/`SkiaDrawer`~~ done, `SkiaLottie`/`SkiaGif`.

## Web-specific divergences (deliberate)

- No SVG module in CanvasKit npm → `SkiaSvg` rasterizes via the browser per displayed size.
- Single-threaded: no offscreen bake threads; anything "background" in DrawnUi becomes a frame-budgeted job here.
- Gesture events are queued and processed at frame start (DrawnUi rule) but delivered by the browser at pointer-event rate.
