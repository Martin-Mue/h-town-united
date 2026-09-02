export interface RoundRobinFixture {
  round: number;
  leg: "single" | "first" | "return";
  player1Id: string;
  player2Id: string;
}

/**
 * Circle method: fixes participant[0] in place and rotates everyone else by one position each
 * round, pairing from the outside in (current[i] vs current[size-1-i]). Guarantees every pair
 * meets exactly once across `size - 1` rounds. An odd participant count gets a `null` placeholder
 * appended first (making the list even) — whoever's paired with it that round has a bye, and that
 * pairing is simply dropped rather than turned into a fixture.
 */
function circleMethodRounds(participantIds: string[]): (string | null)[][][] {
  const isOdd = participantIds.length % 2 !== 0;
  const list: (string | null)[] = isOdd ? [...participantIds, null] : [...participantIds];
  const size = list.length;
  if (size < 2) return [];
  const numRounds = size - 1;
  const half = size / 2;

  const rounds: (string | null)[][][] = [];
  let current = [...list];

  for (let round = 0; round < numRounds; round++) {
    const pairs: (string | null)[][] = [];
    for (let i = 0; i < half; i++) {
      pairs.push([current[i], current[size - 1 - i]]);
    }
    rounds.push(pairs);

    const fixed = current[0];
    const rotating = current.slice(1);
    rotating.unshift(rotating.pop() ?? null);
    current = [fixed, ...rotating];
  }
  return rounds;
}

/**
 * Generates a full fixture list for a league: everyone plays everyone once ("single"), or twice
 * with swapped sides ("double" — Hin- und Rückrunde), continuing the round numbering into a
 * second block rather than restarting at 1, so the fixture list reads as one continuous season.
 */
export function generateRoundRobinFixtures(participantIds: string[], format: "single" | "double"): RoundRobinFixture[] {
  const rounds = circleMethodRounds(participantIds);
  const fixtures: RoundRobinFixture[] = [];

  rounds.forEach((pairs, roundIdx) => {
    pairs.forEach(([a, b]) => {
      if (a === null || b === null) return; // bye
      fixtures.push({ round: roundIdx + 1, leg: format === "double" ? "first" : "single", player1Id: a, player2Id: b });
    });
  });

  if (format === "double") {
    const firstLegRounds = rounds.length;
    rounds.forEach((pairs, roundIdx) => {
      pairs.forEach(([a, b]) => {
        if (a === null || b === null) return;
        // Sides swapped for the return leg — same pairing, opposite player1/player2.
        fixtures.push({ round: firstLegRounds + roundIdx + 1, leg: "return", player1Id: b, player2Id: a });
      });
    });
  }

  return fixtures;
}
