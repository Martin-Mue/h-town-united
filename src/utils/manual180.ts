export interface Manual180Entry {
  player_id: string;
  year: number;
  count: number;
}

export interface Yearly180Breakdown {
  year: number;
  appTracked: number;
  manual: number;
  total: number;
}

/**
 * Combines app-tracked 180 counts (bucketed by calendar year, from real leg data) with a
 * player's manually-entered historical counts into one per-year breakdown, newest year first.
 * Both sides simply ADD for a year that has both — a manual entry is meant for years/games the
 * app never saw (pre-camera-tracking history), so it's on the player not to double-enter a year
 * the app already covers, the same way any other self-reported figure would be.
 */
export function combine180Breakdown(appTrackedByYear: Record<number, number>, manualEntries: Manual180Entry[]): Yearly180Breakdown[] {
  const years = new Set<number>([
    ...Object.keys(appTrackedByYear).map(Number),
    ...manualEntries.map((e) => e.year),
  ]);
  const manualByYear = new Map(manualEntries.map((e) => [e.year, e.count]));
  return [...years]
    .sort((a, b) => b - a)
    .map((year) => {
      const appTracked = appTrackedByYear[year] ?? 0;
      const manual = manualByYear.get(year) ?? 0;
      return { year, appTracked, manual, total: appTracked + manual };
    });
}

/**
 * Whether manually-entered (year-granularity) 180 counts can meaningfully participate in the
 * currently active time filter. A specific calendar year or "all time" both work — but a
 * relative window like "last 7 days" or "last 30 days" can't be mapped onto a whole-year figure
 * at all, so manual entries are excluded rather than silently misrepresented as being "in" a
 * window they can't actually be verified against.
 */
export function manualEntriesApplicable(filterTime: string): boolean {
  return filterTime === "all";
}
