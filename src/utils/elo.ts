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
  isWinner: boolean;
}

/**
 * Multiplayer Elo for a single finished game: the winner is paired against every other
 * (human) participant individually, with the K-factor split across those pairings so an
 * 8-player free-for-all doesn't swing ratings any harder than a normal 1v1 would. Ties
 * among non-winners don't move rating relative to each other — there's no reliable signal
 * for 2nd-vs-3rd place beyond "neither of them won".
 */
export function computeEloDeltas(participants: EloParticipant[]): Record<string, number> {
  const deltas: Record<string, number> = {};
  participants.forEach((p) => (deltas[p.id] = 0));
  const winner = participants.find((p) => p.isWinner);
  const losers = participants.filter((p) => !p.isWinner);
  if (!winner || losers.length === 0) return deltas;
  const perPairK = K_FACTOR / losers.length;
  for (const loser of losers) {
    const expectedWinner = 1 / (1 + 10 ** ((loser.rating - winner.rating) / 400));
    const change = perPairK * (1 - expectedWinner);
    deltas[winner.id] += change;
    deltas[loser.id] -= change;
  }
  return deltas;
}
