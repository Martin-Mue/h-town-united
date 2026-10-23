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

/** Closer than this (fraction of the frame, about 9 mm on the board) to a known dart = probably that dart. */
export const KNOWN_DART_RADIUS = 0.02;
/** A candidate needs at least this share of changed cells around its tip... */
export const CHANGE_SUPPORT_MIN = 0.12;
/** ...and this much when it sits right next to an earlier dart (a tight group). */
export const CHANGE_SUPPORT_NEAR_KNOWN = 0.3;
/** Below this score a detection is "weak": real darts in unusual spots (long dart at the board edge, seen
 *  from a flat angle) often score 0.15-0.25. They count only with clearly fresh change under them. */
export const WEAK_DART_SCORE = 0.25;
export const CHANGE_SUPPORT_WEAK = 0.35;

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
      const needed = Math.max(nearKnown ? CHANGE_SUPPORT_NEAR_KNOWN : CHANGE_SUPPORT_MIN, c.confidence < WEAK_DART_SCORE ? CHANGE_SUPPORT_WEAK : 0);
      if (support < needed) continue;
      rank = c.confidence; // the changed pixels only gate; the model decides which candidate is the dart
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

/**
 * Every new dart of a picture, not just one: several darts can land between two looks (quick throws, or
 * a tight group), so the best new candidate is taken, counted as known, and the search repeats until
 * `capacity` is used up or nothing qualifies. Taking a dart as known first makes the next pick near it
 * stricter, exactly like for darts of earlier throws.
 */
export function selectNewDarts<T extends DartCandidate>(
  known: { x?: number; y?: number }[],
  candidates: T[],
  changeSupportAt: ((x: number, y: number) => number) | null,
  capacity: number,
): T[] {
  const picked: T[] = [];
  let remaining = candidates;
  while (picked.length < capacity) {
    const next = selectNewDart([...known, ...picked], remaining, changeSupportAt);
    if (!next) break;
    picked.push(next);
    remaining = remaining.filter((c) => c !== next);
  }
  return picked;
}

/** A dart a later picture does not show any more was probably never one (a hand, a shadow, an exposure
 *  jump). Strong detections stay regardless — a real dart can hide behind a later one. */
export const STRONG_DART_CONFIDENCE = 0.45;
export const SAME_DART_RADIUS = 0.04;

export function keepSupportedDarts<T extends DartCandidate>(known: T[], detections: { x?: number; y?: number }[]): T[] {
  return known.filter((k) => {
    if (k.confidence >= STRONG_DART_CONFIDENCE) return true;
    const { x, y } = k;
    if (typeof x !== "number" || typeof y !== "number") return true;
    return detections.some((d) => typeof d.x === "number" && typeof d.y === "number" && Math.hypot(d.x - x, d.y - y) < SAME_DART_RADIUS);
  });
}
