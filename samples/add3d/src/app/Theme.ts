// Port of Add3dGallery.Shared Pages/Theme.cs: the app's palette, type, the models it ships, and its button (UiButton).
import { Aria, SkiaControl, SkiaLabel, SkiaShape, SkiaStack, Super, Thickness, type Color } from "drawnui-react/core";

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
  static readonly Accent = "#7C6CF2";
  static readonly Quiet = "#34384E";
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

  /** A section title with the line under it. */
  static Section(title: string, caption: string): SkiaControl {
    return Make(new SkiaStack(), {
      Spacing: 4,
      HorizontalOptions: "Center",
      Margin: new Thickness(0, 12, 0, 0),
      Children: [
        Make(new SkiaLabel(), { Text: title, FontSize: 22, FontFamily: Theme.Title, TextColor: Theme.Ink, HorizontalOptions: "Center", AccessibilityRole: Aria.RoleHeading }),
        Make(new SkiaLabel(), { Text: caption, FontSize: 14, TextColor: Theme.Muted, HorizontalOptions: "Center" }),
      ],
    });
  }
}

/**
 * The app's button: a rounded pill with a caption, lighter while the mouse is over it, a button for the keyboard and
 * screen readers. Fill is its state color (selected, active); the hover lift goes on top of it.
 */
export class UiButton extends SkiaShape {
  private readonly _caption: SkiaLabel;
  private _fill: Color;
  private _hovered = false;

  /** `width` in points; -1 = as wide as its caption plus padding (a chip). */
  constructor(text: string, fill: Color, width = 150) {
    super();
    this._fill = fill;
    // Still between its state changes: one bitmap blit inside cards that redraw every frame around a moving 3D
    // view, not its shape and caption replayed each frame.
    this.UseCache = "Image";
    this.CornerRadius = 10;
    this.WidthRequest = width;
    if (width < 0) this.Padding = new Thickness(18, 0);
    this.HeightRequest = 40;
    this.BackgroundColor = fill;
    this.AccessibilityRole = Aria.RoleButton;
    this.AccessibilityLabel = text;
    this.Children = [
      this._caption = Make(new SkiaLabel(), {
        Text: text, FontSize: 14, FontFamily: Theme.Title, TextColor: Theme.Ink, HorizontalOptions: "Center", VerticalOptions: "Center",
        // The button carries the name a screen reader says.
        AccessibilityRole: Aria.RolePresentation,
      }),
    ];
    this.HoverChanged = (_, on) => {
      this._hovered = on;
      this.Apply();
    };
  }

  /** The caption, also its name for screen readers. */
  get Text(): string { return this._caption.Text; }
  set Text(value: string) {
    this._caption.Text = value;
    this.AccessibilityLabel = value;
  }

  /** The state color; hover lightens it. */
  get Fill(): Color { return this._fill; }
  set Fill(value: Color) {
    this._fill = value;
    this.Apply();
  }

  private Apply(): void {
    this.BackgroundColor = this._hovered ? Theme.Lighter(this._fill, 0.14) : this._fill;
    this.UpdateDraw();
  }
}
