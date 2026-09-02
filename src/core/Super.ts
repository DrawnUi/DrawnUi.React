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

  private static readonly colorCache = new Map<string, Float32Array>();

  /**
   * Color string -> CanvasKit color. Hex follows the MAUI/DrawnUi convention: #RGB, #ARGB, #RRGGBB, #AARRGGBB
   * (alpha FIRST — CSS puts it last, CanvasKit's own parser would read "#22FFFFFF" as opaque cyan).
   * rgb()/rgba() strings are passed to CanvasKit as is.
   */
  static ParseColor(color: string): Float32Array {
    let c = Super.colorCache.get(color);
    if (c) return c;
    if (color.startsWith("#")) {
      let h = color.slice(1);
      if (h.length === 3 || h.length === 4) h = [...h].map((ch) => ch + ch).join("");
      let a = 1, rgb = h;
      if (h.length === 8) { a = parseInt(h.slice(0, 2), 16) / 255; rgb = h.slice(2); }
      const r = parseInt(rgb.slice(0, 2), 16) / 255, g = parseInt(rgb.slice(2, 4), 16) / 255, b = parseInt(rgb.slice(4, 6), 16) / 255;
      c = Super.CK.Color4f(r, g, b, a);
    } else {
      c = Super.CK.parseColorString(color);
    }
    Super.colorCache.set(color, c);
    return c;
  }

  static GetTypeface(alias?: string): Typeface | null {
    return (alias ? Super.Fonts.get(alias) : undefined) ?? Super.DefaultTypeface ?? null;
  }
}
