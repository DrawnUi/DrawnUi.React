import { useState } from "react";
import { Colors, SkiaBackdrop, SkiaButton, SkiaImage, SkiaLabel, SkiaLayer, SkiaScroll, SkiaShape, SkiaShell, SkiaStack, SkiaWrap, Thickness, useShell } from "drawnui-react";

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

/** A page inside the embedded tabbed shell: shows its tab stack and pushes deeper pages. */
function TabPage({ name, color }: { name: string; color: string }) {
  const shell = useShell();
  return (
    <SkiaLayer VerticalOptions="Fill" BackgroundColor={color}>
      <SkiaStack Spacing={10} Padding={new Thickness(16)} HorizontalOptions="Center" VerticalOptions="Center">
        <SkiaLabel Text={name} FontSize={22} FontFamily="FontTextBold" TextColor={Colors.White} HorizontalOptions="Center" />
        <SkiaLabel Text={`Tab ${shell.SelectedTab} · stack [${shell.NavigationStack.join(", ")}]`} FontSize={12} TextColor="#DEE2E6" HorizontalOptions="Center" />
        <SkiaButton Text="Push detail" BackgroundColor="#212529" FontSize={13} HorizontalOptions="Center" Tapped={() => void shell.GoToAsync("detail")} />
      </SkiaStack>
    </SkiaLayer>
  );
}

const TAB_ROUTES = {
  home: () => <TabPage name="Home" color="#0F3460" />,
  search: () => <TabPage name="Search" color="#533483" />,
  profile: () => <TabPage name="Profile" color="#1B4332" />,
  detail: () => <TabPage name="Detail page (pushed inside this tab)" color="#2B3035" />,
};
const TAB_TITLES = { detail: "Detail" };

/** SkiaShell: pages with slide transitions, popups, modals, toasts, tabs, browser back. */
export function ShellPage() {
  const shell = useShell();
  const [log, setLog] = useState("");
  return (
    <SkiaScroll Orientation="Vertical">
      <SkiaStack Spacing={16} Padding={new Thickness(16)} HorizontalOptions="Center" MaximumWidthRequest={720}>
        <SkiaLabel Text="SkiaShell" FontSize={24} TextColor={Colors.White} HorizontalOptions="Center" />
        <SkiaLabel Text={`Route=${shell.Route || '""'} · NavigationStack=[${shell.NavigationStack.join(", ")}] · Popups=${shell.PopupsCount} · Modals=${shell.ModalsCount} · Toasts=${shell.ToastsCount} ${log}`} FontSize={12} TextColor="#ADB5BD" HorizontalOptions="Fill" />
        <SkiaLabel Text="Pages live in the URL hash (#/shell/shapes); the browser Back button closes the top popup, then the top modal, then pops the page — the C# GoBack order." FontSize={12} TextColor="#ADB5BD" HorizontalOptions="Fill" />

        <Card title="Pages — GoToAsync slides the page in from the right (PagesAnimationSpeed 200 ms), GoBackAsync slides it out">
          <SkiaWrap Spacing={8}>
            <SkiaButton Text="GoToAsync('shapes')" BackgroundColor="#0D6EFD" Tapped={() => void shell.GoToAsync("shapes")} />
            <SkiaButton Text="GoToAsync('shell') again" BackgroundColor="#0D6EFD" Tapped={() => void shell.GoToAsync("shell")} />
            <SkiaButton Text="GoBackAsync()" BackgroundColor="#495057" Tapped={() => void shell.GoBackAsync()} />
            <SkiaButton Text="PopToRootAsync()" BackgroundColor="#495057" Tapped={() => void shell.PopToRootAsync()} />
          </SkiaWrap>
        </Card>

        <Card title="Tabs — a nested SkiaShell with Tabs: per-tab navigation stacks, PopTabToRootAsync">
          <SkiaLayer HeightRequest={300} HorizontalOptions="Fill" IsClippedToBounds>
            <SkiaShell Routes={TAB_ROUTES} Titles={TAB_TITLES} Tabs={[{ route: "home", title: "Home" }, { route: "search", title: "Search" }, { route: "profile", title: "Profile" }]} UseBrowserHistory={false} NavBarHeight={44} />
          </SkiaLayer>
        </Card>

        <Card title="SkiaBackdrop — Blur={8} over an image, children drawn first, BackgroundColor tint">
          {/* UseCache=Image: the backdrop snapshots the layer's own offscreen surface (a picture-recording parent has nothing to snapshot yet) */}
          <SkiaLayer HeightRequest={160} HorizontalOptions="Fill" IsClippedToBounds UseCache="Image">
            <SkiaImage Source="images/baboon.jpg" Aspect="AspectCover" HorizontalOptions="Fill" VerticalOptions="Fill" />
            {/* children of a backdrop are blurred with it (C# draws them first): the caption sits on top as a sibling */}
            <SkiaBackdrop Blur={8} BackgroundColor="#33000000" WidthRequest={260} HeightRequest={100} HorizontalOptions="Center" VerticalOptions="Center" />
            <SkiaLabel Text="frosted glass" FontSize={22} FontFamily="FontTextBold" TextColor={Colors.White} HorizontalOptions="Center" VerticalOptions="Center" />
            <SkiaBackdrop Blur={0} Brightness={0.5} WidthRequest={110} HeightRequest={60} HorizontalOptions="End" VerticalOptions="End" Margin={new Thickness(12)}>
              <SkiaLabel Text="Brightness 0.5" FontSize={12} TextColor={Colors.White} HorizontalOptions="Center" VerticalOptions="Center" />
            </SkiaBackdrop>
          </SkiaLayer>
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
