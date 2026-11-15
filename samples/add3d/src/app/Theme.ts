// Port of Add3dGallery.Shared Pages/Theme.cs: the app's palette, type, the models it ships, its button (Button3D), switch (Switch3D) and selectable text (Copyable).
import { Aria, SkiaBevel, SkiaControl, SkiaLabel, SkiaLayer, SkiaShadow, SkiaShape, SkiaStack, Super, Thickness, type Color, type GestureEventProcessingInfo, type PopupId, type SkiaGesturesParameters } from "drawnui-react/core";

/** Sets the properties of a control built in code, as a C# object initializer does. */
export function Make<T extends object>(target: T, props: Partial<T>): T { return Object.assign(target, props); }

/**
 * C# SkiaControl.WasInLastFrame: the control is shown (it and every parent visible) and on screen. Controls off screen
 * are not touched each frame: their state moves on, they get it when they show again.
 */
export function WasInLastFrame(control: SkiaControl): boolean {
  for (let c: SkiaControl | undefined = control; c; c = c.Parent) if (!c.IsVisible) return false;
  const r = control.GetVisibleViewport();
  return r.Right > r.Left && r.Bottom > r.Top;
}

/** A 3D view reads as an image to screen readers, named after what it shows (spread into its properties). */
export const View3D = (name: string) => ({ AccessibilityRole: Aria.RoleImg, AccessibilityLabel: `${name}, 3D view` });

/** Bytes of a file the site ships under assets/. */
async function Asset(name: string): Promise<Uint8Array> {
  const response = await fetch(Super.ResolveAssetUrl(`assets/${name}`));
  if (!response.ok) throw new Error(`assets/${name}: ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

/** The app's palette, type and the models it ships. */
export class Theme {
  static readonly Page = "#0E1018";
  static readonly Header = "#131520";
  static readonly Card = "#181B28";
  static readonly Line = "#282C3E";
  /** The panel a 3D piece stands on inside a card. */
  static readonly Stage = "#2A2F46";
  static readonly Ink = "#F2F1F8";
  static readonly Muted = "#9A98B0";
  static readonly Accent = "#F2B33D";
  static readonly Quiet = "#464C6A";
  /** Prices. */
  static readonly Gold = "#FFC43D";
  static readonly Bad = "#FF6384";

  static readonly Title = "FontTextTitle";

  // Models: CC0, see assets/MODELS-LICENSE.txt. One array each, so every control showing one shares a single read.
  static Dragon: Uint8Array;
  static Avatar: Uint8Array;
  static Chest: Uint8Array;
  static Mob: Uint8Array;
  /** The shop's other pieces (Poly Haven, CC0). */
  static LoungeChair: Uint8Array;
  static Armchair: Uint8Array;
  static Ottoman: Uint8Array;
  static CoffeeTable: Uint8Array;
  static DrawerCabinet: Uint8Array;
  /** The product viewer's sofa (Poly Haven Sofa_01, CC0) and its upholstery images (Poly Haven, CC0). */
  static Sofa: Uint8Array;
  static Linen: Uint8Array;
  static Wool: Uint8Array;
  static Velvet: Uint8Array;
  static Leather: Uint8Array;
  /** NASA's Blue Marble (public domain), an equirectangular map for the globe. */
  static Earth: Uint8Array;

  /** Reads every model and image the gallery shows (the .NET heads embed them in the assembly). */
  static async Load(): Promise<void> {
    [Theme.Dragon, Theme.Avatar, Theme.Chest, Theme.Mob, Theme.LoungeChair, Theme.Armchair, Theme.Ottoman, Theme.CoffeeTable,
      Theme.DrawerCabinet, Theme.Sofa, Theme.Linen, Theme.Wool, Theme.Velvet, Theme.Leather, Theme.Earth] = await Promise.all([
      "dragon.glb", "avatar.glb", "gift.glb", "mob.glb", "lounge_chair.glb", "armchair.glb", "ottoman.glb", "coffee_table.glb",
      "drawer_cabinet.glb", "sofa.glb", "linen.jpg", "wool.jpg", "velvet.jpg", "leather.jpg", "earth.jpg"].map(Asset));
  }

  /** A color moved toward white by `amount` (0..1): the hover lift. "#RRGGBB" or "#AARRGGBB". */
  static Lighter(color: Color, amount: number): Color {
    const hex = color.slice(1), alpha = hex.length === 8 ? hex.slice(0, 2) : "";
    const rgb = hex.slice(alpha.length);
    const lift = (i: number) => {
      const c = parseInt(rgb.slice(i, i + 2), 16);
      return Math.round(c + (255 - c) * amount).toString(16).padStart(2, "0");
    };
    return `#${alpha}${lift(0)}${lift(2)}${lift(4)}`.toUpperCase();
  }

  /** A color moved toward black by `amount` (0..1). "#RRGGBB" or "#AARRGGBB". */
  static Darker(color: Color, amount: number): Color {
    const hex = color.slice(1), alpha = hex.length === 8 ? hex.slice(0, 2) : "";
    const rgb = hex.slice(alpha.length);
    const down = (i: number) => Math.round(parseInt(rgb.slice(i, i + 2), 16) * (1 - amount)).toString(16).padStart(2, "0");
    return `#${alpha}${down(0)}${down(2)}${down(4)}`.toUpperCase();
  }

  /** A color with an alpha (0..1): "#RRGGBB" or "#AARRGGBB" in, "#AARRGGBB" out. */
  static Alpha(color: Color, alpha: number): Color {
    const hex = color.slice(1), rgb = hex.length === 8 ? hex.slice(2) : hex;
    return `#${Math.round(alpha * 255).toString(16).padStart(2, "0")}${rgb}`.toUpperCase();
  }

  /** The edge light of cards (raised) and of the panels sunk into them. */
  static CardBevel(): SkiaBevel { return new SkiaBevel({ Depth: 1.5, LightColor: "#FFFFFF", ShadowColor: "#000000", Opacity: 0.22 }); }

  // Where the gallery links to (this is the React build; the Rust and .NET galleries are the same demo).
  static readonly ArticleUrl = "https://drawnui.net/articles/add3d.html";
  static readonly DocsUrl = "https://drawnui.net/";
  static readonly RepoUrl = "https://github.com/DrawnUi/DrawnUi.React";
  static readonly RustDemoUrl = "https://add3d.drawnui.net/";
  static readonly NetDemoUrl = "https://add3dnet.drawnui.net/";
  static readonly LinkColor = "#FFD06E";

  /**
   * A text link: the accent color, the ink color under the mouse, a link for the keyboard and screen readers; opens in a
   * new tab on the main button (a right click is for its menu, Copy Link).
   */
  static Link(text: string, url: string): SkiaLabel {
    return Make(new Copyable(text), {
      Url: url,
      FontSize: 14,
      FontFamily: Theme.Title,
      TextColor: Theme.LinkColor,
      AccessibilityRole: Aria.RoleLink,
      AccessibilityLabel: text,
      AccessibilityHint: url,
      HoverChanged: (me, on) => { (me as SkiaLabel).TextColor = on ? Theme.Ink : Theme.LinkColor; me.UpdateDraw(); },
      Tapped: (_, e) => { if ((e?.Parameters?.Event?.Pointer?.Button ?? "Left") === "Left") Super.OpenLink(url); },
    });
  }

  /** A section title with the line under it. */
  static Section(title: string, caption: string): SkiaControl {
    return Make(new SkiaStack(), {
      Spacing: 4,
      HorizontalOptions: "Center",
      Margin: new Thickness(0, 12, 0, 0),
      Children: [
        Make(new Copyable(title), { FontSize: 22, FontFamily: Theme.Title, TextColor: Theme.Ink, HorizontalOptions: "Center", AccessibilityRole: Aria.RoleHeading }),
        Make(new Copyable(caption), { FontSize: 14, TextColor: Theme.Muted, HorizontalOptions: "Center" }),
      ],
    });
  }
}

/**
 * The app's button, raised in 3D: a face lit from above (a light gradient and a bevel on its edges) standing on its
 * darker side, with a soft shadow under it. Pressed, the face sinks onto its side; under the mouse it gets lighter. A
 * button for the keyboard and screen readers. Fill is its state color (selected, active). (.NET Button3D)
 */
export class Button3D extends SkiaLayer {
  /** How far the face stands above the page, points: the side seen under it. */
  private static readonly Depth = 4;
  private static readonly FaceHeight = 40;
  private readonly face: SkiaShape;
  private readonly side: SkiaShadow;
  private readonly shade: SkiaLabel;
  private readonly edge: SkiaLabel;
  private readonly caption: SkiaLabel;
  private fill: Color;
  private hovered = false;
  private pressed = false;

  /** `width` in points; -1 = as wide as its caption plus padding (a chip). */
  constructor(text: string, fill: Color, width = 150) {
    super();
    this.fill = fill;
    this.WidthRequest = width;
    // a chip is as wide as its face
    if (width < 0) this.HorizontalOptions = "Start";
    this.HeightRequest = Button3D.FaceHeight + Button3D.Depth;
    // Still between its state changes: one bitmap blit inside cards that redraw every frame around a moving 3D view,
    // not its shapes and caption replayed each frame.
    this.UseCache = "Image";
    this.AccessibilityRole = Aria.RoleButton;
    this.AccessibilityLabel = text;
    const caption = (color: Color, offsetY: number) => Make(new SkiaLabel(), {
      Text: text, FontFamily: Theme.Title, FontSize: 14, TextColor: color, TranslationY: offsetY,
      HorizontalOptions: "Center", VerticalOptions: "Center",
      // the button is the accessible node, read once: its captions are not
      AccessibilityRole: Aria.RolePresentation,
    });
    this.side = new SkiaShadow({ Blur: 0, Y: Button3D.Depth, Opacity: 1 });
    this.Children = [
      this.face = Make(new SkiaShape(), {
        CornerRadius: 10,
        HeightRequest: Button3D.FaceHeight,
        HorizontalOptions: width < 0 ? "Start" : "Fill",
        VerticalOptions: "Start",
        Padding: width < 0 ? new Thickness(18, 0) : new Thickness(0),
        BevelType: "Bevel",
        Bevel: new SkiaBevel({ Depth: 1.2, LightColor: "#FFFFFF", ShadowColor: "#000000", Opacity: 0.5 }),
        // the side: the face's own outline, darker, right under it; then a soft shadow
        Shadows: [this.side, new SkiaShadow({ Blur: 8, Y: Button3D.Depth + 3, Opacity: 0.35, Color: "#000000" })],
        // the caption engraved in the face: its shadow 1 pt above, its light edge 1 pt below
        Children: [
          this.shade = caption("#8C000000", -1),
          this.edge = caption("#29FFFFFF", 1),
          this.caption = caption(Theme.Alpha(Theme.Ink, 0.92), 0),
        ],
      }),
    ];
    this.HoverChanged = (_, on) => { this.hovered = on; this.Apply(); };
    this.Apply();
  }

  /** The caption, also its name for screen readers. */
  get Text(): string { return this.caption.Text; }
  set Text(value: string) {
    this.caption.Text = this.shade.Text = this.edge.Text = value;
    this.AccessibilityLabel = value;
  }

  /** The state color; hover lightens it. */
  get Fill(): Color { return this.fill; }
  set Fill(value: Color) { this.fill = value; this.Apply(); }

  /** An outline around the face (a swatch's color). */
  get StrokeColor(): Color { return this.face.StrokeColor; }
  set StrokeColor(value: Color) { this.face.StrokeColor = value; this.face.UpdateDraw(); }
  get StrokeWidth(): number { return this.face.StrokeWidth; }
  set StrokeWidth(value: number) { this.face.StrokeWidth = value; this.face.Update(); }

  /** A light face (the gold accent) takes dark ink, a dark face light ink. */
  private get LightFace(): boolean {
    const hex = this.fill.slice(-6), r = parseInt(hex.slice(0, 2), 16) / 255, g = parseInt(hex.slice(2, 4), 16) / 255, b = parseInt(hex.slice(4, 6), 16) / 255;
    return 0.299 * r + 0.587 * g + 0.114 * b > 0.55;
  }

  override ProcessGestures(args: SkiaGesturesParameters, apply: GestureEventProcessingInfo): SkiaControl | null {
    // pressed, the face sits on its side
    if (args.Type === "Down") this.SetPressed(true);
    else if (args.Type === "Up") this.SetPressed(false);
    return super.ProcessGestures(args, apply);
  }

  private SetPressed(on: boolean): void {
    if (this.pressed === on) return;
    this.pressed = on;
    this.face.TranslationY = on ? Button3D.Depth : 0;
    this.side.Y = on ? 0 : Button3D.Depth;
    this.face.Update();
  }

  private Apply(): void {
    const face = this.hovered ? Theme.Lighter(this.fill, 0.14) : this.fill;
    this.face.BackgroundColor = face;
    this.face.FillGradient = { StartXRatio: 0, StartYRatio: 0, EndXRatio: 0, EndYRatio: 1, Colors: [Theme.Lighter(face, 0.2), face, Theme.Darker(face, 0.1)], ColorPositions: [0, 0.55, 1] };
    // the foot: the face's own color, darker
    this.side.Color = Theme.Darker(this.fill, 0.45);
    // engraved: a dark face takes its light edge below, a light face its shadow above
    const light = this.LightFace;
    this.shade.TextColor = Theme.Alpha("#000000", light ? 0.18 : 0.55);
    this.edge.TextColor = Theme.Alpha("#FFFFFF", light ? 0.45 : 0.16);
    this.caption.TextColor = light ? "#281C06" : Theme.Alpha(Theme.Ink, 0.92);
    this.face.Update();
  }
}

/**
 * The app's switch, in 3D like Button3D, the classic Android way: a thin track sunk into the card and a bigger raised
 * knob, lit from above, riding on it. On, the knob turns gold and the track takes a deep gold; under the mouse both light
 * up. A switch for the keyboard and screen readers. (.NET Switch3D)
 */
export class Switch3D extends SkiaLayer {
  private static readonly Knob = 28;
  private static readonly Width = 54;
  private readonly track: SkiaShape;
  private readonly thumb: SkiaShape;
  private toggled = false;
  private hovered = false;
  /** Raised when the user or the app turns it. */
  Toggled?: (sender: Switch3D, on: boolean) => void;

  constructor() {
    super();
    this.WidthRequest = Switch3D.Width;
    this.HeightRequest = Switch3D.Knob + 4;
    this.AccessibilityRole = Aria.RoleSwitch;
    this.Children = [
      this.track = Make(new SkiaShape(), {
        CornerRadius: 7, HeightRequest: 14,
        // the knob reaches past both ends of the track
        Margin: new Thickness(6, 0), HorizontalOptions: "Fill", VerticalOptions: "Center",
        BevelType: "Emboss", Bevel: new SkiaBevel({ Depth: 1.5, LightColor: "#FFFFFF", ShadowColor: "#000000", Opacity: 0.45 }),
      }),
      this.thumb = Make(new SkiaShape(), {
        Type: "Circle", WidthRequest: Switch3D.Knob, HeightRequest: Switch3D.Knob, HorizontalOptions: "Start", VerticalOptions: "Center",
        // its rim catches the light on top and falls into shade below
        StrokeWidth: 1.5, StrokeColor: "#FFFFFF",
        StrokeGradient: { StartXRatio: 0, StartYRatio: 0, EndXRatio: 0, EndYRatio: 1, Colors: ["#D9FFFFFF", "#26FFFFFF", "#59000000"], ColorPositions: [0, 0.5, 1] },
        Shadows: [new SkiaShadow({ Blur: 5, Y: 3, Opacity: 0.55, Color: "#000000" })],
      }),
    ];
    this.Tapped = () => { this.IsToggled = !this.toggled; };
    this.HoverChanged = (_, on) => { this.hovered = on; this.Colorize(); };
    this.Colorize();
  }

  get IsToggled(): boolean { return this.toggled; }
  set IsToggled(value: boolean) {
    if (this.toggled === value) return;
    this.toggled = value;
    this.AccessibilityIsPressed = value;
    this.Colorize();
    // the knob glides to its end
    void this.thumb.TranslateToAsync(value ? Switch3D.Width - Switch3D.Knob : 0, 0, 150);
    this.Toggled?.(this, value);
  }

  private Lift(c: Color): Color { return this.hovered ? Theme.Lighter(c, 0.14) : c; }

  /** The knob's and the track's colors for the state and the hover. */
  private Colorize(): void {
    const knob = this.Lift(this.toggled ? Theme.Accent : "#C8CAD6");
    this.thumb.BackgroundColor = knob;
    this.thumb.FillGradient = { StartXRatio: 0, StartYRatio: 0, EndXRatio: 0, EndYRatio: 1, Colors: [Theme.Lighter(knob, 0.35), knob, Theme.Darker(knob, 0.15)], ColorPositions: [0, 0.5, 1] };
    this.track.BackgroundColor = this.Lift(this.toggled ? Theme.Darker(Theme.Accent, 0.45) : Theme.Darker(Theme.Quiet, 0.35));
    this.thumb.UpdateDraw(); this.track.UpdateDraw();
  }
}

/**
 * The gallery's text that can be selected and copied (titles, descriptions): a mouse drag or a double click selects,
 * Ctrl+C copies; a right click on selected text (or a touch long press) opens a small menu, Copy or Cancel; on a link
 * also Copy Link. (.NET Copyable)
 */
export class Copyable extends SkiaLabel {
  private static menu?: PopupId;
  /** A link's address: its menu offers Copy Link. */
  Url?: string;

  constructor(text = "") {
    super();
    this.Text = text;
    this.AccessibilityTextSelectable = true;
    this.ContextMenu = (me, e) => {
      const page = me.Superview;
      // nothing selected and not a link: the right click is not for us
      const selected = !!page?.SelectedText;
      if (!page || (!selected && !this.Url)) return false;
      if (Copyable.menu) page.ClosePopupWindow(Copyable.menu);
      Copyable.menu = page.OpenPopupWindow(Copyable.Menu(this, selected), e.Location);
      return true;
    };
  }

  private static Menu(label: Copyable, selected: boolean): SkiaControl {
    const items: SkiaControl[] = [];
    // a drag may have selected several texts: Copy takes all of them, joined by new lines
    if (selected) items.push(Copyable.Item("Copy", () => label.Superview?.CopyTextSelection()));
    if (label.Url) items.push(Copyable.Item("Copy Link", () => { void navigator.clipboard?.writeText(label.Url!).catch(() => {}); }));
    items.push(Copyable.Item("Cancel", () => label.Superview?.ClearTextSelection()));
    return Make(new SkiaShape(), {
      CornerRadius: 10, BackgroundColor: Theme.Card, StrokeColor: Theme.Line, StrokeWidth: 1, WidthRequest: 150, Padding: new Thickness(4),
      Shadows: [new SkiaShadow({ Blur: 12, Y: 4, Opacity: 0.5, Color: "#000000" })],
      Children: [Make(new SkiaStack(), { Spacing: 0, AccessibilityRole: Aria.RoleMenu, AccessibilityLabel: "Text", Children: items })],
    });
  }

  private static Item(text: string, act: () => void): SkiaControl {
    return Make(new SkiaShape(), {
      CornerRadius: 7, HorizontalOptions: "Fill", Padding: new Thickness(12, 8),
      AccessibilityRole: Aria.RoleMenuItem, AccessibilityCanInteract: true, AccessibilityLabel: text,
      Children: [Make(new SkiaLabel(), { Text: text, FontSize: 14, TextColor: Theme.Ink, AccessibilityRole: Aria.RolePresentation })],
      HoverChanged: (me, on) => { me.BackgroundColor = on ? Theme.Quiet : "#00000000"; me.UpdateDraw(); },
      Tapped: (me) => { act(); if (Copyable.menu) me.Superview?.ClosePopupWindow(Copyable.menu); },
    });
  }
}
