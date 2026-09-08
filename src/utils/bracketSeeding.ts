import { BYE, totalRoundsOf, type Match } from "@/utils/tournament";

/**
 * Round 4 Rang 5: pure bracket-sizing/seeding helpers moved verbatim out of Tournament.tsx (which,
 * at 210KB, had become the single largest file in the app -- larger than Game.tsx was before
 * Round 3 Rang 12's own scoped extraction of legLogic.ts). Same scoping decision as that one: this
 * is NOT a full God-component refactor of Tournament.tsx, just these already fully self-contained,
 * closure-free functions (no React state, no JSX) pulled into their own file with zero behavior
 * change, so they can be unit-tested directly instead of only indirectly through the page.
 */

export const nextPowerOfTwo = (count: number) => Math.pow(2, Math.ceil(Math.log2(Math.max(count, 2))));
export const lowerPowerOfTwo = (count: number) => Math.pow(2, Math.floor(Math.log2(Math.max(count, 2))));

/**
 * Picks the "auto" main bracket size for a field of `count` players. Both a preliminary
 * round (main size = lowerPowerOfTwo) and BYE-only padding (main size = the next power of
 * two up) end up producing the exact same set of matches for the players who'd be "extra"
 * either way — the only real difference is how many players are affected: a preliminary
 * round makes `2 * excess` players play one more match than everyone else, while BYE
 * padding just leaves `next - count` players idle for a round. So: use whichever framing
 * touches fewer players. E.g. 30 players is much closer to 32 than to 16 — a 32er bracket
 * with 2 BYEs beats forcing 28 of the 30 through a preliminary round to fill a 16er.
 * 34 players is the opposite case — 2 preliminary matches (4 players) beats a 64er
 * bracket with 30 BYE slots.
 */
/** `preference` lets an organizer override the tie-break: "prelim" always takes the smaller main
 *  bracket (a preliminary round instead of padding with BYEs), "byes" always takes the next size
 *  up (more BYEs, no preliminary round). "auto" (the default) keeps the original "touches fewer
 *  players" heuristic below. Only meaningful once count > lower — below that there's only one
 *  possible size regardless of preference. */
export const chooseAutoMainSize = (count: number, preference: "auto" | "prelim" | "byes" = "auto"): number => {
  const lower = Math.min(64, lowerPowerOfTwo(Math.max(count, 2)));
  if (count <= lower) return lower;
  const upper = lower * 2;
  if (upper > 64) return lower; // 64 is the largest supported bracket — no bigger option to compare against
  if (preference === "prelim") return lower;
  if (preference === "byes") return upper;
  const excess = count - lower;
  const prelimPlayers = excess * 2;
  const byesIfUpper = upper - count;
  return byesIfUpper <= prelimPlayers ? upper : lower;
};

// A 32+ player mirrored tree can't stay legible at any scale that also fits a screen —
// default those straight to the always-readable "Spielplan" list instead of the tree.
export const defaultBracketView = (bracket: Match[] | undefined): "tree" | "schedule" => {
  if (!bracket || bracket.length === 0) return "tree";
  const totalRounds = totalRoundsOf(bracket);
  return totalRounds >= 5 ? "schedule" : "tree";
};

export const shuffle = <T,>(list: T[]) => {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
};

/** deterministic PRNG so preview and generated bracket use the exact same draw */
export const mulberry32 = (seed: number) => {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

export const seededShuffle = <T,>(list: T[], seed: number) => {
  const rnd = mulberry32(seed);
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
};

/** Standard single-elimination seed placement for a bracket of size n (must be a power of 2) —
 *  e.g. bracketSeedOrder(8) = [1,8,4,5,2,7,3,6], so seed 1 and seed 2 land in opposite halves and
 *  can only meet in the final, seeds 1-4 are spread one to a quarter, etc. Textbook recursive
 *  definition: seed n+1-s always sits opposite seed s at every split. */
export const bracketSeedOrder = (n: number): number[] => {
  if (n <= 1) return [1];
  const prev = bracketSeedOrder(n / 2);
  const out: number[] = [];
  prev.forEach((s) => { out.push(s); out.push(n + 1 - s); });
  return out;
};

/** Elo-based "fair" seeding — orders players so the bracket itself keeps strong players apart
 *  (standard seeding), rather than just sorting by Elo (which would seat #1 and #2 as neighbors
 *  in round 1). Reuses buildSeeding/distributeByes completely unchanged: both already place
 *  whatever order they're given sequentially into slots and hand the front of the list any BYEs
 *  first, so feeding them a properly seed-ordered list is the only change needed for correct
 *  seeded placement, including BYEs going to the top seeds as intended. When the field exceeds
 *  `mainSize` (a preliminary round is needed), the weakest players — who buildSeeding always
 *  slices off the tail into the preliminary round regardless of mode — are appended in plain Elo
 *  order; only the direct-entry seeds get the interleaved placement, a reasonable approximation
 *  rather than a fully co-derived seeding for that rarer non-power-of-2 case. */
export const fairSeededOrder = (playerNames: string[], mainSize: number, eloByName: Map<string, number>): string[] => {
  const byElo = [...playerNames].sort((a, b) => (eloByName.get(b) ?? 1000) - (eloByName.get(a) ?? 1000));
  const excess = Math.max(0, playerNames.length - mainSize);
  const topCount = mainSize - excess;
  const topSeeds = byElo.slice(0, topCount);
  const rest = byElo.slice(topCount);
  const seeded = bracketSeedOrder(mainSize)
    .filter((seedNum) => seedNum <= topCount)
    .map((seedNum) => topSeeds[seedNum - 1]);
  return [...seeded, ...rest];
};

/**
 * Distributes BYEs evenly across the first round: every player with a bye is placed
 * into their own match, spread over the bracket (never two byes next to each other
 * while real pairings are still possible).
 */
export const distributeByes = (ordered: string[], size: number): string[] => {
  const slots: string[] = new Array(size).fill(BYE);
  const matchCount = size / 2;
  const byes = size - ordered.length;
  if (byes <= 0) return [...ordered];
  const list = [...ordered];
  // choose which matches get a bye – evenly spaced across the bracket
  const byeMatches = new Set<number>();
  const step = matchCount / Math.min(byes, matchCount);
  for (let i = 0; i < Math.min(byes, matchCount); i++) {
    byeMatches.add(Math.min(matchCount - 1, Math.round(i * step)));
  }
  for (let m = 0; m < matchCount; m++) {
    if (byeMatches.has(m)) {
      slots[m * 2] = list.shift() ?? BYE;
      slots[m * 2 + 1] = BYE;
    }
  }
  for (let m = 0; m < matchCount; m++) {
    if (byeMatches.has(m)) continue;
    slots[m * 2] = list.shift() ?? BYE;
    slots[m * 2 + 1] = list.shift() ?? BYE;
  }
  return slots;
};

export interface Seeding {
  /** Round-1 slots (length = mainSize). `undefined` means "pending — filled by a preliminary-round winner". */
  round1: (string | undefined)[];
  prelimPairs: [string, string][];
  /** Parallel to prelimPairs: which round-1 match/slot that preliminary match's winner feeds into. */
  prelimFeeds: { position: number; slot: 1 | 2 }[];
}

/**
 * Seeds a clean power-of-two main bracket of `mainSize` players. When the real
 * player count exceeds `mainSize`, the excess plays a small preliminary round
 * (real matches, no BYEs) instead of padding the whole tree with BYEs up to the
 * next power of two above — e.g. 34 players → a 32er main bracket with 2
 * preliminary matches, not a 64er bracket with 30 BYE slots.
 */
export const buildSeeding = (players: string[], mainSize: number): Seeding => {
  const excess = Math.max(0, players.length - mainSize);

  if (excess === 0) {
    // No preliminary round needed — same evenly-spaced BYE distribution as before.
    return { round1: distributeByes(players.slice(0, mainSize), mainSize), prelimPairs: [], prelimFeeds: [] };
  }

  const byePlayers = players.slice(0, mainSize - excess);
  const prelimPlayers = players.slice(mainSize - excess);
  const prelimPairs: [string, string][] = [];
  for (let i = 0; i < prelimPlayers.length; i += 2) prelimPairs.push([prelimPlayers[i], prelimPlayers[i + 1]]);

  // Reuse the evenly-spaced BYE distribution (byePlayers are `excess` short of a full
  // bracket) and turn each resulting BYE slot — there are exactly `excess` of them —
  // into a "pending, filled by a preliminary winner" slot. A round-1 match can end up
  // fed by up to two preliminary winners when excess is large (e.g. 62 players → a
  // 32er main bracket needs 30 preliminary matches, far more than the 16 round-1
  // matches can each take just one of).
  const spread = distributeByes(byePlayers, mainSize);
  const round1: (string | undefined)[] = [...spread];
  const prelimFeeds: { position: number; slot: 1 | 2 }[] = [];
  for (let i = 0; i < round1.length && prelimFeeds.length < prelimPairs.length; i++) {
    if (round1[i] === BYE) {
      round1[i] = undefined;
      prelimFeeds.push({ position: Math.floor(i / 2), slot: i % 2 === 0 ? 1 : 2 });
    }
  }
  return { round1, prelimPairs, prelimFeeds };
};
