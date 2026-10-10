import { useEffect, useState } from "react";
import { Aria, Colors, SkiaButton, SkiaLabel, SkiaRow, SkiaScroll, SkiaShape, SkiaStack, SkiaSvg, SkiaWrap, Thickness } from "drawnui-react";
import { useCanvasView } from "./canvasView";

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <SkiaShape Type="Rectangle" CornerRadius={8} BackgroundColor="#2B3035" HorizontalOptions="Fill" AccessibilityRole={Aria.RoleGroup} AccessibilityLabel={title}>
      <SkiaStack Spacing={10} Padding={new Thickness(16, 12)}>
        <SkiaLabel Text={title} FontSize={12} TextColor="#6EA8FE" FontAttributes="Bold" TextTransform="Uppercase" FontFamilyFallback="FontSymbols,FontSymbols2" AccessibilityRole={Aria.RoleHeading} />
        {children}
      </SkiaStack>
    </SkiaShape>
  );
}

/** An item of a keyboard group: a SkiaShape button that reports itself as activated (hello-app a11y screen, HelloWpf). */
function GroupItem({ text, width, activated }: { text: string; width?: number; activated: (name: string) => void }) {
  return (
    <SkiaShape Type="Rectangle" CornerRadius={6} BackgroundColor="#373B3E" WidthRequest={width ?? -1} HeightRequest={36} HorizontalOptions={width ? "Start" : "Fill"}
      AnimationTapped="Ripple" AccessibilityRole={Aria.RoleButton} AccessibilityCanInteract AccessibilityLabel={text} Tapped={() => activated(text)}>
      <SkiaLabel Text={text} FontSize={14} TextColor={Colors.White} HorizontalOptions="Center" VerticalOptions="Center" AccessibilityRole={Aria.RolePresentation} />
    </SkiaShape>
  );
}

const FRUITS = ["Apple", "Banana", "Cherry", "Date"];
const NUMBERS = Array.from({ length: 12 }, (_, i) => `${i + 1}`);

/**
 * Accessibility snippet: the canvas is aria-hidden, an invisible ARIA overlay mirrors the drawn controls.
 * Everything here is reachable with Tab / Enter / Space and a screen reader; hover and pointer gestures still hit the canvas.
 */
export function AccessibilityPage() {
  const view = useCanvasView();
  const [count, setCount] = useState(0);
  const [sound, setSound] = useState(true);
  const [dark, setDark] = useState(false);
  const [nodes, setNodes] = useState(0);
  const [focused, setFocused] = useState("none");
  const [lastActivated, setLastActivated] = useState("-");

  // live view of the engine's accessibility snapshot (Canvas.AccessibilityManager)
  useEffect(() => {
    if (!view) return;
    const mgr = view.AccessibilityManager;
    const refresh = () => { setNodes(mgr.Snapshot.length); setFocused(mgr.FocusedNode?.AccessibilityLabel ?? "none"); };
    refresh();
    const off = mgr.OnChanged(refresh);
    const id = setInterval(refresh, 300); // focus is not part of the snapshot
    return () => { off(); clearInterval(id); };
  }, [view]);

  return (
    <SkiaScroll Orientation="Vertical">
      <SkiaStack Spacing={16} Padding={new Thickness(16)} HorizontalOptions="Center" MaximumWidthRequest={720}>
        <SkiaLabel Text="Accessibility" FontSize={24} TextColor={Colors.White} HorizontalOptions="Center" AccessibilityRole={Aria.RoleHeading} />
        <SkiaLabel Text="Press Tab to move between the drawn controls, Enter or Space to activate. Screen readers see the same overlay: roles, labels, hints, pressed state, live regions." FontSize={14} TextColor={Colors.LightGray} HorizontalOptions="Fill" HorizontalTextAlignment="Center" />

        <Card title="Accessibility snapshot (Canvas.AccessibilityManager)">
          <SkiaLabel Text={`Nodes in the overlay: ${nodes} · focused: ${focused} · last activated: ${lastActivated}`} FontSize={14} TextColor="#DEE2E6" HorizontalOptions="Fill" AccessibilityRole={Aria.RoleStatus} AccessibilityLive={Aria.LivePolite} />
        </Card>

        <Card title="AccessibilityTextSelectable — real selectable text over the drawn label (opt-in)">
          <SkiaLabel AccessibilityTextSelectable Text="This paragraph is drawn on the canvas, but the accessibility overlay also carries it as real, invisible text in the same font and line positions. Select it with the mouse or touch, copy it with Ctrl+C, let a screen reader read it word by word — like any HTML paragraph. Off by default: pointer input over selectable text goes to the selection, not to the drawn control, so it is never turned on for buttons, carousels or anything gesture-driven." FontSize={14} TextColor="#DEE2E6" HorizontalOptions="Fill" />
          <SkiaLabel Text="This one is a normal label: exposed to screen readers, not selectable." FontSize={12} TextColor="#ADB5BD" HorizontalOptions="Fill" />
        </Card>

        <Card title="Buttons — label from Text, hint, custom label, disabled">
          <SkiaWrap Spacing={8}>
            <SkiaButton Text={`Tapped ${count}×`} BackgroundColor="#0D6EFD" AccessibilityHint="Increments the counter" Tapped={() => { setCount((c) => c + 1); setLastActivated("counter"); }} />
            <SkiaButton Text="★" FontSize={18} FontFamilyFallback="FontSymbols,FontSymbols2" BackgroundColor="#6610F2" WidthRequest={48} AccessibilityLabel="Favorite" AccessibilityHint="Icon-only button: AccessibilityLabel replaces the glyph" Tapped={() => setLastActivated("favorite")} />
            <SkiaButton Text="Disabled" BackgroundColor="#495057" IsDisabled AccessibilityHint="IsDisabled: no tab stop, not activatable" />
          </SkiaWrap>
        </Card>

        <Card title="Toggles — AccessibilityIsPressed, in a toolbar">
          {/* a toolbar: one Tab stop, Left / Right move between the toggles */}
          <SkiaRow Spacing={8} AccessibilityRole={Aria.RoleToolbar}>
            <SkiaButton Text={sound ? "Sound: on" : "Sound: off"} BackgroundColor={sound ? "#20C997" : "#495057"} AccessibilityLabel="Sound" AccessibilityIsPressed={sound} Tapped={() => { setSound((v) => !v); setLastActivated("sound"); }} />
            <SkiaButton Text={dark ? "Dark: on" : "Dark: off"} BackgroundColor={dark ? "#20C997" : "#495057"} AccessibilityLabel="Dark mode" AccessibilityIsPressed={dark} Tapped={() => { setDark((v) => !v); setLastActivated("dark"); }} />
          </SkiaRow>
        </Card>

        <Card title="Any control can be a node — SkiaShape as a button, image with a description">
          <SkiaWrap Spacing={12}>
            <SkiaShape Type="Rectangle" CornerRadius={12} BackgroundColor="#373B3E" StrokeColor="#6EA8FE" StrokeWidth={1} AnimationTapped="Ripple"
              AccessibilityRole={Aria.RoleButton} AccessibilityLabel="Open settings" AccessibilityHint="A SkiaShape with Tapped: role button, label and hint set explicitly"
              Tapped={() => setLastActivated("settings card")}>
              <SkiaStack Spacing={4} Padding={new Thickness(16, 12)}>
                <SkiaLabel Text="Settings" FontSize={18} FontFamily="FontTextBold" TextColor={Colors.White} AccessibilityRole={Aria.RolePresentation} />
                <SkiaLabel Text="inner labels are RolePresentation" FontSize={12} TextColor="#ADB5BD" AccessibilityRole={Aria.RolePresentation} />
              </SkiaStack>
            </SkiaShape>
            <SkiaSvg Source="images/drawnui.svg" WidthRequest={72} LockRatio={1} AccessibilityRole={Aria.RoleImg} AccessibilityLabel="DrawnUI palette logo" />
            <SkiaShape Type="Circle" BackgroundColor="#FFC107" WidthRequest={48} LockRatio={1} VerticalOptions="Center" AccessibilityRole={Aria.RolePresentation} />
          </SkiaWrap>
          <SkiaLabel Text="The yellow circle is decorative: AccessibilityRole=Aria.RolePresentation keeps it out of the tree." FontSize={12} TextColor="#ADB5BD" HorizontalOptions="Fill" />
        </Card>

        <Card title="Keyboard groups — one Tab stop, the arrow keys inside">
          <SkiaLabel Text="A container with a composite role (Aria.RoleList, RoleToolbar, RoleGrid...) is one Tab stop: the arrow keys move between its items, Home and End go to the first and the last, Enter or Space activates. Tab comes back to the item it left." FontSize={12} TextColor="#ADB5BD" HorizontalOptions="Fill" />
          <SkiaLabel Text="Fruits — a list: Up and Down" FontSize={13} TextColor="#DEE2E6" HorizontalOptions="Fill" />
          <SkiaStack Spacing={6} AccessibilityRole={Aria.RoleList} AccessibilityLabel="Fruits">
            {FRUITS.map((name) => <GroupItem key={name} text={name} activated={setLastActivated} />)}
          </SkiaStack>
          <SkiaLabel Text="Numbers — a grid: all four arrows" FontSize={13} TextColor="#DEE2E6" HorizontalOptions="Fill" />
          <SkiaWrap Spacing={6} AccessibilityRole={Aria.RoleGrid} AccessibilityLabel="Numbers">
            {NUMBERS.map((name) => <GroupItem key={name} text={name} width={56} activated={setLastActivated} />)}
          </SkiaWrap>
        </Card>

        <Card title="Labels — read by default, opted out per control">
          <SkiaLabel Text="This label is announced: SkiaLabel.DefaultAccessibilityRole = Aria.RoleText was set once at startup." FontSize={14} TextColor="#DEE2E6" HorizontalOptions="Fill" />
          <SkiaLabel Text="This one is visible but hidden from assistive technology (RolePresentation)." FontSize={14} TextColor="#ADB5BD" HorizontalOptions="Fill" AccessibilityRole={Aria.RolePresentation} />
          <SkiaLabel Text="Heading level text" FontSize={16} FontFamily="FontTextBold" TextColor={Colors.White} AccessibilityRole={Aria.RoleHeading} />
        </Card>

        <Card title="How it works">
          <SkiaLabel FontSize={13} TextColor="#ADB5BD" HorizontalOptions="Fill" Text={"• <canvas> is aria-hidden; a DOM overlay mirrors accessible controls with role / aria-label / title / aria-pressed / aria-live / tabindex.\n• Snapshot rebuilt at most once per second from the arranged rects, so it follows scrolling.\n• Overlay has pointer-events:none — hover and gestures reach the canvas; keyboard and screen-reader activation are routed as a Tapped.\n• Same property names as DrawnUi (.NET): AccessibilityRole, AccessibilityLabel, AccessibilityHint, AccessibilityCanInteract, AccessibilityIsPressed, AccessibilityLive."} />
        </Card>
      </SkiaStack>
    </SkiaScroll>
  );
}
