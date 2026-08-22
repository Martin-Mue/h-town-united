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
