import {
  BYE,
  isLiveSnapshotFresh,
  totalRoundsOf,
  type Match,
  type RoundRobinMatch,
} from "./tournament";

/**
 * Nothing in this schema ever records wall-clock start/finish times for a leg or match —
 * games.played_at/created_at and game_legs.created_at are all written together, at match-END, by
 * saveGameRecord (see gameSync.ts). The only real historical signals are how many darts a leg
 * actually took and how many legs a match actually took, both aggregated server-side by the
 * admin_tournament_forecast_* RPCs (see the migration for why server-side). Everything below turns
 * those two numbers into a seconds estimate — there is no ground truth to validate against, only
 * plausibility, which is exactly why `secondsPerDart` is an admin-adjustable input, not a constant.
 */

/** Subset of Tournament.tsx's own (unexported) TournamentRecord shape — just the fields this
 *  forecast needs, redeclared locally rather than importing a type that page keeps private. */
export interface ForecastTournament {
  id: string;
  name: string;
  mode: string; // "ko" | "round-robin"
  players: string[];
  bracket: Match[] | RoundRobinMatch[];
  game_mode?: string;
  best_of_legs?: number;
  round_configs?: { mode: string; bestOf: number }[];
  boards?: number;
}

export interface ModeStatsRow {
  mode: string;
  best_of_legs: number;
  avg_legs_per_match: number | null;
  match_count: number;
  avg_darts_per_leg: number | null;
  leg_count: number;
}

export interface PlayerModeStatsRow {
  player_name: string;
  mode: string;
  avg_darts_per_leg: number;
  leg_count: number;
}

interface SampledAverage {
  avg: number;
  sampleSize: number;
}

export interface ModeStatsIndex {
  /** Keyed `${mode}:${bestOfLegs}` — match length depends on the format, not just the mode. */
  legsPerMatch: Map<string, SampledAverage>;
  /** Keyed by mode alone — how long a leg runs doesn't depend on the match's best-of format. */
  dartsPerLeg: Map<string, SampledAverage>;
}

const normalizeMode = (mode: string) => mode.toLowerCase();

/** Only ever a last resort — used when the club has literally never played this mode before, so
 *  there's zero real data to fall back to. Deliberately rough; the point is "don't show nothing",
 *  not "be precise for a mode nobody's tried yet". */
const FALLBACK_DARTS_PER_LEG: Record<string, number> = { "501": 15, "301": 10, cricket: 15 };
const fallbackDartsPerLeg = (mode: string) => FALLBACK_DARTS_PER_LEG[mode] ?? 15;

/** Halfway between "one side sweeps it" (legsToWin) and "it goes the distance" (bestOf) — used
 *  only when this exact (mode, bestOf) combination has never actually been played, so there's no
 *  real legs-per-match average to use instead. */
const fallbackLegsPerMatch = (bestOf: number) => Math.round((Math.ceil(bestOf / 2) + bestOf) / 2);

export function buildModeStatsIndex(rows: ModeStatsRow[]): ModeStatsIndex {
  const legsPerMatch = new Map<string, SampledAverage>();
  const dartsPerLeg = new Map<string, SampledAverage>();
  for (const r of rows) {
    const mode = normalizeMode(r.mode);
    if (r.avg_legs_per_match != null) {
      legsPerMatch.set(`${mode}:${r.best_of_legs}`, { avg: Number(r.avg_legs_per_match), sampleSize: Number(r.match_count) });
    }
    if (r.avg_darts_per_leg != null && !dartsPerLeg.has(mode)) {
      dartsPerLeg.set(mode, { avg: Number(r.avg_darts_per_leg), sampleSize: Number(r.leg_count) });
    }
  }
  return { legsPerMatch, dartsPerLeg };
}

export type PlayerStatsIndex = Map<string, SampledAverage>;

export function buildPlayerStatsIndex(rows: PlayerModeStatsRow[]): PlayerStatsIndex {
  const map: PlayerStatsIndex = new Map();
  for (const r of rows) {
    map.set(`${r.player_name}:${normalizeMode(r.mode)}`, { avg: Number(r.avg_darts_per_leg), sampleSize: Number(r.leg_count) });
  }
  return map;
}

/** Below this many recorded legs, a player's own average is too noisy to trust over the mode-wide
 *  one — falls back to the broader number instead of a couple of fluke legs. */
const MIN_PLAYER_SAMPLE = 5;

/** Darts-per-leg for a specific upcoming/live match: averages whichever of the two named players
 *  have enough of their own history in this mode, falling back to the club-wide mode average (and,
 *  failing that, the hardcoded guess) for anyone too new or entirely unknown (a guest name). */
function dartsPerLegFor(
  mode: string,
  players: (string | undefined)[],
  modeStats: ModeStatsIndex,
  playerStats: PlayerStatsIndex,
): number {
  const known = players
    .filter((p): p is string => !!p && p !== BYE)
    .map((p) => playerStats.get(`${p}:${mode}`))
    .filter((s): s is SampledAverage => !!s && s.sampleSize >= MIN_PLAYER_SAMPLE);
  if (known.length > 0) return known.reduce((sum, s) => sum + s.avg, 0) / known.length;
  const global = modeStats.dartsPerLeg.get(mode);
  return global ? global.avg : fallbackDartsPerLeg(mode);
}

/** A live match already has some legs decided (LiveSnapshot.legs1/legs2) — needs fewer REMAINING
 *  legs than the full match average, not the average from scratch. */
function remainingLegsFor(match: { live?: Match["live"] }, legsPerMatch: number, bestOf: number): number {
  if (!isLiveSnapshotFresh(match.live)) return legsPerMatch;
  const legsToWin = Math.ceil(bestOf / 2);
  const decided = Math.max(match.live!.legs1, match.live!.legs2);
  return Math.max(1, Math.min(legsPerMatch, legsToWin - decided));
}

export interface RoundForecast {
  /** 1-based round number for KO (0 = preliminary round); 1-based synthetic wave index for
   *  round-robin, which has no real "round" concept at all — see roundRobinBoardCards. */
  round: number;
  label: string;
  /** Raw resolved mode string ("501" | "301" | "Cricket" | "Extern"), not lowercased — for display. */
  mode: string;
  matchCount: number;
  /** How many sequential board-waves this round needs: ceil(matchCount / boards). */
  waves: number;
  /** null when mode is "Extern" — no live game is ever created for those, so there's categorically
   *  no historical data this app could ever have for them. */
  estimatedSeconds: number | null;
}

export interface TournamentForecast {
  tournamentId: string;
  /** null once any remaining round/wave is an unestimatable "Extern" round — a partial sum would
   *  look precise while actually being a silent undercount. */
  totalEstimatedSeconds: number | null;
  hasExternGap: boolean;
  rounds: RoundForecast[];
}

const germanRoundLabel = (round: number, total: number): string => {
  if (round === 0) return "Vorrunde";
  if (round === total) return "Finale";
  if (round === total - 1) return "Halbfinale";
  if (round === total - 2) return "Viertelfinale";
  if (round === total - 3) return "Achtelfinale";
  if (round === total - 4) return "Runde der letzten 32";
  if (round === total - 5) return "Runde der letzten 64";
  return `Runde ${round}`;
};

function forecastKo(
  t: ForecastTournament,
  secondsPerDart: number,
  modeStats: ModeStatsIndex,
  playerStats: PlayerStatsIndex,
  resolveMode: (round: number) => string,
  resolveBestOf: (round: number) => number,
): TournamentForecast {
  const bracket = t.bracket as Match[];
  const boards = Math.max(1, t.boards || 2);
  const totalRounds = totalRoundsOf(bracket);
  const hasPrelim = bracket.some((m) => m.round === 0);
  const rounds: RoundForecast[] = [];
  let hasExternGap = false;

  for (let r = hasPrelim ? 0 : 1; r <= totalRounds; r++) {
    // Not filtered by isPlayable: a not-yet-reachable later round's slots still exist in the
    // bracket array (created upfront), just with player1/player2 still empty — undecided (no
    // winner) either way, and exactly the count of real matches that round will need.
    const remaining = bracket.filter((m) => m.round === r && !m.winner);
    if (remaining.length === 0) continue;

    const rawMode = resolveMode(r);
    const bestOf = resolveBestOf(r);
    const waves = Math.ceil(remaining.length / boards);
    const label = germanRoundLabel(r, totalRounds);

    if (rawMode === "Extern") {
      hasExternGap = true;
      rounds.push({ round: r, label, mode: rawMode, matchCount: remaining.length, waves, estimatedSeconds: null });
      continue;
    }

    const mode = normalizeMode(rawMode);
    const legsPerMatch = modeStats.legsPerMatch.get(`${mode}:${bestOf}`)?.avg ?? fallbackLegsPerMatch(bestOf);
    let matchSecondsTotal = 0;
    for (const m of remaining) {
      const dartsPerLeg = dartsPerLegFor(mode, [m.player1, m.player2], modeStats, playerStats);
      const legs = remainingLegsFor(m, legsPerMatch, bestOf);
      matchSecondsTotal += legs * dartsPerLeg * secondsPerDart;
    }
    // Matches within a round play out as `waves` sequential groups of up to `boards` concurrent
    // matches (buildSchedule's own model) — approximated here as the round's mean match duration
    // per wave, since which exact matches share a wave isn't decided yet for a future round.
    const meanMatchSeconds = matchSecondsTotal / remaining.length;
    rounds.push({ round: r, label, mode: rawMode, matchCount: remaining.length, waves, estimatedSeconds: waves * meanMatchSeconds });
  }

  const total = hasExternGap ? null : rounds.reduce((sum, r) => sum + (r.estimatedSeconds ?? 0), 0);
  return { tournamentId: t.id, totalEstimatedSeconds: total, hasExternGap, rounds };
}

/** Round-robin (RoundRobinMatch[]) has no `round` field at all — matches are just a flat list. The
 *  closest existing UI concept is roundRobinBoardCards' "now"/"onDeck" chunking by board count;
 *  this extends that same idea (array order, chunked by `boards`) across ALL remaining matches
 *  instead of just the next two, labeling each chunk a synthetic "wave" rather than a real round. */
function forecastRoundRobin(
  t: ForecastTournament,
  secondsPerDart: number,
  modeStats: ModeStatsIndex,
  playerStats: PlayerStatsIndex,
): TournamentForecast {
  const matches = t.bracket as RoundRobinMatch[];
  const boards = Math.max(1, t.boards || 2);
  const pending = matches.filter((m) => !m.played);
  const rawMode = t.game_mode || "501";
  const bestOf = t.best_of_legs || 1;

  if (pending.length === 0) return { tournamentId: t.id, totalEstimatedSeconds: 0, hasExternGap: false, rounds: [] };

  if (rawMode === "Extern") {
    const waves = Math.ceil(pending.length / boards);
    return {
      tournamentId: t.id,
      totalEstimatedSeconds: null,
      hasExternGap: true,
      rounds: [{ round: 1, label: "Alle verbleibenden Spiele", mode: rawMode, matchCount: pending.length, waves, estimatedSeconds: null }],
    };
  }

  const mode = normalizeMode(rawMode);
  const legsPerMatch = modeStats.legsPerMatch.get(`${mode}:${bestOf}`)?.avg ?? fallbackLegsPerMatch(bestOf);
  const rounds: RoundForecast[] = [];

  for (let i = 0, wave = 1; i < pending.length; i += boards, wave++) {
    const waveMatches = pending.slice(i, i + boards);
    let waveSecondsTotal = 0;
    for (const m of waveMatches) {
      const dartsPerLeg = dartsPerLegFor(mode, [m.player1, m.player2], modeStats, playerStats);
      const legs = remainingLegsFor(m, legsPerMatch, bestOf);
      waveSecondsTotal += legs * dartsPerLeg * secondsPerDart;
    }
    rounds.push({
      round: wave,
      label: `Welle ${wave}`,
      mode: rawMode,
      matchCount: waveMatches.length,
      waves: 1,
      estimatedSeconds: waveSecondsTotal / waveMatches.length,
    });
  }

  const total = rounds.reduce((sum, r) => sum + (r.estimatedSeconds ?? 0), 0);
  return { tournamentId: t.id, totalEstimatedSeconds: total, hasExternGap: false, rounds };
}

/** round_configs[i] holds round (i+1)'s override; the preliminary round (round 0) is appended one
 *  slot past the last real round instead of renumbering everything — exact mirror of
 *  Tournament.tsx's private roundConfigIndex/resolveRoundMode/resolveRoundBestOf (not exported
 *  from there, so redeclared here rather than risking a change to that already-fragile file). */
function makeRoundResolvers(t: ForecastTournament) {
  const bracket = t.bracket as Match[];
  const configIndex = (round: number) => (round === 0 ? totalRoundsOf(bracket) : round - 1);
  return {
    mode: (round: number) => (t.round_configs || [])[configIndex(round)]?.mode || t.game_mode || "501",
    bestOf: (round: number) => (t.round_configs || [])[configIndex(round)]?.bestOf || t.best_of_legs || 3,
  };
}

export function forecastTournament(
  t: ForecastTournament,
  secondsPerDart: number,
  modeStats: ModeStatsIndex,
  playerStats: PlayerStatsIndex,
): TournamentForecast {
  if (t.mode === "round-robin") return forecastRoundRobin(t, secondsPerDart, modeStats, playerStats);
  const resolvers = makeRoundResolvers(t);
  return forecastKo(t, secondsPerDart, modeStats, playerStats, resolvers.mode, resolvers.bestOf);
}

export function formatDuration(seconds: number): string {
  const totalMinutes = Math.max(1, Math.round(seconds / 60));
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h === 0) return `${m} Min`;
  if (m === 0) return `${h} Std`;
  return `${h} Std ${m} Min`;
}

export function formatEta(seconds: number): string {
  return new Date(Date.now() + seconds * 1000).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
}
