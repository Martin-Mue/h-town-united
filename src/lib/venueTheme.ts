import { resolveClubTheme } from "@/lib/clubThemePresets";

/** The color tokens a fixed-dark venue surface (.venue-dark / .broadcast-* in index.css) re-maps. */
const VENUE_ROLE_TOKENS = [
  "--primary",
  "--primary-foreground",
  "--secondary",
  "--secondary-foreground",
  "--accent",
  "--accent-foreground",
  "--ring",
] as const;

/** Prefix of the custom properties the venue surface reads: "--primary" -> "--venue-primary". */
const venueName = (token: string) => `--venue-${token.slice(2)}`;

/**
 * The club's colors in their DARK-mode tones, as --venue-* custom properties.
 *
 * The venue screen (Board-Übersicht on a TV/tablet, the board-mode kiosk card) is always dark,
 * whatever the viewer's device is set to. The normal --primary etc. follow the device's light/dark
 * mode, and some presets' light tones are unusable on a dark panel (Dartspot's light-mode action
 * color is near-black). So the branding provider writes these dark tones alongside the normal ones,
 * and the fixed-dark surfaces read them instead. index.css's fallbacks for an unset --venue-* are
 * the Cyan dark tones, which is what a cold start shows before the club has loaded.
 */
export function resolveVenueThemeVars(presetId: string): Record<string, string> {
  const dark = resolveClubTheme(presetId, "dark");
  return Object.fromEntries(VENUE_ROLE_TOKENS.map((token) => [venueName(token), dark[token]]));
}
