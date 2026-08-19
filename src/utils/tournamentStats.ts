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
