import type { SVGProps } from "react";

/**
 * DartSpot's own icon set — hand-drawn to replace the generic lucide icons in the main
 * navigation (Layout.tsx's NAV_ITEMS), per the roadmap's "Eigene Icon-Sprache" item: the
 * Design agent called out Target/Trophy/Users by name as reading as "any app's" icons rather
 * than this one's, since Home/Game/Stats/Training/Tournament/Club are the six icons every
 * member sees on every single screen (desktop top nav AND mobile bottom nav both read straight
 * from NAV_ITEMS) — the single highest-visibility, lowest-risk surface to make genuinely
 * DartSpot's own instead of "any app built with shadcn".
 *
 * Shared visual language across all six (this IS the "language" part, not just six unrelated
 * pictures): every icon reuses the same dart silhouette — a diagonal shaft, a filled dot tip,
 * a small flared flight — so Game (one dart in flight), Training (three darts grouped tightly,
 * the actual practice concept of "grouping"), and Club (two darts crossed, a classic darts-club
 * emblem motif, the same idea as crossed cues for a billiards club) visually belong to one
 * family instead of being generic stand-ins. Training in particular replaces a plain gym
 * Dumbbell, which never made sense for DART training in the first place. Tournament's cup
 * echoes the shape (bowl, handles, stem, base) of the existing hand-built TrophyCeremony.tsx
 * animation at icon scale, so the "big moment" trophy and the everyday nav trophy read as the
 * same object. Checked visually at both icon-sheet scale and actual ~20px nav size before
 * landing on this shape (a flared-triangle flight reads more clearly than a 3-ray fan did).
 *
 * Drawn as plain stroke line art (fill="none", stroke="currentColor") in the exact same
 * convention lucide-react's own icons use -- same 24x24 viewBox, same default width/height,
 * same ...props passthrough -- specifically so every existing call site (className="w-5 h-5",
 * the active-tab drop-shadow-glow filter, color via text-primary/text-muted-foreground, etc.)
 * keeps working completely unchanged. These are drop-in replacements, not a new icon API.
 */
const BASE_PROPS = {
  viewBox: "0 0 24 24",
  width: 24,
  height: 24,
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

/** Nav: "Home" / Start — a plain house silhouette, redrawn from scratch rather than a generic
 *  library glyph so it matches this set's slightly rounder, hand-set proportions. */
export const HomeIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg {...BASE_PROPS} {...props}>
    <path d="M4 12 L12 5 L20 12" />
    <path d="M6.5 10.5 V19.5 H17.5 V10.5" />
    <path d="M10 19.5 V14.5 H14 V19.5" />
  </svg>
);

/** Nav: "Spielen" — replaces lucide's generic crosshair Target. A single dart mid-flight:
 *  diagonal shaft, a filled tip, a flared flight -- the shaft/tip/flight vocabulary every other
 *  dart-based icon in this set reuses. */
export const DartGameIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg {...BASE_PROPS} {...props}>
    <path d="M4.5 19.5 L15 9" />
    <path d="M17.3 11.3 L15.8 8.2 L12.7 6.7" />
    <circle cx="4.5" cy="19.5" r="1.15" fill="currentColor" stroke="none" />
  </svg>
);

/** Nav: "Statistiken" — replaces lucide's generic BarChart3. Three ascending bars, same rounded
 *  stroke language as the rest of the set instead of filled rectangles. */
export const StatsIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg {...BASE_PROPS} {...props}>
    <rect x="4" y="13.5" width="3.6" height="6" rx="1" />
    <rect x="10.2" y="9.5" width="3.6" height="10" rx="1" />
    <rect x="16.4" y="4.5" width="3.6" height="15" rx="1" />
  </svg>
);

/** Nav: "Training" — replaces lucide's Dumbbell, which was always a gym icon standing in for
 *  DART practice. Three darts thrown parallel and tight, the actual "grouping" a player
 *  practices for -- distinct from the single Game dart by being three, clustered, and thrown
 *  straight down rather than angled in flight. */
export const TrainingIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg {...BASE_PROPS} {...props}>
    <path d="M5.5 19 L9.5 12.5" />
    <path d="M11.4 13.7 L10.1 11.5 L7.6 11.3" />
    <circle cx="5.5" cy="19" r="1" fill="currentColor" stroke="none" />
    <path d="M11.5 19 L15.5 12.5" />
    <path d="M17.4 13.7 L16.1 11.5 L13.6 11.3" />
    <circle cx="11.5" cy="19" r="1" fill="currentColor" stroke="none" />
    <path d="M17.5 19 L21.5 12.5" />
    <path d="M23.2 13.7 L22.1 11.5 L19.6 11.3" />
    <circle cx="17.5" cy="19" r="1" fill="currentColor" stroke="none" />
  </svg>
);

/** Nav: "Turnier" — replaces lucide's generic Trophy. Deliberately echoes the SAME cup
 *  construction (bowl + two handles + stem + base) as TrophyCeremony.tsx's big championship
 *  animation, just simplified to line art at icon scale, so the two read as the same trophy. */
export const DartTrophyIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg {...BASE_PROPS} {...props}>
    <path d="M7.5 4.5 H16.5 V9 C16.5 12.3 14.5 14.3 12 14.3 C9.5 14.3 7.5 12.3 7.5 9 Z" />
    <path d="M7.5 6 C4.7 6 4.3 9.5 7.5 10.5" />
    <path d="M16.5 6 C19.3 6 19.7 9.5 16.5 10.5" />
    <path d="M12 14.3 V17" />
    <path d="M9 17 H15" />
    <path d="M7.5 19.5 H16.5" />
  </svg>
);

/** Nav: "Verein" — replaces lucide's generic Users. Two darts crossed, a classic darts-club
 *  emblem motif (in the same spirit as crossed cues for a billiards club), built from the same
 *  shaft/tip/flight vocabulary as the Game and Training icons. */
export const ClubIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg {...BASE_PROPS} {...props}>
    <path d="M19 19 L5 5" />
    <path d="M6.8 3.2 L4.2 4.2 L3.2 6.8" />
    <circle cx="19" cy="19" r="1.15" fill="currentColor" stroke="none" />
    <path d="M5 19 L19 5" />
    <path d="M20.8 6.8 L19.8 4.2 L17.2 3.2" />
    <circle cx="5" cy="19" r="1.15" fill="currentColor" stroke="none" />
  </svg>
);

/** Dashboard quick action: "Season" (round-robin/league standings over a whole season, distinct
 *  from a single tournament's DartTrophyIcon above) — replaces lucide's generic Medal. A ribboned
 *  medal disc with a star, the one icon in this set that isn't built from the shaft/tip/flight
 *  vocabulary (a season standing isn't a single throw or match) but still plain stroke line art
 *  in the same convention so it drops into every existing call site unchanged. */
export const SeasonIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg {...BASE_PROPS} {...props}>
    <path d="M9 13 L6.5 20.5 L12 18 L17.5 20.5 L15 13" />
    <circle cx="12" cy="8" r="5.25" />
    <path d="M12 5.2 L13.1 7.4 L15.5 7.75 L13.75 9.45 L14.15 11.85 L12 10.7 L9.85 11.85 L10.25 9.45 L8.5 7.75 L10.9 7.4 Z" fill="currentColor" stroke="none" />
  </svg>
);

/** Nav: "Admin" (Round 3 Rang 6) — replaces lucide's generic UserCog. Admin sits in the exact
 *  same nav slot as the original six above (Layout.tsx's desktop nav, mobile top-level nav, and
 *  the "Mehr" drawer all read it from the same list) but was left on a stock lucide icon when
 *  this set was first drawn, since it's only ever shown to admins. A shield with a checkmark —
 *  "verified control area", not a single throw or match, so deliberately not built from the
 *  shaft/tip/flight vocabulary (same reasoning as SeasonIcon's medal above). Distinct on purpose
 *  from the plain lucide Shield/ShieldOff still used inside Admin.tsx for the per-member
 *  grant/revoke buttons — those are a specific role-toggle action, not this nav concept. */
export const AdminIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg {...BASE_PROPS} {...props}>
    <path d="M12 3.3 L18.4 5.7 V11.3 C18.4 15.8 15.6 18.7 12 20.4 C8.4 18.7 5.6 15.8 5.6 11.3 V5.7 Z" />
    <path d="M8.8 11.9 L10.9 14 L15.3 9.2" />
  </svg>
);
