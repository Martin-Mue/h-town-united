import { count180s, computeCheckoutStats, type DartThrow } from "./dartStats";

export interface TournamentStatsLegRow {
  player_id: string | null;
  player_name: string;
  starting_score: number;
  throws: DartThrow[];
  won: boolean;
}

export interface ParticipantHighlight {
  key: string;
  name: string;
  /** Triple 16-20 — the "big" trebles that actually matter for a highlight reel, as opposed to
   *  every treble including e.g. T5. */
  bigTriples: number;
  bulls: number;
  oneEighties: number;
  /** Winning-leg checkout THRESHOLDS — each is cumulative ("at least X"), so a 170 finish counts
   *  toward all five, not just checkout170. Mirrors how darts players actually talk about
   *  checkouts ("a 140+", "a ton-plus"), and keeps every tier from undercounting the ones above it. */
  checkout100Plus: number;
  checkout120Plus: number;
  checkout140Plus: number;
  checkout160Plus: number;
  /** Exactly 170 — the maximum possible checkout, universally nicknamed "Big Fish". Already
   *  included in checkout160Plus above; called out on its own since it's the one score every
   *  darts player instantly recognizes. */
  checkout170: number;
}

export interface TournamentHighlights {
  heatmapPoints: { u: number; v: number; points: number }[];
  participants: ParticipantHighlight[];
}

export interface TournamentStatsGameRow {
  id: string;
  player1_id: string | null;
  player1_name: string;
  player1_average: number;
  player2_id: string | null;
  player2_name: string;
  player2_average: number;
}

export interface ParticipantAverage {
  key: string;
  name: string;
  tournamentAverage: number;
  gamesPlayed: number;
}

export interface GameAverageRow {
  gameId: string;
  player1Name: string;
  player1Average: number;
  player2Name: string;
  player2Average: number;
}

export interface TournamentAverages {
  participants: ParticipantAverage[];
  games: GameAverageRow[];
}

/** One row per participant, merging computeTournamentHighlights' dart-based tallies with
 *  computeTournamentAverages' game-based averages — the two are independent (a heatmap/180-count
 *  needs real per-dart data, an average is already stored per game regardless of how it was
 *  scored), so this is the only place they actually come together for display. */
export interface ParticipantStatsRow {
  key: string;
  name: string;
  tournamentAverage: number;
  bigTriples: number;
  bulls: number;
  oneEighties: number;
  checkout100Plus: number;
  checkout120Plus: number;
  checkout140Plus: number;
  checkout160Plus: number;
  checkout170: number;
}

const BIG_TRIPLE_NUMBERS = new Set([16, 17, 18, 19, 20]);

/** Shared "biggest highlight first" ranking, used by both computeTournamentHighlights (dart-based
 *  tallies only) and mergeTournamentStats (which layers tournamentAverage on top as one more,
 *  final tiebreak) — one function so the two can't silently drift the way they already had here
 *  (the merged list had picked up a `bulls` tiebreak the highlights-only sort never got). */
function compareByHighlightMagnitude(
  a: { oneEighties: number; checkout170: number; checkout160Plus: number; checkout140Plus: number; checkout120Plus: number; checkout100Plus: number; bigTriples: number; bulls: number },
  b: typeof a,
): number {
  return (
    b.oneEighties - a.oneEighties || b.checkout170 - a.checkout170 || b.checkout160Plus - a.checkout160Plus ||
    b.checkout140Plus - a.checkout140Plus || b.checkout120Plus - a.checkout120Plus || b.checkout100Plus - a.checkout100Plus ||
    b.bigTriples - a.bigTriples || b.bulls - a.bulls
  );
}

/**
 * Pools every dart from a tournament's legs into a board-wide heatmap plus a per-participant
 * highlight tally (big triples, bulls, 180s, checkout tiers) — the handful of stats exciting
 * enough to show on a spectator screen, not a full statistics breakdown. Grouped by
 * `player_id ?? player_name` so guests without a club profile still get their own row.
 */
export function computeTournamentHighlights(legs: TournamentStatsLegRow[]): TournamentHighlights {
  const heatmapPoints: { u: number; v: number; points: number }[] = [];
  const byKey = new Map<string, ParticipantHighlight>();

  for (const leg of legs) {
    if (!Array.isArray(leg.throws) || leg.throws.length === 0) continue;
    const key = leg.player_id ?? leg.player_name;
    const entry = byKey.get(key) ?? {
      key, name: leg.player_name, bigTriples: 0, bulls: 0, oneEighties: 0,
      checkout100Plus: 0, checkout120Plus: 0, checkout140Plus: 0, checkout160Plus: 0, checkout170: 0,
    };

    for (const t of leg.throws) {
      if (typeof t.boardU === "number" && typeof t.boardV === "number") {
        heatmapPoints.push({ u: t.boardU, v: t.boardV, points: t.points });
      }
      if (t.multiplier === 3 && BIG_TRIPLE_NUMBERS.has(t.baseValue)) entry.bigTriples++;
      if (t.baseValue === 25) entry.bulls++;
    }
    entry.oneEighties += count180s(leg.throws);

    if (leg.won) {
      const { highestCheckout } = computeCheckoutStats(leg.throws, leg.starting_score);
      if (highestCheckout >= 100) entry.checkout100Plus++;
      if (highestCheckout >= 120) entry.checkout120Plus++;
      if (highestCheckout >= 140) entry.checkout140Plus++;
      if (highestCheckout >= 160) entry.checkout160Plus++;
      if (highestCheckout === 170) entry.checkout170++;
    }

    byKey.set(key, entry);
  }

  const participants = [...byKey.values()]
    .filter((p) => p.bigTriples || p.bulls || p.oneEighties || p.checkout100Plus)
    .sort(compareByHighlightMagnitude);

  return { heatmapPoints, participants };
}

/**
 * Per-game averages already exist on each `games` row (computed the same way everywhere else in
 * the app) — no new aggregation needed there, just pooled per participant as a MEAN of their own
 * game averages (matching the app-wide convention — see Statistics.tsx's filteredPlayerStats
 * comment on why "mean of per-game averages", not a raw pooled-dart average). Needs no per-dart
 * data at all, so this works identically whether the tournament was scored by camera or entirely
 * by hand — unlike computeTournamentHighlights above, which needs real per-dart records.
 */
export function computeTournamentAverages(games: TournamentStatsGameRow[]): TournamentAverages {
  const byKey = new Map<string, { name: string; averages: number[] }>();
  const add = (key: string, name: string, avg: number) => {
    if (!avg) return;
    const entry = byKey.get(key) ?? { name, averages: [] };
    entry.averages.push(avg);
    byKey.set(key, entry);
  };
  for (const g of games) {
    add(g.player1_id ?? g.player1_name, g.player1_name, Number(g.player1_average));
    add(g.player2_id ?? g.player2_name, g.player2_name, Number(g.player2_average));
  }

  const participants = [...byKey.entries()]
    .map(([key, { name, averages }]) => ({
      key, name, gamesPlayed: averages.length,
      tournamentAverage: averages.reduce((s, a) => s + a, 0) / averages.length,
    }))
    .sort((a, b) => b.tournamentAverage - a.tournamentAverage);

  const gameRows: GameAverageRow[] = games.map((g) => ({
    gameId: g.id,
    player1Name: g.player1_name, player1Average: Number(g.player1_average),
    player2Name: g.player2_name, player2Average: Number(g.player2_average),
  }));

  return { participants, games: gameRows };
}

/** Combines the two independent computations above into the single per-participant row the UI
 *  actually renders. Someone who only appears in one side (e.g. no highlight-worthy darts at
 *  all, which is the common case for a hand-scored tournament) still gets a full row — the other
 *  side's fields just default to 0, not dropped from the table entirely. */
export function mergeTournamentStats(highlights: TournamentHighlights, averages: TournamentAverages): ParticipantStatsRow[] {
  const emptyHighlights = { bigTriples: 0, bulls: 0, oneEighties: 0, checkout100Plus: 0, checkout120Plus: 0, checkout140Plus: 0, checkout160Plus: 0, checkout170: 0 };
  const byKey = new Map<string, ParticipantStatsRow>();
  for (const p of averages.participants) {
    byKey.set(p.key, { key: p.key, name: p.name, tournamentAverage: p.tournamentAverage, ...emptyHighlights });
  }
  for (const h of highlights.participants) {
    const entry = byKey.get(h.key) ?? { key: h.key, name: h.name, tournamentAverage: 0, ...emptyHighlights };
    entry.bigTriples = h.bigTriples;
    entry.bulls = h.bulls;
    entry.oneEighties = h.oneEighties;
    entry.checkout100Plus = h.checkout100Plus;
    entry.checkout120Plus = h.checkout120Plus;
    entry.checkout140Plus = h.checkout140Plus;
    entry.checkout160Plus = h.checkout160Plus;
    entry.checkout170 = h.checkout170;
    byKey.set(h.key, entry);
  }
  // Ranked by highlight magnitude, biggest first — this is the Highlights table, not the
  // leaderboard, so someone with real highlight-worthy darts (even a single 180) belongs above
  // someone who just has a higher average but nothing highlight-worthy at all. tournamentAverage
  // is one more tiebreak on top of compareByHighlightMagnitude, not the primary key.
  return [...byKey.values()].sort((a, b) => compareByHighlightMagnitude(a, b) || b.tournamentAverage - a.tournamentAverage);
}

export type ParticipantSortMode = "alpha" | "average";

/** Orders a tournament's player-name list for display — shared by Tournament.tsx's "Teilnehmer
 *  verwalten" and PublicTournament.tsx's live Teilnehmer grid so the two sorts can't drift apart
 *  the way the checkout-tier ranking already had. "average" ranks by Ø tournament average, best
 *  first; anyone with no average yet (still loading, or hasn't played a scored leg) sorts after
 *  everyone who has one rather than mixing in at 0 — same alphabetical order either way among
 *  people who tie, so the list doesn't visibly shuffle position as more averages arrive. */
export function sortParticipants(
  players: string[],
  mode: ParticipantSortMode,
  averages: TournamentAverages | null,
): string[] {
  if (mode === "alpha") return [...players].sort((a, b) => a.localeCompare(b));
  const averageFor = (name: string) =>
    averages?.participants.find((pa) => pa.key === name || pa.name === name)?.tournamentAverage || 0;
  return [...players].sort((a, b) => averageFor(b) - averageFor(a) || a.localeCompare(b));
}
