import { isPlayable, isRealPlayer, type Match, type RoundRobinMatch } from "./tournament";
import { splitTeamName } from "./tournamentTeams";

/** The slice of a tournament row the statistics need. */
export interface TournamentForStats {
  id: string;
  name: string;
  mode: string;
  created_at: string;
  bracket: unknown;
}

/** A decided tournament match that has no saved game behind it (the winner was tapped in the bracket by hand). */
export interface ManualTournamentResult {
  key: string;
  tournamentName: string;
  /** The tournament's date — a manually tapped match carries no time of its own. */
  date: string;
  player1: string;
  player2: string;
  winner: string;
}

/**
 * Every decided match of the given tournaments for which no game was saved. Matches played live produce a game (linked
 * by tournament id + match id, see gameSync.ts) that the statistics already count; only the rest has to be taken from
 * the bracket, otherwise a tournament win decided by hand never shows up in anyone's record.
 * `savedMatchKeys` holds `${tournament_id}:${match_id}` of every saved game that belongs to a tournament match.
 */
export function manualTournamentResults(tournaments: TournamentForStats[], savedMatchKeys: ReadonlySet<string>): ManualTournamentResult[] {
  const out: ManualTournamentResult[] = [];
  for (const t of tournaments) {
    if (!Array.isArray(t.bracket)) continue;
    if (t.mode === "round-robin") {
      for (const m of t.bracket as RoundRobinMatch[]) {
        if (!m.played || !isRealPlayer(m.winner) || !isRealPlayer(m.player1) || !isRealPlayer(m.player2)) continue;
        const key = `${t.id}:${m.id}`;
        if (!savedMatchKeys.has(key)) out.push({ key, tournamentName: t.name, date: t.created_at, player1: m.player1, player2: m.player2, winner: m.winner! });
      }
      continue;
    }
    for (const m of t.bracket as Match[]) {
      // a walkover after a withdrawal was never played
      if (!isPlayable(m) || !isRealPlayer(m.winner) || m.walkover) continue;
      const key = `${t.id}:${m.id}`;
      if (!savedMatchKeys.has(key)) out.push({ key, tournamentName: t.name, date: t.created_at, player1: m.player1!, player2: m.player2!, winner: m.winner! });
    }
  }
  return out;
}

/**
 * Reads the two leg fields of the result dialog. The winner is whoever has more legs, so nobody has to say first
 * who won. Null while a field is empty or not a whole number, and for a level score (a match has a winner).
 */
export function resultFromLegs(player1: string, player2: string, legs1: string, legs2: string): { winner: string; score1: number; score2: number } | null {
  const [score1, score2] = [legs1, legs2].map((text) => (text.trim() === "" ? NaN : Number(text)));
  if (!Number.isInteger(score1) || !Number.isInteger(score2) || score1 < 0 || score2 < 0 || score1 === score2) return null;
  return { winner: score1 > score2 ? player1 : player2, score1, score2 };
}

/** How many hand-entered results a player has and how many of them were wins, after `keep` (a time filter, say). */
export function manualRecordFor(results: ManualTournamentResult[], playerName: string, keep: (date: string) => boolean = () => true): { played: number; won: number } {
  const mine = manualResultsFor(results, playerName).filter((r) => keep(r.date));
  return { played: mine.length, won: mine.filter((r) => r.won).length };
}

const isSide = (entry: string, name: string): boolean => entry === name || splitTeamName(entry).includes(name);

/** One player's view of the manual results: who the opponent was and whether they won. Doubles teams count for each member. */
export function manualResultsFor(results: ManualTournamentResult[], playerName: string): { opponent: string; won: boolean; date: string }[] {
  const mine: { opponent: string; won: boolean; date: string }[] = [];
  for (const r of results) {
    const onSide1 = isSide(r.player1, playerName);
    const onSide2 = isSide(r.player2, playerName);
    if (onSide1 === onSide2) continue; // not in this match (or the same name on both sides)
    mine.push({ opponent: onSide1 ? r.player2 : r.player1, won: r.winner === (onSide1 ? r.player1 : r.player2), date: r.date });
  }
  return mine;
}
