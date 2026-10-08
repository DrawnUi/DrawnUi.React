# Parity notes: DrawnUi.React vs DrawnUi (.NET)

Behavioural differences between the two implementations that are NOT plain omissions (those live in
[SKIPPED.md](SKIPPED.md)). Each entry says what differs, why, and whether the .NET side should adopt it.
Updated whenever the port deliberately diverges or finds something worth back-porting.

## Animators

### Animators run on vsync time
- **React**: `Canvas` ticks animators with the frame's vsync timestamp (`document.timeline.currentTime` inside the
  rAF callback). Measured in the Pong demo: frames reached the screen 16.68 ms ± 0.08 apart, while the callback
  start (`performance.now()`, the old clock) drifted 12..23 ms between frames; a ball moving by `speed × delta`
  jumped 5..10 px per displayed frame (spread 10%). On vsync time: 3% (the rest is whole-pixel blit snapping).
- **.NET**: Blazor sets `FrameTime = Super.GetCurrentTimeNanos()` when the paint starts, the old React behaviour.
- **Opinion**: back-port to DrawnUi.Blazor: pass the `requestAnimationFrame` timestamp (`drawnui-frameloop.js`
  already receives it) through to `FrameTime`.

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

### An empty FontFamily resolves to the Skia built-in face on both sides (settled 2026-09-08)
- **Both, since 2026-09-08**: an empty family resolves to the Skia built-in face — `SKTypeface.CreateDefault()` in
  .NET, `CK.Typeface.GetDefault()` in React — and an app that wants its own font everywhere registers it as a style
  default, which is what the .NET Blazor sandbox and the Fiddle already do
  (`ConfigureStyles(styles => styles.AddStyle({ TargetType: SkiaLabel, ApplyToDerivedTypes: true, Setters: { FontFamily: "FontText" } }))`).
- **Was**: React fell back to `Super.DefaultFontAlias`, the first registered font, so unstyled text looked like the rest
  of the app while .NET drew it in the Skia face. Owner's call was to keep .NET as it is and align React, which needed
  `ConfigureStyles` ported first — until then React had no way to express the app-wide default.
- Visible where a control leaves the family empty by default: `SkiaButton.FontFamily` is `""` on both sides and is
  pushed to the caption label after that label was styled, so button captions draw in the Skia face while every other
  label follows the app style. React reproduces the order by styling the button's own frame and label when the button
  builds them (`ApplyInitialStyles(true)` in the constructor), the way C# styles `ButtonLabel` at init and then
  overwrites `FontFamily` in `ApplyProperties`. Found 2026-09-08 by the fiddle session comparing the Cells preset.
- Opinion kept for the record: a button caption drawn in a face the app never registered still reads as a bug, and on
  WASM there is no system font behind it. The owner decided .NET stays as it is, so the divergence is closed by React
  matching .NET rather than the other way round; an app that dislikes the look sets `FontFamily` on the button.
- Worst case for the current .NET rule is the Fiddle: Blazor WASM has nothing behind `SKTypeface.CreateDefault()`, so
  every unstyled C# button in every published snippet draws in Skia's embedded face while the app has its own fonts
  registered and used everywhere else. The Fiddle also has the same five-button toolbar preset in C# and in TSX, so the
  change can be confirmed or refuted with one side-by-side capture, the way the 100pt width floor was.

### `Views` of a templated layout: realized cells here, empty on .NET
- **React**: `SkiaLayout.Views` returns `ChildrenFactory.GetViewsInUse()` when templated, so a page can walk its live rows (the reorder demo's `RowRect` / `RefreshRows`).
- **.NET**: recycled cells never enter `Views`; the realized rows live in the `ViewsAdapter` (`ChildrenFactory.GetCellInUseOrNull(index)`, `GetCellsInUse()` since 1.10.6.18). The 1:1 port of ReorderPage to HelloMaui / HelloWpf walked `Views`, found nothing, and the lifted-row ghost silently never showed (fixed 2026-09-24 in DrawnUi 24a0994d).
- **Opinion**: keep the React shortcut (it is what a React page expects), but any port back to .NET must go through `ChildrenFactory`.

### A reorder moves the measured heights, it does not just rebind
- **.NET** (`HandleStructurePreservingMove` / `ApplyMoveChange`, 2026-09-08): an `ObservableCollection.Move` rebinds the
  contexts and deliberately touches no structure — the rows keep their heights and the arrange pass re-flows them from
  their bound views, so permuting the measured sizes changed nothing observable there.
- **React**: the same user action arrives as a new array, and the measured heights are index-keyed arrays that arrange
  reads directly (`itemHeights`, `mvHeights` / `mvPrefix`), with no view to re-flow from. So the port detects the
  permutation and moves each height with its item; under `MeasureVisible` the exact prefix is rebuilt over the leading
  measured run, because an item that was never measured can land inside it. Same outcome, different mechanism, and the
  difference is forced by where the two engines keep row geometry.
- Verified 2026-09-08 in the browser on the demo's `MeasureVisible` list, scrolled ~2300 pt down, reordering two rows
  far above the viewport: rows, pixel position and `measured 200/200` all unchanged, no cell re-created. The same swap
  routed through the rebuild path (cloned items, so not a permutation) moved the content by a row.

### Gestures="Enabled" shares the wheel per event, not by a sticky lock
- **.NET** (DrawnUi.Blazor `TouchEffect`, `TouchHandlingStyle.Manual`): the canvas sets `WIllLock` Locked when a control
  consumes a Panning or Wheel and Unlocked when a Panning is not consumed, resetting to Initial on Down / Up; the wheel
  policy prevents the page default while Locked. An unconsumed wheel never unlocks, so after a wheel scrolled an inner
  list, wheeling over a part of the canvas that does not scroll still blocks the page until the next press.
- **React**: the wheel's own result decides: processed immediately in the DOM handler, default prevented only when a
  control USED that wheel (marked `Handled`, or a consumer that is not a `BlockGesturesBelow` layer). A blocker returns
  itself for everything it keeps from the controls below, and a shell page is one (C# `SkiaViewSwitcher` sets it on
  the visible page too), so in Blazor a shell app blocks the page wheel over its whole canvas. Before this, React prevented every wheel in both modes, so `Enabled` behaved like `Lock`
  and a canvas embedded in a longer HTML page stopped the page from scrolling under the mouse.
- **Opinion**: per-event is what "share if not consumed" means; the Blazor lock only needs the sticky state for pointer
  moves, where one Down starts a whole gesture.

### Gestures="Enabled" hands touch pans to the page along the axes it can scroll
- **.NET MAUI**: `Enabled` inside a native scroll view lets the parent intercept the pans it scrolls in; the canvas
  keeps taps and the other axis. **DrawnUi.Blazor / DrawnUi.Wasm** used `touch-action:none` for `Enabled` too, so a
  finger on the canvas never scrolled the page. Both heads now follow the MAUI rule as well (AppoMobi.Blazor.Gestures
  3.11.2, `drawnui-web.js`).
- **React**: `touch-action` is set to the page's scrollable axes before a touch starts (the browser reads it at touch
  start, it cannot be decided mid-gesture): attach, window / html / body resize, and after every touch. When the browser
  takes the pan it cancels the pointer; `SkiaScroll` settles on a cancel instead of flinging from the moves that arrived
  before it (same fix in C# `SkiaScroll`). A page that cannot scroll keeps every touch, so full-page apps are unchanged.
- **Iframes** (2026-09-12): a full-viewport app in a frame has a document that cannot scroll, and a cross-origin parent
  cannot be read, so the own-document check alone gave `none` and a widget embedded on a landing page never let the
  page scroll by touch. Framed (`window.self !== window.top`) now always counts the vertical axis. Same rule in
  AppoMobi.Blazor.Gestures 3.11.3 and `drawnui-web.js`. Cost: a framed `Enabled` app loses its own vertical touch
  drags; such apps use `Lock`.
- **Claimed touches** (2026-09-13): touch-action alone let iOS Safari take an off-axis drag from a control that had
  already consumed the Down (a before/after handle panning sideways lost its drag to the page). `Enabled` now processes
  a touch Down immediately and, when a control used it, default-prevents that touch's `touchmove` until it ends:
  closer to MAUI, where a child that handles the gesture can keep the parent from intercepting. A non-passive
  `touchmove` listener makes the browser consult the main thread before it scrolls over the canvas. Cost: a touch
  that starts on a `SkiaCarousel` (it always consumes Down) no longer scrolls the page.
- **Opinion**: this is the only browser mapping of MAUI's parent intercept; the per-gesture "share unless consumed" that
  Blazor's `Manual` does for the wheel cannot exist for touch, because the choice is made before the canvas sees a move.

### WillFirstTimeDraw fires on a frame without the JSX content
- **.NET** (`DrawnView.OnDrawSurface`): `WillFirstTimeDraw` is raised before the first `Draw` once `CanRender`; the
  content set in XAML or code is normally already attached, so that first frame draws it.
- **React**: the engine draws frame 1 synchronously in its constructor (the canvas is painted before the browser shows
  it), and React renders the children into the tree afterwards. `WillFirstTimeDraw` therefore fires for a frame that
  only clears to `BackgroundColor`; the content arrives on a later frame. Use `WasDrawn` (or the first `WasDrawn` after
  your content mounted) when you need a frame that shows the tree.

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

### Each name said once in the flat overlay (React and Rust only)
- **React / Rust**: a text or heading whose label repeats the label of the node it is in is said once: under an
  interactive node the child is left out, under any other node (a group card) the node loses its name and the heading
  says it. Selectable text always stays. The web overlay is flat, so a group's name and its heading are read one after
  the other.
- **.NET**: no such rule yet.

### Disabled control roles: listbox and scrollbar are left out
- **React / Rust**: `Aria.IsInteractiveRole` (aria-disabled for a control role that takes no input) lists button,
  link, checkbox, radio, switch, slider, spinbutton, textbox, searchbox, combobox, option, tab, menuitem,
  menuitemcheckbox, menuitemradio.
- **.NET**: `Aria.IsInteractiveRole` also lists listbox and scrollbar.
- **Why**: a listbox is an arrow-key group here, and groups are never disabled.

### Row length of a 2D arrow-key group is the first row's
- **React / Rust**: Up / Down in a Wrap or Grid without Split move by the number of items on the group's first row.
- **.NET**: `SkiaAccessibilityManager.RowLength` counts the focused item's row; from the short last row of a wrap, Up
  skips items (12 tiles at 10 per row: Up from 12 goes to 10). This is a C# bug, reported to the C# side.

### Hover is decided by its own hit pass (drawnui-cross 6m)
- **React**: `HoverManager` walks the tree from one mouse position with the routing rules of ProcessGestures (visible,
  not InputTransparent, inside, children not locked, nothing below a BlockGesturesBelow subtree); controls get no
  `Pointer` gesture. Checked once per mouse move, plus the frame-end checks of 6m.
- **.NET**: the canvas routes a `Pointer` gesture through ProcessGestures; controls that take hover report themselves
  (`CheckHovered` -> `ReportHover`), the canvas commits after the pass. A custom ProcessGestures override can see and
  stop Pointer gestures there.
- **Opinion**: same hovered set for the same tree; routing Pointer gestures would reach every gesture override in the
  React controls at mouse-move rate for no visible gain.

### A deep change in an ImageComposite: by area, transforms mapped in (React and Rust)
- **React / Rust**: the area of a change deeper than a direct child is mapped through the transforms on the way (the
  control as drawn before and now, then every ancestor), so a card moved past its stack's edge is drawn there and erased
  again when it moves back; only a visual effect or a backdrop on the way draws the child whole.
- **.NET**: any transform from the origin up to the direct child draws the child whole, not clipped (draws the
  overflow, never erases it when the card moves back).
- React only: the area path needs `UpdateDraw` or `RepaintComposition`; a plain `Update()` (React's Update re-measures)
  records the composite whole, so color changes should go through props or the color setters. A templated (ItemsSource)
  composite always records whole (its cells are not composite children here). Not allocation-free: React's frame
  allocates rects per child already.

### Focus scrolls the drawn content into view
- **React-only**: when keyboard focus lands on an overlay node that is outside its `SkiaScroll` viewport,
  `SkiaScroll.EnsureVisible(control)` animates every scroll ancestor so the control is visible (browser
  behaviour for DOM pages). Opinion: back-port — Blazor users tabbing through a drawn list get the same
  experience as a native page; needs a `ScrollToView`-like helper plus the overlay `focus` callback.

### ContextMenu (React only)
- **React**: `ContextMenu` handler on controls and on the Canvas for the browser `contextmenu` request; routed like a
  tap, `true` suppresses the browser's canvas menu.
- **.NET** (2026-09-06): the same API on the web heads — `SkiaControl.ContextMenu` event + `ContextMenuEventArgs`
  (`Handled`, `Source`, `Local`), `.OnContextMenu(...)` fluent, `TouchActionResult.ContextMenu` routed through
  `ProcessGestures` (AppoMobi.Gestures 3.11.0); Blazor via `AppoMobi.Blazor.Gestures` `OnCanvasContextMenu`, Wasm via
  `WebInput.OnContextMenu`. Difference: C# sets `e.Handled = true`, React returns `true`.

### Static HTML for crawlers (React only)
- **React**: `drawnUiStatic()` (`drawnui-react/vite`) generates visible semantic HTML into `#root` at build time from
  the accessibility snapshot of the running build (headless Chrome), replaced by React's first render.
- **.NET**: nothing comparable (Blazor sites hand-write static SEO content in `index.html`, see the drawnui-blazor
  SEO notes). Opinion: web-only concern, no C# API to mirror; keep it a Vite plugin, never runtime.

### Versioned public files (React only)
- **React**: `drawnUiAssetStamps()` (`drawnui-react/vite`) hashes the public folder at build time; every engine
  loader fetches through `Super.ResolveAssetUrl`, which adds `?v=<hash>`, so a returning visitor never pairs new
  code with an old font, image, sprite sheet, shader or animation kept by the browser.
- **.NET**: assets ship inside the app package (MAUI / desktop) or the Blazor `_framework` fingerprints; no API.
  Opinion: web-only concern; the hook is one replaceable function, the plugin stays build-time.

### The scroll never derives its viewport from a measure constraint
- **.NET** (fixed 2026-09-08): `InitializeViewport` ran on any measure pass, including one with an infinite constraint
  on the scrolling axis, concluded "everything fits" and reset the offset to the top; a sibling changing size was
  enough to throw a scrolled list back. The fix returns early until a pass constrains the axis.
- **React**: nothing to port. `ContentOffsetBounds` is computed in `OnLayoutChanged`, which runs inside `Arrange` from
  the arranged `DrawingRect`, so a measure pass — constrained or not — never touches the offset or the bounds.
  Verified by measuring the demo's scroll with an infinite height while scrolled 2288 pt down: offset and bounds
  identical afterwards, visible rows unmoved.

## Rendering

### RenderingMode defaults to Accelerated
- **React**: a `<Canvas>` without `RenderingMode` draws on the GPU: the engine field starts as `"Accelerated"`
  (`src/core/Canvas.ts`). `RenderingMode="Default"` draws on the CPU (software surface). The value is read once,
  when the canvas is created. Accelerated falls back to software on its own when WebGL is unavailable.
- **.NET**: `DrawnView.RenderingModeProperty` defaults to `RenderingModeType.Default` (software); apps set
  `RenderingMode="Accelerated"` themselves.
- **Opinion**: keep it (Nick, 2026-10-04): WebGL is almost always there on the web and the fallback covers the rest,
  so nothing gets slower.

### Redraw synchronously inside the resize callback
- **React**: the `ResizeObserver` callback recreates the surface and draws immediately (RO runs after layout,
  before paint), so a live window drag never presents a blank frame; the GL context/GrContext live for the Canvas
  lifetime, only the surface is recreated.
- **.NET**: platform views handle resize natively (SkiaSharp views recreate surfaces on size change and request a
  paint); Windows `DrawnSwapChainPanel` already owns surface recreation.
- **Opinion**: no action; noted so the web behaviour is understood as intentional.

### SkiaLabelFps never asks for a frame
- **React**: the text changes only on frames that running animators request (`Canvas.AnimatingControls` not empty):
  scroll inertia, wheel scrolls, transitions, Lottie, game loops. An idle canvas draws nothing and the counter keeps
  the last value measured; a finger drag without an animator does not refresh it. The label re-measures itself on
  draw (parent-independent; React layouts do not re-arrange children per frame).
- **.NET**: `Draw` sets `Text` from `Superview.FPS` on every draw, so each changed value invalidates the label
  (whether that keeps an idle .NET canvas redrawing was not measured). `ForceRefresh` registers it as an animator.
- **Opinion**: keep. React `Canvas.FPS` counts the frames drawn in the last second, so a counter that asked for a
  frame for every new value would feed its own number (a frame raises the count, the new text asks for another
  frame) and keep an idle canvas drawing.

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

### Templated Row / Wrap / Grid follow RecyclingTemplate (Nick, 2026-10-01)
- **React**: with `RecyclingTemplate="Enabled"` a templated Row / Wrap / Grid / split Column measures each item through a
  slot bound to a pooled view (released right after unless the item is on screen), arranges only the slots, and binds
  views to the slots drawn (the viewport + `VirtualisationInflated`; every slot under a cache, as C#
  `GetOnScreenVisibleArea`). A view measured for another item is measured again when its whole size differs from the
  slot (C# 3d7bd78f). A slot keeps its size for the same item and constraints, so invalidating the layout does not
  rebind the items off screen (the list keeps its item heights the same way). Views on screen follow their slots on
  every layout change, also when a cached ancestor skips the drawing pass. `Disabled` keeps one view per item.
- **.NET**: Column / Row / Wrap recycle through `DrawStack`; the templated Grid realizes one view per item whatever the
  setting (`SkiaLayout.Grid.cs:36`), Nick to decide whether it follows.
- Check: `npm run check:recycling` (Node + CanvasKit): identical pixels Enabled vs Disabled at 12 scroll offsets and
  after items change; a 1000-item Split=3 wrap: first frame 18-24 ms vs 88-91 ms, a frame after invalidation 3.5-4 vs
  10-11 ms, a scroll frame 4.1-5.1 vs 9.1-10.2 ms, 27 views vs 1000 (software surface).

### `OnChildrenInitialized` order in SkiaCarousel
- see SkiaShaderCarousel above.

## Caching

### ImageComposite dirty tracking
- **React**: `RepaintComposition` is the only dirty source (transform / own cache invalidation of a child); a remeasure anywhere below marks the composite for a full record. C# tracks `DirtyChildrenTracker` from `InvalidateByChild` too; both erase the union of old + new transformed bounds and pull intersecting siblings in.
- **React-only gotcha**: React props that are new objects on every render (`Margin={new Thickness(...)}`) remeasure the child each render and force full records; memoize them.

### Image caches on whole pixels
- **React**: `Image` / `ImageComposite` / `ImageDoubleBuffered` caches record the expanded rect snapped outward to integer device pixels; the blit is 1:1 and a shader effect sampling `fragCoord - iOffset` hits texel centers (a fractional `DrawingRect.Left` made `blit.sksl` bilinear-blur the image by a sub-pixel amount). Picture caches keep the exact rect.
- **.NET**: `CachedObject.Bounds` / recording areas are already integer pixels.

## Accessibility

### Wheel events under half a notch move at once
- **React**: an event smaller than half of `Canvas.WheelDeltaPerNotch` (a touchpad, a free-spinning or high-resolution
  wheel) sets the offset directly; a notch glides over `AutoScrollingSpeedMs` (600 ms). Gliding every small event kept
  the content 600 ms behind a Mac touchpad (Nick: a delay before it starts to scroll).
- **.NET**: every wheel event glides over AutoScrollingSpeedMs (`SkiaScroll.ApplyWheelScroll`); touchpad latency on
  Blazor / Wasm / MAUI Mac not measured.
- **Opinion**: browsers apply touchpad deltas directly and smooth only notches; the .NET heads may want the same rule.

### Cache textures follow their control
- **React**: scrolled content is re-arranged to new absolute positions (a cached child is blitted at its current
  aligned rect), so `CachedImage` reports where the cache is shown now, not where it was recorded; effects sampling
  another control's cache (ShaderDoubleTexturesEffect `ControlFrom` / `ControlTo`) and frozen `Once` textures follow
  their control.
- **.NET / Rust**: `CachedImage` keeps the cache's own bounds; Rust draws scroll content through a translated canvas,
  so those bounds stay valid.

### WebGL context restore abandons with releaseResourcesAndAbandonContext
- **React**: CanvasKit 0.42 exposes no `abandonContext`; `releaseResourcesAndAbandonContext` is the only way to abandon
  a GrDirectContext. It runs first on restore, with the old GL handle current (CanvasKit makes a context's own handle
  current before each of its calls) and before the new context creates any object, so its GL calls reach only
  lost-generation objects and free their ids; after it, freeing an old image or surface makes no GL call.
- **.NET / Rust**: `AbandonContext(false)` / `abandon()` with no GL calls.
- **Opinion**: same effect on the web (the restored WebGL object ignores lost-generation objects); switch to
  `abandonContext` if a CanvasKit release exposes it.

### Keyboard navigation through the DOM overlay
- **React**: as DrawnUi.Blazor, the overlay elements are the keyboard focus: roving tabindex for arrow-key groups, the
  browser's Tab order, `:focus-visible` as the focus ring. A focus request from the manager (arrow keys) rebuilds the
  snapshot at once and focuses the element after the overlay rendered. Tab / Shift+Tab inside a `SkiaEditor` (its
  hidden textarea holds DOM focus) move focus to the editor's own overlay element without taking the caret again, then
  the browser's Tab moves on, so the next node keeps the keyboard. An item counts as drawn when it is in use and laid
  out (C# `WasInLastFrame`: React keeps only drawn cells in use).
- **.NET**: MAUI Windows / WPF draw the ring on the canvas and track `KeyboardFocusNode`; Escape leaves the drawn nodes.
- **Opinion**: same contract; the canvas ring and Escape are not needed where the browser owns focus.

### Selectable text is opt-in
- **React**: `AccessibilityTextSelectable` (default false) puts a label's lines into the overlay as real text with pointer events; the text then owns the pointer (selection), so it is never enabled implicitly — custom controls would lose taps and pans under their labels. ARIA roles / labels stay unaffected.
- **.NET**: no selectable labels (only `SkiaEditor` selects).
