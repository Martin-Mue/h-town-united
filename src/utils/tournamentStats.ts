import { count180s, tonPlusCount, oneTwentyPlusCount, oneFortyPlusCount, oneSixtyPlusCount, average, computeCheckoutStats, type DartThrow } from "./dartStats";

export interface TournamentStatsLegRow {
  player_id: string | null;
  player_name: string;
  starting_score: number;
  throws: DartThrow[];
  won: boolean;
  /** Which game/match this leg belongs to, and its position within that match — both optional
   *  since most existing callers/tests only ever cared about per-dart tallies, not per-leg
   *  drill-down. Only needed for computeLegAveragesByGame below. */
  game_id?: string;
  leg_number?: number;
}

export interface ParticipantHighlight {
  key: string;
  name: string;
  /** Triple 15-20 — the "big" trebles that actually matter for a highlight reel, as opposed to
   *  every treble including e.g. T5. */
  bigTriples: number;
  bulls: number;
  oneEighties: number;
  /** Scoring tiers alongside 180 — visits scoring >=160/>=140/>=120/>=100 in a single turn,
   *  regardless of whether that turn won the leg. Deliberately NOT gated on `won`: these are
   *  scoring-power stats (how often does this player put up a big number), not checkout stats
   *  (did this player finish with a big number) — conflating the two was the previous design
   *  here, and made these tiers read as near-always-zero next to bigTriples/bulls since a winning
   *  big-number finish is comparatively rare while just scoring that much is common. */
  oneSixtyPlus: number;
  oneFortyPlus: number;
  oneTwentyPlus: number;
  oneHundredPlus: number;
  /** This player's own best checkout so far — the per-player counterpart to the tournament-wide
   *  topCheckout below (that one is "who holds the record right now", this is "what's each
   *  player's personal best"), same as how tournamentAverage coexists with the single leading-Ø
   *  headline. Only ever set on a leg this player actually won (a checkout, by definition, means
   *  finishing the leg). 0 if they haven't won a leg with a real checkout yet. */
  highestCheckout: number;
}

export interface TournamentHighlights {
  heatmapPoints: { u: number; v: number; points: number }[];
  participants: ParticipantHighlight[];
  /** Highest checkout of the whole tournament so far — null until at least one leg has been won. */
  topCheckout: { name: string; value: number } | null;
  /** Fewest darts to finish a leg so far (a "nine-darter"-style stat, not tied to any specific
   *  starting score) — null until at least one leg has been won. */
  shortestLeg: { name: string; darts: number } | null;
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

export interface GameLegAverage {
  player1Average: number;
  player2Average: number;
}

export interface GameAverageRow {
  gameId: string;
  player1Name: string;
  player1Average: number;
  player2Name: string;
  player2Average: number;
  /** Per-leg breakdown of this same match, in play order — absent/empty until attached by
   *  computeLegAveragesByGame (needs the raw leg rows, which computeTournamentAverages alone
   *  never sees). Never populated for a leg with no recorded throws at all. */
  legs?: GameLegAverage[];
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
  /** Games played in this tournament so far — shown next to every other column so a small
   *  sample size (e.g. one game before an early elimination) is visible at a glance instead of
   *  letting a lucky single-game stat look equivalent to one built on a full run. */
  gamesPlayed: number;
  bigTriples: number;
  bulls: number;
  oneEighties: number;
  oneSixtyPlus: number;
  oneFortyPlus: number;
  oneTwentyPlus: number;
  oneHundredPlus: number;
  highestCheckout: number;
}

const BIG_TRIPLE_NUMBERS = new Set([15, 16, 17, 18, 19, 20]);

/** Shared "biggest highlight first" ranking, used by both computeTournamentHighlights (dart-based
 *  tallies only) and mergeTournamentStats (which layers tournamentAverage on top as one more,
 *  final tiebreak) — one function so the two can't silently drift the way they already had here
 *  (the merged list had picked up a `bulls` tiebreak the highlights-only sort never got). */
function compareByHighlightMagnitude(
  a: { oneEighties: number; oneSixtyPlus: number; oneFortyPlus: number; oneTwentyPlus: number; oneHundredPlus: number; highestCheckout: number; bigTriples: number; bulls: number },
  b: typeof a,
): number {
  return (
    b.oneEighties - a.oneEighties || b.oneSixtyPlus - a.oneSixtyPlus || b.oneFortyPlus - a.oneFortyPlus ||
    b.oneTwentyPlus - a.oneTwentyPlus || b.oneHundredPlus - a.oneHundredPlus || b.highestCheckout - a.highestCheckout ||
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
  let topCheckout: { name: string; value: number } | null = null;
  let shortestLeg: { name: string; darts: number } | null = null;

  for (const leg of legs) {
    if (!Array.isArray(leg.throws) || leg.throws.length === 0) continue;
    const key = leg.player_id ?? leg.player_name;
    const entry = byKey.get(key) ?? {
      key, name: leg.player_name, bigTriples: 0, bulls: 0, oneEighties: 0,
      oneSixtyPlus: 0, oneFortyPlus: 0, oneTwentyPlus: 0, oneHundredPlus: 0, highestCheckout: 0,
    };

    for (const t of leg.throws) {
      if (typeof t.boardU === "number" && typeof t.boardV === "number") {
        heatmapPoints.push({ u: t.boardU, v: t.boardV, points: t.points });
      }
      if (t.multiplier === 3 && BIG_TRIPLE_NUMBERS.has(t.baseValue)) entry.bigTriples++;
      if (t.baseValue === 25) entry.bulls++;
    }
    entry.oneEighties += count180s(leg.throws);
    entry.oneSixtyPlus += oneSixtyPlusCount(leg.throws);
    entry.oneFortyPlus += oneFortyPlusCount(leg.throws);
    entry.oneTwentyPlus += oneTwentyPlusCount(leg.throws);
    entry.oneHundredPlus += tonPlusCount(leg.throws);

    if (leg.won) {
      const { highestCheckout } = computeCheckoutStats(leg.throws, leg.starting_score);
      if (highestCheckout > entry.highestCheckout) entry.highestCheckout = highestCheckout;
      if (highestCheckout > 0 && (!topCheckout || highestCheckout > topCheckout.value)) {
        topCheckout = { name: leg.player_name, value: highestCheckout };
      }
      if (!shortestLeg || leg.throws.length < shortestLeg.darts) {
        shortestLeg = { name: leg.player_name, darts: leg.throws.length };
      }
    }

    byKey.set(key, entry);
  }

  const participants = [...byKey.values()]
    .filter((p) => p.bigTriples || p.bulls || p.oneEighties || p.oneHundredPlus)
    .sort(compareByHighlightMagnitude);

  return { heatmapPoints, participants, topCheckout, shortestLeg };
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

/**
 * Groups a tournament's raw leg rows into per-leg average pairs, one ordered list per game_id —
 * the drill-down behind "average per leg" on each row of the game-average list. Needs real
 * per-dart throws plus game_id/leg_number (same data the public_tournament_highlights RPC and
 * game_legs both carry) — a leg missing any of those (no throws recorded, or a caller that never
 * asked for them) is simply skipped rather than guessed at. Side (player1 vs player2) is resolved
 * against the matching `games` row's own player1_id/player1_name rather than array order or a
 * `player_index` column, since this is the only place that already has both pieces of data at
 * hand and it keeps TournamentStatsLegRow itself free of game-level fields.
 */
export function computeLegAveragesByGame(
  legs: TournamentStatsLegRow[],
  games: TournamentStatsGameRow[],
): Map<string, GameLegAverage[]> {
  const gameById = new Map(games.map((g) => [g.id, g]));
  const byGame = new Map<string, Map<number, Partial<GameLegAverage>>>();

  for (const l of legs) {
    if (!l.game_id || l.leg_number === undefined || !Array.isArray(l.throws) || l.throws.length === 0) continue;
    const g = gameById.get(l.game_id);
    if (!g) continue;
    const isPlayer1 = l.player_id ? l.player_id === g.player1_id : l.player_name === g.player1_name;
    const perLegNum = byGame.get(l.game_id) ?? new Map<number, Partial<GameLegAverage>>();
    const entry = perLegNum.get(l.leg_number) ?? {};
    const avg = average(l.throws);
    if (isPlayer1) entry.player1Average = avg; else entry.player2Average = avg;
    perLegNum.set(l.leg_number, entry);
    byGame.set(l.game_id, perLegNum);
  }

  const result = new Map<string, GameLegAverage[]>();
  for (const [gameId, perLegNum] of byGame) {
    const legNumbers = [...perLegNum.keys()].sort((a, b) => a - b);
    result.set(gameId, legNumbers.map((n) => {
      const e = perLegNum.get(n)!;
      return { player1Average: e.player1Average ?? 0, player2Average: e.player2Average ?? 0 };
    }));
  }
  return result;
}

/** Combines the two independent computations above into the single per-participant row the UI
 *  actually renders. Someone who only appears in one side (e.g. no highlight-worthy darts at
 *  all, which is the common case for a hand-scored tournament) still gets a full row — the other
 *  side's fields just default to 0, not dropped from the table entirely. */
export function mergeTournamentStats(highlights: TournamentHighlights, averages: TournamentAverages): ParticipantStatsRow[] {
  const emptyHighlights = { bigTriples: 0, bulls: 0, oneEighties: 0, oneSixtyPlus: 0, oneFortyPlus: 0, oneTwentyPlus: 0, oneHundredPlus: 0, highestCheckout: 0 };
  const byKey = new Map<string, ParticipantStatsRow>();
  for (const p of averages.participants) {
    byKey.set(p.key, { key: p.key, name: p.name, tournamentAverage: p.tournamentAverage, gamesPlayed: p.gamesPlayed, ...emptyHighlights });
  }
  for (const h of highlights.participants) {
    const entry = byKey.get(h.key) ?? { key: h.key, name: h.name, tournamentAverage: 0, gamesPlayed: 0, ...emptyHighlights };
    entry.bigTriples = h.bigTriples;
    entry.bulls = h.bulls;
    entry.oneEighties = h.oneEighties;
    entry.oneSixtyPlus = h.oneSixtyPlus;
    entry.oneFortyPlus = h.oneFortyPlus;
    entry.oneTwentyPlus = h.oneTwentyPlus;
    entry.oneHundredPlus = h.oneHundredPlus;
    entry.highestCheckout = h.highestCheckout;
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
