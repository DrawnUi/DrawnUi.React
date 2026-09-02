import { useEffect, useState } from "react";
import { PUBLISH } from "../publish";
import { Aria, Colors, SkiaLabel, SkiaScroll, SkiaShape, SkiaStack, SkiaSvg, SkiaWrap, Thickness, useShell } from "drawnui-react";

const SAMPLES: { route: string; title: string; text: string }[] = [
  { route: "cells", title: "Recycled cells", text: "100 000 items in a SkiaScroll, RecyclingTemplate + MeasureFirst, UseCache=Image" },
  { route: "uneven", title: "Uneven cells", text: "Rows of different heights — MeasureVisible, LoadMore at both ends, ImageDoubleBuffered cells" },
  { route: "images", title: "Images", text: "SkiaImage — every TransformAspect, alignment, clipping" },
  { route: "svg", title: "SVG", text: "SkiaSvg — file and inline sources, TintColor, LockRatio" },
  { route: "shapes", title: "Shapes", text: "SkiaShape — rectangle, circle, ellipse, arc, polygon, line, path; stroke, corner radii, clipping" },
  { route: "text", title: "Text", text: "SkiaLabel — word wrap, MaxLines, alignment, spans, weights, glyph fallback" },
  { route: "layouts", title: "Layouts", text: "Every SkiaLayout type — Absolute, Column, Row, Wrap, Grid (tracks, spans, spacing)" },
  { route: "looks", title: "Common Controls", text: "SkiaSwitch, SkiaCheckbox, SkiaRadioButton, SkiaProgress, SkiaSlider, SkiaButton — Default, Windows, Cupertino, Material, Material3" },
  { route: "snapping", title: "Carousel & Drawer", text: "SkiaCarousel (swipe, SidesOffset peek, SelectedIndex) and SkiaDrawer (drag from an edge, snap by velocity)" },
  { route: "animations", title: "Lottie & GIF", text: "SkiaLottie (Skottie: AutoPlay, Repeat, SpeedRatio, IsOn, ColorTint) and SkiaGif frames on the canvas frame loop" },
  { route: "shell", title: "Shell", text: "SkiaShell — page transitions, OpenPopupAsync, PushModalAsync (drawer), ShowToast" },
  { route: "editor", title: "Editor", text: "SkiaEditor — drawn text input: caret, selection, placeholder, password, multiline, ControlStyle looks" },
  { route: "keyboard", title: "Keyboard Input", text: "KeyboardManager — window-level KeyDown / KeyUp / KeyChar with modifier state, the Blazor sandbox probe" },
  { route: "transforms", title: "Transforms", text: "Rotation, Scale, Skew, Translation, Opacity — hit-testing through them, *ToAsync animations" },
  { route: "a11y", title: "Accessibility", text: "ARIA overlay over the canvas — roles, labels, hints, toggles, live regions, keyboard" },
];

/** Root menu styled after drawnui.net: dark body, logo + bold title, sample cards below. */
const MAX_WIDTH = 820, PAGE_PADDING = 24, GAP = 16;
// title gradients cycle through the drawnui.net accents
const TITLE_GRADIENTS: [string, string][] = [["#6EA8FE", "#0D6EFD"], ["#D63384", "#FD7E14"], ["#20C997", "#0DCAF0"], ["#FFC107", "#FD7E14"], ["#A98EFF", "#6610F2"], ["#0DCAF0", "#6EA8FE"]];

/** Card width in points: two columns when the page is wide enough, one otherwise (SkiaWrap flows them). */
function useCardWidth(): number {
  const compute = () => { const inner = Math.min(MAX_WIDTH, window.innerWidth) - PAGE_PADDING * 2; return inner >= 640 ? (inner - GAP) / 2 : inner; };
  const [width, setWidth] = useState(compute);
  useEffect(() => { const onResize = () => setWidth(compute()); window.addEventListener("resize", onResize); return () => window.removeEventListener("resize", onResize); }, []);
  return width;
}

export function RootPage() {
  const shell = useShell();
  const cardWidth = useCardWidth();
  return (
    <SkiaScroll Orientation="Vertical">

      <SkiaStack Spacing={24} Padding={new Thickness(24, 24, 24, 40)} HorizontalOptions="Center" MaximumWidthRequest={820} UseCache="Image">
        <SkiaSvg Source="images/drawnui.svg" WidthRequest={120} LockRatio={1} HorizontalOptions="Center" Margin={new Thickness(0, 16, 0, 0)} AccessibilityRole={Aria.RoleImg} AccessibilityLabel="DrawnUI logo" />
        <SkiaLabel Text="DrawnUI for React" FontSize={48} FontFamily="FontTextBold" TextColor={Colors.White} HorizontalOptions="Center" AccessibilityRole={Aria.RoleHeading} />

        {/* samples */}
        {/* two columns on wide screens, one on phones: fixed-width cards flowing in a SkiaWrap */}
        <SkiaWrap Spacing={GAP} HorizontalOptions="Fill">
          {SAMPLES.map((s, i) => (
            <SkiaShape key={s.route} Type="Rectangle" CornerRadius={12} BackgroundColor="#2B3035" StrokeColor="#373B3E" StrokeWidth={1} WidthRequest={cardWidth} AnimationTapped="Ripple" Tapped={() => void shell.GoToAsync(s.route)}
              AccessibilityRole={Aria.RoleButton} AccessibilityLabel={s.title} AccessibilityHint={s.text}>
              <SkiaStack Spacing={6} Padding={new Thickness(24, 20, 48, 20)}>
                <SkiaLabel Text={s.title} FontSize={22} FontFamily="FontTextBold" TextColor={Colors.White} FillGradient={{ Type: "Linear", Angle: 0, Colors: TITLE_GRADIENTS[i % TITLE_GRADIENTS.length] }} AccessibilityRole={Aria.RolePresentation} />
                <SkiaLabel Text={s.text} FontSize={13} TextColor="#ADB5BD" AccessibilityRole={Aria.RolePresentation} />
              </SkiaStack>
              <SkiaLabel Text="›" FontSize={28} TextColor="#6EA8FE" HorizontalOptions="End" VerticalOptions="Center" Margin={new Thickness(0, 0, 20, 0)} AccessibilityRole={Aria.RolePresentation} />
            </SkiaShape>
          ))}
        </SkiaWrap>

        <SkiaLabel Text={`helloreact.drawnui.net · github.com/DrawnUi/DrawnUi.React · MIT · Publish ${PUBLISH}`} FontSize={12} TextColor="#6C757D" HorizontalOptions="Center" Margin={new Thickness(0, 16, 0, 0)} />
      </SkiaStack>
      
    </SkiaScroll>
  );
}
