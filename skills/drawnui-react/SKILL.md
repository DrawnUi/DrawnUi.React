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
  virtualized list). Appending to `ItemsSource` keeps measured rows; a new array reference is diffed.
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
- Caching is the same plan as C#: `UseCache="Image"` on stable subtrees, `"Operations"` for vector content (the
  default on shapes and labels), `"ImageComposite"` for a layer whose children change independently (only the
  dirty children are re-recorded; `LastCompositeRecord` reports what happened), `None` for per-frame painters.
  Shader effects need an Image-type cache on their control.
- Invalidation vocabulary when writing custom controls: `Update()` = remeasure + redraw; `InvalidateCache()` = own
  content changed; `RepaintComposition()` = my transform / paint changed, ancestor caches go stale; `Repaint()` =
  just ask for a frame. A control that changes its own drawing calls `InvalidateCache(); RepaintComposition();`.
- Effects: `VisualEffects={[effect]}` with `SkiaShaderEffect` (`ShaderSource` url or `ShaderCode`, Shadertoy
  uniforms `iResolution` / `iImageResolution` / `iTime` / `iOffset` / `iMouse` + `iImage1`, `SetUniform`,
  `UseBackground` Always / Once / Never), `ShaderDoubleTexturesEffect`, `ShaderTransitionEffect`,
  `AnimatedShaderEffect`; `SkiaShaderCarousel` slides must be `UseCache="Image"`. An effect implementing
  `ProcessGestures` receives the parent's gestures first.
- Keyboard: `KeyboardManager.Subscribe(down, char, up?)` (DOM `event.code` names). `SkiaEditor` focuses on tap; a
  hidden textarea feeds IME / soft keyboard / clipboard into the same editing methods.
- Accessibility: an invisible DOM overlay mirrors accessible controls over the `aria-hidden` canvas
  (`AccessibilityRole`, `AccessibilityLabel`, `AccessibilityHint`, `AccessibilityIsPressed`, `AccessibilityLive`,
  `Aria.RolePresentation` to hide). `AccessibilityTextSelectable` (opt-in) makes a label's text natively
  selectable and copyable; never enable it on gesture-driven controls, the text then owns the pointer.
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
