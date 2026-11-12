/** Pure helpers for the head of the Statistics page: the period switch (7 Tage / 30 Tage /
 *  Saison / Gesamt), the 3-dart average with its change against the previous period, and the
 *  "Average pro Spieltag" bar series. No React, no Supabase — the page feeds in samples it has
 *  already computed from its own game/leg queries. */

const DAY_MS = 86_400_000;

/** The shortcuts the period switch offers. They are not a separate filter: each one is a preset
 *  over the page's existing `filterTime` + `filterYear` state (see filterStateForPeriod). */
export type StatsPeriod = "week" | "month" | "season" | "all";

export const STATS_PERIODS: readonly StatsPeriod[] = ["week", "month", "season", "all"];

/** The filter values (same shape as Statistics.tsx's filterTime/filterYear) a period stands for.
 *  "Saison" is the current calendar year, matching the page's existing season select. */
export function filterStateForPeriod(period: StatsPeriod, currentYear: number): { filterTime: "all" | "week" | "month"; filterYear: string } {
  if (period === "week") return { filterTime: "week", filterYear: "all" };
  if (period === "month") return { filterTime: "month", filterYear: "all" };
  if (period === "season") return { filterTime: "all", filterYear: String(currentYear) };
  return { filterTime: "all", filterYear: "all" };
}

/** Which period button reads as pressed for the current filter state — null when the filter bar
 *  holds a combination none of the shortcuts stands for (e.g. "Heute" or an older season). */
export function activeStatsPeriod(filterTime: string, filterYear: string, currentYear: number): StatsPeriod | null {
  return STATS_PERIODS.find((p) => {
    const state = filterStateForPeriod(p, currentYear);
    return state.filterTime === filterTime && state.filterYear === filterYear;
  }) ?? null;
}

/** Half-open time range [start, end) in epoch milliseconds. */
export interface TimeWindow { start: number; end: number }

/** What the previous-period comparison is measured against. */
export type PreviousPeriodKind = "week" | "month" | "season";

/** The window right before the one the filter currently shows, of the same length: the 7 days
 *  before the last 7, the 30 days before the last 30, or the whole previous season (calendar
 *  year) for a season filter. Null when there is nothing sensible to compare against (all time,
 *  "today", "last 12 months", or a time range combined with a season). */
export function previousWindowFor(filterTime: string, filterYear: string, now: number): { kind: PreviousPeriodKind; window: TimeWindow } | null {
  if (filterYear === "all") {
    if (filterTime === "week") return { kind: "week", window: { start: now - 14 * DAY_MS, end: now - 7 * DAY_MS } };
    if (filterTime === "month") return { kind: "month", window: { start: now - 60 * DAY_MS, end: now - 30 * DAY_MS } };
    return null;
  }
  if (filterTime !== "all") return null;
  const season = Number(filterYear);
  if (!Number.isFinite(season)) return null;
  return { kind: "season", window: { start: new Date(season - 1, 0, 1).getTime(), end: new Date(season, 0, 1).getTime() } };
}

/** One player's 3-dart average in one game (all of that player's darts in that game pooled). */
export interface GameAverageSample { gameId: string; playedAt: number; average: number }

export function isInWindow(playedAt: number, window: TimeWindow): boolean {
  return playedAt >= window.start && playedAt < window.end;
}

/** Mean of per-game averages, every game counted equally — the same convention the page's
 *  leaderboard and the stored lifetime player average use. Null without any sample. */
export function meanOfGameAverages(samples: readonly GameAverageSample[]): number | null {
  if (samples.length === 0) return null;
  return samples.reduce((sum, s) => sum + s.average, 0) / samples.length;
}

/** Change of the average against the previous period, rounded to one decimal like it is shown.
 *  Null when either side has no games — a delta against nothing would be noise, not a trend. */
export function averageChange(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null) return null;
  return Math.round((current - previous) * 10) / 10;
}

/** Local calendar day (YYYY-MM-DD) a timestamp falls on — a Spieltag is a day someone played. */
export function localDayKey(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export interface PlayDayAverage { dayKey: string; firstPlayedAt: number; average: number; games: number }

/** Average per play day, oldest first, limited to the most recent `maxDays` days that have games
 *  (days without games are skipped, not drawn as empty bars). */
export function averagesPerPlayDay(samples: readonly GameAverageSample[], maxDays = 12): PlayDayAverage[] {
  const byDay = new Map<string, { firstPlayedAt: number; sum: number; games: number }>();
  samples.forEach((s) => {
    const key = localDayKey(s.playedAt);
    const day = byDay.get(key);
    if (day) {
      day.sum += s.average;
      day.games += 1;
      day.firstPlayedAt = Math.min(day.firstPlayedAt, s.playedAt);
    } else {
      byDay.set(key, { firstPlayedAt: s.playedAt, sum: s.average, games: 1 });
    }
  });
  return Array.from(byDay.entries())
    .map(([dayKey, d]) => ({ dayKey, firstPlayedAt: d.firstPlayedAt, average: d.sum / d.games, games: d.games }))
    .sort((a, b) => a.dayKey.localeCompare(b.dayKey))
    .slice(-maxDays);
}

/** Bar heights in percent of the chart height. Averages of one player rarely move more than a
 *  few points, so a zero baseline would draw every bar the same height; the scale instead starts
 *  a little below the lowest value (padding at least 5 points, never below 0), and every bar
 *  keeps a 12% stub so the lowest day is still visible. Exact values go in the bar's label. */
export function barHeightPercents(values: readonly number[]): number[] {
  if (values.length === 0) return [];
  const max = Math.max(...values);
  const min = Math.min(...values);
  const floor = Math.max(0, min - Math.max(5, (max - min) * 0.5));
  const span = max - floor;
  if (span <= 0) return values.map(() => 100);
  return values.map((v) => Math.round(12 + 88 * ((v - floor) / span)));
}
