/**
 * Elo skill rating — answers "who's actually best right now" by weighting each result
 * against the opponent's own rating, rather than a flat win quota that rewards mostly
 * beating weaker players. Team games are excluded entirely (see gameSync.ts): with one
 * shared team score it's ambiguous how much of a win belongs to which member.
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
