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
  /** Winning-leg checkouts >= 100, INCLUDING the 170s below — "ton-plus" is the broader category
   *  a 170 finish is still a member of, not a separate bucket that would otherwise undercount it. */
  tonPlusFinishes: number;
  /** Winning-leg checkouts of exactly 170 — the maximum possible, always worth calling out by itself. */
  maxCheckouts: number;
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
  tonPlusFinishes: number;
  maxCheckouts: number;
}

const BIG_TRIPLE_NUMBERS = new Set([16, 17, 18, 19, 20]);

/**
 * Pools every dart from a tournament's legs into a board-wide heatmap plus a per-participant
 * highlight tally (big triples, bulls, 180s, ton-plus/maximum finishes) — the handful of stats
 * exciting enough to show on a spectator screen, not a full statistics breakdown. Grouped by
 * `player_id ?? player_name` so guests without a club profile still get their own row.
 */
export function computeTournamentHighlights(legs: TournamentStatsLegRow[]): TournamentHighlights {
  const heatmapPoints: { u: number; v: number; points: number }[] = [];
  const byKey = new Map<string, ParticipantHighlight>();

  for (const leg of legs) {
    if (!Array.isArray(leg.throws) || leg.throws.length === 0) continue;
    const key = leg.player_id ?? leg.player_name;
    const entry = byKey.get(key) ?? { key, name: leg.player_name, bigTriples: 0, bulls: 0, oneEighties: 0, tonPlusFinishes: 0, maxCheckouts: 0 };

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
      if (highestCheckout >= 100) entry.tonPlusFinishes++;
      if (highestCheckout === 170) entry.maxCheckouts++;
    }

    byKey.set(key, entry);
  }

  const participants = [...byKey.values()]
    .filter((p) => p.bigTriples || p.bulls || p.oneEighties || p.tonPlusFinishes || p.maxCheckouts)
    .sort((a, b) => b.oneEighties - a.oneEighties || b.maxCheckouts - a.maxCheckouts || b.tonPlusFinishes - a.tonPlusFinishes || b.bigTriples - a.bigTriples);

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
  const byKey = new Map<string, ParticipantStatsRow>();
  for (const p of averages.participants) {
    byKey.set(p.key, { key: p.key, name: p.name, tournamentAverage: p.tournamentAverage, bigTriples: 0, bulls: 0, oneEighties: 0, tonPlusFinishes: 0, maxCheckouts: 0 });
  }
  for (const h of highlights.participants) {
    const entry = byKey.get(h.key) ?? { key: h.key, name: h.name, tournamentAverage: 0, bigTriples: 0, bulls: 0, oneEighties: 0, tonPlusFinishes: 0, maxCheckouts: 0 };
    entry.bigTriples = h.bigTriples;
    entry.bulls = h.bulls;
    entry.oneEighties = h.oneEighties;
    entry.tonPlusFinishes = h.tonPlusFinishes;
    entry.maxCheckouts = h.maxCheckouts;
    byKey.set(h.key, entry);
  }
  return [...byKey.values()].sort((a, b) => b.tournamentAverage - a.tournamentAverage || b.oneEighties - a.oneEighties);
}
