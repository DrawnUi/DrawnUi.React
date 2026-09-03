# Parity notes: DrawnUi.React vs DrawnUi (.NET)

Behavioural differences between the two implementations that are NOT plain omissions (those live in
[SKIPPED.md](SKIPPED.md)). Each entry says what differs, why, and whether the .NET side should adopt it.
Updated whenever the port deliberately diverges or finds something worth back-porting.

## Scrolling

### Viewport offset snapped to device pixels while moving
- **React**: `SkiaScroll.ArrangeContent` rounds `offset × scale` every frame (drag, fling, bounce, wheel).
- **.NET**: `SkiaScroll.PositionViewport` rounds `offsetPixels` only when `!IsUserPanning && !IsScrolling`
  (and once after init). While moving, content sits at fractional pixels; cached cells look stable only because
  `CachedObject.Draw` blits the bitmap with nearest sampling, which snaps as a side effect. Uncached text shimmers
  while scrolling (each glyph re-rasterized at a new sub-pixel phase per frame).
- **Opinion — adopt in .NET: yes.** Two lines in `PositionViewport` (round unconditionally). Benefits: uncached
  or `Operations`-cached content becomes as stable as `Image`-cached cells; the round happens where the code already
  rounds at rest, so anchor/offset math downstream is unchanged. Cost: on low-DPR screens the slow fling tail steps
  by whole device pixels — exactly what `ScrollFlingAnimator`'s pixel-aware finish (`FinishStepPixels`, gated by
  `PixelAwareFlingFinishBelowScale`) already smooths; on high-DPR the quantum is sub-visual. Verify with the fling
  harness (paint cadence + applied px offsets) before shipping; watch `OffsetVisibleAnchorY` paths, which pass
  fractional points and must not fight the round.

### Mouse-wheel notches accumulate onto the running target
- **React**: `ApplyWheelScroll` starts from the running animator's `Parameters.Destination` when one is active, so N
  notches inside one frame travel N × `WheelLineSize`.
- **.NET**: `ApplyWheelScroll` starts from `ViewportOffsetY`, which has barely moved when notches arrive faster than
  frames; each new `ScrollTo` stops the previous one — a fast spin collapses to roughly one step.
- **Opinion — adopt in .NET: yes**, same shape: `var from = _animatorFlingY.IsRunning ? _animatorFlingY.Parameters.Destination : ViewportOffsetY`.

## Caching

### Text properties invalidate like bindable properties
- **Both**: `SkiaLabel.Text/FontSize/TextColor/FontFamily` are accessors that call `Update()` (C#: BindableProperty
  changed callbacks). Plain public fields on other controls do NOT invalidate when assigned directly — React props go
  through `applyProps` which calls `Update()`, but engine-level code must call `Update()` itself after mutating a field.
  Converting the remaining hot properties to accessors is pending.

## Text

### Font weights are registered per alias
- **Both**: `ConfigureFonts(f => f.AddFont(source, alias, weight))`; `FontWeight`/`FontAttributes=Bold` resolve to the nearest
  registered weight of the alias (400 = default). React adds: italic without an italic face = synthetic skew (-0.25), the C#
  side has no synthetic italic. Defaults adopted from C#: `FontSize` 12, `TextColor` GreenYellow (unstyled text stays visible).
- **`FontFamilyFallback` chain (React extension)**: C# takes ONE fallback alias; React accepts a comma-separated chain
  (`"FontSymbols,FontSymbols2"`) tried in order per codepoint, and spaces are never moved to a fallback run (keeps word gaps
  at the main font's width). Opinion: worth back-porting to .NET — a single fallback cannot cover arrows (Math) and
  ♥/★ (Symbols 2) at once, which is exactly the split `AddSymbols()` ships.

### Markdown parser
- C# `SkiaRichLabel` parses with CommonMark.NET; React ships a small hand-written parser (headings, lists, fenced
  code, inline emphasis/code/links, escapes). Same span output rules (`SpanWithAttributes`), same style properties.
  Code blocks: C# paints `ParagraphColor` across the full line width, React paints the span background only.
  Not worth a dependency for the demo; swap in a CommonMark library if edge cases matter.

### Span decorations use estimated metrics
- C# reads `UnderlinePosition` / `StrikeoutPosition` / `XHeight` from the SKFont metrics and falls back to
  1 px / half x-height when a face lacks them. CanvasKit exposes none of the three, so React always uses the
  C# fallbacks: underline at `baseline + 1 scaled px`, strikeout at `baseline - 0.26 * fontSize` (x-height ≈ 0.52 em).
  Visually identical for OpenSans; faces with unusual x-height may sit the strike a pixel off.
- Spaces: a span fragment starting/ending with a space contributes a break opportunity but the space itself is not
  painted with the span's `BackgroundColor` (C# paints it). Cosmetic; not worth changing on either side.

## Layout

### Grid attached properties are plain child props
- C#: `draw:SkiaLayout.Column="1"` attached bindable properties. React: `Column={1}` / `Row` / `ColumnSpan` / `RowSpan`
  props on any control (fields on `SkiaControl`, read by the grid only). Same defaults (0 / 0 / 1 / 1), no behaviour change.

### `MaximumWidthRequest` / `MaximumHeightRequest`
- Same as C# (1.10.5.18+): caps the measured size AND the arranged Fill box; alignment uses the parent's full box. Used by
  the demo for responsive pages (`SkiaStack MaximumWidthRequest={720} HorizontalOptions="Center"`) — fluid below the cap,
  fixed above it, no media queries.

## Lists

### ItemsSource changes are diffed, not observed
- **C#**: `ObservableCollection` events say exactly what changed.
- **React**: state is immutable arrays; the layout compares old/new (first/middle/last element identity) to recognise
  append and prepend and keeps its structure; anything else rebuilds. Same user-visible result for the paging and
  chat-history cases; an in-place removal costs a rebuild here. Opinion: nothing to back-port, .NET has the events.

### MeasureVisible measures visible cells on demand, not only in the background
- **C#**: initial measured batch + background batches; a cell entering the viewport before its batch arrives uses
  the estimate until measured.
- **React**: a cell entering the viewport is measured right there (it is being bound anyway) and laid out with its
  real height, the estimate is used only for the anchor offset of the first visible item; the idle pass then
  extends the exact prefix. Result: no visible resize of on-screen cells, only the far-away offsets refine.
- Opinion: back-portable and cheap on .NET too (measure at bind time in `DrawStack` when the height is unknown).

### Recycled cells contract
- Same in both: the templated `SkiaLayout` (ItemsSource + ItemTemplate) is the `SkiaScroll`'s ONLY content; anything
  above the list goes above the scroll or into the scroll `Header` (not ported yet). Nesting the templated layout inside a
  static stack makes it a BindableLayout, not a CollectionView, and `ScrollToIndex` requires Content to be the layout.
- **React-only rule**: `ItemTemplate` must be a stable function reference (module-level or `useCallback`). A new arrow on
  every render is a new template → the pool is rebuilt each render (C# XAML sets `DataTemplate` once, so it never hits this).

## Colors

### Hex alpha position
- **Both**: 8-digit hex is `#AARRGGBB` (MAUI `Color.FromArgb`), 4-digit is `#ARGB`. All color strings go through
  `Super.ParseColor`; CanvasKit's own `parseColorString` (CSS `#RRGGBBAA`) is used only for `rgb()/rgba()` strings.
  Web developers used to CSS must be told — `"#22FFFFFF"` is 13% white here, not opaque cyan.

## Transforms

### Transform / Opacity changes stale ancestor caches, not the control's own
- **C#**: transform properties call `RedrawCanvas`; whether a cached parent re-records depends on the invalidation path.
- **React**: `RepaintComposition()` marks every ancestor cache dirty (their pictures contain this control's composited
  output) and keeps the control's own cache (content unchanged); the reconciler routes transform/opacity prop changes
  there instead of `Update()`, so animating a child never remeasures. Found the hard way: the animated logo lived
  inside an `Operations`-cached `SkiaShape` and did not move until the parent was re-recorded.
- Opinion: matches what DrawnUi does at the top cached container; nothing to back-port beyond making sure a child's
  transform change invalidates the parent's cache on every path.

### Cancellation and skew
- C# `*ToAsync` take a `CancellationTokenSource`; React takes an `AbortSignal` and rejects with `AbortError`.
- C# ignores negative `SkewX/SkewY` (`> 0` check); React applies both signs. Opinion: C# check looks accidental.

## Effects

### ClipEffects is honoured
- C# `WillClipEffects` exists but the render path always expands the clip by the effects margin. React: with
  `IsClippedToBounds`, `ClipEffects=true` (default) clips to the exact box, `false` expands by the aggregated
  effects margin. Opinion: wire `WillClipEffects` into `DrawWithClipAndTransforms` on .NET, it is a one-line gate.

### Color matrix units
- SkiaSharp `CreateColorMatrix` translations are 0..255, CanvasKit `MakeMatrix` 0..1; React divides the C# constants
  so `Darken=5` looks the same on both. Gamma has no table filter in CanvasKit — linear approximation.

## Accessibility

### Overlay does not capture pointer events
- **C# (Blazor)**: the ARIA overlay elements sit above the canvas and receive clicks, so a control with
  accessibility metadata stops getting `Pointer` (hover) gestures — documented limitation.
- **React**: overlay elements have `pointer-events: none`; real pointers always reach the canvas, keyboard and
  screen-reader activation arrive as DOM `click`/`keydown` on the focused element and are routed as a `Tapped`.
  ATs that simulate a physical click at coordinates hit the canvas directly and work as well.
- Opinion: back-port to Blazor — one CSS rule on `.xaml-a11y-element` (`pointer-events: none`) plus keeping
  `tabindex`/`@onclick`/`@onkeydown` as they are; removes the hover limitation with no other change.

### Default roles per class
- **C#**: opt-in per control (`AccessibilityRole` null by default), `SkiaLabel` only syncs `AccessibilityLabel`.
- **React**: same opt-in, plus `SkiaLabel.DefaultAccessibilityRole` / `SkiaButton.DefaultAccessibilityRole` statics
  (unset by default) so an app can make every label/button accessible in two lines; `AccessibilityLabel` falls
  back to the control text, `AccessibilityCanInteract` to "has a Tapped handler".
- Opinion: worth back-porting as static defaults on `SkiaLabel`/`SkiaButton` — keeps the opt-in contract and gives
  "readable labels" without touching every control.

### Nodes pruned instead of unregistered
- **C#**: controls unregister on detach/dispose/visibility change.
- **React**: the snapshot rebuild drops nodes without a `Superview`, invisible, or farther than one canvas size
  outside it; rects are re-read from `DrawingRect`, so they follow scrolling. Behavioural difference: a removed
  node can linger up to `MinUpdateIntervalMs` in the DOM. Pooled recycled cells get `Parent = undefined` on release.

### Focus scrolls the drawn content into view
- **React-only**: when keyboard focus lands on an overlay node that is outside its `SkiaScroll` viewport,
  `SkiaScroll.EnsureVisible(control)` animates every scroll ancestor so the control is visible (browser
  behaviour for DOM pages). Opinion: back-port — Blazor users tabbing through a drawn list get the same
  experience as a native page; needs a `ScrollToView`-like helper plus the overlay `focus` callback.

## Rendering

### Redraw synchronously inside the resize callback
- **React**: the `ResizeObserver` callback recreates the surface and draws immediately (RO runs after layout,
  before paint), so a live window drag never presents a blank frame; the GL context/GrContext live for the Canvas
  lifetime, only the surface is recreated.
- **.NET**: platform views handle resize natively (SkiaSharp views recreate surfaces on size change and request a
  paint); Windows `DrawnSwapChainPanel` already owns surface recreation.
- **Opinion**: no action; noted so the web behaviour is understood as intentional.

### SVG rendering
- **React**: no SVG module in CanvasKit's npm build → browser decodes, raster per displayed size, `TintColor` via
  `SrcIn`. Effects that operate on the SVG picture (`FillGradient`, FontAwesome duotone) are not reproducible this way.
- **.NET**: `Svg.Skia` picture, vector at any scale.
- **Opinion**: web-only constraint; nothing to back-port.

## SkiaCarousel

### Wrong-direction check follows the carousel axis
- **React**: the first pan compares the movement along the carousel axis with the movement across it (`IsVertical` aware), using the total movement since Down.
- **.NET**: `movex < RenderingScale * 2 || movey > movex` on the per-event delta, regardless of `IsVertical` — a vertical carousel rejects its own vertical swipes.
- **Opinion**: back-port; pick the axis from `IsVertical`.

### LinearSpeedMs ratio in points
- **React**: `ratio = |end - start| / CellSize.Units`, so `LinearSpeedMs` is the time of exactly one slide.
- **.NET**: divides the unit displacement by `CellSize.Pixels.Width`, so one slide takes `LinearSpeedMs / RenderingScale` (350 ms becomes 175 ms on a 2x screen), which contradicts the doc comment.
- **Opinion**: back-port; use `CellSize.Units`.

### Programmatic SelectedIndex interrupts a running snap
- **React**: setting `SelectedIndex` (or `ScrollTo`) while a snap animates calls `InterruptSnapping` first, like `GoNext`/`GoPrev`, so the new target is honoured.
- **.NET**: only `GoNext`/`GoPrev` interrupt; a plain `SelectedIndex` set during `_isSnapping` is ignored by `OnSelectedIndexChanged` and the carousel ends on the old target while the property says otherwise.
- **Opinion**: back-port; call `InterruptSnapping()` from the `SelectedIndex` property changed handler.

## Animated frames

### Animator initialized on the first layout only
- **React**: `AnimatedFramesRenderer.OnLayoutChanged` runs on every frame (Arrange is per frame here), so the animator is created / auto-started only on the first layout; later `SetAnimation` calls initialize explicitly.
- **.NET**: `OnLayoutChanged` fires only on a real layout change, so `InitializeAnimator` + `Start` on every call is harmless.
- **Opinion**: no action for .NET; note for anyone porting the control to a per-frame-arrange engine.

### Overlay animators stale the ancestors' caches while running
- **React**: `RenderingAnimator.TickFrame` marks every ancestor cache dirty on each tick, so a ripple on a button inside a `UseCache=Image` card is drawn (the card re-records for the ~500 ms of the effect).
- **.NET**: the effect invalidates the parent through the regular `Update`/`Repaint` path.
- **Opinion**: same outcome; noted because the React cache model had to add it explicitly.

## SkiaBackdrop

### Ancestor caches staled after every backdrop paint
- **React**: a backdrop recorded into a cached parent (the demo card is a SkiaShape with the default Operations cache) kept a snapshot taken before the baboon image had loaded: the image's invalidation climbs its own branch and never reaches the sibling shape. After each paint the backdrop marks its ancestors' caches stale (microtask, no frame requested), so the next frame for any reason re-records it.
- **.NET**: the same tree in `MainPageBackdrop` works because the sandbox content loads before the first record or the page redraws for other reasons; a late-loading sibling would leave the same stale snapshot.
- **Opinion**: consider the same "stale ancestors after paint" in `SkiaBackdrop.Paint`; it costs nothing while the canvas is idle.

## Visual effects

### Post renderers wait for the shader to compile
- **React**: `SkiaControl.EffectPostRenderers` is filtered by `NeedApply` at render time; `SkiaShaderEffect.NeedApply` fetches the source (async, once) and compiles (sync) when needed, so a control with an effect whose `.sksl` is still loading is blitted plainly and takes the shader on the next frame.
- **.NET**: `DrawRenderObject` skips the cache blit whenever `EffectPostRenderers` is non-empty and the effect logs "failed to create shader" until compiled, so the control is invisible while the shader is missing.
- **Opinion**: filtering by `NeedApply` there too avoids the blank control on a slow resource / compile error.

### Texture texel origin
- **React**: `CachedTexture.Origin` records where texel (0,0) of the texture sits in canvas space; a cache image gets no local matrix (shaders sample `fragCoord - iOffset` in texel space, as in C#), a whole-surface snapshot gets a translation so texel (0,0) is the destination's top-left (a bounded `makeImageSnapshot` of a GPU surface is not origin-safe in CanvasKit).
- **.NET**: `CreateSnapshot` maps the destination through `TotalMatrix` and snapshots that sub-rect.
- **Opinion**: same outcome.

### Effects' `Update()` re-records the parent
- **React**: `SkiaEffect.Update` invalidates the parent's cache and stales the ancestors (`RepaintComposition`), the C# `Parent.Update()` semantics; the parent's own re-record is what lets `SkiaShaderCarousel` realize new slides while the transition progresses.

## SkiaShaderCarousel

### Cached as Image by default
- **React**: the constructor sets `UseCache="Image"` so the overlapping slides (all arranged at offset 0) are recorded into a cache that is never blitted (the post renderer replaces the blit) instead of being painted on screen under the effect.
- **.NET**: the user sets the cache type; with `UseCache=None` `DrawRenderObject` is never used and the transition effect never runs.
- **Opinion**: forcing an Image cache in the C# constructor would make the control work out of the box.

### `OnChildrenInitialized` before the first position
- **React**: `InitializeChildren` raises `OnChildrenInitialized` before `ApplyIndex(true)`; the shader carousel resets its from/to state there, and the first `OnScrollProgressChanged` (from the instant `ApplyPosition`) then sets them up. The other order left the first transition pair at -1 until the first swipe.

## SkiaEditor

### Hidden DOM textarea for IME / soft keyboards
- **React**: `TextInputProxy` mirrors the focused editor into a hidden textarea and replays its input events through the stub methods (diff of the value). DrawnUi.Blazor has no DOM input at all (physical keyboard only); this is a deliberate addition so mobile browsers can type.
- **.NET**: `SkiaEditor.Blazor.cs` subscribes to `KeyboardManager` only.
- **Opinion**: the same proxy would give the Blazor / Wasm heads mobile input; the diff approach avoids per-inputType handling and keeps IME composition intact.

## SkiaImageManager

### Queue in the browser
- **React**: `LoadImageManagedAsync` orders by priority and caps concurrent fetches at 5 like the C# semaphore; `SkiaImage.Source` goes through it (`LoadPriority`). Browsers already limit connections per host, so the cap mostly keeps decode work paced.

## SkiaScroll

### Scroll inside a cached parent stales it
- **React**: every offset change calls `RepaintComposition` (ancestor caches staled, own cache kept) instead of a plain `Repaint`; before, a `SkiaScroll` inside an Operations-cached card moved its arranged rects but never repainted (the card's picture was replayed).
- **.NET**: `Update()` invalidates up the tree.

### Wheel goes to the innermost scroll first
- **React**: a nested scroll under the pointer takes the wheel; when it sits at its edge in that direction it declines and the outer scroll moves. C# has no wheel routing rule for nested scrolls.

### Refresh indicator position
- **React**: `RefreshIndicator.SetDragRatio` slides the view in linearly with the overscroll and parks it at `RefreshShowDistance` (centered in the gap when the gap is taller than the view); the C# curve (`getPosition(k)`) depends on the sign convention of `InternalViewportOffset` and produced off-screen positions with this port's positive top overscroll.

### Snap uses the last paint's geometry
- **React**: `Snap` computes the target offset from the child's position relative to the content start as arranged at the last paint, so a fling that stopped a tick after that paint still lands the child exactly; `ScrollTo` applies its exact destination when the deceleration curve finishes (`LandScrollTo`).

## Layouts

### Templated Row / Wrap / Grid are not virtualized
- **React**: every item is realized through the `ViewsAdapter` (the C# non-list layouts also measure and draw all cells); only the templated single-column Column is the virtualized list.

### `OnChildrenInitialized` order in SkiaCarousel
- see SkiaShaderCarousel above.

## Caching

### ImageComposite dirty tracking
- **React**: `RepaintComposition` is the only dirty source (transform / own cache invalidation of a child); a remeasure anywhere below marks the composite for a full record. C# tracks `DirtyChildrenTracker` from `InvalidateByChild` too; both erase the union of old + new transformed bounds and pull intersecting siblings in.
- **React-only gotcha**: React props that are new objects on every render (`Margin={new Thickness(...)}`) remeasure the child each render and force full records; memoize them.

### Image caches on whole pixels
- **React**: `Image` / `ImageComposite` / `ImageDoubleBuffered` caches record the expanded rect snapped outward to integer device pixels; the blit is 1:1 and a shader effect sampling `fragCoord - iOffset` hits texel centers (a fractional `DrawingRect.Left` made `blit.sksl` bilinear-blur the image by a sub-pixel amount). Picture caches keep the exact rect.
- **.NET**: `CachedObject.Bounds` / recording areas are already integer pixels.
