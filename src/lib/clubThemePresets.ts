export interface ClubThemePreset {
  id: string;
  label: string;
  hues: {
    primary: { light: number; dark: number };
    secondary: { light: number; dark: number };
    accent: { light: number; dark: number };
  };
}

// Saturation/lightness are locked per role across every preset -- only hue rotates. These are
// today's exact shipping values from index.css, which is what keeps the existing white/near-black
// --*-foreground contrast correct for every preset with zero extra work (the provider never
// touches --*-foreground).
const ROLE_TONE = {
  primary: { sLight: 85, lLight: 38, sDark: 85, lDark: 48 },
  secondary: { sLight: 65, lLight: 34, sDark: 65, lDark: 42 },
  accent: { sLight: 95, lLight: 45, sDark: 100, lDark: 58 },
} as const;

export const CLUB_THEME_PRESETS: ClubThemePreset[] = [
  {
    id: "default",
    label: "Cyan & Gold",
    hues: {
      primary: { light: 185, dark: 185 },
      secondary: { light: 155, dark: 155 },
      accent: { light: 42, dark: 45 },
    },
  },
  {
    id: "ozeanblau",
    label: "Ozeanblau & Bernstein",
    hues: {
      primary: { light: 208, dark: 208 },
      secondary: { light: 178, dark: 178 },
      accent: { light: 65, dark: 65 },
    },
  },
  {
    id: "violett",
    label: "Violett & Lindgrün",
    hues: {
      primary: { light: 270, dark: 270 },
      secondary: { light: 240, dark: 240 },
      accent: { light: 127, dark: 127 },
    },
  },
  {
    id: "bordeaux",
    label: "Bordeaux & Himmelblau",
    hues: {
      primary: { light: 335, dark: 335 },
      secondary: { light: 305, dark: 305 },
      accent: { light: 192, dark: 192 },
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
  const { primary: p, secondary: s, accent: a } = ROLE_TONE;

  const primary = tone(
    isDark ? preset.hues.primary.dark : preset.hues.primary.light,
    isDark ? p.sDark : p.sLight,
    isDark ? p.lDark : p.lLight,
  );
  const secondary = tone(
    isDark ? preset.hues.secondary.dark : preset.hues.secondary.light,
    isDark ? s.sDark : s.sLight,
    isDark ? s.lDark : s.lLight,
  );
  const accent = tone(
    isDark ? preset.hues.accent.dark : preset.hues.accent.light,
    isDark ? a.sDark : a.sLight,
    isDark ? a.lDark : a.lLight,
  );

  // --gradient-hero always uses dark-mode-brightness hues for its wash, in both light and dark
  // mode -- mirrors the fact that today's light-mode --gradient-hero in index.css already
  // hardcodes the dark-mode literal verbatim.
  const heroPrimary = tone(preset.hues.primary.dark, p.sDark, p.lDark);
  const heroSecondary = tone(preset.hues.secondary.dark, s.sDark, s.lDark);
  const heroAccent = tone(preset.hues.accent.dark, a.sDark, a.lDark);

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
