interface Hsl {
  h: number;
  s: number;
  l: number;
}

interface RoleTone {
  light: Hsl;
  dark: Hsl;
  /** Text color ON this role's fill, per mode. Optional: without it the role keeps index.css's
   *  stock foreground (see STOCK_FOREGROUNDS below). Needed by presets whose fills break the
   *  usual bands — e.g. Dartspot's light mode, where the action color is near-black. */
  foreground?: { light?: Hsl; dark?: Hsl };
}

export interface ClubThemePreset {
  id: string;
  label: string;
  roles: {
    primary: RoleTone;
    secondary: RoleTone;
    accent: RoleTone;
  };
}

// Unlike the first 4 presets (which share one saturation/lightness "shape" and only rotate hue --
// see the git history of this file), saturation and lightness are now per-preset too, so a preset
// can have its own personality (muted/earthy, neon, near-monochrome, ...) instead of just being a
// different-colored copy of the same look. Every (light, dark) pair still respects the two fixed
// contrast constraints from index.css that resolveClubTheme's output feeds: dark-mode text on
// primary/accent is near-black (--primary-foreground/--accent-foreground), so their dark lightness
// must stay bright (~45%+); secondary's text is white in both modes, so it stays moderate-to-dark
// in both. Ignoring those bands would produce a technically-valid but hard-to-read preset.
const role = (hLight: number, sLight: number, lLight: number, hDark: number, sDark: number, lDark: number): RoleTone => ({
  light: { h: hLight, s: sLight, l: lLight },
  dark: { h: hDark, s: sDark, l: lDark },
});

// Dartspot channel colors (banner, 2026-11-12): yellow #FDD857, amber #F6B110, black #0A0B08.
const DARTSPOT_YELLOW: Hsl = { h: 47, s: 98, l: 67 };
const DARTSPOT_BLACK: Hsl = { h: 80, s: 16, l: 4 };

export const CLUB_THEME_PRESETS: ClubThemePreset[] = [
  {
    // The Dartspot house look and the default for NEW clubs (see DEFAULT_CLUB_THEME_PRESET_ID).
    // Dark: near-black ground, yellow action color with black text on it.
    // Light: yellow must never be text on white (about 1.4:1), so the action color flips to the
    // banner's black with yellow text on it — the channel's "black bar, yellow letters" look.
    // Win = dartboard green (white text). Highlight = cream in dark / bronze in light: clearly not
    // the action yellow, and no dartboard red anywhere, so nothing reads like an error.
    id: "dartspot",
    label: "Dartspot",
    roles: {
      primary: {
        light: DARTSPOT_BLACK,
        dark: DARTSPOT_YELLOW,
        foreground: { light: DARTSPOT_YELLOW, dark: DARTSPOT_BLACK },
      },
      secondary: role(145, 65, 28, 145, 62, 32),
      accent: {
        light: { h: 34, s: 85, l: 30 },
        dark: { h: 40, s: 45, l: 90 },
        foreground: { light: { h: 0, s: 0, l: 100 }, dark: DARTSPOT_BLACK },
      },
    },
  },
  {
    // Id stays "default" for compatibility: existing clubs (H-Town United, ...) store this exact
    // string in clubs.theme_preset, so they keep Cyan even though it is no longer the default.
    id: "default",
    label: "Cyan & Gold",
    roles: {
      primary: role(185, 85, 38, 185, 85, 48),
      secondary: role(155, 65, 34, 155, 65, 42),
      accent: role(42, 95, 45, 45, 100, 58),
    },
  },
  {
    id: "ozeanblau",
    label: "Ozeanblau & Bernstein",
    roles: {
      primary: role(208, 85, 38, 208, 85, 48),
      secondary: role(178, 65, 34, 178, 65, 42),
      accent: role(65, 95, 45, 65, 100, 58),
    },
  },
  {
    id: "violett",
    label: "Violett & Lindgrün",
    roles: {
      primary: role(270, 85, 38, 270, 85, 48),
      secondary: role(240, 65, 34, 240, 65, 42),
      accent: role(127, 95, 45, 127, 100, 58),
    },
  },
  {
    id: "bordeaux",
    label: "Bordeaux & Himmelblau",
    roles: {
      primary: role(335, 85, 38, 335, 85, 48),
      secondary: role(305, 65, 34, 305, 65, 42),
      accent: role(192, 95, 45, 192, 100, 58),
    },
  },
  {
    // High-saturation, high-energy — an esports/arena feel rather than a club-crest feel.
    id: "neon-arena",
    label: "Neon-Arena",
    roles: {
      primary: role(320, 90, 42, 320, 90, 55),
      secondary: role(195, 85, 38, 195, 85, 46),
      accent: role(75, 90, 42, 75, 95, 55),
    },
  },
  {
    // Lower saturation across all three roles instead of just a different hue — a genuinely
    // quieter, earthier register next to the vibrant presets above.
    id: "waldmeister",
    label: "Waldmeister",
    roles: {
      primary: role(142, 45, 32, 142, 48, 46),
      secondary: role(32, 40, 32, 32, 42, 40),
      accent: role(95, 55, 38, 95, 60, 50),
    },
  },
  {
    // Deep jewel tones — moderate saturation held at a lower lightness than the others for a
    // moodier, more premium feel rather than the bright-arena default.
    id: "mitternacht",
    label: "Mitternacht",
    roles: {
      primary: role(235, 70, 40, 235, 75, 52),
      secondary: role(265, 55, 34, 265, 55, 40),
      accent: role(340, 75, 42, 340, 80, 55),
    },
  },
  {
    // Near-neutral graphite base (very low saturation on primary/secondary) with one saturated
    // accent doing all the color work — structurally different from every hue-trio preset above.
    id: "monochrom-silber",
    label: "Monochrom Silber",
    roles: {
      primary: role(210, 15, 38, 210, 15, 50),
      secondary: role(210, 10, 30, 210, 12, 38),
      accent: role(18, 90, 48, 18, 95, 58),
    },
  },
  {
    // Clinical scan register — icy cyan + near-neutral bone-grey, with a hazard-red accent doing
    // the job a radiologist's annotation marker would (highlighting a finding on a scan) rather
    // than the warm sports-club accent every other preset above leans on.
    id: "roentgen",
    label: "Röntgen",
    roles: {
      primary: role(195, 70, 40, 195, 75, 52),
      secondary: role(210, 12, 35, 210, 14, 42),
      accent: role(358, 85, 45, 358, 85, 55),
    },
  },
];

/** Preset for new clubs and for an unknown/missing preset id. NOT the same as the preset whose id
 *  is "default" (Cyan & Gold), which is what existing clubs store. */
export const DEFAULT_CLUB_THEME_PRESET_ID = "dartspot";

const tone = (h: number, s: number, l: number) => `${h} ${s}% ${l}%`;
const toneOf = (c: Hsl) => tone(c.h, c.s, c.l);

/** index.css's own foreground values. Always written out, so switching from a preset that
 *  overrides them (Dartspot) back to one that doesn't never leaves a stale text color behind. */
const STOCK_FOREGROUNDS = {
  light: { primary: "0 0% 100%", secondary: "0 0% 100%", accent: "0 0% 100%" },
  dark: { primary: "222 30% 5%", secondary: "0 0% 100%", accent: "222 30% 5%" },
} as const;

/** Every CSS custom property the club branding provider needs to set for one (preset, mode) pair. */
export function resolveClubTheme(presetId: string, mode: "light" | "dark"): Record<string, string> {
  const preset =
    CLUB_THEME_PRESETS.find((p) => p.id === presetId) ??
    CLUB_THEME_PRESETS.find((p) => p.id === DEFAULT_CLUB_THEME_PRESET_ID)!;
  const isDark = mode === "dark";

  const pRole = isDark ? preset.roles.primary.dark : preset.roles.primary.light;
  const sRole = isDark ? preset.roles.secondary.dark : preset.roles.secondary.light;
  const aRole = isDark ? preset.roles.accent.dark : preset.roles.accent.light;

  const fg = (r: RoleTone, key: "primary" | "secondary" | "accent") => {
    const own = isDark ? r.foreground?.dark : r.foreground?.light;
    return own ? toneOf(own) : STOCK_FOREGROUNDS[mode][key];
  };
  const primaryForeground = fg(preset.roles.primary, "primary");
  const secondaryForeground = fg(preset.roles.secondary, "secondary");
  const accentForeground = fg(preset.roles.accent, "accent");

  const primary = tone(pRole.h, pRole.s, pRole.l);
  const secondary = tone(sRole.h, sRole.s, sRole.l);
  const accent = tone(aRole.h, aRole.s, aRole.l);

  // --gradient-hero always uses dark-mode-brightness hues for its wash, in both light and dark
  // mode -- mirrors the fact that today's light-mode --gradient-hero in index.css already
  // hardcodes the dark-mode literal verbatim.
  const heroD = preset.roles;
  const heroPrimary = tone(heroD.primary.dark.h, heroD.primary.dark.s, heroD.primary.dark.l);
  const heroSecondary = tone(heroD.secondary.dark.h, heroD.secondary.dark.s, heroD.secondary.dark.l);
  const heroAccent = tone(heroD.accent.dark.h, heroD.accent.dark.s, heroD.accent.dark.l);

  return {
    "--primary": primary,
    "--primary-foreground": primaryForeground,
    "--secondary": secondary,
    "--secondary-foreground": secondaryForeground,
    "--accent": accent,
    "--accent-foreground": accentForeground,
    "--sidebar-primary-foreground": primaryForeground,
    "--ring": primary,
    "--dart-cyan": primary,
    "--dart-green": secondary,
    "--dart-gold": accent,
    "--sidebar-primary": primary,
    "--sidebar-ring": primary,
    "--gradient-hero": `linear-gradient(135deg, hsl(${heroPrimary} / 0.08), hsl(${heroSecondary} / 0.05), hsl(${heroAccent} / 0.03))`,
    "--shadow-glow-cyan": `0 0 30px hsl(${primary} / ${isDark ? 0.25 : 0.18})`,
    "--shadow-glow-green": `0 0 30px hsl(${secondary} / ${isDark ? 0.25 : 0.18})`,
    "--shadow-glow-gold": `0 0 20px hsl(${accent} / ${isDark ? 0.2 : 0.15})`,
  };
}
