import { useEffect, useRef, useState } from "react";
import { Colors, SkiaButton, SkiaLabel, SkiaLayer, SkiaRow, SkiaScroll, SkiaShape, SkiaSlider, SkiaStack, SkiaSvg, SkiaWrap, Thickness } from "drawnui-react";
import { Easing, type SkiaLabel as SkiaLabelCtrl, type SkiaShape as SkiaShapeCtrl, type SkiaSlider as SkiaSliderCtrl, type SkiaSvg as SkiaSvgCtrl } from "drawnui-react/core";

/** Tile gradients of the tilted strip: the root page's card title colors, G0..G5. */
const STRIP_COLORS: [string, string][] = [["#6EA8FE", "#0D6EFD"], ["#D63384", "#FD7E14"], ["#20C997", "#0DCAF0"], ["#FFC107", "#FD7E14"], ["#A98EFF", "#6610F2"], ["#0DCAF0", "#6EA8FE"]];

/** An angle in -180..180. */
const normalize = (degrees: number) => ((((degrees + 180) % 360) + 360) % 360) - 180;
const whole = (v: number) => `${Math.round(v) || 0}`;

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <SkiaShape Type="Rectangle" CornerRadius={8} BackgroundColor="#2B3035" HorizontalOptions="Fill">
      <SkiaStack Spacing={10} Padding={new Thickness(16, 12)}>
        <SkiaLabel Text={title} FontSize={12} TextColor="#6EA8FE" FontAttributes="Bold" TextTransform="Uppercase" FontFamilyFallback="FontSymbols,FontSymbols2" />
        {children}
      </SkiaStack>
    </SkiaShape>
  );
}

/** A 96x64 tile with a caption, used to show one transform each. */
function Tile({ text, ...transform }: { text: string; Rotation?: number; RotationX?: number; RotationY?: number; ScaleX?: number; ScaleY?: number; SkewX?: number; SkewY?: number; TranslationX?: number; TranslationY?: number; Opacity?: number; AnchorX?: number; AnchorY?: number }) {
  return (
    <SkiaStack Spacing={6} WidthRequest={120} Padding={new Thickness(0, 12)}>
      <SkiaShape Type="Rectangle" CornerRadius={10} BackgroundColor="#0D6EFD" WidthRequest={96} HeightRequest={56} HorizontalOptions="Center" {...transform}>
        <SkiaLabel Text="DrawnUI" FontSize={14} FontFamily="FontTextBold" TextColor={Colors.White} HorizontalOptions="Center" VerticalOptions="Center" />
      </SkiaShape>
      <SkiaLabel Text={text} FontSize={12} TextColor="#ADB5BD" HorizontalOptions="Center" HorizontalTextAlignment="Center" />
    </SkiaStack>
  );
}

/** One face of the 3D card: a gradient fill with a title and a line of text. */
function Face({ from, to, title, text, face }: { from: string; to: string; title: string; text: string; face: React.Ref<SkiaShapeCtrl> }) {
  return (
    <SkiaShape ref={face} Type="Rectangle" CornerRadius={16} HorizontalOptions="Fill" VerticalOptions="Fill" FillGradient={{ Type: "Linear", EndXRatio: 1, EndYRatio: 1, Colors: [from, to] }}>
      <SkiaStack Spacing={4} VerticalOptions="Center">
        <SkiaLabel Text={title} FontSize={28} FontFamily="FontTextBold" TextColor={Colors.White} HorizontalOptions="Fill" HorizontalTextAlignment="Center" />
        <SkiaLabel Text={text} FontSize={13} TextColor={Colors.White} Margin={new Thickness(12, 0)} HorizontalOptions="Fill" HorizontalTextAlignment="Center" />
      </SkiaStack>
    </SkiaShape>
  );
}

/** A caption, a slider for one 3D property; moving the slider sets the property. */
function SliderRow({ name, min, max, slider, apply }: { name: string; min: number; max: number; slider: React.Ref<SkiaSliderCtrl>; apply: (v: number) => void }) {
  return (
    <SkiaLayer HorizontalOptions="Fill">
      <SkiaLabel Text={name} FontSize={13} TextColor="#ADB5BD" VerticalOptions="Center" />
      <SkiaSlider ref={slider} AccessibilityLabel={name} Min={min} Max={max} Margin={new Thickness(104, 0, 0, 0)} HorizontalOptions="Fill" VerticalOptions="Center" EndChanged={(_, v) => apply(v)} />
    </SkiaLayer>
  );
}

/** Render transforms (MAUI VisualElement names), 3D turns, Opacity, hit-testing through transforms and the *ToAsync animations. */
export function TransformsPage() {
  const logo = useRef<SkiaSvgCtrl>(null);
  const [taps, setTaps] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const spin = useRef<AbortController | null>(null);

  const card3d = useRef<SkiaShapeCtrl>(null), front = useRef<SkiaShapeCtrl>(null), back = useRef<SkiaShapeCtrl>(null);
  const sliderX = useRef<SkiaSliderCtrl>(null), sliderY = useRef<SkiaSliderCtrl>(null), sliderZ = useRef<SkiaSliderCtrl>(null);
  const readout = useRef<SkiaLabelCtrl>(null);
  const [lastTile, setLastTile] = useState("none");
  const [spinning3d, setSpinning3d] = useState(false);
  const spin3d = useRef<AbortController | null>(null);
  const syncing = useRef(false), turning = useRef(false), faces = useRef(-1);

  const toggleSpin = async () => {
    const svg = logo.current;
    if (!svg) return;
    if (spin.current) { spin.current.abort(); spin.current = null; setSpinning(false); return; }
    const c = new AbortController();
    spin.current = c;
    setSpinning(true);
    try {
      while (!c.signal.aborted) { svg.Rotation = 0; await svg.RotateToAsync(360, 1200, Easing.Linear, c.signal); }
    } catch { /* aborted */ }
  };

  /** Shows the face that looks at the viewer and syncs the sliders and the readout with the card. */
  const onCardTurned = () => {
    const card = card3d.current, f = front.current, b = back.current;
    if (!card || !f || !b) return;
    const cosX = Math.cos((card.RotationX * Math.PI) / 180), cosY = Math.cos((card.RotationY * Math.PI) / 180);
    const backShows = cosX * cosY < 0;
    // seen from behind a face draws mirrored: the back face is mirrored once more to read right
    const look = (backShows ? 1 : 0) | (cosY < 0 ? 2 : 0) | (cosX < 0 ? 4 : 0);
    if (faces.current !== look) {
      faces.current = look;
      f.Opacity = backShows ? 0 : 1; b.Opacity = backShows ? 1 : 0;
      b.ScaleX = cosY < 0 ? -1 : 1; b.ScaleY = cosX < 0 ? -1 : 1;
      f.RepaintComposition(); b.RepaintComposition();
    }
    syncing.current = true;
    if (sliderX.current) sliderX.current.End = normalize(card.RotationX);
    if (sliderY.current) sliderY.current.End = normalize(card.RotationY);
    if (sliderZ.current) sliderZ.current.End = card.TranslationZ;
    syncing.current = false;
    if (readout.current) readout.current.Text = `RotationX ${whole(normalize(card.RotationX))}°  ·  RotationY ${whole(normalize(card.RotationY))}°  ·  TranslationZ ${whole(card.TranslationZ)}`;
  };

  /** A slider moved by the user sets its property on the card. */
  const set3d = (apply: (card: SkiaShapeCtrl) => void) => {
    const card = card3d.current;
    if (!card || syncing.current) return;
    apply(card);
    card.RepaintComposition();
    onCardTurned();
  };

  /** Half a turn around the vertical (flip) or the horizontal (tumble) axis. */
  const turn = async (aroundY: boolean) => {
    const card = card3d.current;
    if (!card || turning.current || spin3d.current) return;
    turning.current = true;
    const from = aroundY ? card.RotationY : card.RotationX;
    await card.AnimateRangeAsync((v) => { if (aroundY) card.RotationY = v; else card.RotationX = v; onCardTurned(); }, from, from + 180, 700, Easing.CubicInOut);
    if (aroundY) card.RotationY = normalize(card.RotationY); else card.RotationX = normalize(card.RotationX);
    onCardTurned();
    turning.current = false;
  };

  const toggleSpin3d = async () => {
    const card = card3d.current;
    if (!card) return;
    if (spin3d.current) { spin3d.current.abort(); spin3d.current = null; setSpinning3d(false); return; }
    if (turning.current) return;
    const c = new AbortController();
    spin3d.current = c;
    setSpinning3d(true);
    try {
      while (!c.signal.aborted) {
        const from = normalize(card.RotationY);
        await card.AnimateRangeAsync((v) => { card.RotationY = v; onCardTurned(); }, from, from + 360, 3000, Easing.Linear, c.signal);
      }
    } catch { /* aborted */ }
    card.RotationY = normalize(card.RotationY);
    onCardTurned();
  };

  const reset3d = async () => {
    const card = card3d.current;
    if (!card) return;
    if (spin3d.current) await toggleSpin3d();
    if (turning.current) return;
    turning.current = true;
    const x = normalize(card.RotationX), y = normalize(card.RotationY), z = card.TranslationZ;
    await card.AnimateRangeAsync((t) => { card.RotationX = x * (1 - t); card.RotationY = y * (1 - t); card.TranslationZ = z * (1 - t); onCardTurned(); }, 0, 1, 400, Easing.CubicOut);
    turning.current = false;
  };

  useEffect(() => { onCardTurned(); return () => { spin3d.current?.abort(); }; }, []);

  return (
    <SkiaScroll Orientation="Vertical">
      <SkiaStack Spacing={16} Padding={new Thickness(16)} HorizontalOptions="Center" MaximumWidthRequest={720}>
        <SkiaLabel Text="Transforms" FontSize={24} TextColor={Colors.White} HorizontalOptions="Center" />
        <SkiaLabel Text="Applied at render around the arranged box, so layout is untouched and caches stay valid. Same names as MAUI: TranslationX/Y, Rotation, RotationX/Y, ScaleX/Y, SkewX/Y, AnchorX/Y, Opacity, plus TranslationZ for 3D depth." FontSize={13} TextColor={Colors.LightGray} HorizontalOptions="Fill" HorizontalTextAlignment="Center" />

        <Card title="One property each">
          <SkiaWrap Spacing={4} HorizontalOptions="Center">
            <Tile text="none" />
            <Tile text="Rotation={15}" Rotation={15} />
            <Tile text="RotationX={45}" RotationX={45} />
            <Tile text="RotationY={45}" RotationY={45} />
            <Tile text="Scale={1.3}" ScaleX={1.3} ScaleY={1.3} />
            <Tile text="ScaleX={-1}" ScaleX={-1} />
            <Tile text="SkewX={20}" SkewX={20} />
            <Tile text="TranslationY={10}" TranslationY={10} />
            <Tile text="Opacity={0.35}" Opacity={0.35} />
            <Tile text="Rotation={15} AnchorX/Y={0}" Rotation={15} AnchorX={0} AnchorY={0} />
          </SkiaWrap>
        </Card>

        <Card title="3D — RotationX, RotationY, TranslationZ, with perspective">
          <SkiaLayer HeightRequest={250} HorizontalOptions="Fill">
            <SkiaShape ref={card3d} Type="Rectangle" CornerRadius={16} WidthRequest={240} HeightRequest={150} HorizontalOptions="Center" VerticalOptions="Center" UseCache="Image" Tapped={() => void turn(true)}>
              <Face face={front} from="#6EA8FE" to="#0D6EFD" title="DrawnUI" text="Tap to flip" />
              <Face face={back} from="#D63384" to="#FD7E14" title="Back side" text="Drawn mirrored, reads right from behind" />
            </SkiaShape>
          </SkiaLayer>
          <SkiaLabel ref={readout} FontSize={13} TextColor={Colors.White} HorizontalOptions="Fill" HorizontalTextAlignment="Center" />
          <SliderRow name="RotationX" min={-180} max={180} slider={sliderX} apply={(v) => set3d((c) => { c.RotationX = v; })} />
          <SliderRow name="RotationY" min={-180} max={180} slider={sliderY} apply={(v) => set3d((c) => { c.RotationY = v; })} />
          <SliderRow name="TranslationZ" min={-300} max={150} slider={sliderZ} apply={(v) => set3d((c) => { c.TranslationZ = v; })} />
          <SkiaWrap Spacing={6}>
            <SkiaButton Text="Flip" BackgroundColor="#0D6EFD" Tapped={() => void turn(true)} />
            <SkiaButton Text="Tumble" BackgroundColor="#0D6EFD" Tapped={() => void turn(false)} />
            <SkiaButton Text={spinning3d ? "Stop spin" : "Spin"} BackgroundColor={spinning3d ? "#DC3545" : "#20C997"} Tapped={() => void toggleSpin3d()} />
            <SkiaButton Text="Reset" BackgroundColor="#495057" Tapped={() => void reset3d()} />
          </SkiaWrap>
          <SkiaLabel Text="Perspective is built in: RotationX turns around the horizontal axis, RotationY around the vertical one, TranslationZ moves the control toward (+) or away from (−) the viewer. The card keeps its Image cache while it turns; it shows the back face once it faces away." FontSize={12} TextColor="#ADB5BD" HorizontalOptions="Fill" />
        </Card>

        <Card title="Gestures map through 3D — swipe and tap the tilted strip">
          <SkiaLayer HeightRequest={220} HorizontalOptions="Fill">
            <SkiaShape Type="Rectangle" CornerRadius={16} WidthRequest={280} HeightRequest={150} HorizontalOptions="Center" VerticalOptions="Center" RotationX={16} RotationY={20} Rotation={-6} BackgroundColor="#111827" StrokeColor="#6EA8FE" StrokeWidth={1.55}>
              <SkiaScroll Orientation="Horizontal" HorizontalOptions="Fill" VerticalOptions="Fill">
                <SkiaRow UseCache="Image" Spacing={10} Padding={new Thickness(14)} VerticalOptions="Center">
                  {Array.from({ length: 20 }, (_, k) => k + 1).map((i) => (
                    <SkiaShape key={i} Type="Rectangle" CornerRadius={12} WidthRequest={96} HeightRequest={96} FillGradient={{ Type: "Linear", EndXRatio: 1, EndYRatio: 1, Colors: STRIP_COLORS[(i - 1) % STRIP_COLORS.length] }} Tapped={() => setLastTile(`tile ${i}`)}>
                      <SkiaLabel Text={`${i}`} FontSize={30} FontFamily="FontTextBold" TextColor={Colors.White} HorizontalOptions="Center" VerticalOptions="Center" />
                    </SkiaShape>
                  ))}
                </SkiaRow>
              </SkiaScroll>
            </SkiaShape>
          </SkiaLayer>
          <SkiaLabel Text={`Tapped: ${lastTile}`} FontSize={13} TextColor={Colors.White} HorizontalOptions="Fill" HorizontalTextAlignment="Center" />
          <SkiaLabel Text="RotationX 16, RotationY 20, Rotation −6. A sideways swipe scrolls the strip and a tap picks the tile under the finger: input goes through the inverse of the 3D matrix. An up or down swipe still scrolls the page." FontSize={12} TextColor="#ADB5BD" HorizontalOptions="Fill" />
        </Card>

        <Card title="Gestures map through transforms — tap the rotated, scaled button">
          <SkiaStack Spacing={8} HeightRequest={120} HorizontalOptions="Fill">
            <SkiaButton Text={`Tapped ${taps}×`} BackgroundColor="#D63384" HorizontalOptions="Center" VerticalOptions="Center" Rotation={-20} ScaleX={1.4} ScaleY={1.4} ApplyEffect="Ripple" Tapped={() => setTaps((t) => t + 1)} />
          </SkiaStack>
          <SkiaLabel Text="The hit rect is the drawn one (inverse RenderTransformMatrix), not the layout box; the ripple lands under the finger." FontSize={12} TextColor="#ADB5BD" HorizontalOptions="Fill" />
        </Card>

        <Card title="Animations — FadeToAsync, ScaleToAsync, TranslateToAsync, RotateToAsync (Promises)">
          <SkiaStack Spacing={0} HeightRequest={140} HorizontalOptions="Fill">
            <SkiaSvg ref={logo} Source="images/drawnui.svg" WidthRequest={100} LockRatio={1} HorizontalOptions="Center" VerticalOptions="Center" />
          </SkiaStack>
          <SkiaWrap Spacing={6}>
            <SkiaButton Text="Fade" BackgroundColor="#0D6EFD" Tapped={() => { void logo.current?.FadeToAsync(0.15, 300).then(() => logo.current?.FadeToAsync(1, 300)); }} />
            <SkiaButton Text="Scale" BackgroundColor="#0D6EFD" Tapped={() => { void logo.current?.ScaleToAsync(1.6, 1.6, 250, Easing.CubicOut).then(() => logo.current?.ScaleToAsync(1, 1, 250, Easing.CubicIn)); }} />
            <SkiaButton Text="Translate" BackgroundColor="#0D6EFD" Tapped={() => { void logo.current?.TranslateToAsync(140, 0, 300, Easing.CubicInOut).then(() => logo.current?.TranslateToAsync(0, 0, 300, Easing.CubicInOut)); }} />
            <SkiaButton Text="Rotate" BackgroundColor="#0D6EFD" Tapped={() => { const s = logo.current; if (s) { s.Rotation = 0; void s.RotateToAsync(360, 600, Easing.CubicInOut); } }} />
            <SkiaButton Text={spinning ? "Stop spin" : "Spin"} BackgroundColor={spinning ? "#DC3545" : "#20C997"} Tapped={() => void toggleSpin()} />
          </SkiaWrap>
          <SkiaLabel Text="Each *ToAsync cancels its previous run of the same kind (like the C# per-property CancellationTokenSource); pass an AbortSignal to cancel from outside." FontSize={12} TextColor="#ADB5BD" HorizontalOptions="Fill" />
        </Card>
      </SkiaStack>
    </SkiaScroll>
  );
}
