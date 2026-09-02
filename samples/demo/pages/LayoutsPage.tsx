import { Colors, SkiaGrid, SkiaLabel, SkiaScroll, SkiaShape, SkiaStack, SkiaWrap, Thickness } from "drawnui-react";

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

/** A colored cell with a centered caption, sized by its grid cell. */
function Cell({ text, color, ...place }: { text: string; color: string; Column?: number; Row?: number; ColumnSpan?: number; RowSpan?: number }) {
  return (
    <SkiaShape Type="Rectangle" CornerRadius={6} BackgroundColor={color} HorizontalOptions="Fill" VerticalOptions="Fill" {...place}>
      <SkiaLabel Text={text} FontSize={13} TextColor={Colors.White} HorizontalOptions="Center" VerticalOptions="Center" Padding={new Thickness(8, 6)} />
    </SkiaShape>
  );
}

/** SkiaGrid: star / Auto / absolute tracks, spans, spacing; SkiaWrap next to it. */
export function LayoutsPage() {
  return (
    <SkiaScroll Orientation="Vertical">
      <SkiaStack Spacing={16} Padding={new Thickness(16)} HorizontalOptions="Center" MaximumWidthRequest={720}>
        <SkiaLabel Text="SkiaGrid" FontSize={24} TextColor={Colors.White} HorizontalOptions="Center" />

        <Card title='ColumnDefinitions="*, 2*, Auto" RowDefinitions="Auto, 60" · ColumnSpacing/RowSpacing 8'>
          <SkiaGrid ColumnDefinitions="*, 2*, Auto" RowDefinitions="Auto, 60" ColumnSpacing={8} RowSpacing={8}>
            <Cell text="*" color="#0D6EFD" Column={0} Row={0} />
            <Cell text="2*" color="#6610F2" Column={1} Row={0} />
            <Cell text="Auto (this label)" color="#D63384" Column={2} Row={0} />
            <Cell text="Row 1 = 60pt" color="#20C997" Column={0} Row={1} />
            <Cell text="Column 1" color="#FD7E14" Column={1} Row={1} />
            <Cell text="Auto" color="#DC3545" Column={2} Row={1} />
          </SkiaGrid>
        </Card>

        <Card title="ColumnSpan / RowSpan">
          <SkiaGrid ColumnDefinitions="*, *, *" RowDefinitions="48, 48, 48" ColumnSpacing={6} RowSpacing={6}>
            <Cell text="ColumnSpan=2" color="#0D6EFD" Column={0} Row={0} ColumnSpan={2} />
            <Cell text="RowSpan=2" color="#6610F2" Column={2} Row={0} RowSpan={2} />
            <Cell text="0,1" color="#20C997" Column={0} Row={1} />
            <Cell text="1,1" color="#FD7E14" Column={1} Row={1} />
            <Cell text="ColumnSpan=3" color="#D63384" Column={0} Row={2} ColumnSpan={3} />
          </SkiaGrid>
        </Card>

        <Card title="Implicit tracks: no definitions, children reference Column/Row (DefaultColumnDefinition = Auto)">
          <SkiaGrid ColumnSpacing={12} RowSpacing={4} HorizontalOptions="Start">
            <SkiaLabel Text="Name" FontSize={14} TextColor="#ADB5BD" Column={0} Row={0} />
            <SkiaLabel Text="DrawnUI for React" FontSize={14} TextColor={Colors.White} Column={1} Row={0} />
            <SkiaLabel Text="Renderer" FontSize={14} TextColor="#ADB5BD" Column={0} Row={1} />
            <SkiaLabel Text="CanvasKit (Skia WASM) + react-reconciler" FontSize={14} TextColor={Colors.White} Column={1} Row={1} />
            <SkiaLabel Text="License" FontSize={14} TextColor="#ADB5BD" Column={0} Row={2} />
            <SkiaLabel Text="MIT" FontSize={14} TextColor={Colors.White} Column={1} Row={2} />
          </SkiaGrid>
        </Card>

        <Card title="Icon + text pattern: Auto column for the icon, * for wrapping text">
          <SkiaGrid ColumnDefinitions="Auto, *" ColumnSpacing={12}>
            <SkiaShape Type="Circle" BackgroundColor="#6EA8FE" WidthRequest={40} LockRatio={1} VerticalOptions="Start" Column={0} />
            <SkiaLabel Column={1} FontSize={14} TextColor="#DEE2E6" HorizontalOptions="Fill" Text="The star column takes whatever the Auto column leaves, and this label wraps inside it. The row is Auto, so it grows with the text — the same layout a MAUI Grid would produce." />
          </SkiaGrid>
        </Card>

        <SkiaLabel Text="SkiaWrap" FontSize={24} TextColor={Colors.White} HorizontalOptions="Center" Margin={new Thickness(0, 8, 0, 0)} />
        <Card title="Type=Wrap · Spacing 8 · resize the window">
          <SkiaWrap Spacing={8}>
            {["Absolute", "Column", "Row", "Wrap", "Grid", "SkiaStack", "SkiaRow", "SkiaLayer", "SkiaWrap", "SkiaGrid", "Spacing", "Padding", "Margin"].map((t) => (
              <SkiaShape key={t} Type="Rectangle" CornerRadius={14} BackgroundColor="#373B3E">
                <SkiaLabel Text={t} FontSize={13} TextColor="#DEE2E6" Padding={new Thickness(12, 6)} />
              </SkiaShape>
            ))}
          </SkiaWrap>
        </Card>
      </SkiaStack>
    </SkiaScroll>
  );
}
