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
