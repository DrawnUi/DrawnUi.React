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

## Lists

### Recycled cells contract
- Same in both: the templated `SkiaLayout` (ItemsSource + ItemTemplate) is the `SkiaScroll`'s ONLY content; anything
  above the list goes above the scroll or into the scroll `Header` (not ported yet). Nesting the templated layout inside a
  static stack makes it a BindableLayout, not a CollectionView, and `ScrollToIndex` requires Content to be the layout.
- **React-only rule**: `ItemTemplate` must be a stable function reference (module-level or `useCallback`). A new arrow on
  every render is a new template → the pool is rebuilt each render (C# XAML sets `DataTemplate` once, so it never hits this).

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
