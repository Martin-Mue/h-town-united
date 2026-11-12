import { describe, it, expect } from "vitest";
import { resolveClubTheme, CLUB_THEME_PRESETS, DEFAULT_CLUB_THEME_PRESET_ID } from "./clubThemePresets";

// WCAG 2 contrast between two "h s% l%" tokens.
const luminance = (token: string) => {
  const [h, s, l] = token.replace(/%/g, "").split(" ").map(Number);
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const v = l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(0) + 0.7152 * f(8) + 0.0722 * f(4);
};
const contrast = (x: string, y: string) => {
  const [a, b] = [luminance(x), luminance(y)].sort((p, q) => q - p);
  return (a + 0.05) / (b + 0.05);
};
const LIGHT_BG = "210 20% 99%";
const DARK_CARD = "219 27% 10%";

describe("resolveClubTheme", () => {
  it("reproduces today's index.css light-mode values for the default preset", () => {
    const vars = resolveClubTheme("default", "light");
    expect(vars["--primary"]).toBe("185 85% 38%");
    expect(vars["--secondary"]).toBe("155 65% 34%");
    expect(vars["--accent"]).toBe("42 95% 45%");
    expect(vars["--ring"]).toBe("185 85% 38%");
    expect(vars["--dart-cyan"]).toBe("185 85% 38%");
    expect(vars["--dart-green"]).toBe("155 65% 34%");
    expect(vars["--dart-gold"]).toBe("42 95% 45%");
  });

  it("reproduces today's index.css dark-mode values for the default preset", () => {
    const vars = resolveClubTheme("default", "dark");
    expect(vars["--primary"]).toBe("185 85% 48%");
    expect(vars["--secondary"]).toBe("155 65% 42%");
    expect(vars["--accent"]).toBe("45 100% 58%");
    expect(vars["--ring"]).toBe("185 85% 48%");
  });

  it("falls back to the default preset for an unknown preset id", () => {
    const known = resolveClubTheme(DEFAULT_CLUB_THEME_PRESET_ID, "dark");
    const unknown = resolveClubTheme("does-not-exist", "dark");
    expect(unknown).toEqual(known);
  });

  it("produces a distinct hue for each preset", () => {
    const ids = ["default", "ozeanblau", "violett", "bordeaux"];
    const primaries = ids.map((id) => resolveClubTheme(id, "dark")["--primary"]);
    expect(new Set(primaries).size).toBe(ids.length);
  });

  it("gives every registered preset a distinct primary hue, including the newer ones", () => {
    const primaries = CLUB_THEME_PRESETS.map((p) => resolveClubTheme(p.id, "dark")["--primary"]);
    expect(new Set(primaries).size).toBe(CLUB_THEME_PRESETS.length);
  });

  it("keeps every preset's dark-mode primary/accent lightness readable against near-black text", () => {
    // --primary-foreground/--accent-foreground are near-black in dark mode (index.css) --
    // a preset with a too-dark primary/accent there would be genuinely hard to read, not just a
    // stylistic choice, so this is a real floor and not an arbitrary number.
    for (const preset of CLUB_THEME_PRESETS) {
      expect(preset.roles.primary.dark.l).toBeGreaterThanOrEqual(45);
      expect(preset.roles.accent.dark.l).toBeGreaterThanOrEqual(45);
    }
  });

  it("resolves every registered preset for both modes without throwing or falling back", () => {
    for (const preset of CLUB_THEME_PRESETS) {
      const dark = resolveClubTheme(preset.id, "dark");
      const light = resolveClubTheme(preset.id, "light");
      expect(dark["--primary"]).toBeTruthy();
      expect(light["--primary"]).toBeTruthy();
    }
  });

  it("makes Dartspot the default for new clubs while Cyan keeps its stored id", () => {
    expect(DEFAULT_CLUB_THEME_PRESET_ID).toBe("dartspot");
    // Existing clubs store "default" — that must still be Cyan & Gold, not the new default.
    expect(resolveClubTheme("default", "dark")["--primary"]).toBe("185 85% 48%");
  });

  it("writes every foreground token, so switching presets never leaves a stale text color", () => {
    for (const preset of CLUB_THEME_PRESETS) {
      for (const mode of ["light", "dark"] as const) {
        const vars = resolveClubTheme(preset.id, mode);
        expect(vars["--primary-foreground"]).toBeTruthy();
        expect(vars["--secondary-foreground"]).toBeTruthy();
        expect(vars["--accent-foreground"]).toBeTruthy();
      }
    }
    expect(resolveClubTheme("default", "light")["--primary-foreground"]).toBe("0 0% 100%");
    expect(resolveClubTheme("default", "dark")["--primary-foreground"]).toBe("222 30% 5%");
  });

  describe("Dartspot contrast", () => {
    const dark = resolveClubTheme("dartspot", "dark");
    const light = resolveClubTheme("dartspot", "light");

    it("dark: black text on the yellow action color", () => {
      expect(contrast(dark["--primary-foreground"], dark["--primary"])).toBeGreaterThanOrEqual(7);
    });
    it("dark: yellow and cream stay readable as text on cards", () => {
      expect(contrast(dark["--primary"], DARK_CARD)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(dark["--accent"], DARK_CARD)).toBeGreaterThanOrEqual(4.5);
    });
    it("light: the action color is never yellow text on white", () => {
      expect(contrast(light["--primary"], LIGHT_BG)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(light["--primary-foreground"], light["--primary"])).toBeGreaterThanOrEqual(7);
    });
    it("light: bronze highlight readable as text and under white text", () => {
      expect(contrast(light["--accent"], LIGHT_BG)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(light["--accent-foreground"], light["--accent"])).toBeGreaterThanOrEqual(4.5);
    });
    it("win green carries white text in both modes", () => {
      expect(contrast(dark["--secondary-foreground"], dark["--secondary"])).toBeGreaterThanOrEqual(4.5);
      expect(contrast(light["--secondary-foreground"], light["--secondary"])).toBeGreaterThanOrEqual(4.5);
    });
    // Cream and the yellow are about equally bright (only ~1.1:1), so lightness alone cannot tell
    // them apart: the highlight stays a pale, low-saturation cream and UI pairs it with a symbol
    // (trophy, star) — the redesign plan's "Creme/Weiß mit Symbol statt Gold".
    it("highlight is a pale cream, far less saturated than the action yellow", () => {
      const [, sA, lA] = dark["--accent"].replace(/%/g, "").split(" ").map(Number);
      const [, sP] = dark["--primary"].replace(/%/g, "").split(" ").map(Number);
      expect(lA).toBeGreaterThanOrEqual(88);
      expect(sP - sA).toBeGreaterThanOrEqual(40);
    });
  });
});
