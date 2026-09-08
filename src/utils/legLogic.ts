import type { GameState, LegState, DartThrow, CricketPlayerState, TeamSlot } from "@/types/game";
import { createLegState, createCricketState } from "@/utils/gameStateFactory";
import { teamIndexFor } from "@/utils/teamUtils";

/**
 * Round 3 Rang 12: split out of Game.tsx verbatim (previously four module-level functions sitting
 * above the 3500-line GamePage component itself) — the God-component audit's first, lowest-risk
 * slice. These four were already pure (no closure over any Game.tsx state, only their own
 * parameters and the same gameStateFactory/teamUtils imports Game.tsx itself used), so moving them
 * changes zero runtime behavior; it just gives the app's actual leg-scoring rules a home outside
 * the page component, and — for the first time — real unit test coverage (see legLogic.test.ts),
 * something impossible while they were locked inside a page component with no exported access.
 * Game.tsx now imports these instead of defining them.
 *
 * This is a deliberately scoped first step, not the whole of Rang 12: Game.tsx and Tournament.tsx
 * are still ~3500 lines each, still holding plenty of setup-flow UI state, bot-turn orchestration,
 * camera/undo/ghost-mode wiring, and tournament/league sync side effects that are NOT pure and
 * genuinely intertwined with component lifecycle (refs, effects, closures over live state) — those
 * would need actual manual QA against a running app to safely restructure, which this environment
 * has no way to do (no build/dev-server/test-runner access, only per-file isolatedModules
 * transpile checks). Pulling out what's provably pure and side-effect-free first is the safe,
 * honest slice; the rest is flagged here as real follow-up work if wanted.
 */

/**
 * Applies a decided leg win (`winnerIndex`, a score-slot index — teamIdx-space, matching
 * `legsWon`/`currentLeg.remaining`) on top of `base` — either finishes the match (bestOfLegs
 * reached) or archives the leg and starts the next one via createLegState. `updatedLeg` is the
 * caller's own already-prepared current leg (with the deciding dart/state applied, if any);
 * `base` and `prev` are usually the same object — `base` only needs to differ when a caller has
 * its own extra fields to preserve in the non-finished branch (e.g. handleX01Throw's round-cap
 * path, which pre-sets a default `currentPlayerIndex` before knowing whether the cap ended the
 * leg). Shared by every place an X01 leg can end: a checkout, the maxRoundsX01 cap resolving to a
 * unique winner, and a bull-off tiebreak resolving a cap-tied leg — previously reimplemented at
 * each site (Game.tsx's own duplication tracking flagged this as the likely next source of a
 * fixed-in-one-path-forgotten-in-the-other bug).
 */
export function applyLegWin(base: GameState, prev: GameState, updatedLeg: LegState, winnerIndex: number): GameState {
  const n = prev.players.length;
  const legsWon = [...prev.legsWon];
  legsWon[winnerIndex] += 1;
  const legsToWin = Math.ceil(prev.bestOfLegs / 2);
  const finishedLeg: LegState = { ...updatedLeg, winnerIndex };
  if (legsWon[winnerIndex] >= legsToWin) {
    return {
      ...base,
      currentLeg: finishedLeg,
      legsWon,
      isFinished: true,
      winnerName: prev.teams ? prev.teams[winnerIndex].name : prev.players[winnerIndex].name,
      winnerIndex,
    };
  }
  const nextStarter = (finishedLeg.startingPlayerIndex + 1) % n;
  return {
    ...base,
    legsWon,
    completedLegs: [...prev.completedLegs, finishedLeg],
    currentLeg: createLegState(finishedLeg.legNumber + 1, prev.startScore, nextStarter, prev.players, prev.teams),
    currentPlayerIndex: nextStarter,
  };
}

/**
 * Applies one Cricket dart's marks/points to `myState` (the throwing player/team's own
 * CricketPlayerState) in place — mutates `myState.marks`/`myState.points` directly, matching the
 * "already-cloned, safe to mutate" convention every call site already uses for its own working
 * copy. Shared by the three places a Cricket dart's marks get computed: a live manual/bot throw,
 * a camera-detected round, and replaying a whole leg from scratch after a mid-leg delete —
 * previously reimplemented identically at each site.
 */
export function applyCricketDart(myState: CricketPlayerState, others: CricketPlayerState[], cricketNumbers: readonly number[], targetNumber: number, baseValue: number, multiplier: number): void {
  if (!cricketNumbers.includes(targetNumber) || targetNumber === 0) return;
  const hitsToAdd = baseValue === 50 ? 2 : multiplier;
  const currentMarks = myState.marks[targetNumber] || 0;
  const newMarks = currentMarks + hitsToAdd;
  myState.marks = { ...myState.marks, [targetNumber]: newMarks };
  const stillOpenForSomeoneElse = others.some((o) => (o.marks[targetNumber] || 0) < 3);
  if (newMarks > 3 && stillOpenForSomeoneElse) {
    const scorableHits = newMarks - Math.max(currentMarks, 3);
    myState.points += targetNumber * scorableHits;
  }
}

/**
 * Rebuilds Cricket marks/points from scratch by replaying a leg's throws in true chronological
 * order. Needed because — unlike X01's `remaining`, a simple running total that reverses cleanly
 * with `+= removed.points` — Cricket scoring is order-dependent ACROSS players: whether a hit
 * still scores points depends on whether every opponent has already closed that number, which
 * depends on the true interleaved throw order, not just this one player's own sequence. deleting
 * a single throw and only patching that one player's marks/points (the way X01 patches
 * `remaining`) can't correctly account for numbers that were open when the deleted throw happened
 * but have since closed, or vice versa.
 *
 * `currentLeg.throws` doesn't store a shared timestamp/sequence number across players, but turns
 * strictly alternate in up-to-3-dart visits starting from `startingPlayerIndex` (see
 * `currentPlayerIndex`'s own `(idx + 1) % n` advance elsewhere in Game.tsx) — enough structure to
 * reconstruct the true interleaving purely from each player's own already-ordered array: take up
 * to 3 darts from whoever's turn it is, advance, repeat, skipping (not looping forever on) a
 * player who's already exhausted their recorded throws for this leg.
 */
export function replayCricketState(
  throwsByPlayer: DartThrow[][],
  startingPlayerIndex: number,
  teams: TeamSlot[] | undefined,
  cricketNumbers: readonly number[]
): CricketPlayerState[] {
  const n = throwsByPlayer.length;
  const scoreSlots = teams?.length ?? n;
  const cricket = Array.from({ length: scoreSlots }, () => createCricketState(cricketNumbers));
  const cursors = new Array(n).fill(0);
  let active = startingPlayerIndex;
  let exhaustedStreak = 0;
  while (exhaustedStreak < n) {
    const arr = throwsByPlayer[active];
    if (cursors[active] >= arr.length) {
      exhaustedStreak++;
      active = (active + 1) % n;
      continue;
    }
    exhaustedStreak = 0;
    const take = Math.min(3, arr.length - cursors[active]);
    const teamIdx = teamIndexFor(teams, active);
    const myState = cricket[teamIdx];
    for (let i = 0; i < take; i++) {
      const d = arr[cursors[active] + i];
      const others = cricket.filter((_, j) => j !== teamIdx);
      const targetNumber = d.baseValue === 50 ? 25 : d.baseValue;
      applyCricketDart(myState, others, cricketNumbers, targetNumber, d.baseValue, d.multiplier);
    }
    cursors[active] += take;
    active = (active + 1) % n;
  }
  return cricket;
}

/** 6 unique random numbers (1-20) plus Bull, freshly rolled — never memoized/cached across games. */
export function generateRandomCricketNumbers(): number[] {
  const pool = Array.from({ length: 20 }, (_, i) => i + 1);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return [...pool.slice(0, 6), 25];
}
