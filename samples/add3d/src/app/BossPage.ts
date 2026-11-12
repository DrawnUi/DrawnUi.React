// Port of Add3dGallery.Shared Pages/BossPage.cs.
import { Aria, SkiaGrid, SkiaLabel, SkiaLayer, SkiaShape, SkiaStack, SkiaWrap, Thickness, type Color } from "drawnui-react/core";
import { SkiaModel3D } from "drawnui-react-add3d/core";
import { Make, Theme, UiButton } from "./Theme";

const Idle = "CharacterArmature|Flying_Idle";
const Hit = "CharacterArmature|HitReact";

/** How a move plays. */
enum Kind {
  /** Loops until another move. */
  Loop,
  /** Plays once, then back to the loop. */
  Once,
  /** Plays once and stays on its last frame. */
  Hold,
}

/** The boss's moves: the caption, the glTF animation and how it plays, in the order of a fight. */
const Moves: [string, string, Kind][] = [
  ["Idle", Idle, Kind.Loop],
  ["Fly", "CharacterArmature|Fast_Flying", Kind.Loop],
  ["Punch", "CharacterArmature|Punch", Kind.Once],
  ["Headbutt", "CharacterArmature|Headbutt", Kind.Once],
  ["Yes", "CharacterArmature|Yes", Kind.Once],
  ["No", "CharacterArmature|No", Kind.Once],
  ["Death", "CharacterArmature|Death", Kind.Hold],
];

/** Skin colors for the dragon's main material; undefined = the file's own. */
const Skins: [string, Color | undefined][] = [
  ["Ember", undefined],
  ["Frost", "#4696E6"],
  ["Venom", "#5ABE50"],
  ["Shadow", "#463C5A"],
];

const Ember = "#BE461E";
const ButtonColor = "#2C2834";
const MovesAccent = "#FF7A45";
const ToggleColor = "#3C3648";
const RageColor = "#C81E28";
const Muted = "#BEB4C8";

/**
 * A 3D boss in a DrawnUI screen (port of DrawnUI for Rust's model3d): a glTF model with its skeleton animations,
 * drawn with the same GPU context as the UI around it. The app drives the scene: moves played once and back to idle,
 * a tap on the boss that hits it, its skin and eyes recolored by material name. Drag the dragon to turn it.
 */
export class BossPage extends SkiaLayer {
  private readonly _moveButtons: UiButton[] = [];
  private readonly _skinButtons: UiButton[] = [];
  private _boss!: SkiaModel3D;
  private _news!: SkiaLabel;
  private _rageButton!: UiButton;
  private _turnButton!: UiButton;
  private _looping = "Idle";
  private _skin = "Ember";
  private _rage = false;
  private _turning = false;

  constructor() {
    super();
    this.VerticalOptions = "Fill";
    this.Children = [
      // The arena: a warm light behind the boss.
      Make(new SkiaShape(), {
        HorizontalOptions: "Fill",
        VerticalOptions: "Fill",
        BackgroundColor: "#120E16",
        // A full-page gradient: drawn on the GPU once and kept there.
        UseCache: "GPU",
        FillGradient: { Type: "Circular", StartXRatio: 0.5, StartYRatio: 0.42, Colors: ["#5C261E", "#120E16"] },
      }),
      Make(new SkiaGrid(), {
        Padding: new Thickness(20),
        RowSpacing: 10,
        VerticalOptions: "Fill",
        RowDefinitions: "Auto,*,Auto,Auto",
        Children: [
          Make(new SkiaStack(), {
            Spacing: 8,
            UseCache: "Image",
            Row: 0,
            Children: [
              Make(new SkiaLabel(), { Text: "BOSS FIGHT", FontSize: 30, FontFamily: Theme.Title, TextColor: "#FFFFFF", HorizontalOptions: "Center", AccessibilityRole: Aria.RoleHeading }),
              Make(new SkiaLabel(), {
                Text: "A glTF model drawn in 3D inside DrawnUI, driven by the app. Drag it to turn it, tap it to hit it.",
                FontSize: 15, TextColor: Muted, HorizontalOptions: "Center", HorizontalTextAlignment: "Center",
              }),
            ],
          }),
          this._boss = Make(new SkiaModel3D(Theme.Dragon), {
            Animation: Idle, Yaw: 30, Pitch: 8, Zoom: 0.75,
            HorizontalOptions: "Fill", VerticalOptions: "Fill",
            Row: 1,
            Tapped3D: (me, hit) => {
              // A hit plays once and goes back to the loop; a dead dragon does not react.
              if (this._looping !== "Death") me.PlayOnce(Hit);
              this._news.Text = `Hit on ${hit.Material.replaceAll("_", " ")}`;
            },
            AnimationEnded: (_, name) => { this._news.Text = `${BossPage.CaptionOf(name)} finished`; },
          }),
          this._news = Make(new SkiaLabel(), {
            Text: "Tap the dragon to hit it.", FontSize: 15, TextColor: "#FFFFFF", HorizontalOptions: "Center",
            AccessibilityLive: Aria.LivePolite,
            Row: 2,
          }),
          Make(new SkiaStack(), {
            Spacing: 10,
            UseCache: "Image",
            Row: 3,
            Children: [
              BossPage.Caption("MOVES"),
              Make(new SkiaWrap(), {
                Spacing: 8,
                HorizontalOptions: "Center",
                AccessibilityRole: Aria.RoleToolbar,
                AccessibilityLabel: "Moves",
                Children: Moves.map(([caption, animation, kind], i) => this._moveButtons[i] = Make(new UiButton(caption, ButtonColor, 100), {
                  Tapped: () => this.Move(caption, animation, kind),
                })),
              }),
              BossPage.Caption("SKIN AND EYES (materials by name)"),
              Make(new SkiaWrap(), {
                Spacing: 8,
                HorizontalOptions: "Center",
                AccessibilityRole: Aria.RoleToolbar,
                AccessibilityLabel: "Skin and eyes",
                Children: [
                  ...Skins.map(([caption, color], i) => this._skinButtons[i] = Make(new UiButton(caption, ButtonColor, 100), {
                    StrokeColor: color ?? Ember, StrokeWidth: 2,
                    AccessibilityRole: Aria.RoleRadio,
                    Tapped: () => this.Skin(caption, color),
                  })),
                  this._rageButton = Make(new UiButton("Rage: off", ToggleColor, 124), { Tapped: () => this.ToggleRage() }),
                  this._turnButton = Make(new UiButton("Turn: off", ToggleColor, 124), { Tapped: () => this.ToggleTurn() }),
                ],
              }),
            ],
          }),
        ],
      }),
    ];
    this.UpdateButtons();
  }

  private static Caption(text: string): SkiaLabel {
    return Make(new SkiaLabel(), { Text: text, FontSize: 13, TextColor: Muted, HorizontalOptions: "Center", AccessibilityRole: Aria.RoleHeading });
  }

  private static CaptionOf(animation: string): string {
    for (const [caption, name] of Moves) if (name === animation) return caption;
    return animation === Hit ? "Hit" : "Move";
  }

  private Move(caption: string, animation: string, kind: Kind): void {
    switch (kind) {
      case Kind.Loop:
        this._boss.Play(animation);
        this._looping = caption;
        break;
      case Kind.Once:
        this._boss.PlayOnce(animation);
        break;
      case Kind.Hold:
        this._boss.Hold(animation);
        this._looping = caption;
        break;
    }
    this._news.Text = `${caption}…`;
    this.UpdateButtons();
  }

  private Skin(caption: string, color: Color | undefined): void {
    this._boss.SetMaterialColor("Dragon_Main", color);
    this._skin = caption;
    this.UpdateButtons();
  }

  private ToggleRage(): void {
    this._rage = !this._rage;
    this._boss.SetMaterialColor("Eye_White", this._rage ? "#FF281E" : undefined);
    this.UpdateButtons();
  }

  private ToggleTurn(): void {
    this._turning = !this._turning;
    this._boss.AutoRotate = this._turning ? 30 : 0;
    this.UpdateButtons();
  }

  private UpdateButtons(): void {
    Moves.forEach(([caption], i) => { this._moveButtons[i].Fill = this._looping === caption ? MovesAccent : ButtonColor; });
    Skins.forEach(([caption, color], i) => {
      const on = this._skin === caption;
      this._skinButtons[i].Fill = on ? color ?? Ember : ButtonColor;
      this._skinButtons[i].AccessibilityIsPressed = on;
    });
    this._rageButton.Text = this._rage ? "Rage: on" : "Rage: off";
    this._rageButton.Fill = this._rage ? RageColor : ToggleColor;
    this._rageButton.AccessibilityIsPressed = this._rage;
    this._turnButton.Text = this._turning ? "Turn: on" : "Turn: off";
    this._turnButton.AccessibilityIsPressed = this._turning;
  }
}
