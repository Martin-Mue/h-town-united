/**
 * Elo skill rating — answers "who's actually best right now" by weighting each result
 * against the opponent's own rating, rather than a flat win quota that rewards mostly
 * beating weaker players. Team games are handled by computeTeamEloDeltas below, which
 * moves every member of a team by the SAME amount rather than trying to apportion a win
 * between teammates — see that function's doc comment for why.
 */
const K_FACTOR = 32;

export interface EloParticipant {
  id: string;
  rating: number;
  /** 1 = best placement this game (the winner), 2 = next best, etc. Participants who tied
   *  (identical standing — see gameSync.ts for how that's decided) share the same rank. */
  rank: number;
}

/**
 * Multiplayer Elo for a single finished game, placement-aware: every PAIR of participants is
 * scored as its own virtual 1-on-1 (whoever placed better is that pair's "winner"; equal ranks
 * count as a draw, actual score 0.5 each), not just winner-vs-everyone-else. This matters once
 * there are 3+ players — under the old winner-vs-rest model, 2nd place lost the same rating as
 * last place, with zero credit for beating everyone below them. Reduces to exactly the classic
 * 1v1 formula when there are only 2 participants (perPairK === K_FACTOR, one pair, one
 * winner/loser) — this is a generalization, not a different system for the 2-player case.
 *
 * K-factor is split across each participant's (n-1) pairings, same reasoning as before: a
 * player's total possible movement in one game stays bounded by K_FACTOR regardless of how many
 * people played, so an 8-player free-for-all doesn't swing ratings any harder than a 1v1 would.
 */
export function computeEloDeltas(participants: EloParticipant[]): Record<string, number> {
  const deltas: Record<string, number> = {};
  participants.forEach((p) => (deltas[p.id] = 0));
  if (participants.length < 2) return deltas;
  const perPairK = K_FACTOR / (participants.length - 1);
  for (let i = 0; i < participants.length; i++) {
    for (let j = i + 1; j < participants.length; j++) {
      const a = participants[i];
      const b = participants[j];
      const expectedA = 1 / (1 + 10 ** ((b.rating - a.rating) / 400));
      const actualA = a.rank < b.rank ? 1 : a.rank > b.rank ? 0 : 0.5;
      const change = perPairK * (actualA - expectedA);
      deltas[a.id] += change;
      deltas[b.id] -= change;
    }
  }
  return deltas;
}

/** One team's Elo inputs for computeTeamEloDeltas: its matched human members' ids/ratings
 *  (bots and unmatched names already filtered out by the caller) and its placement rank,
 *  same rank semantics as EloParticipant. */
export interface EloTeam {
  memberIds: string[];
  /** Index-aligned with memberIds. */
  memberRatings: number[];
  rank: number;
}

/**
 * Team-game Elo. Each team is reduced to one virtual participant — its rating is the
 * average of its matched members' individual ratings — and those virtual participants are
 * run through the exact same pairwise placement model as computeEloDeltas above. The
 * resulting per-team delta is then applied UNIFORMLY to every member of that team.
 *
 * Deliberately not apportioned by individual contribution: as the module doc explains,
 * there's no principled way to say how much of a shared team result belongs to which
 * member. Averaging in and moving everyone by the same delta sidesteps that question
 * entirely while still letting real team results move individual ratings, rather than
 * excluding team games from Elo altogether.
 */
export function computeTeamEloDeltas(teams: EloTeam[]): Record<string, number> {
  const virtual: EloParticipant[] = teams.map((team, idx) => ({
    id: String(idx),
    rating: team.memberRatings.reduce((sum, r) => sum + r, 0) / (team.memberRatings.length || 1),
    rank: team.rank,
  }));
  const teamDeltas = computeEloDeltas(virtual);
  const deltas: Record<string, number> = {};
  teams.forEach((team, idx) => {
    const delta = teamDeltas[String(idx)] ?? 0;
    team.memberIds.forEach((id) => { deltas[id] = delta; });
  });
  return deltas;
}
