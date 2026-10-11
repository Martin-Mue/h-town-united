import type { Match } from "@/utils/tournament";
import { isRealPlayer } from "@/utils/tournament";

/** match_id -> { predicted player name -> vote count } (same shape useMatchPredictions returns) */
export type PredictionTallies = Record<string, Record<string, number>>;

export interface EvaluatedMatch {
  match: Match;
  votes1: number;
  votes2: number;
  total: number;
  /** Player the majority tipped; null on a tie or when nobody tipped. */
  crowdPick: string | null;
  /** Only set once the match is decided and at least one tip exists. */
  crowdCorrect: boolean | null;
  myPick: string | null;
  myCorrect: boolean | null;
}

export interface PredictionEvaluation {
  /** Anonymous number of tips cast across the whole tournament. */
  totalTips: number;
  /** Decided matches that received at least one tip, newest round first. */
  decided: EvaluatedMatch[];
  crowdCorrect: number;
  crowdDecided: number;
  /** Share of all tips on decided matches that named the actual winner (0-100), null without data. */
  tipAccuracyPct: number | null;
  myCorrect: number;
  myDecided: number;
}

export function evaluatePredictions(matches: Match[], tallies: PredictionTallies, myVotes: Record<string, string>): PredictionEvaluation {
  let totalTips = 0;
  for (const bucket of Object.values(tallies)) for (const n of Object.values(bucket)) totalTips += n;

  const decided: EvaluatedMatch[] = [];
  let crowdCorrect = 0, crowdDecided = 0, myCorrect = 0, myDecided = 0, tipsOnDecided = 0, tipsRight = 0;

  for (const match of matches) {
    if (!match.winner || !isRealPlayer(match.player1) || !isRealPlayer(match.player2)) continue;
    const bucket = tallies[match.id] ?? {};
    const votes1 = bucket[match.player1!] ?? 0;
    const votes2 = bucket[match.player2!] ?? 0;
    const total = votes1 + votes2;
    const myPick = myVotes[match.id] ?? null;
    if (total === 0 && !myPick) continue;
    const crowdPick = votes1 === votes2 ? null : votes1 > votes2 ? match.player1! : match.player2!;
    const crowdIsCorrect = total > 0 && crowdPick ? crowdPick === match.winner : null;
    const myIsCorrect = myPick ? myPick === match.winner : null;
    if (crowdIsCorrect !== null) { crowdDecided++; if (crowdIsCorrect) crowdCorrect++; }
    if (myIsCorrect !== null) { myDecided++; if (myIsCorrect) myCorrect++; }
    tipsOnDecided += total;
    tipsRight += match.winner === match.player1 ? votes1 : votes2;
    decided.push({ match, votes1, votes2, total, crowdPick, crowdCorrect: crowdIsCorrect, myPick, myCorrect: myIsCorrect });
  }
  decided.sort((a, b) => b.match.round - a.match.round || a.match.position - b.match.position);
  return {
    totalTips, decided, crowdCorrect, crowdDecided,
    tipAccuracyPct: tipsOnDecided > 0 ? Math.round((tipsRight / tipsOnDecided) * 100) : null,
    myCorrect, myDecided,
  };
}
