---
name: drawnui-react
description: Build web UIs with DrawnUi.React (npm `drawnui-react`) — the DrawnUi (.NET) drawn-UI engine in TypeScript on CanvasKit (Skia WASM), composed with React through a custom react-reconciler. Use for any app using `drawnui-react` / `drawnui-react/core`, and for porting DrawnUi XAML / C# screens to React. Demo: https://helloreact.drawnui.net, source: https://github.com/DrawnUi/DrawnUi.React
---

# DrawnUi.React

Same API as DrawnUi.Net: same control names, PascalCase property names, same measure / arrange / paint
contract, same defaults. Everything the `drawnui` skill (https://drawnui.net/skills/drawnui/SKILL.md) teaches
about layouts, caching, gestures and cells applies 1:1; this skill covers what React adds. `SKIPPED.md` in the
repo lists what is not ported per control, `dev/PARITY.md` the deliberate divergences. Never invent a new name
when C# has one.

## Install

```
npm i drawnui-react@preview react react-dom
```

- `drawnui-react` = React tags + every engine type. `drawnui-react/core` = the engine only (no React), for
  code-behind classes, cells, effects.
- ES modules + `.d.ts`. CanvasKit's `.wasm` is referenced through a `?url` import: use Vite or a bundler that
  understands it. Preview releases carry the `preview` dist-tag.
- Fonts are plain files under `public/fonts` (`FontCollection.ContentRoot = "fonts/"`), loaded at startup.

## Startup (same shape as DrawnUi.Net / OpenTK)

```tsx
await Super.UseDrawnUi()
  .ConfigureFonts((fonts) => fonts
    .AddFont("fonts/OpenSans-Regular.ttf", "FontText")
    .AddFont("fonts/OpenSans-Semibold.ttf", "FontText", 600)   // FontAttributes="Bold" / FontWeight={600}
    .AddSymbols()   // FontSymbols / FontSymbols2 (arrows, math) shipped subsets, like DrawnUi.Blazor
    .AddEmojis())   // FontEmoji
  .ConfigureStyles((styles) => styles.AddStyle({   // property defaults per control type, like DrawnUi.Net
    TargetType: SkiaLabel, ApplyToDerivedTypes: true, Setters: { FontFamily: "FontText" },
  }))
  .BuildAsync();    // loads CanvasKit + fonts; render the first <Canvas> after this

SkiaLabel.DefaultAccessibilityRole = Aria.RoleText;      // classes from "drawnui-react/core"
SkiaButton.DefaultAccessibilityRole = Aria.RoleButton;

createRoot(document.getElementById("root")!).render(
  <Canvas BackgroundColor="#212529" RenderingMode="Accelerated" Gestures="Enabled" style={{ height: "100vh" }}>
    <SkiaShell Routes={ROUTES} Titles={TITLES}><RootPage /></SkiaShell>
  </Canvas>,
);
```

- No glyph = silently dropped, never tofu-substituted: set `FontFamilyFallback="FontSymbols,FontSymbols2,FontEmoji"`
  on labels / editors that show symbols or emoji. No CJK font is shipped; register your own.
- A control with no `FontFamily` draws in CanvasKit's built-in face, not your font (same as DrawnUi.Net). Register the
  app default with `ConfigureStyles` as above. A `SkiaLabel` style does NOT reach button captions, because `SkiaButton`
  pushes its own (empty) `FontFamily` onto its label — the .NET behaviour too — so add a second style for
  `TargetType: SkiaButton` (or set `FontFamily` per button) when you want your font on captions. `SkiaShell`'s own
  Back / Home chrome are buttons, so the button style covers them as well.
- Styles are defaults: the JSX props of a control always win, and a control built in code-behind keeps whatever your
  code set before its first measure. `BasedOn`, `Triggers` and the per-control `Style` property are not ported.
- Give the page the canvas background (`html, body, #root { background: … }`) so nothing flashes while WASM loads.

## Composition rules (React on top of the `drawnui` skill)

- JSX tags are the engine classes: `<SkiaLabel Text=… />` is `new SkiaLabel()`; every prop is a plain property
  set on the control, C# events map to one callback prop each (`Tapped`, `TextChanged`, `SelectedIndexChanged`,
  `Scrolled`, …). `ref` gives the engine instance: call its methods (`GoNext()`, `ScrollTo(…)`, `IsFocused = true`).
- **Stable object props.** `Margin={new Thickness(…)}`, `Padding`, `Shadows={[…]}`, `FillGradient={{…}}`,
  `VisualEffects={[fx]}`, `ItemTemplate={() => …}` created inline are a new object on every render: the control
  remeasures each render, a templated layout rebuilds its cell pool, an `ImageComposite` records fully. Hoist them
  to module constants or `useMemo` / `useCallback`. Primitive props are diffed by value.
- Templated lists: `ItemsSource={array}` + `ItemTemplate={template}`; cells extend `SkiaDynamicDrawnCell`
  (build the visuals in the constructor, override `SetContent(item)`). `RecyclingTemplate`,
  `MeasureItemsStrategy` (`MeasureFirst` default / `MeasureAll` / `MeasureVisible`), `Split` / `SplitAlign` /
  `DynamicColumns` / `Invert` for Wrap / Row / Grid (those realize every item; the single-column Column is the
  virtualized list). Appending to `ItemsSource` keeps measured rows, prepending keeps the visible rows in place, and reordering the same items (drag to reorder) keeps every measured height and the scroll offset; any other change rebuilds.
- A stack packs its children along its axis: a child's `VerticalOptions="Center"` cannot centre it in a column's
  leftover space (nor `HorizontalOptions` in a row). Use `SkiaLayer` (absolute) when a child has to sit in the
  middle of a bigger box, which is also how a full-height drag handle keeps its icon centred.
- Code-behind controls: `new MySprite()` then `host.AddSubView(x)` in `useEffect`, and on cleanup
  `host.RemoveSubView(x); x.Dispose()`. JSX children are disposed by the renderer when they unmount.
- `SkiaScroll` extras are JSX children with a `Tag`: `Tag="Header"`, `"Footer"`, `"RefreshIndicator"`,
  `"ScrollBar"`, `"ScrollBarHorizontal"`; everything else is the single `Content`. Header modes: in the flow,
  `HeaderSticky`, `HeaderBehind` + `HeaderParallaxRatio`; `ScrollBarsVisibility`, `RefreshEnabled` +
  `RefreshCommand`, `SnapToChildren`, `TrackIndexPosition` / `CurrentIndex`.
- A Fill child inside a `SkiaRow` auto-sizes (C# rule). Use a `SkiaGrid` with `*` columns, or the stack itself.
- `SkiaShell` (React-level): `Routes` (page factories receive the navigation arguments), `GoToAsync("detail?id=7")`
  or `GoToAsync("detail", true, { id: 7 })`, `useShell()` inside pages (`GoBackAsync`, `OpenPopupAsync`,
  `PushModalAsync`, `ShowToast`, tabs), `Navigating` (set `e.Cancel`) / `Navigated` / `RouteChanged`, browser
  history + deep links (`UseBrowserHistory`), safe-area `Insets`.
- Colors are DrawnUi strings everywhere: `#RGB`, `#ARGB`, `#RRGGBB`, `#AARRGGBB` (alpha FIRST, as in MAUI / C#), or
  `rgb()` / `rgba()`. When app code paints with CanvasKit directly (an offscreen `Surface`, a `Paint`), convert with
  `Super.ParseColor(color)`; never call `CK.parseColorString` (CSS order, reads `#22FFFFFF` as opaque cyan) or build
  `CK.Color(...)` from a DrawnUi string. `#RRGGBBAA` must never surface in app code.
- Caching is the same plan as C#: `UseCache="Image"` on stable subtrees, `"Operations"` for vector content (the
  default on shapes and labels), `"ImageComposite"` for a layer whose children change independently (only the
  dirty children are re-recorded; `LastCompositeRecord` reports what happened), `None` for per-frame painters.
  Shader effects need an Image-type cache on their control. That cache is only the shader's INPUT: a
  post-render effect runs on every frame its control is drawn (measured: one shader pass per drag frame on
  a moving sibling). For a static result under something that moves, wrap the control in a parent with
  `UseCache="Image"` — the parent records the shaded output once and blits it; its own `TranslationX` /
  `RepaintComposition()` do not stale that cache (measured: 0 shader passes over a 20-step drag).
- Invalidation vocabulary when writing custom controls: `Update()` = remeasure + redraw; `InvalidateCache()` = own
  content changed; `RepaintComposition()` = my transform / paint changed, ancestor caches go stale; `Repaint()` =
  just ask for a frame. A control that changes its own drawing calls `InvalidateCache(); RepaintComposition();`.
- Effects: `VisualEffects={[effect]}` with `SkiaShaderEffect` (`ShaderSource` url or `ShaderCode`, Shadertoy
  uniforms `iResolution` / `iImageResolution` / `iTime` / `iOffset` / `iMouse` + `iImage1`, `SetUniform`,
  `UseBackground` Always / Once / Never), `ShaderDoubleTexturesEffect`, `ShaderTransitionEffect`,
  `AnimatedShaderEffect`; `SkiaShaderCarousel` slides must be `UseCache="Image"`. An effect implementing
  `ProcessGestures` receives the parent's gestures first.
- `<Canvas Gestures>`: `"Enabled"` shares input with the host page like MAUI's `Enabled` inside a native scroll view,
  so a canvas embedded in a longer page never traps page scrolling. Touch: a finger pan along an axis the page can
  scroll scrolls the page (the canvas pointer is cancelled, a `SkiaScroll` settles without flinging), taps and the
  other axis stay on the canvas; a page that cannot scroll (a full-page app) keeps every touch. Inside an iframe the
  embedding page cannot be inspected, so it is assumed to scroll vertically: a framed widget hands vertical pans to it
  (use `"Lock"` for a framed app that needs its own vertical drags). Wheel: the page scrolls
  unless a control used it (a `SkiaScroll` that moved, a `ConsumeGestures` handler that set `Consumed`; a
  `BlockGesturesBelow` layer that only blocks does not count). `"Lock"` keeps all input: use it for a widget whose own
  vertical drags (inner list, drawer, drag to reorder) must win inside a scrolling page. A custom control overriding
  `ProcessGestures` to act on a wheel sets `args.Event.Handled = true` so the page does not scroll too.
- Right click / long press / Menu key: `ContextMenu={(sender, e) => { …; return true; }}` on any control (routed like
  a tap: deepest child first, then parents, then `<Canvas ContextMenu>`); `true` suppresses the browser's canvas menu,
  no handler = browser menu as usual. `e.Location` points, `e.Local` pixels in the control, `e.Source`
  mouse / touch / keyboard, `e.Native` the DOM event. Every mouse button still taps (`e.Parameters.Event.Pointer.Button`
  "Left" / "Right" / "Middle" / "XButton1"…, `DeviceType`, `PressedButtons`): a handler meant for the primary button only checks it.
- A control that consumes a gesture keeps it until it stops consuming, so a drag survives the finger leaving the
  control. To drag inside a `SkiaScroll` (the scroll owns vertical pans), take `Down` on a handle with
  `ConsumeGestures`, set `scroll.RespondsToGestures = false` for the drag and restore it on `Up`, and count travel in
  CONTENT space (pointer movement plus what the list scrolled underneath) so edge auto-scroll keeps advancing the row.
  Reordering the array as you go is cheap: the layout applies a permutation in place, see the `#/reorder` demo page.
- Lifted drag (the row floats over the list instead of only swapping places): the ghost cannot live in a recycled
  cell, put it in an `InputTransparent` overlay layer that covers the page, above the scroll that clips the list.
  Size it from the row's `DrawingRect`, move it with `Left` / `Top` in points plus `RepaintComposition()` per frame,
  and read the scale off the overlay, not the ghost: a hidden control is never measured, so its `RenderingScale` is
  still 1. Blank the real row while it is lifted, so the travelling gap shows where the drop lands, and re-read the
  target row's rect on each frame of the drop animation, because the list is still catching up with the last move.
- Keyboard: `KeyboardManager.Subscribe(down, char, up?)` (DOM `event.code` names). `SkiaEditor` focuses on tap; a
  hidden textarea feeds IME / soft keyboard / clipboard into the same editing methods.
- Accessibility: an invisible DOM overlay mirrors accessible controls over the `aria-hidden` canvas
  (`AccessibilityRole`, `AccessibilityLabel`, `AccessibilityHint`, `AccessibilityIsPressed`, `AccessibilityLive`,
  `Aria.RolePresentation` to hide). `AccessibilityTextSelectable` (opt-in) makes a label's text natively
  selectable and copyable; never enable it on gesture-driven controls, the text then owns the pointer.
- Pointer (hand) cursor over tappable things: a `Tapped` handler alone does NOT show it. The control must also be in
  the accessibility overlay, so give it a role: `AccessibilityRole={Aria.RoleButton}` on a tappable card, row or
  shape, with `AccessibilityRole={Aria.RolePresentation}` on the labels inside so the card stays one target.
  `SkiaButton` has no default role: set `SkiaButton.DefaultAccessibilityRole = Aria.RoleButton` once at startup.
  Switch, checkbox, radio and slider carry their roles already. A control driven only by `ConsumeGestures` (a drag
  grip) has no `Tapped`, so it needs `AccessibilityCanInteract={true}` as well. A `TextSpan` with `Tapped` gets the
  hand over just that span when its label has a role.
- Crawlers / AI agents: `import { drawnUiStatic } from "drawnui-react/vite"`, `plugins: [react(), drawnUiStatic()]`
  (needs `playwright-core` + a Chrome at build). After `vite build` it boots the built app headlessly, reads the
  accessibility tree of the root page and of each page a root button opens, and writes visible semantic HTML
  (heading → heading, button → link, label → paragraph) after `#root` in `dist/index.html`, or at
  `<!-- drawnui-static -->`. Below the fold when the mount element fills the viewport; the first `<Canvas>` removes
  it after frame 1, so people never see it next to the canvas; check it with `curl`, not DevTools. Non-rendering
  bots read it, Googlebot (renders JS) sees the a11y overlay instead — a control without `AccessibilityRole` is in
  neither. Style via `.drawnui-static` or `render: { style: false }`.

## Debugging in the browser

- The `Canvas` ref exposes the engine view: `FPS`, `FrameTime`, `RenderingScale`, `AccessibilityManager.Snapshot`.
- The accessibility overlay is the easiest automation hook: every accessible control is a DOM node with
  `role` / `aria-label` positioned over its drawn rect (labels expose their text). Drive UI tests through it.
- Nothing repaints while idle: an animation or a scroll must request frames (`Repaint()`, animators). If something
  moves in the overlay but not on screen, a cached parent was not staled (`RepaintComposition`).
