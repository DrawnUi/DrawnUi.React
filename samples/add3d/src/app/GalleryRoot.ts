// Port of Add3dGallery.Shared GalleryRoot.cs.
import { Aria, ScaledSize, SkiaControl, SkiaGrid, SkiaLabel, SkiaLabelFps, SkiaLayer, SkiaRow, SkiaShape, SkiaStack, Thickness, type SkiaLayout } from "drawnui-react/core";
import { BossPage } from "./BossPage";
import { GalleryPage } from "./GalleryPage";
import { Make, Theme, UiButton } from "./Theme";

/** Narrower canvases put the tabs under the app's name. */
const HeaderOneLine = 620;

/**
 * The whole app: a header with two tabs (the gallery and the boss fight) over one drawing surface, and the frame rate
 * in a corner.
 */
export class GalleryRoot extends SkiaLayer {
  private readonly _tabs: UiButton[] = [];
  private readonly _pages: SkiaControl[] = [];
  private _header!: SkiaLayout;
  private _oneLine?: boolean;

  /** The gallery screen. */
  get Gallery(): GalleryPage { return this._pages[0] as GalleryPage; }

  /** `subtitle`: the line under the app name, naming the head. */
  constructor(subtitle: string) {
    super();
    this.VerticalOptions = "Fill";
    this.BackgroundColor = Theme.Page;
    this.Children = [
      Make(new SkiaGrid(), {
        RowSpacing: 0,
        VerticalOptions: "Fill",
        RowDefinitions: "Auto,*",
        Children: [
          this._header = Make(new SkiaLayer(), {
            BackgroundColor: Theme.Header,
            HeightRequest: 64,
            Spacing: 10,
            Padding: new Thickness(24, 0),
            // Static chrome over pages that draw every frame: blitted, not drawn again.
            UseCache: "Image",
            Row: 0,
            Children: [
              Make(new SkiaRow(), {
                Spacing: 12,
                VerticalOptions: "Center",
                Children: [
                  Make(new SkiaShape(), {
                    Type: "Rectangle", CornerRadius: 8, WidthRequest: 32, HeightRequest: 32,
                    VerticalOptions: "Center",
                    FillGradient: { StartXRatio: 0, StartYRatio: 0, EndXRatio: 1, EndYRatio: 1, Colors: [Theme.Accent, "#FF6384"] },
                    Children: [
                      Make(new SkiaLabel(), { Text: "3D", FontSize: 13, FontFamily: Theme.Title, TextColor: "#FFFFFF", HorizontalOptions: "Center", VerticalOptions: "Center", AccessibilityRole: Aria.RolePresentation }),
                    ],
                  }),
                  Make(new SkiaStack(), {
                    Spacing: 0,
                    HorizontalOptions: "Start",
                    VerticalOptions: "Center",
                    Children: [
                      Make(new SkiaLabel(), { Text: "DrawnUI 3D Demo", FontSize: 17, FontFamily: Theme.Title, TextColor: Theme.Ink, AccessibilityRole: Aria.RoleHeading }),
                      Make(new SkiaLabel(), { Text: subtitle, FontSize: 12, TextColor: Theme.Muted }),
                    ],
                  }),
                ],
              }),
              Make(new SkiaRow(), {
                Spacing: 8,
                HorizontalOptions: "End",
                VerticalOptions: "Center",
                AccessibilityRole: Aria.RoleTabList,
                AccessibilityLabel: "Screens",
                Children: [
                  this._tabs[0] = Make(new UiButton("Gallery", Theme.Accent, 120), { AccessibilityRole: Aria.RoleTab, Tapped: () => this.Show(0) }),
                  this._tabs[1] = Make(new UiButton("Boss fight", Theme.Quiet, 120), { AccessibilityRole: Aria.RoleTab, Tapped: () => this.Show(1) }),
                ],
              }),
            ],
          }),
          Make(new SkiaLayer(), {
            VerticalOptions: "Fill",
            Row: 1,
            Children: [
              this._pages[0] = new GalleryPage(),
              this._pages[1] = Make(new BossPage(), { IsVisible: false }),
            ],
          }),
        ],
      }),
      Make(new SkiaLabelFps(), {
        Margin: new Thickness(0, 0, 8, 8),
        VerticalOptions: "End",
        HorizontalOptions: "End",
        FontSize: 12,
        BackgroundColor: "#8B0000",
        TextColor: "#FFFFFF",
        // Its text changes every frame: recorded (Operations, the label default), not a GPU surface made again each frame.
        ZIndex: 110,
      }),
    ];
    this.Show(0);
  }

  /** The canvas's width decides the header's arrangement (C# OnMeasured). */
  protected override MeasureAbsolute(widthConstraint: number, heightConstraint: number, scale: number): ScaledSize {
    const width = widthConstraint / scale;
    if (width > 0 && isFinite(width)) {
      const oneLine = width >= HeaderOneLine;
      if (this._oneLine !== oneLine) {
        this._oneLine = oneLine;
        this._header.Type = oneLine ? "Absolute" : "Column";
        this._header.HeightRequest = oneLine ? 64 : -1;
        this._header.Padding = oneLine ? new Thickness(24, 0) : new Thickness(16, 12);
        this._header.Update();
      }
    }
    return super.MeasureAbsolute(widthConstraint, heightConstraint, scale);
  }

  /** Shows one screen; the hidden one asks for no frames. */
  private Show(index: number): void {
    for (let i = 0; i < this._pages.length; i++) {
      this._pages[i].IsVisible = i === index;
      this._pages[i].Update();
      this._tabs[i].Fill = i === index ? Theme.Accent : Theme.Quiet;
      this._tabs[i].AccessibilityIsPressed = i === index;
    }
  }
}
