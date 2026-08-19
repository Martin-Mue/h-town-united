import type { DartThrow } from "@/types/game";

/** Running "remaining" after each dart of a recorded leg — index 0 is the score after the FIRST
 *  dart, not before it (there's nothing interesting to compare against before any dart is
 *  thrown). Doesn't stop at zero/bust: a recorded WON leg never goes below 0 or busts on its
 *  final dart by definition, so a plain running subtraction is exact, not an approximation. */
export function ghostRemainingSequence(throws: DartThrow[], startScore: number): number[] {
  const seq: number[] = [];
  let remaining = startScore;
  for (const t of throws) {
    remaining -= t.points;
    seq.push(remaining);
  }
  return seq;
}

/** Named dart-count benchmarks offered as a ghost target alongside "your own best leg". Only
 *  offered to the player when mathematically reachable for the game's start score (needs an
 *  average of 60 or less per dart — 60 being the highest a single dart can ever score — checked
 *  by the caller via `startScore / darts <= 60`, not hardcoded here since it depends on the
 *  game's own start score). */
export const GHOST_BENCHMARKS = [
  { darts: 9, label: "9-Darter" },
  { darts: 12, label: "12-Darter" },
  { darts: 15, label: "15-Darter" },
  { darts: 18, label: "18-Darter" },
] as const;

/**
 * A synthetic, evenly-paced target sequence for "finish in exactly N darts" — deliberately NOT
 * an attempt to recreate a realistic dart-by-dart visit pattern (that would need to fabricate
 * specific throw values and present them as if some real performance actually went that way,
 * which this explicitly avoids). It's a smooth pace curve: after dart i of totalDarts, you'd
 * need to be at startScore * (1 - i/totalDarts) to be exactly on pace to finish at dart
 * totalDarts. Framed to the player as a named challenge ("Schlage den 15-Darter"), not
 * attributed to any real person or match.
 */
export function buildBenchmarkSequence(startScore: number, totalDarts: number): number[] {
  const seq: number[] = [];
  for (let i = 1; i <= totalDarts; i++) {
    seq.push(i === totalDarts ? 0 : Math.max(1, Math.round(startScore * (1 - i / totalDarts))));
  }
  return seq;
}

export interface GhostComparison {
  /** Positive = ahead of the ghost's pace at this many darts in (scored more so far), negative = behind. */
  aheadBy: number;
  /** The ghost's remaining score after the same number of darts (clamped to 0 once the ghost's own leg was already finished by then). */
  ghostRemaining: number;
}

/**
 * Compares "how far into this leg am I" against a ghost leg's own pace at that same dart count —
 * not total-darts-to-finish (which only means anything once EITHER leg is actually over), so a
 * player gets a live signal mid-leg, not just a verdict at the end. Once darts thrown exceeds
 * how many the ghost's leg took, the ghost is treated as having already finished (remaining 0)
 * for every dart after that, rather than reading past the end of its own throw list.
 */
export function compareToGhost(dartsThrown: number, myRemaining: number, ghostSequence: number[]): GhostComparison | null {
  if (dartsThrown < 1 || ghostSequence.length === 0) return null;
  const ghostRemaining = dartsThrown <= ghostSequence.length ? ghostSequence[dartsThrown - 1] : 0;
  return { aheadBy: ghostRemaining - myRemaining, ghostRemaining };
}
