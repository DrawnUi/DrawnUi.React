import { useState } from "react";
import { Colors, SkiaButton, SkiaLabel, SkiaScroll, SkiaShape, SkiaStack, SkiaWrap, Thickness, useShell } from "drawnui-react";

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <SkiaShape Type="Rectangle" CornerRadius={8} BackgroundColor="#2B3035" HorizontalOptions="Fill">
      <SkiaStack Spacing={10} Padding={new Thickness(16, 12)}>
        <SkiaLabel Text={title} FontSize={12} TextColor="#6EA8FE" FontAttributes="Bold" TextTransform="Uppercase" />
        {children}
      </SkiaStack>
    </SkiaShape>
  );
}

/** Content of the demo popup: a card with its own close button (uses the shell from context). */
function PopupContent({ title }: { title: string }) {
  const shell = useShell();
  return (
    <SkiaShape Type="Rectangle" CornerRadius={16} BackgroundColor="#F5F5F5" WidthRequest={300} Shadows={[{ X: 0, Y: 6, Blur: 12, Opacity: 0.5, Color: Colors.Black }]}>
      <SkiaStack Spacing={12} Padding={new Thickness(20)}>
        <SkiaLabel Text={title} FontSize={20} FontFamily="FontTextBold" TextColor="#111827" />
        <SkiaLabel Text="OpenPopupAsync centers the content over a dimmed backdrop, scales it in from 0.5 and fades the layer (PopupsAnimationSpeed 250 ms). A tap outside closes it when closeWhenBackgroundTapped." FontSize={13} TextColor="#374151" HorizontalOptions="Fill" />
        <SkiaButton Text="Close" ControlStyle="Material" HorizontalOptions="End" Tapped={() => void shell.ClosePopupAsync()} />
      </SkiaStack>
    </SkiaShape>
  );
}

function ModalContent() {
  const shell = useShell();
  return (
    <SkiaShape Type="Rectangle" BackgroundColor="#212529" HorizontalOptions="Fill" VerticalOptions="Fill">
      <SkiaStack Spacing={16} Padding={new Thickness(24, 40)} HorizontalOptions="Center" MaximumWidthRequest={520}>
        <SkiaLabel Text="Modal page" FontSize={28} FontFamily="FontTextBold" TextColor={Colors.White} />
        <SkiaLabel Text="PushModalAsync wraps the content in a full-screen SkiaDrawer (Direction=FromBottom, HeaderSize=0) that slides open; with useGestures it can be dragged down to close. PopModalAsync closes it." FontSize={14} TextColor="#ADB5BD" HorizontalOptions="Fill" />
        <SkiaWrap Spacing={8}>
          <SkiaButton Text="PopModalAsync()" BackgroundColor="#0D6EFD" Tapped={() => void shell.PopModalAsync()} />
          <SkiaButton Text="Popup over the modal" BackgroundColor="#6610F2" Tapped={() => void shell.OpenPopupAsync(<PopupContent title="Popup over a modal" />)} />
          <SkiaButton Text="Toast" BackgroundColor="#495057" Tapped={() => shell.ShowToast("Toast shown above the modal (ZIndexToasts)")} />
        </SkiaWrap>
      </SkiaStack>
    </SkiaShape>
  );
}

/** SkiaShell: pages with slide transitions, popups, modals, toasts. */
export function ShellPage() {
  const shell = useShell();
  const [log, setLog] = useState("");
  return (
    <SkiaScroll Orientation="Vertical">
      <SkiaStack Spacing={16} Padding={new Thickness(16)} HorizontalOptions="Center" MaximumWidthRequest={720}>
        <SkiaLabel Text="SkiaShell" FontSize={24} TextColor={Colors.White} HorizontalOptions="Center" />
        <SkiaLabel Text={`Route=${shell.Route || '""'} · NavigationStack=[${shell.NavigationStack.join(", ")}] · Popups=${shell.PopupsCount} · Modals=${shell.ModalsCount} · Toasts=${shell.ToastsCount} ${log}`} FontSize={12} TextColor="#ADB5BD" HorizontalOptions="Fill" />

        <Card title="Pages — GoToAsync slides the page in from the right (PagesAnimationSpeed 200 ms), GoBackAsync slides it out">
          <SkiaWrap Spacing={8}>
            <SkiaButton Text="GoToAsync('shapes')" BackgroundColor="#0D6EFD" Tapped={() => void shell.GoToAsync("shapes")} />
            <SkiaButton Text="GoToAsync('shell') again" BackgroundColor="#0D6EFD" Tapped={() => void shell.GoToAsync("shell")} />
            <SkiaButton Text="GoBackAsync()" BackgroundColor="#495057" Tapped={() => void shell.GoBackAsync()} />
            <SkiaButton Text="PopToRootAsync()" BackgroundColor="#495057" Tapped={() => void shell.PopToRootAsync()} />
          </SkiaWrap>
        </Card>

        <Card title="Popups — OpenPopupAsync(content, options)">
          <SkiaWrap Spacing={8}>
            <SkiaButton Text="Open popup" BackgroundColor="#6610F2" Tapped={() => void shell.OpenPopupAsync(<PopupContent title="Hello popup" />).then(() => setLog("· popup opened"))} />
            <SkiaButton Text="Not closable outside" BackgroundColor="#6610F2" Tapped={() => void shell.OpenPopupAsync(<PopupContent title="closeWhenBackgroundTapped=false" />, { closeWhenBackgroundTapped: false })} />
            <SkiaButton Text="No overlay, not animated" BackgroundColor="#6610F2" Tapped={() => void shell.OpenPopupAsync(<PopupContent title="showOverlay=false" />, { showOverlay: false, animated: false })} />
            <SkiaButton Text="Red overlay" BackgroundColor="#6610F2" Tapped={() => void shell.OpenPopupAsync(<PopupContent title="backgroundColor" />, { backgroundColor: "#66FF0000" })} />
            <SkiaButton Text="CloseAllPopups()" BackgroundColor="#495057" Tapped={() => void shell.CloseAllPopups()} />
          </SkiaWrap>
        </Card>

        <Card title="Modals — PushModalAsync(content, { useGestures, animated })">
          <SkiaWrap Spacing={8}>
            <SkiaButton Text="Push modal" BackgroundColor="#20C997" TextColor="#1A1A2E" Tapped={() => void shell.PushModalAsync(<ModalContent />).then(() => setLog("· modal opened"))} />
            <SkiaButton Text="Draggable (useGestures)" BackgroundColor="#20C997" TextColor="#1A1A2E" Tapped={() => void shell.PushModalAsync(<ModalContent />, { useGestures: true })} />
            <SkiaButton Text="Not animated" BackgroundColor="#20C997" TextColor="#1A1A2E" Tapped={() => void shell.PushModalAsync(<ModalContent />, { animated: false })} />
          </SkiaWrap>
        </Card>

        <Card title="Toasts — ShowToast(text | content, msShowTime)">
          <SkiaWrap Spacing={8}>
            <SkiaButton Text="ShowToast('Saved!')" BackgroundColor="#FD7E14" TextColor="#1A1A2E" Tapped={() => shell.ShowToast("**Saved!** The toast slides up, stays 4 s, slides down.")} />
            <SkiaButton Text="Short (1.5 s)" BackgroundColor="#FD7E14" TextColor="#1A1A2E" Tapped={() => shell.ShowToast("Gone in 1.5 seconds", 1500)} />
            <SkiaButton Text="Custom content" BackgroundColor="#FD7E14" TextColor="#1A1A2E" Tapped={() => shell.ShowToast(
              <SkiaStack Spacing={4} Padding={new Thickness(24, 16)}>
                <SkiaLabel Text="Custom toast" FontSize={16} FontFamily="FontTextBold" TextColor={Colors.White} />
                <SkiaLabel Text="Any drawn tree works as toast content." FontSize={13} TextColor="#ADB5BD" />
              </SkiaStack>, 3000)} />
            <SkiaButton Text="CloseAllToasts()" BackgroundColor="#495057" Tapped={() => void shell.CloseAllToasts()} />
          </SkiaWrap>
        </Card>
      </SkiaStack>
    </SkiaScroll>
  );
}
