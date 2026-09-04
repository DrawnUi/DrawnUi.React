# DrawnUi.React

[DrawnUi](https://drawnui.net) engine ptototype for React, TypeScript on top of
[CanvasKit](https://skia.org/docs/user/modules/canvaskit/) (Skia for the browser), composed with React
through a custom `react-reconciler` renderer.

Check out latest playbook: [helloreact.drawnui.net](https://helloreact.drawnui.net/) 👈

*Work in progress*: the goal is same API surface and semantics as DrawnUi (.NET) — same control names, same PascalCase
property names, same measure/arrange/paint contract — so knowledge and docs transfer 1:1.

```tsx
await Super.UseDrawnUi()
  .ConfigureFonts((fonts) => fonts.AddFont("fonts/OpenSans-Regular.ttf", "FontText"))
  .BuildAsync();

<Canvas BackgroundColor={Colors.DarkSlateBlue} RenderingMode="Accelerated" Gestures="Enabled">
  <SkiaStack Spacing={8} Padding={new Thickness(16)} VerticalOptions="Center">
    <SkiaLabel Text="Hello World" FontSize={32} TextColor={Colors.White} HorizontalOptions="Center" />
    <SkiaButton Text="Tap me" ApplyEffect="Ripple" HorizontalOptions="Center" Tapped={() => setCount((c) => c + 1)} />
  </SkiaStack>
</Canvas>
```

## Install

```
npm i drawnui-react@preview react react-dom
```

`drawnui-react` = React tags + every engine type, `drawnui-react/core` = the engine only. Ships ES modules + `.d.ts`;
CanvasKit's `.wasm` is referenced with a `?url` import, so use Vite (or any bundler that understands `?url`) and
put your fonts under `public/fonts`. Preview releases carry the `preview` dist-tag (the first publish also became `latest`, as npm always does).

## Run

```
npm install
npm run dev              # samples/demo at http://localhost:5173
npx vite samples/<name>  # any other sample
npm run build            # typecheck + build all samples into dist/<name>/
```

## Skills for AI agents

`skills/drawnui-react/SKILL.md` teaches an agent this library (install, startup, composition rules, scroll / shell
extras, caching, effects, accessibility). Save it under `~/.claude/skills/drawnui-react/SKILL.md` or fetch it from
the demo site: https://helloreact.drawnui.net/skills/drawnui-react/SKILL.md — `llms.txt` / `llms-full.txt` at the
site root point to it. Pair it with the DrawnUI framework skill from https://drawnui.net/llms.txt.

## Where React ends and DrawnUi begins

React never touches the canvas. The engine (`src/core`, `src/controls`) is plain TypeScript: `SkiaControl` trees
that measure, arrange and paint themselves on a CanvasKit surface, exactly like the .NET `SkiaControl` trees — it can
be driven from any framework, or from no framework at all (`new SkiaLabel()`, `AddSubView`, `canvas.Content = ...`).

`react-reconciler` is React's own renderer-building package: the same core that powers `react-dom` and
`react-native`, minus the DOM. You hand it a "host config" — how to create an instance for a JSX tag, how to append
/ remove / reorder children, how to apply changed props — and React does the rest: diffing, hooks, state, effects,
keys, Suspense. Our host config (`src/react/reconciler.ts`) maps every tag to an engine class (`<SkiaLabel>` →
`new SkiaLabel()`), `appendChild` to `AddSubView`, and a changed prop to a plain property assignment on the control
(`Text`, `FontSize`, `Tapped`…), after which the control invalidates itself the way it would from C#. So the JSX is
just a declarative way to build and mutate the same control tree; the render loop, caching, gestures, animators and
accessibility all live in the engine and would work identically under Vue, Svelte, Blazor-JS interop or a game loop.
That is also why the demo pages describe DrawnUi features, not React ones: the same pages are meant to be reused as
the showcase for other frameworks on this engine.

## Accessibility

Same model as DrawnUi.Blazor: the `<canvas>` is `aria-hidden`, an invisible DOM overlay mirrors every
accessible drawn control (`role`, `aria-label`, `title` hint, `aria-pressed`, `aria-live`, `tabindex`), rebuilt
at most once per second from the arranged rects. Keyboard (Tab / Enter / Space) and screen-reader activation
are routed back into the gesture pipeline as a `Tapped` on the control.

Per control (C# names): `AccessibilityRole` (enables the node; use `Aria.*`), `AccessibilityLabel`
(defaults to the control's text), `AccessibilityHint`, `AccessibilityCanInteract` (defaults to "has a
`Tapped` handler"), `AccessibilityIsPressed`, `AccessibilityLive`. `Aria.RolePresentation` hides a control that
would otherwise get a default role.

App-wide opt-in (React extension): `SkiaLabel.DefaultAccessibilityRole = Aria.RoleText` and
`SkiaButton.DefaultAccessibilityRole = Aria.RoleButton` (import the classes from `drawnui-react/core`) make every
label readable and every button focusable without touching each control.

The overlay has `pointer-events: none`, so hover and all pointer gestures still reach the canvas — the
Blazor "accessible control loses hover" limitation does not apply.

Text selection (React extension, opt-in): `AccessibilityTextSelectable` on a `SkiaLabel` renders its laid-out lines
as real, invisible DOM text in the overlay — one span per drawn line, in the same font (registered fonts are also
installed as CSS `FontFace`s) and stretched to the drawn line width — with pointer events on. The browser then
selects, copies (Ctrl+C / context menu) and reads it like an HTML paragraph, and the wheel over it still scrolls the
drawn content. It is off by default and must stay off on anything gesture-driven (buttons, carousels, drawers): the
selectable text owns the pointer, so taps and pans under it never reach the drawn control. Everything else in the
overlay is `user-select: none`, so select-all only highlights opted-in text.

## Crawlers and AI agents: static HTML from the accessibility tree

A drawn app serves `<div id="root"></div>`; a crawler that does not run JavaScript sees nothing. The
`drawnUiStatic` Vite plugin fixes that at build time, from the app itself:

```ts
// vite.config.ts
import { drawnUiStatic } from "drawnui-react/vite";
export default defineConfig({ plugins: [react(), drawnUiStatic()] });
```

After `vite build` it serves the build, opens it in headless Chrome (`playwright-core`, your dev dependency; GitHub's
ubuntu runners ship a Chrome), lets the engine draw, reads the accessibility snapshot of the root page and of every
page a root button opens (or the `routes` you list), and writes ordinary visible HTML into `#root` of
`dist/index.html`: a heading is a heading, a button is a link to the page it opened, a label is a paragraph. The
overlay's own markup (transparent text over the canvas) is never copied — in a static file it would read as hidden
text. Nothing is hand-written, so it cannot drift from what the canvas draws.

It is the pre-hydration state of the page: React replaces `#root`'s children on its first render, right when the
canvas draws its first frame, so a person sees it only while CanvasKit loads and never next to the canvas. If the
app fails to boot it stays. No runtime code, nothing in the frame loop; an app without the plugin pays nothing.

Two things to know. Check it with `curl` or view-source, not DevTools after boot. And crawlers that do not run
JavaScript (GPTBot, ClaudeBot, CCBot, link previews) read this HTML, while Googlebot renders JavaScript and sees the
booted page, i.e. the accessibility overlay; both come from the same tree, and a control without an
`AccessibilityRole` is invisible to both.

## Development

Repo layout, build scripts, skill sync and how the demo / npm package are published: [dev/DEVELOPMENT.md](dev/DEVELOPMENT.md).
