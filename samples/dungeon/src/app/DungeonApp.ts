// Dungeon Run (port of examples/dungeon/src/lib.rs): a first-person runner. The dungeon is one SkMesh a frame,
// lit by its SkSL fragment program (Scene), under an SkSL post effect. Everything else is ordinary DrawnUI over it:
// a layer whose popups are the dialogs, plates for the buttons, shapes and labels for the HUD and the title,
// in the look of the HUD (dark fills, amber lines and glow). The panel of a dialog is a shader too.
// This file follows the C# port's split, one section per file there: the app's state and the tree
// (DungeonApp.cs), one frame (DungeonApp.Tick.cs), keys and the pointer (DungeonApp.Input.cs), help and pause
// (DungeonApp.Dialogs.cs), the dialogs' host (DungeonApp.Shell.cs).
//
// Most engine properties here are plain fields: a value set from code shows after the call that invalidates it,
// UpdateDraw() for a look, Update() for anything that changes size or visibility, RepaintComposition() for a
// transform or the opacity. Label texts, sizes and colors and shape shadows invalidate by themselves.

import {
  Aria, type Color, type InputKey, KeyboardManager, type SkiaControl, type SkiaGesturesParameters, type SkiaGradient,
  SkiaBackdrop, SkiaLabel, SkiaLabelFps, SkiaLayer, SkiaLayout, SkiaRow, SkiaScroll, SkiaShaderEffect, SkiaShadow,
  SkiaShape, SkiaStack, SkiaWrap, Super, TextSpan, Thickness,
} from "drawnui-react/core";
import { CURTAIN, DIALOG, GLOW, POST } from "../game/shaders";
import { Scene } from "../game/scene";
import { Hint, Input, Phase, World } from "../game/world";
import { DungeonGame } from "./DungeonGame";
import { Plate } from "./Plate";

/** What the big prompt says, in its own color: a lesson or a power-up's name. */
export enum PromptKind {
  Jump,
  Lane,
  Health,
  Surge,
  Shield,
  Absorbed,
  Cheer,
  /** The one-time lessons: after the first hit, after the first cell lost to the drain, after the first ghost gone by. */
  Heal,
  Drain,
  Avoid,
  /** Under four cells of health. */
  Low,
  /** The time of an escape, in tenths of a second. */
  Time,
}

/** A prompt and what it carries (a cheer's words, an escape's time). */
export interface Prompt { Kind: PromptKind; Cheer?: string; Tenths?: number }

/** Sets the properties of a control (or an effect) built in code, as a C# object initializer does. */
function Make<T extends object>(target: T, props: Partial<T>): T { return Object.assign(target, props); }

/** A uniform the effect reads from this array at every draw: change the array in place, then call this again. */
function SetUniform(effect: SkiaShaderEffect, name: string, values: number[]): void {
  effect.Uniforms.set(name, values);
  effect.UpdateUniforms();
}

/** Opacity changed from code: the React engine needs the redraw asked for (its properties are plain fields). */
function SetOpacity(control: SkiaControl, opacity: number): void {
  control.Opacity = opacity;
  control.RepaintComposition();
}

// ---- DungeonApp.cs: the app's state and the tree ----

/** The amber of every line, caption and frame of the interface. */
const ACCENT = 0xFFFF_B060;
/** What hurts. */
const HOT = 0xFFFF_3B6B;
/** A link, and the same under the mouse. */
const LINK = 0xFF8C_B8FF;
const LINK_HOVER = 0xFFD2_E4FF;
const GOOD = 0xFF6C_FF5A;

/** The title's gradient: gold to amber. */
const GOLD = [0xFFFF_F4D0, 0xFFFF_C050, 0xFFD0_6810];
const FIRE = [0xFFFF_E870, 0xFFFF_8A20, 0xFFE0_1810];

/** GAME OVER and the caption under it (55 points below) go up by this, to stand centered as one block. */
const GAME_OVER_LIFT = 20.0;
/** Canvas widths under this (points) have no room for the score, the health and the buttons in one row. */
const NARROW = 620.0;
/** A cell of the health that is out. */
const CELL_OFF = 0x8010_1420;

// ---- DungeonApp.Tick.cs ----

/** Said after every stretch of running without a hit. */
const CHEERS = ["WELL DONE!", "NICE RUN!", "YOU ARE KILLING IT!", "UNSTOPPABLE!", "ON FIRE!", "FLAWLESS!", "KEEP GOING!", "SMOOTH!"];
/** Seconds of clean running between two cheers. */
const CHEER_EVERY = 12.0;

// ---- DungeonApp.Input.cs ----

/** Points of sideways drag per lane. */
const PAN_STEP = 44.0;
/** A drag that went this far (points) was a drag, not a tap, whatever its release says: the engine's own tap threshold. */
const TAP_SLOP = 16.0;
/**
 * A held lane key steps again after this long, then at this pace (the system's own key repeat waits half a second:
 * too slow for a run).
 */
const HOLD_FIRST = 0.2;
const HOLD_NEXT = 0.13;

// ---- DungeonApp.Dialogs.cs ----

/** Points around a dialog's panel that its glow needs (the shader counts with the same numbers). */
const DIALOG_GLOW = 26;
const DIALOG_WIDTH = 452.0;

// ---- DungeonApp.Shell.cs ----

const POPUP_SPEED = 250; // SkiaShell.PopupsAnimationSpeed

export class DungeonApp {
  /** The arrows of the help come from this fallback font. */
  static SYMBOLS = "FontSymbols";

  /**
   * The framework the game runs on, as the title and the help name it ("DRAWNUI FOR REACT SAMPLE"): set by the head
   * at startup.
   */
  static Framework = "REACT";

  /** The DrawnUI docs page of the framework, opened by the help's link. */
  static get FrameworkDocs(): string { return "https://helloreact.drawnui.net"; }

  /**
   * The framework's name in the bottom right corner at all times, so every screenshot and video says what runs it.
   * Set to false to hide it (e.g. for clean captures).
   */
  static SHOW_WATERMARK = true;

  /** The watermark's text: the framework this head runs on. */
  static get WatermarkText(): string { return DungeonApp.Framework.toUpperCase(); }

  /** The source code of this sample, opened by the help's second link. */
  static readonly SourceCode = "https://github.com/DrawnUi/DrawnUi.React/tree/master/samples/dungeon";

  // ---- the tree ----
  private _scene!: Scene;
  private _post!: SkiaShaderEffect;
  private _title!: SkiaLayout;
  private _score!: SkiaLabel;
  private _hud!: SkiaLayout;
  /** Everything over the game that must stay clear of the system bars and cutouts. */
  private _safe!: SkiaLayout;
  /** The frame rate, top left, on the title only (the distance is there during a run). */
  private _fps!: SkiaLabelFps;
  /** Help and pause, top right. */
  private _buttons!: SkiaLayout;
  /** The prompt (JUMP, CHANGE LANE, a power-up's name): its glow layer, its label. */
  private _promptBox!: SkiaLayout;
  private _promptGlow!: SkiaShaderEffect;
  private _prompt!: SkiaLabel;
  /** The light dim and blur under a dialog. */
  private _veil!: SkiaBackdrop;
  /** The ten cells of the health, one per tenth. */
  private readonly _cells: SkiaShape[] = new Array(10);
  private _scoreBox!: SkiaLayout;
  /** The score's violet glow, on the score only while it jumps. */
  private _scoreGlow!: SkiaShaderEffect;
  /** The game's name on the title: smaller on a narrow screen. */
  private _name!: SkiaLabel;
  /** The best escape time of the session, on the title. */
  private _best!: SkiaLabel;
  /** The big label in the middle: the countdown, GAME OVER, YOU ESCAPED! */
  private _count!: SkiaLayout;
  private _countGlow!: SkiaShaderEffect;
  private _countLabel!: SkiaLabel;
  /** Over everything after GAME OVER: its frozen picture, burning away. */
  private _curtain!: SkiaLayout;
  private _curtainEffect!: SkiaShaderEffect;
  /** "TAP OR PRESS SPACE TO CONTINUE" under GAME OVER (the title's caption style). */
  private _restart!: SkiaLabel;
  /** The mark of a row of orbs (x2, x3) by the score. */
  private _streak!: SkiaLabel;
  private _game!: DungeonGame;

  // ---- the state (Rust `App`) ----
  private _promptPop = 0;
  private _promptTime = 0;
  private _shownDistance = 0;
  /** 1 when points were just won, fading: the score jumps. */
  private _pop = 0;
  private readonly _input = new Input();
  /** The lane key that is held (-1 left, 1 right) and the seconds to its next step. */
  private _held = 0;
  private _holdWait = 0;
  /** The press already steered: its release is not a tap. */
  private _swiped = false;
  /** Lanes the drag in progress has stepped (right positive). */
  private _panSteps = 0;
  /** A dialog is open: the world stands still. */
  private _paused = false;
  /** The open dialog is the help (closing it during a run brings the pause back). */
  private _helpOpen = false;
  /** What the labels show. */
  private _phase: Phase = Phase.Attract;
  private _shownScore = 0;
  /** Lit cells of the health bar, and the hits the run has taken, as last shown. */
  private _shownCells = 0;
  private _shownHits = 0;
  /** The canvas is too narrow for one row of HUD. */
  private _narrow = false;
  /** Points: how high and wide the canvas is. */
  private _canvasHeight = 0;
  private _canvasWidth = 0;
  private _hint: Hint = Hint.None;
  /** What the count shows (3, 2, 1, 0 = GO, -2 = GAME OVER, -3 = YOU ESCAPED!, -1 = nothing), its jump, the seconds GO stays. */
  private _shownCount = 0;
  private _countPop = 0;
  private _go = 0;
  private _curtainOn = false;
  /** A key or a tap left GAME OVER: one frame for the curtain to take its picture, then the title. */
  private _leaving = 0;
  /** GAME OVER has stood long enough to take a key or a tap (a press in panic does not skip it). */
  private _overReady = false;
  /** The last press was a finger: the texts speak of taps only. */
  private _touched = false;
  private _restartShown = false;
  private _shownBurn = 0;
  /** The health flash, the surge, the color of its rays, the orb pulse and the ghost's flash the post effect was last given. */
  private readonly _shownFx2 = new Float32Array(7);
  private readonly _shownShield = [0, 0];
  private _lastBurst = 0;
  /** The orbs' color the post effect was last given. */
  private readonly _shownOrb = new Float32Array(3);
  private _streakTime = 0;
  /** Seconds the prompt still shows a power-up's name. */
  private _notice = 0;
  /** How often the jump and the lane prompts were shown; three times teach it. */
  private readonly _taught = [0, 0];
  /** The ghost has the run: no prompt over it. */
  private _ghosted = false;
  /** A lesson waiting for the prompt to be free. */
  private _pending: Prompt | undefined;
  private _taughtHeal = false;
  private _taughtDrain = false;
  private _taughtGhost = false;
  /** LOW HEALTH was said; said again after the health came back over the line. */
  private _warnedLow = false;
  /** Seconds run without a hit, and how many times that was praised. */
  private _clean = 0;
  private _cheers = 0;

  // what the world writes each frame, kept for their allocation (C# stackalloc)
  private readonly _fx2 = new Float32Array(7);
  private readonly _orb = new Float32Array(3);

  // the uniforms handed to the effects, kept for their allocation
  private readonly _uFx = [0, 0, 0, 0];
  private readonly _uFx2 = [0, 0, 0, 0];
  private readonly _uRay = [1.0, 0.55, 0.22];
  private readonly _uOrb = [0, 0, 0];
  private readonly _uShield = [0, 0];
  private readonly _uBurn = [0];
  private readonly _uScoreGlow = [0];
  private readonly _uPromptGlow = [0];
  private readonly _uPromptTint = [0, 0, 0];
  private readonly _uCountTint = [0, 0, 0];

  /** A color (0xAARRGGBB). */
  static C(argb: number): Color { return "#" + (argb >>> 0).toString(16).toUpperCase().padStart(8, "0"); }

  /** A color (0xAARRGGBB) as the red, green and blue a shader's tint takes. */
  static Tint(color: number): number[] { return [(color >>> 16 & 0xFF) / 255.0, (color >>> 8 & 0xFF) / 255.0, (color & 0xFF) / 255.0]; }

  /**
   * The gradient of the heavy letters (the countdown, GAME OVER, the title, the prompts): light at the top, deep
   * at the bottom.
   */
  static Fire(colors: number[]): SkiaGradient {
    return {
      Type: "Linear",
      StartXRatio: 0,
      StartYRatio: 0,
      EndXRatio: 0,
      EndYRatio: 1,
      Colors: [C(colors[0]), C(colors[1]), C(colors[2])],
    };
  }

  static Glow(glow: number, tint: number[]): SkiaShaderEffect {
    return Make(new SkiaShaderEffect(), { ShaderCode: GLOW, OnCompilationError: (_, error) => console.log(`dungeon: glow SkSL: ${error}`) })
      .SetUniform("uGlow", glow)
      .SetUniform("uWash", 0.0)
      .SetUniform("uTint", ...tint);
  }

  static Line(text: string, size: number, color: number): SkiaLabel {
    return Make(new SkiaLabel(), {
      Text: text,
      FontSize: size,
      TextColor: C(color),
      FontFamilyFallback: DungeonApp.SYMBOLS,
    });
  }

  static Centered(text: string, size: number, color: number): SkiaLabel {
    return Make(Line(text, size, color), {
      HorizontalOptions: "Center",
      HorizontalTextAlignment: "Center",
    });
  }

  /** What every button is made of: a dark plate whose thin line is white at rest and amber, with a glow, under the pointer or a press. */
  static MakePlate(name: string): Plate {
    return Make(new Plate(C(0x66FF_FFFF), C(ACCENT)), {
      CornerRadius: 2,
      BackgroundColor: C(0xE608_0B14),
      StrokeWidth: 1.55,
      AnimationTapped: "Ripple",
      // A Tab stop a screen reader calls a button; Enter and Space press it.
      AccessibilityRole: Aria.RoleButton,
      AccessibilityLabel: name,
    });
  }

  /** A button's caption: the button itself carries the name a screen reader says. */
  static Caption(text: string, size: number): SkiaLabel {
    return Make(Line(text, size, 0xE6FF_FFFF), { AccessibilityRole: Aria.RolePresentation });
  }

  /** The main action: the plate with a lit LED at its left edge. */
  static Button(text: string): Plate {
    return Make(MakePlate(text), {
      HeightRequest: 40,
      Children: [
        Make(new SkiaShape(), {
          WidthRequest: 3,
          HeightRequest: 18,
          Margin: new Thickness(10, 0, 0, 0),
          VerticalOptions: "Center",
          BackgroundColor: C(0xFFFF_E6C0),
          Shadows: [new SkiaShadow({ Color: C(ACCENT), X: 0, Y: 0, Blur: 7, Opacity: 1 })],
        }),
        Make(Caption(text, 14), { HorizontalOptions: "Center", VerticalOptions: "Center", Margin: new Thickness(26, 0, 20, 0) }),
      ],
    });
  }

  /** Any other action. */
  static GhostButton(text: string): Plate {
    return Make(MakePlate(text), {
      HeightRequest: 40,
      Children: [Make(Caption(text, 14), { HorizontalOptions: "Center", VerticalOptions: "Center", Margin: new Thickness(20, 0, 20, 0) })],
    });
  }

  /** A square button of the HUD. */
  static Key(text: string, name: string): Plate {
    return Make(MakePlate(name), {
      WidthRequest: 40,
      HeightRequest: 40,
      Children: [Make(Caption(text, 15), { HorizontalOptions: "Center", VerticalOptions: "Center" })],
    });
  }

  /**
   * The part of the screen the system bars and cutouts leave free, in points, as DrawnUI measures it (0 on the
   * desktop): the 3D view and the post effect fill the whole screen, the HUD, the texts and the dialogs stay inside.
   */
  static get SafeInsets(): Thickness { const i = Super.Insets; return new Thickness(i.Left, i.Top, i.Right, i.Bottom); }

  private ApplySafeInsets(): void {
    this._safe.Margin = DungeonApp.SafeInsets;
    this._safe.Update();
    this._canvasWidth = -1; // the sizes that follow the free width are set again at the next frame
  }

  /** The whole tree: the dialogs' host, its root layer and everything over the game. */
  Build(): SkiaControl {
    Super.OnInsetsChanged(() => this.ApplySafeInsets());
    this._post = Make(new SkiaShaderEffect(), { ShaderCode: POST, OnCompilationError: (_, error) => console.log(`dungeon: post SkSL: ${error}`) });
    SetUniform(this._post, "uFx2", this._uFx2);
    SetUniform(this._post, "uRay", this._uRay);
    SetUniform(this._post, "uOrb", this._uOrb);
    SetUniform(this._post, "uShield", this._uShield);
    this._scoreGlow = Make(new SkiaShaderEffect(), { ShaderCode: GLOW, OnCompilationError: (_, error) => console.log(`dungeon: glow SkSL: ${error}`) })
      .SetUniform("uGlow", 1.0)
      .SetUniform("uWash", 0.7)
      .SetUniform("uTint", 0.62, 0.22, 1.0);
    this._countGlow = Glow(1.0, [1.0, 0.16, 0.04]);
    this._promptGlow = Glow(1.0, [0.62, 0.22, 1.0]);
    this._curtainEffect = Make(new SkiaShaderEffect(), { ShaderCode: CURTAIN, UseBackground: "Once", OnCompilationError: (_, error) => console.log(`dungeon: curtain SkSL: ${error}`) });
    SetUniform(this._curtainEffect, "uBurn", this._uBurn);

    // the dialogs open over it: the popups of the host layer (DungeonApp.Shell.cs)
    return this.Shell(Make(new SkiaLayer(), {
      VerticalOptions: "Fill",
      Children: [
        // The game takes every press that lands on it, so what is tapped lies over it, not in it.
        this._game = Make(new DungeonGame(this), {
          Children: [
            // Draws every frame: no cache. The post effect reads what it drew.
            this._scene = Make(new Scene(), {
              HorizontalOptions: "Fill",
              VerticalOptions: "Fill",
              VisualEffects: [this._post],
            }),
          ],
        }),

        // The HUD, the title and the texts stay out of the system bars and cutouts (ApplySafeInsets).
        this._safe = Make(new SkiaLayer(), {
          VerticalOptions: "Fill",
          Margin: DungeonApp.SafeInsets,
          Children: [
            // The health, top center: ten slanted cells, one per tenth. One cached image, drawn again only
            // when the health changes.
            this._hud = Make(new SkiaStack(), {
              Spacing: 7,
              WidthRequest: 266,
              HorizontalOptions: "Center",
              Margin: new Thickness(0, 16, 0, 0),
              Opacity: 0,
              InputTransparent: true,
              UseCache: "GPU",
              // Read as one value, said again when it changes.
              AccessibilityRole: Aria.RoleStatus,
              AccessibilityLabel: "Health 100 percent",
              AccessibilityLive: "polite",
              Children: [
                Make(new SkiaRow(), {
                  Spacing: 5,
                  Children: Array.from({ length: 10 }, (_, i) => this._cells[i] = Make(new SkiaShape(), {
                    WidthRequest: 22,
                    HeightRequest: 14,
                    CornerRadius: 1,
                    SkewX: -18,
                    BackgroundColor: C(GOOD),
                    StrokeColor: C(0x66FF_FFFF),
                    StrokeWidth: 1,
                    Shadows: [new SkiaShadow({ Color: C(GOOD), X: 0, Y: 0, Blur: 7, Opacity: 0.9 })],
                  })),
                }),
              ],
            }),

            this._fps = Make(new SkiaLabelFps(), {
              FontSize: 12,
              Padding: new Thickness(8, 4, 8, 4),
              Margin: new Thickness(16, 16, 0, 0),
              HorizontalOptions: "Start",
              VerticalOptions: "Start",
            }),

            // The distance, top left, in steps of ten meters: quiet (soft white, no glow) so it does not pull
            // the eye from the run; an orb makes it jump in a violet flash (FlashScore).
            this._scoreBox = Make(new SkiaLayer(), {
              WidthRequest: 260,
              HeightRequest: 60,
              HorizontalOptions: "Start",
              Margin: new Thickness(8, 4, 0, 0),
              Opacity: 0,
              InputTransparent: true,
              UseCache: "GPU",
              Children: [
                this._score = Make(new SkiaLabel(), {
                  Text: "0 M",
                  FontFamily: "FontScore",
                  FontSize: 30,
                  TextColor: C(0xCCFF_FFFF),
                  StrokeColor: C(0x9900_0000),
                  StrokeWidth: 1,
                  AnchorX: 0,
                  AnchorY: 0,
                  Margin: new Thickness(14, 8, 0, 0),
                }),
              ],
            }),

            this._streak = Make(new SkiaLabel(), {
              Text: "x2",
              FontFamily: "FontScore",
              FontSize: 16,
              TextColor: C(0xFFC9_8BFF),
              Margin: new Thickness(23, 52, 0, 0),
              Opacity: 0,
              InputTransparent: true,
            }),

            this._buttons = Make(new SkiaRow(), {
              Spacing: 8,
              HorizontalOptions: "End",
              Margin: new Thickness(0, 14, 16, 0),
              Children: [
                Make(Key("?", "Help"), { Tapped: () => this.ToggleDialog(() => this.HelpDialog()) }),
                Make(Key("II", "Pause"), { Tapped: () => this.Menu() }),
              ],
            }),

            // The prompt, above the middle: heavy letters in the color of what it asks, in a glow of the same
            // color (ShowPrompt); its own cached image under the glow shader, like the countdown.
            this._promptBox = Make(new SkiaLayer(), {
              WidthRequest: 760,
              HeightRequest: 110,
              HorizontalOptions: "Center",
              Margin: new Thickness(0, 96, 0, 0),
              IsVisible: false,
              InputTransparent: true,
              UseCache: "GPU",
              VisualEffects: [this._promptGlow],
              Children: [
                this._prompt = Make(new SkiaLabel(), {
                  Text: "",
                  FontFamily: "FontScore",
                  FontSize: 44,
                  TextColor: "#FFFFFF",
                  StrokeColor: C(0xFF14_0820),
                  StrokeWidth: 2.5,
                  HorizontalTextAlignment: "Center",
                  AccessibilityLive: "assertive",
                  HorizontalOptions: "Center",
                  VerticalOptions: "Center",
                }),
              ],
            }),

            // The countdown and GAME OVER, in the middle: heavy letters, yellow to red, in a red glow.
            this._count = Make(new SkiaLayer(), {
              WidthRequest: 760,
              HeightRequest: 220,
              HorizontalOptions: "Center",
              VerticalOptions: "Center",
              IsVisible: false,
              InputTransparent: true,
              UseCache: "GPU",
              VisualEffects: [this._countGlow],
              Children: [
                this._countLabel = Make(new SkiaLabel(), {
                  Text: "3",
                  FontFamily: "FontScore",
                  FontSize: 120,
                  TextColor: "#FFFFFF",
                  FillGradient: Fire(FIRE),
                  StrokeColor: C(0xFF30_0404),
                  StrokeWidth: 3,
                  HorizontalTextAlignment: "Center",
                  AccessibilityLive: "assertive",
                  HorizontalOptions: "Center",
                  VerticalOptions: "Center",
                }),
              ],
            }),

            // Still over a scene that draws every frame: one cached image to blit.
            this._title = Make(new SkiaStack(), {
              Spacing: 14,
              HorizontalOptions: "Center",
              VerticalOptions: "Center",
              InputTransparent: true,
              UseCache: "GPU",
              Children: [
                // The name, white in a glow of the interface's accent color: its own cached image under
                // the glow shader.
                Make(new SkiaLayer(), {
                  HeightRequest: 120,
                  Margin: new Thickness(0, -32, 0, -34),
                  UseCache: "GPU",
                  VisualEffects: [Glow(0.5, Tint(ACCENT))],
                  Children: [
                    // The same heavy letters as GAME OVER, gold to amber instead of fire.
                    this._name = Make(new SkiaLabel(), {
                      Text: "DUNGEON RUN",
                      FontFamily: "FontScore",
                      FontSize: 44,
                      TextColor: "#FFFFFF",
                      FillGradient: Fire(GOLD),
                      StrokeColor: C(0xFF2A_1404),
                      StrokeWidth: 2.5,
                      HorizontalOptions: "Center",
                      VerticalOptions: "Center",
                      HorizontalTextAlignment: "Center",
                    }),
                  ],
                }),
                Centered(`DRAWNUI FOR ${DungeonApp.Framework.toUpperCase()} SAMPLE`, 14, ACCENT),
                this._best = Make(Centered("", 11, ACCENT), { IsVisible: false }),
                Centered("TAP OR PRESS SPACE TO PLAY", 11, 0x99FF_FFFF),
              ],
            }),

            this._restart = Make(Centered("", 11, 0x99FF_FFFF), {
              VerticalOptions: "Center",
              Margin: new Thickness(0, 110, 0, 0),
              TranslationY: -GAME_OVER_LIFT,
              Opacity: 0,
              InputTransparent: true,
            }),

            // The framework's name, bottom right, over the post effect: faint, never read aloud.
            Make(new SkiaLabel(), {
              Text: DungeonApp.WatermarkText,
              FontSize: 22,
              FontFamily: "FontScore",
              TextColor: C(0x33FF_FFFF),
              HorizontalOptions: "End",
              VerticalOptions: "End",
              Margin: new Thickness(0, 0, 16, 12),
              InputTransparent: true,
              IsVisible: DungeonApp.SHOW_WATERMARK,
              UseCache: "Image",
              AccessibilityRole: Aria.RolePresentation,
            }),
          ],
        }),

        this._curtain = Make(new SkiaLayer(), {
          VerticalOptions: "Fill",
          IsVisible: false,
          InputTransparent: true,
          VisualEffects: [this._curtainEffect],
        }),

        this._veil = Make(new SkiaBackdrop(), {
          Blur: 1.5,
          BackgroundColor: C(0x7300_0000),
          HorizontalOptions: "Fill",
          VerticalOptions: "Fill",
          InputTransparent: true,
          IsVisible: false,
        }),
      ],
    }));
  }

  // ---- DungeonApp.Tick.cs: one frame (port of `tick`, `show_prompt` and `flash_score` in lib.rs): the world
  // moves, the scene draws again, the HUD follows. Labels and effects are touched only when what they show changes.

  /** The score jumps in a violet glow for a moment: the glow shader is on it only that long. */
  private FlashScore(): void {
    this._pop = 1.0;
    if (!this._scoreBox.VisualEffects.includes(this._scoreGlow)) {
      this._uScoreGlow[0] = 1.0;
      SetUniform(this._scoreGlow, "uGlow", this._uScoreGlow);
      this._scoreBox.VisualEffects = [...this._scoreBox.VisualEffects, this._scoreGlow];
    }
  }

  /** One frame: the world moves, the scene draws again, the HUD follows. */
  Tick(delta: number): void {
    // On a narrow screen (a phone held upright) the health does not fit between the score and the buttons:
    // it goes under them.
    // the size the system bars and cutouts leave free (the whole canvas on the web and the desktop)
    const game = this._game, scale = game.RenderingScale;
    const canvasWidth = game.DrawingRect.Width / scale - this._safe.Margin.HorizontalThickness;
    const canvasHeight = game.DrawingRect.Height / scale - this._safe.Margin.VerticalThickness;
    this._canvasHeight = canvasHeight;
    if (canvasWidth !== this._canvasWidth) {
      this._canvasWidth = canvasWidth;
      // The big texts fit the width they have.
      this._name.FontSize = canvasWidth < 440.0 ? 32.0 : 44.0;
      this._count.WidthRequest = Math.min(canvasWidth, 760.0);
      this._count.Update();
      this._promptBox.WidthRequest = Math.min(canvasWidth, 760.0);
      this._promptBox.Update();
      this._prompt.FontSize = canvasWidth < 520.0 ? 28.0 : 44.0;
    }
    const narrow = canvasWidth < NARROW;
    if (narrow !== this._narrow) {
      this._narrow = narrow;
      this._hud.Margin = new Thickness(0, narrow ? 62 : 16, 0, 0);
      this._hud.Update();
    }
    if (this._paused) return;
    if (this._held !== 0) {
      this._holdWait -= delta;
      if (this._holdWait <= 0.0) {
        this._holdWait = HOLD_NEXT;
        this._input.Left = this._held < 0;
        this._input.Right = this._held > 0;
      }
    }
    const world = this._scene.World;
    // A frame that came late (a hidden tab) is not a jump through the walls.
    world.Step(Math.min(delta, 0.05), this._input);
    // Leaving GAME OVER: this frame the curtain shows and takes its picture of it (the scene stays live under
    // GAME OVER until then), the next one goes to the title under the burning curtain.
    let closing = false;
    if (this._leaving > 0) {
      this._leaving -= 1;
      if (this._leaving > 0) closing = true;
      else world.ToTitle();
    }
    this._overReady = world.OverFor > 0.6;
    const phase = world.Phase;
    const orbs = world.Orbs, hits = world.Hits, ghostsPassed = world.GhostsPassed;
    const health = world.Health, runTime = world.RunTime, worldGhost = world.Ghost, burn = world.Burn;
    const hint = world.GetHint();
    const young = world.Young, escaped = world.Escaped;
    const bestTime = world.BestTime;
    const worldKiller = world.Killer;
    const meters = Math.floor(world.Distance / 10) * 10;
    const count = world.Count;
    const pickup = world.TakePickup();
    this._uFx[0] = world.Rush;
    this._uFx[1] = world.Warp;
    this._uFx[2] = world.Flash;
    this._uFx[3] = world.Time;
    const fx2 = this._fx2;
    world.Light(fx2, 2);
    // The ghost's blackout, plus 2 while its touch is felt (the post effect's haunt).
    const haunt = world.Ghost > 0.0 || world.Killer != null ? 2.0 : 0.0;
    fx2[0] = world.Heal; fx2[1] = world.SurgeGlow; fx2[5] = world.OrbPulse; fx2[6] = world.Ghost + haunt;
    const orb = this._orb;
    world.OrbFlash(orb);
    // The aura fades over the shield's last two seconds.
    const shield0 = Math.min(world.Shield / 2.0, 1.0), shield1 = world.ShieldBurst;
    const streak = world.Streak;

    SetUniform(this._post, "uFx", this._uFx);
    if (!SameValues(fx2, this._shownFx2)) {
      this._shownFx2.set(fx2);
      this._uFx2[0] = fx2[0]; this._uFx2[1] = fx2[1]; this._uFx2[2] = fx2[5]; this._uFx2[3] = fx2[6];
      SetUniform(this._post, "uFx2", this._uFx2);
      this._uRay[0] = fx2[2]; this._uRay[1] = fx2[3]; this._uRay[2] = fx2[4];
      SetUniform(this._post, "uRay", this._uRay);
    }
    if (shield0 !== this._shownShield[0] || shield1 !== this._shownShield[1]) {
      this._shownShield[0] = shield0; this._shownShield[1] = shield1;
      this._uShield[0] = shield0; this._uShield[1] = shield1;
      SetUniform(this._post, "uShield", this._uShield);
    }
    if (!SameValues(orb, this._shownOrb)) {
      this._shownOrb.set(orb);
      this._uOrb[0] = orb[0]; this._uOrb[1] = orb[1]; this._uOrb[2] = orb[2];
      SetUniform(this._post, "uOrb", this._uOrb);
    }
    // the scene draws again (it has no cache: a redraw, no measure)
    this._scene.InvalidateCache();
    this._scene.RepaintComposition();
    // The shield took a hit: ABSORBED!
    if (shield1 > this._lastBurst && phase === Phase.Playing) {
      this._notice = 1.3; this._hint = Hint.None;
      this.ShowPrompt({ Kind: PromptKind.Absorbed });
    }
    this._lastBurst = shield1;

    if (phase !== this._phase) {
      if (this._phase === Phase.Countdown && phase === Phase.Playing) this._go = 0.7;
      if (phase === Phase.Countdown) {
        // A new run: the readouts start over.
        this._shownScore = 0; this._shownDistance = 0;
        this._clean = 0.0;
        this._score.Text = "0 M";
      }
      this._phase = phase;
      const onTitle = phase === Phase.Attract;
      this._title.IsVisible = onTitle;
      this._title.Update();
      if (onTitle) {
        this._notice = 0.0; this._hint = Hint.None; this._pending = undefined;
        this.ShowPrompt(undefined);
        this._best.IsVisible = bestTime != null;
        this._best.Update();
        if (bestTime != null) this._best.Text = `BEST ESCAPE ${FormatTime(Math.trunc(bestTime * 10.0))}`;
      }
      // Rust hides it with opacity 0; here a control at opacity 0 still draws, and the frame rate label lays out
      // its changing text every frame: off the screen during a run it is not drawn at all.
      this._fps.IsVisible = onTitle;
      this._fps.Update();
      const opacity = onTitle ? 0.0 : 1.0;
      SetOpacity(this._hud, opacity);
      this._scoreBox.Opacity = opacity;
      this._scoreBox.RepaintComposition();
    }
    // The curtain: shown the frame GAME OVER is left, it keeps that picture (its shader takes its texture once),
    // then burns it away over the title's run.
    const curtainOn = closing || burn > 0.0;
    const hole = closing ? 0.0 : 1.0 - burn;
    if (curtainOn !== this._curtainOn) {
      this._curtainOn = curtainOn;
      this._curtain.IsVisible = curtainOn;
      this._curtain.Update();
      if (!curtainOn) this._curtainEffect.ReleaseFrozenSnapshot();
    }
    if (curtainOn && hole !== this._shownBurn) {
      this._shownBurn = hole;
      this._uBurn[0] = hole;
      SetUniform(this._curtainEffect, "uBurn", this._uBurn);
    }
    // The countdown: each number jumps in and settles; GO stays a moment into the run.
    this._go = Math.max(this._go - delta, 0.0);
    const show = count != null ? count
      : phase === Phase.Over ? (escaped ? -3 : -2)
      : this._go > 0.0 ? 0
      : -1;
    if (show !== this._shownCount) {
      this._shownCount = show;
      this._countPop = 1.0;
      if (show !== -1) {
        this._countLabel.FontSize = show >= 0 ? 120.0 : this._canvasWidth < 520.0 ? 38.0 : 64.0;
        this._countLabel.Text = show === 0 ? "GO" : show === -2 ? "GAME OVER" : show === -3 ? "YOU ESCAPED!" : String(show);
        // Fire, or the title's gold for the way out.
        this._countLabel.FillGradient = Fire(show === -3 ? GOLD : FIRE);
        this._countLabel.UpdateDraw();
      }
      this._count.IsVisible = show !== -1;
      this._count.Opacity = 1.0;
      // GAME OVER and the caption under it are centered as one block.
      this._count.TranslationY = show === -2 ? -GAME_OVER_LIFT : 0.0;
      this._count.Update();
      const tint = show === -3 ? Tint(ACCENT) : [1.0, 0.16, 0.04];
      this._uCountTint[0] = tint[0]; this._uCountTint[1] = tint[1]; this._uCountTint[2] = tint[2];
      SetUniform(this._countGlow, "uTint", this._uCountTint);
      if (show === -3) {
        // The time stays with the view from outside, until the player leaves it.
        this._notice = Number.MAX_VALUE; this._hint = Hint.None; this._pending = undefined;
        this.ShowPrompt({ Kind: PromptKind.Time, Tenths: Math.trunc(runTime * 10.0) });
      }
    }
    if (this._countPop > 0.0) {
      this._countPop = Math.max(this._countPop - delta * 2.4, 0.0);
      const s = 1.0 + 0.7 * this._countPop * this._countPop;
      this._count.ScaleX = s;
      this._count.ScaleY = s;
      this._count.RepaintComposition();
    }
    // A hit (not the drain) ends the clean stretch and, the first time, teaches the orbs.
    if (hits !== this._shownHits) {
      this._shownHits = hits;
      if (hits > 0) {
        this._clean = 0.0;
        if (!this._taughtHeal && phase === Phase.Playing) { this._taughtHeal = true; this._pending = { Kind: PromptKind.Heal }; }
      }
    }
    // The bar changes by whole cells (the drain moves the health every frame). The second cell lost in a session
    // explains the drain.
    const lit = Math.max(Math.round(health * 10.0), 0);
    if (lit !== this._shownCells) {
      if (lit < this._shownCells && lit <= 8 && !this._taughtDrain && phase === Phase.Playing) { this._taughtDrain = true; this._pending = { Kind: PromptKind.Drain }; }
      this._shownCells = lit;
      // Under four cells: LOW HEALTH, once per fall under the line.
      const low = lit < 4;
      if (low && !this._warnedLow && phase === Phase.Playing && health > 0.0) this._pending = { Kind: PromptKind.Low };
      this._warnedLow = low;
      // Green, amber, red; a cell per tenth, lit from the left.
      const color = C(health > 0.6 ? GOOD : health > 0.3 ? 0xFFFF_B030 : 0xFFFF_3B30);
      this._hud.AccessibilityLabel = `Health ${lit * 10} percent`;
      for (let i = 0; i < this._cells.length; i++) {
        const on = i < lit;
        this._cells[i].BackgroundColor = on ? color : C(CELL_OFF);
        // the Shadows setter redraws the cell
        this._cells[i].Shadows = on ? [new SkiaShadow({ Color: color, X: 0, Y: 0, Blur: 7, Opacity: 0.9 })] : [];
      }
    }
    // An orb taken: the distance jumps in a violet flash.
    if (phase === Phase.Playing && orbs !== this._shownScore) {
      const won = orbs > this._shownScore;
      this._shownScore = orbs;
      if (won) {
        this.FlashScore();
        // The second and third orb of a row say so.
        if (streak >= 2) {
          this._streakTime = 0.9;
          this._streak.Text = `x${streak}`;
          SetOpacity(this._streak, 1.0);
        }
      }
    }
    if (pickup != null && phase === Phase.Playing) this.FlashScore();
    if (phase === Phase.Playing && meters !== this._shownDistance) {
      this._shownDistance = meters;
      this._score.Text = `${meters} M`;
      this._score.AccessibilityLabel = `Distance ${meters} meters`;
    }
    if (this._streakTime > 0.0) {
      this._streakTime = Math.max(this._streakTime - delta, 0.0);
      SetOpacity(this._streak, Math.min(this._streakTime / 0.3, 1.0));
    }
    if (this._pop > 0.0) {
      this._pop = Math.max(this._pop - delta * 3.0, 0.0);
      const s = 1.0 + 0.35 * this._pop * this._pop;
      this._score.ScaleX = s;
      this._score.ScaleY = s;
      this._score.RepaintComposition();
      // The flash is over: no shader left over the score.
      if (this._pop <= 0.0) {
        this._scoreBox.VisualEffects = [];
      } else {
        this._uScoreGlow[0] = this._pop;
        SetUniform(this._scoreGlow, "uGlow", this._uScoreGlow);
      }
    }
    if (phase === Phase.Playing) this._clean += delta;
    // The first ghost gone by teaches (after a touch, once the blackout is over).
    if (ghostsPassed > 0 && !this._taughtGhost && phase === Phase.Playing) { this._taughtGhost = true; this._pending = { Kind: PromptKind.Avoid }; }
    // The ghost's kill takes the prompt away; a power-up says its name for a moment; the lessons wait.
    if ((worldKiller != null) !== this._ghosted) {
      this._ghosted = worldKiller != null;
      if (this._ghosted) {
        this._notice = 0.0; this._hint = Hint.None; this._pending = undefined;
        this.ShowPrompt(undefined);
      }
    }
    const pending = this._pending;
    if (pending && phase === Phase.Playing && this._notice <= 0.0 && hint === Hint.None && worldGhost < 0.5) {
      this._pending = undefined; this._notice = 1.8; this._hint = Hint.None;
      this.ShowPrompt(pending);
    } else if (pickup != null && phase === Phase.Playing) {
      this._notice = 1.3; this._hint = Hint.None;
      this.ShowPrompt({ Kind: pickup === World.HEALTH ? PromptKind.Health : pickup === World.SHIELD ? PromptKind.Shield : PromptKind.Surge });
    } else if (this._notice > 0.0) {
      this._notice -= delta;
      if (this._notice <= 0.0) this.ShowPrompt(undefined);
    } else if (phase === Phase.Playing && this._clean >= CHEER_EVERY && hint === Hint.None) {
      // A stretch without a hit: a word of praise, in the prompt's slot while no lesson needs it.
      this._clean = 0.0;
      this._cheers += 1;
      this._notice = 1.3;
      this.ShowPrompt({ Kind: PromptKind.Cheer, Cheer: CHEERS[((this._cheers * 7 + meters) >>> 0) % CHEERS.length] });
    } else if (hint !== this._hint) {
      this._hint = hint;
      const lesson = hint === Hint.Jump ? 0 : hint === Hint.Lane ? 1 : -1;
      // Every hazard of a young run is announced; later the first three of each kind teach it.
      let showHint = false;
      if (lesson >= 0) {
        if (this._taught[lesson] < 4) this._taught[lesson] += 1;
        showHint = young || this._taught[lesson] <= 3;
      }
      this.ShowPrompt(showHint ? { Kind: hint === Hint.Jump ? PromptKind.Jump : PromptKind.Lane } : undefined);
    }
    // Under GAME OVER, once it takes a key: how to go on (any key works, Space is the one named).
    const restart = phase === Phase.Over && !escaped && this._overReady && this._leaving === 0;
    if (restart !== this._restartShown) {
      this._restartShown = restart;
      this._restart.Text = this._touched ? "TAP TO CONTINUE" : "TAP OR PRESS SPACE TO CONTINUE";
      SetOpacity(this._restart, restart ? 1.0 : 0.0);
    }
    // The prompt jumps in like the countdown, then its glow beats.
    if (this._promptPop > 0.0 || this._promptTime > 0.0) {
      this._promptPop = Math.max(this._promptPop - delta * 2.4, 0.0);
      this._promptTime += delta;
      const s = 1.0 + 0.7 * this._promptPop * this._promptPop;
      this._promptBox.ScaleX = s;
      this._promptBox.ScaleY = s;
      this._promptBox.RepaintComposition();
      this._uPromptGlow[0] = 0.55 + 0.45 * this._promptPop + 0.3 * Math.sin(this._promptTime * 9.0);
      SetUniform(this._promptGlow, "uGlow", this._uPromptGlow);
    }
  }

  /** Shows the prompt (text, gradient and glow of its kind, jumping in) or hides it. */
  private ShowPrompt(p: Prompt | undefined): void {
    if (p) {
      const [text, colors, tint] = PromptLook(p);
      this._prompt.Text = text;
      this._prompt.FillGradient = Fire(colors);
      this._prompt.UpdateDraw();
      this._promptPop = 1.0; this._promptTime = 0.001;
      this._promptBox.IsVisible = true;
      this._promptBox.Update();
      this._uPromptTint[0] = tint[0]; this._uPromptTint[1] = tint[1]; this._uPromptTint[2] = tint[2];
      SetUniform(this._promptGlow, "uTint", this._uPromptTint);
    } else {
      this._promptPop = 0.0; this._promptTime = 0.0;
      this._promptBox.IsVisible = false;
      this._promptBox.Update();
    }
  }

  // ---- DungeonApp.Input.cs: keys and the pointer (port of `act`, `key_down`, `key_up` and `gesture` in lib.rs) ----

  /** A lane change or a jump; on the title, a jump (a tap, Space, Enter) starts the run, a drag or a lane key does not. */
  private Act(left: boolean, right: boolean, jump: boolean): void {
    if (this._paused) return;
    switch (this._phase) {
      case Phase.Attract:
        if (jump) this._scene.World.Start();
        break;
      case Phase.Playing:
        this._input.Left ||= left;
        this._input.Right ||= right;
        this._input.Jump ||= jump;
        break;
      // Any key or tap leaves GAME OVER or the view from outside for the title.
      case Phase.Over:
        if (this._overReady && this._leaving === 0) this._leaving = 2;
        break;
    }
  }

  KeyDown(key: InputKey): void {
    // The canvas's keyboard navigation used it (a button a keyboard user tabbed to took Enter or Space, an arrow
    // moved in a group): not the game's.
    if (KeyboardManager.IsKeyHandled) return;
    // GAME OVER takes any key (F1 still opens the help).
    if (this._phase === Phase.Over && !this._paused && key !== "F1") {
      this.Act(false, false, true);
      return;
    }
    // In a dialog, Enter and Space press its main button (numpad Enter included, as Rust's NumpadEnter).
    if ((key === "Enter" || key === "NumpadEnter" || key === "Space") && this._paused) { this.CloseDialog(); return; }
    switch (key) {
      case "F1":
        this.ToggleDialog(() => this.HelpDialog());
        break;
      case "Escape": case "KeyP":
        this.Menu();
        break;
      case "ArrowLeft": case "KeyA":
        this._held = -1; this._holdWait = HOLD_FIRST;
        this.Act(true, false, false);
        break;
      case "ArrowRight": case "KeyD":
        this._held = 1; this._holdWait = HOLD_FIRST;
        this.Act(false, true, false);
        break;
      case "ArrowUp": case "KeyW": case "Space": case "Enter": case "NumpadEnter":
        this.Act(false, false, true);
        break;
    }
  }

  /** The held lane key was released (the other one may have taken over since). */
  KeyUp(key: InputKey): void {
    if ((key === "ArrowLeft" || key === "KeyA") && this._held < 0) this._held = 0;
    else if ((key === "ArrowRight" || key === "KeyD") && this._held > 0) this._held = 0;
  }

  /** The pointer, a finger or the mouse alike: a drag steers, a tap jumps. */
  Gesture(args: SkiaGesturesParameters, scale: number): void {
    scale = Math.max(scale, 0.1);
    switch (args.Type) {
      case "Down":
        this._swiped = false; this._panSteps = 0; this._touched = args.Event.Pointer?.DeviceType === "Touch";
        break;
      // A drag steers, with a finger or the mouse: a lane for every PAN_STEP points the pointer has gone
      // sideways since the press, there and back.
      case "Panning": {
        // A finger that went past the tap threshold and came back ends within it: the engine reports a
        // Tapped then, but the player dragged, so no jump on this release.
        const dx = args.Event.Distance.Total.X / scale, dy = args.Event.Distance.Total.Y / scale;
        if (Math.abs(dx) >= TAP_SLOP || Math.abs(dy) >= TAP_SLOP) this._swiped = true;
        const steps = Math.trunc(dx / PAN_STEP);
        if (steps !== this._panSteps) {
          const right = steps > this._panSteps;
          this._panSteps += right ? 1 : -1;
          this._swiped = true;
          this.Act(!right, right, false);
        }
        break;
      }
      // A tap or a click that steered nothing is a jump, wherever it lands.
      case "Tapped":
        if (!this._swiped) this.Act(false, false, true);
        break;
    }
  }

  // ---- DungeonApp.Dialogs.cs: help and pause (port of the dialog half of lib.rs): popups without an overlay,
  // their panel, frame and glow one animated shader, the content over it.

  /** A dialog over the run stops it. */
  private ShellChanged(): void {
    this._paused = this.PopupsCount > 0;
    this._held = 0;
    this._veil.IsVisible = this._paused;
    this._veil.Update();
    // Under a dialog the HUD's buttons are gone, so Tab stays in the dialog.
    this._buttons.IsVisible = !this._paused;
    this._buttons.Update();
  }

  private OpenDialog(dialog: () => SkiaControl): void {
    const content = dialog();
    this.ShowPopup(content);
    // the popup is in the host's list at once: the run stops now, not after the popup's animation
    this.ShellChanged();
  }

  private ClosePopup(animated: boolean): void {
    this.HidePopup(animated);
  }

  /**
   * Escape, P or the pause button: a run pauses (home or resume); the title, which has nothing to pause, shows
   * how to play; an open dialog closes.
   */
  private Menu(): void {
    if (this._paused) this.CloseDialog();
    else if (this._phase === Phase.Playing || this._phase === Phase.Countdown) this.OpenDialog(() => this.PauseDialog());
    else if (this._phase === Phase.Attract) this.OpenDialog(() => this.HelpDialog());
  }

  /** Opens a dialog, or closes the one that is open. */
  private ToggleDialog(dialog: () => SkiaControl): void {
    if (this._paused) this.ClosePopup(true);
    else this.OpenDialog(dialog);
  }

  /** The open dialog closes; the help read during a run gives way to the pause again. */
  private CloseDialog(): void {
    const backToPause = this._helpOpen && (this._phase === Phase.Playing || this._phase === Phase.Countdown);
    this.ClosePopup(!backToPause);
    if (backToPause) this.OpenDialog(() => this.PauseDialog());
  }

  /** A dialog: its panel, frame and glow are one animated shader; the content lies over it. */
  private Dialog(title: string, ...content: SkiaControl[]): SkiaControl {
    // As wide as it likes on a desktop, as wide as the screen lets it on a phone.
    const width = Math.max(Math.min(DIALOG_WIDTH, this._canvasWidth - 4.0), 280.0);
    const stack = Make(new SkiaStack(), {
      // the texts and their glows do not change while the panel's shader runs under them every frame:
      // one image, made again only when a button or a link in it changes
      UseCache: "GPU",
      Spacing: 9,
      Margin: new Thickness(DIALOG_GLOW),
      Padding: new Thickness(this._narrow ? 14 : 24),
      Children: [
        // A lit LED bar.
        Make(new SkiaShape(), {
          WidthRequest: 44,
          HeightRequest: 3,
          CornerRadius: 1.5,
          BackgroundColor: C(0xFFFF_E6C0),
          Shadows: [new SkiaShadow({ Color: C(ACCENT), X: 0, Y: 0, Blur: 9, Opacity: 1 })],
          Margin: new Thickness(0, 2, 0, 4),
        }),
        Make(Line(title, 22, ACCENT), { Margin: new Thickness(0, 0, 0, 4) }),
        ...content,
      ],
    });
    const panel = Make(new SkiaLayer(), {
      VerticalOptions: "Fill",
      VisualEffects: [
        Make(new SkiaShaderEffect(), {
          ShaderCode: DIALOG,
          UseBackground: "Never",
          AutoCreateInputTexture: false,
          OnCompilationError: (_, error) => console.log(`dungeon: dialog SkSL: ${error}`),
        }).SetUniform("uWidth", width),
      ],
    });
    panel.UpdateNonStop(); // its time runs while it is open
    return Make(new SkiaLayer(), {
      WidthRequest: width,
      HorizontalOptions: "Center",
      // centered in what the system bars and cutouts leave free
      Margin: DungeonApp.SafeInsets,
      AccessibilityRole: Aria.RoleDialog,
      AccessibilityLabel: title,
      Children: [panel, stack],
    });
  }

  /** A heading inside a dialog. */
  private static Section(text: string, color: number): SkiaLabel { return Make(Line(text, 12, color), { Margin: new Thickness(0, 10, 0, 0) }); }

  /**
   * One thing of the dungeon: how it looks, its name, what to do about it. On a narrow screen the name and the
   * action do not share a line.
   */
  private static Thing(narrow: boolean, swatch: SkiaShape, name: string, action: string, color: number): SkiaControl {
    if (narrow) {
      return Make(new SkiaStack(), {
        Spacing: 0,
        Children: [
          DungeonApp.ThingRow(swatch, name, undefined),
          Make(Line(action, 13, color), { HorizontalOptions: "End", Margin: new Thickness(0, -4, 0, 0) }),
        ],
      });
    }
    return DungeonApp.ThingRow(swatch, name, Make(Line(action, 13, color), { HorizontalOptions: "End", VerticalOptions: "Center" }));
  }

  private static ThingRow(swatch: SkiaShape, name: string, action: SkiaControl | undefined): SkiaLayer {
    const children: SkiaControl[] = [
      Make(new SkiaLayer(), {
        WidthRequest: 26,
        VerticalOptions: "Fill",
        Children: [Make(swatch, { HorizontalOptions: "Center", VerticalOptions: "Center" })],
      }),
      Make(Line(name, 13, 0xFFFF_FFFF), { Margin: new Thickness(38, 0, 0, 0), VerticalOptions: "Center" }),
    ];
    if (action) children.push(action);
    return Make(new SkiaLayer(), { HeightRequest: 22, Children: children });
  }

  /** One control: what to press or do, and what it does. */
  private static Pair(input: string, action: string): SkiaLayer {
    return Make(new SkiaLayer(), {
      HeightRequest: 20,
      Children: [
        Make(Line(input, 13, ACCENT), { VerticalOptions: "Center" }),
        Make(Line(action, 13, 0xFFFF_FFFF), { HorizontalOptions: "End", VerticalOptions: "Center" }),
      ],
    });
  }

  private static Swatch(width: number, height: number, color: number, glow: boolean): SkiaShape {
    return Make(new SkiaShape(), {
      WidthRequest: width,
      HeightRequest: height,
      BackgroundColor: C(color),
      Shadows: glow ? [new SkiaShadow({ Color: C(color), X: 0, Y: 0, Blur: 8, Opacity: 1 })] : [],
    });
  }

  private static Circle(shape: SkiaShape): SkiaShape {
    shape.Type = "Circle";
    return shape;
  }

  /**
   * A link of the help, opened in the browser: in the link's blue, lighter and underlined under the mouse or when
   * tapped.
   */
  private static Link(text: string, url: string): SkiaLabel {
    const span = Make(new TextSpan(), { Text: text });
    let hovered = false;
    const look = (on: boolean) => { label.TextColor = C(on ? LINK_HOVER : LINK); span.Underline = on; label.Update(); };
    // a tap lights the link; a finger has no hover to end, so it goes back after a moment, and when the page is back
    const settle = () => { if (!hovered) look(false); };
    const label = Make(new SkiaLabel(), {
      FontSize: 11,
      TextColor: C(LINK),
      AccessibilityRole: Aria.RoleLink,
      HoverChanged: (_, on) => { hovered = on; look(on); },
      Tapped: () => {
        look(true);
        Super.OpenLink(url);
        setTimeout(settle, 300);
        window.addEventListener("focus", settle, { once: true });
      },
    });
    label.AddSubView(span);
    return label;
  }

  /**
   * What to do, what not to do, and only then the controls: keyboard, then touch and mouse. The text scrolls when
   * the screen is too low for it; the last line and the button always show.
   */
  private HelpDialog(): SkiaControl {
    // What the dialog needs around the text: its glow, padding, title, the two links and the button.
    const room = Math.max(this._canvasHeight - 322.0, 110.0);
    const narrow = this._narrow;
    this._helpOpen = true;
    const T = DungeonApp.Thing, S = DungeonApp.Swatch, O = DungeonApp.Circle;
    return this.Dialog("HOW TO PLAY",
      Make(new SkiaScroll(), {
        HorizontalOptions: "Fill",
        MaximumHeightRequest: room,
        Content: Make(new SkiaStack(), {
          Spacing: 9,
          Children: [
            Make(DungeonApp.Section("YOUR GOAL", GOOD), { Margin: new Thickness(0) }),
            Line("RUN AS FAR AS YOU CAN. THE RUN NEVER STOPS.", 11, 0xD9FF_FFFF),
            Line("COLLECT WHAT GLOWS ON YOUR WAY.", 11, 0xD9FF_FFFF),
            T(narrow, O(S(14, 14, 0xFFC0_60FF, true)), "ORB", "A LITTLE HEALTH", GOOD),
            T(narrow, O(S(14, 14, 0xFF4D_FF66, true)), "GREEN CROSS", "RESTORES HEALTH", GOOD),
            T(narrow, O(S(14, 14, 0xFF4D_E6FF, true)), "SURGE", "FAST, NOTHING HURTS", GOOD),
            T(narrow, O(S(14, 14, 0xFFFF_CC4D, true)), "SHIELD", "10 S: ONE PILLAR OR GHOST", GOOD),
            DungeonApp.Section("DO NOT TOUCH", HOT),
            Line("THESE DRAIN YOUR HEALTH. ZERO ENDS THE RUN.", 11, 0xD9FF_FFFF),
            T(narrow, Make(S(10, 18, 0xFF3A_3D4A, false), { StrokeColor: C(0xFFFF_8A30), StrokeWidth: 1.55 }), "PILLAR", "MOVE TO A FREE LANE", HOT),
            T(narrow, S(22, 4, 0xFFFF_4030, true), "RED BEAM", "JUMP OVER IT", HOT),
            T(narrow, S(22, 9, 0xFFE8_3A0A, true), "LAVA", "JUMP OVER IT", HOT),
            T(narrow, S(14, 18, 0xFFC8_D8FF, true), "GHOST", "CHANGE LANE. IT HURTS MOST", HOT),
            DungeonApp.Controls(),
          ],
        }),
      }),
      // Links opened in the browser (a new tab): what the game is made with, then its code.
      Make(DungeonApp.Link(`MADE WITH DRAWNUI FOR ${DungeonApp.Framework.toUpperCase()}`, DungeonApp.FrameworkDocs), { Margin: new Thickness(0, 12, 0, 0) }),
      Make(DungeonApp.Link("SOURCE CODE ON GITHUB", DungeonApp.SourceCode), { Margin: new Thickness(0, 6, 0, 0) }),
      Make(Button("OK"), { HorizontalOptions: "End", Margin: new Thickness(0, 6, 0, 0), Tapped: () => this.CloseDialog() }));
  }

  /** The controls section of the help: keyboard, then touch and mouse. */
  private static Controls(): SkiaControl {
    return Make(new SkiaStack(), {
      Spacing: 9,
      Children: [
        DungeonApp.Section("KEYBOARD", ACCENT),
        DungeonApp.Pair("← →", "CHANGE LANE"),
        DungeonApp.Pair("↑ / SPACE", "JUMP"),
        DungeonApp.Section("TOUCH OR MOUSE", ACCENT),
        DungeonApp.Pair("DRAG LEFT OR RIGHT", "CHANGE LANE"),
        DungeonApp.Pair("TAP OR CLICK", "JUMP"),
      ],
    });
  }

  private PauseDialog(): SkiaControl {
    this._helpOpen = false;
    // A wrap: on a narrow screen what does not fit goes to the next line, nothing squeezed.
    return this.Dialog("PAUSED", Make(new SkiaWrap(), {
      Spacing: 14,
      HorizontalOptions: "Center",
      Margin: new Thickness(0, 12, 0, 0),
      Children: [
        Make(GhostButton("HELP"), {
          Tapped: () => {
            this.ClosePopup(false);
            this.OpenDialog(() => this.HelpDialog());
          },
        }),
        // Leaves the run for the title.
        Make(GhostButton("HOME"), {
          Tapped: () => {
            this.ClosePopup(true);
            this._scene.World.ToTitle();
          },
        }),
        Make(Button("RESUME"), { Tapped: () => this.ClosePopup(true) }),
      ],
    }));
  }

  // ---- DungeonApp.Shell.cs: the dialogs' host. The engine's SkiaShell is a React component here, so the host is a
  // layer over the game's tree that shows the dialogs as SkiaShell shows its popups (centered, no overlay, scaled in
  // from 0.5 while fading in, a tap outside closes, screen readers and Tab stay inside), as the C# MAUI head does.

  private readonly _popups: SkiaLayer[] = [];
  private _host!: SkiaLayer;

  /** The game's tree with the layer its dialogs open in. */
  private Shell(root: SkiaControl): SkiaControl {
    return this._host = Make(new SkiaLayer(), {
      HorizontalOptions: "Fill",
      VerticalOptions: "Fill",
      Children: [root],
    });
  }

  /** Dialogs open now. */
  private get PopupsCount(): number { return this._popups.length; }

  private ShowPopup(content: SkiaControl): void {
    const wrapper = Make(new SkiaLayer(), {
      HorizontalOptions: "Center",
      VerticalOptions: "Center",
      Scale: 0.5,
      Children: [content],
    });
    const layer: SkiaLayer = Make(new SkiaLayer(), {
      HorizontalOptions: "Fill",
      VerticalOptions: "Fill",
      ZIndex: 2000 + this._popups.length,
      BlockGesturesBelow: true,
      AccessibilityModal: true,
      // its outside-tap close is no Tab stop (as SkiaShell's popup wrapper)
      AccessibilityCanInteract: false,
      Opacity: 0.1,
      Children: [wrapper],
      Tapped: (_, e) => {
        const location = e.ProcessingInfo.MappedLocation, offset = e.ProcessingInfo.ChildOffset;
        if (!wrapper.HitIsInside(location.X + offset.X, location.Y + offset.Y)) void this.Close(layer, true);
      },
    });
    this._popups.push(layer);
    this._host.AddSubView(layer);
    void layer.FadeToAsync(1, POPUP_SPEED);
    void wrapper.ScaleToAsync(1, 1, POPUP_SPEED);
  }

  private HidePopup(animated: boolean): void {
    if (this._popups.length > 0) void this.Close(this._popups[this._popups.length - 1], animated);
  }

  private async Close(layer: SkiaLayer, animated: boolean): Promise<void> {
    const at = this._popups.indexOf(layer);
    if (at < 0) return;
    this._popups.splice(at, 1);
    if (animated) {
      try {
        await Promise.all([layer.FadeToAsync(0, POPUP_SPEED), layer.Views[0].ScaleToAsync(0, 0, POPUP_SPEED)]);
      } catch { /* the tree went away during the animation */ }
    }
    this._host.RemoveSubView(layer);
    layer.Dispose();
    this.ShellChanged();
  }
}

// the C# file-level helpers, as short names inside this module (C#: static members called unqualified)
const C = DungeonApp.C, Tint = DungeonApp.Tint, Fire = DungeonApp.Fire, Glow = DungeonApp.Glow, Line = DungeonApp.Line;
const Centered = DungeonApp.Centered, MakePlate = DungeonApp.MakePlate, Caption = DungeonApp.Caption;
const Button = DungeonApp.Button, GhostButton = DungeonApp.GhostButton, Key = DungeonApp.Key;

/** C# Span.SequenceEqual. */
function SameValues(a: Float32Array, b: Float32Array): boolean {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Tenths of a second as m:ss.t. */
function FormatTime(tenths: number): string {
  return `${Math.floor(tenths / 600)}:${String(Math.floor(tenths / 10) % 60).padStart(2, "0")}.${tenths % 10}`;
}

/** The text, gradient and glow tint of a prompt. */
function PromptLook(p: Prompt): [string, number[], number[]] {
  switch (p.Kind) {
    case PromptKind.Time: return [`YOUR TIME ${FormatTime(p.Tenths ?? 0)}`, GOLD, Tint(ACCENT)];
    case PromptKind.Jump: return ["JUMP", [0xFFF4_E8FF, 0xFFB0_70FF, 0xFF70_20E0], [0.62, 0.22, 1.0]];
    case PromptKind.Lane: return ["CHANGE LANE", [0xFFE8_FFFF, 0xFF40_E0FF, 0xFF10_90E0], [0.15, 0.85, 1.0]];
    // Health shows during its own green flash: white letters with a green glow stay readable in it.
    case PromptKind.Health: return ["HEALTH UP", [0xFFFF_FFFF, 0xFFF0_FFE8, 0xFFA0_E890], [0.42, 1.0, 0.35]];
    case PromptKind.Surge: return ["SURGE", [0xFFFF_FFFF, 0xFF90_F0FF, 0xFF30_B0FF], [0.5, 0.9, 1.0]];
    case PromptKind.Shield: return ["SHIELD ON", GOLD, [1.0, 0.8, 0.3]];
    case PromptKind.Absorbed: return ["ABSORBED!", GOLD, [1.0, 0.8, 0.3]];
    case PromptKind.Cheer: return [p.Cheer ?? "", GOLD, Tint(ACCENT)];
    case PromptKind.Heal: return ["COLLECT ORBS TO HEAL", [0xFFFF_FFFF, 0xFFF0_FFE8, 0xFFA0_E890], [0.42, 1.0, 0.35]];
    case PromptKind.Drain: return ["YOU TIRE AS YOU RUN", [0xFFFF_FFFF, 0xFFF0_FFE8, 0xFFA0_E890], [0.42, 1.0, 0.35]];
    case PromptKind.Avoid: return ["AVOID GHOSTS", [0xFFFF_FFFF, 0xFFD8_E4FF, 0xFF88_A0E0], [0.72, 0.84, 1.0]];
    default: return ["LOW HEALTH", [0xFFFF_E0D8, 0xFFFF_6050, 0xFFC0_1810], [1.0, 0.25, 0.2]];
  }
}
