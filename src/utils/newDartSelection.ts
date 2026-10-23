/**
 * Which of the model's detections is the dart that JUST landed?
 *
 * The old rule compared counts and positions with the darts already known and dropped every detection
 * that looked like one of them. That fails exactly where it matters: two darts in a group are closer
 * than the old match radius, the model often misses a dart that is partly hidden (so it returns fewer
 * detections than darts present), and two darts with the same score were treated as the same dart.
 *
 * Now the picture itself decides: exactly one dart lands per throw, so the pixels that changed since the
 * last stable frame (see changeMask.ts) mark it. A candidate qualifies when it stands on changed pixels;
 * standing close to an earlier dart only matters when nothing changed there. Without a comparison frame
 * the old position check remains the fallback.
 */

export interface DartCandidate {
  x?: number;
  y?: number;
  confidence: number;
}

/** Closer than this (fraction of the frame, about 11 mm on the board) to a known dart = probably that dart. */
export const KNOWN_DART_RADIUS = 0.03;
/** A candidate needs at least this share of changed cells around its tip... */
export const CHANGE_SUPPORT_MIN = 0.12;
/** ...and this much when it sits right next to an earlier dart (a tight group). */
export const CHANGE_SUPPORT_NEAR_KNOWN = 0.3;

export function selectNewDart<T extends DartCandidate>(
  known: { x?: number; y?: number }[],
  candidates: T[],
  changeSupportAt: ((x: number, y: number) => number) | null,
): T | null {
  let best: T | null = null;
  let bestScore = -1;
  for (const c of candidates) {
    const { x, y } = c;
    if (typeof x !== "number" || typeof y !== "number") continue;
    const nearKnown = known.some(
      (k) => typeof k.x === "number" && typeof k.y === "number" && Math.hypot(k.x - x, k.y - y) < KNOWN_DART_RADIUS,
    );
    let rank: number;
    if (changeSupportAt) {
      const support = changeSupportAt(x, y);
      if (support < (nearKnown ? CHANGE_SUPPORT_NEAR_KNOWN : CHANGE_SUPPORT_MIN)) continue;
      rank = support * c.confidence;
    } else {
      if (nearKnown) continue;
      rank = c.confidence;
    }
    if (rank > bestScore) {
      best = c;
      bestScore = rank;
    }
  }
  return best;
}
