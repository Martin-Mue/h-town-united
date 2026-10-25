import { BYE, isRealPlayer, type Match, type RoundRobinMatch } from "./tournament";
import { splitTeamName } from "./tournamentTeams";
import type { GameState } from "@/types/game";

/** The slice of a tournament row the start page needs. */
export interface TournamentLite {
  id: string;
  name: string;
  mode: string;
  status: string;
  bracket: unknown;
  public_view?: boolean | null;
  public_slug?: string | null;
}

export interface NextTournamentMatch {
  tournamentId: string;
  tournamentName: string;
  /** Null while the opponent is not decided yet (the earlier match is still running). */
  opponent: string | null;
  /** Bracket round (1 = first main round); null for round-robin. */
  round: number | null;
  totalRounds: number | null;
}

/** An entry plays in a match when it IS the entry or, for a doubles team "Anna & Ben", one of its two members. */
const isMine = (entry: string | undefined, myName: string): boolean =>
  !!entry && (entry === myName || splitTeamName(entry).includes(myName));

/**
 * The next tournament match of one player across the running tournaments: the lowest unfinished round of a K.O.
 * bracket (the opponent may not be known yet), or the first unplayed pairing of a round-robin. A tournament the
 * player is out of, or whose matches are all done, gives nothing.
 */
export function findNextTournamentMatch(tournaments: TournamentLite[], myName: string): NextTournamentMatch | null {
  if (!myName.trim()) return null;
  let best: (NextTournamentMatch & { order: number }) | null = null;
  for (const t of tournaments) {
    if (t.status !== "active" || !Array.isArray(t.bracket)) continue;
    if (t.mode === "round-robin") {
      const m = (t.bracket as RoundRobinMatch[]).find((x) => !x.played && (isMine(x.player1, myName) || isMine(x.player2, myName)));
      if (m) {
        const opponent = isMine(m.player1, myName) ? m.player2 : m.player1;
        best ??= { tournamentId: t.id, tournamentName: t.name, opponent, round: null, totalRounds: null, order: 0 };
      }
      continue;
    }
    const matches = t.bracket as Match[];
    const open = matches
      .filter((m) => !m.winner && (isMine(m.player1, myName) || isMine(m.player2, myName)) && m.player1 !== BYE && m.player2 !== BYE)
      .sort((a, b) => a.round - b.round);
    const mine = open[0];
    if (!mine) continue;
    const other = isMine(mine.player1, myName) ? mine.player2 : mine.player1;
    const totalRounds = Math.max(...matches.map((m) => m.round));
    // the earlier the round, the sooner the player is on — keep the soonest across tournaments
    const candidate = { tournamentId: t.id, tournamentName: t.name, opponent: isRealPlayer(other) ? other! : null, round: mine.round, totalRounds, order: mine.round };
    if (!best || candidate.order < best.order) best = candidate;
  }
  if (!best) return null;
  const { order: _order, ...result } = best;
  return result;
}

export interface ResumableGame {
  /** "Martin 276 : 376 Bot" for two sides, "4 Spieler" style handled by the caller via `sides`. */
  names: string[];
  scores: number[];
  isCricket: boolean;
  activeName: string;
}

/** What the "continue your game" tile shows for a saved, unfinished game; null when nothing is worth resuming. */
export function describeResumableGame(game: GameState | null | undefined): ResumableGame | null {
  if (!game || game.isFinished || !game.players?.length) return null;
  const isCricket = game.mode === "cricket";
  const sides = game.teams ? game.teams.map((t) => t.name) : game.players.map((p) => p.name);
  const scores = isCricket
    ? (game.cricket ?? []).map((c) => c.points)
    : game.currentLeg.remaining;
  const activeName = game.players[game.currentPlayerIndex]?.name ?? "";
  return { names: sides, scores: scores.slice(0, sides.length), isCricket, activeName };
}
