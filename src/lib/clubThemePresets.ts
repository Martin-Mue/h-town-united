interface RoleTone {
  light: { h: number; s: number; l: number };
  dark: { h: number; s: number; l: number };
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

export const CLUB_THEME_PRESETS: ClubThemePreset[] = [
  {
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
];

export const DEFAULT_CLUB_THEME_PRESET_ID = "default";

const tone = (h: number, s: number, l: number) => `${h} ${s}% ${l}%`;

/** Every CSS custom property the club branding provider needs to set for one (preset, mode) pair. */
export function resolveClubTheme(presetId: string, mode: "light" | "dark"): Record<string, string> {
  const preset =
    CLUB_THEME_PRESETS.find((p) => p.id === presetId) ??
    CLUB_THEME_PRESETS.find((p) => p.id === DEFAULT_CLUB_THEME_PRESET_ID)!;
  const isDark = mode === "dark";

  const pRole = isDark ? preset.roles.primary.dark : preset.roles.primary.light;
  const sRole = isDark ? preset.roles.secondary.dark : preset.roles.secondary.light;
  const aRole = isDark ? preset.roles.accent.dark : preset.roles.accent.light;

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
    "--secondary": secondary,
    "--accent": accent,
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
