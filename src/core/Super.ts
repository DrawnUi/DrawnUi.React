import CanvasKitInit, { type CanvasKit, type Typeface } from "canvaskit-wasm";
import wasmUrl from "canvaskit-wasm/bin/canvaskit.wasm?url";

/** Mirrors DrawnUi.Net IFontCollection: fonts.AddFont(source, alias). */
export class FontCollection {
  readonly Fonts: { Source: string; Alias: string }[] = [];
  AddFont(source: string, alias: string): FontCollection {
    this.Fonts.push({ Source: source, Alias: alias });
    return this;
  }
}

/** Mirrors DrawnUi.Net DrawnUiBuilder: Super.UseDrawnUi().ConfigureFonts(...).BuildAsync(). */
export class DrawnUiBuilder {
  private readonly fonts = new FontCollection();

  ConfigureFonts(configure: (fonts: FontCollection) => void): DrawnUiBuilder {
    configure(this.fonts);
    return this;
  }

  /** Loads CanvasKit + registered fonts. Must complete before the first Canvas is created. */
  async BuildAsync(): Promise<void> {
    Super.CK = await CanvasKitInit({ locateFile: () => wasmUrl });
    for (const f of this.fonts.Fonts) {
      const data = await (await fetch(f.Source)).arrayBuffer();
      const face = Super.CK.Typeface.MakeFreeTypeFaceFromData(data);
      if (!face) throw new Error(`DrawnUi: cannot load font '${f.Source}'`);
      Super.Fonts.set(f.Alias, face);
      Super.DefaultTypeface ??= face;
    }
    Super.DefaultTypeface ??= Super.CK.Typeface.GetDefault() ?? undefined;
  }
}

/** Mirrors DrawnUi static Super: global engine state. */
export class Super {
  /** CanvasKit instance, valid after BuildAsync(). */
  static CK: CanvasKit;
  /** Registered typefaces by alias (FontFamily). */
  static readonly Fonts = new Map<string, Typeface>();
  /** First registered font, or CanvasKit's built-in one. */
  static DefaultTypeface?: Typeface;

  static UseDrawnUi(): DrawnUiBuilder { return new DrawnUiBuilder(); }

  static GetTypeface(alias?: string): Typeface | null {
    return (alias ? Super.Fonts.get(alias) : undefined) ?? Super.DefaultTypeface ?? null;
  }
}
