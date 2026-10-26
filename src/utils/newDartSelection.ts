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

/** Closer than this (fraction of the frame, about 16 mm on the board) to a known dart = probably that dart. */
export const KNOWN_DART_RADIUS = 0.035;
/** A candidate needs at least this share of changed cells around its tip... */
export const CHANGE_SUPPORT_MIN = 0.12;
/** ...and this much when it sits right next to an earlier dart (a tight group). */
export const CHANGE_SUPPORT_NEAR_KNOWN = 0.3;
/** Below this score a detection is "weak": real darts in unusual spots (long dart at the board edge, seen
 *  from a flat angle) often score 0.15-0.25. They count only with clearly fresh change under them. */
export const WEAK_DART_SCORE = 0.25;
/** Two new darts found in the SAME look must be at least this far apart (frame fraction, ~27 mm) — otherwise they are one dart. */
export const NEW_DART_SEPARATION = 0.06;
export const CHANGE_SUPPORT_WEAK = 0.35;
/**
 * Darts in the double ring and beyond (about 40 % of the misses of the model on hand-checked pictures: it finds only about
 * half of the tips outside the double with the usual cut-off) give weak scores — the tip is dark on dark, the flight leaves
 * the picture. A weak hit there needs less fresh change under it than anywhere else. Only for the straightened frame, where
 * the board centre is (0.5, 0.5) and its radius 0.377.
 */
export const CHANGE_SUPPORT_WEAK_EDGE = 0.22;
export const EDGE_ZONE_FROM_RADIUS = 0.9;
const BOARD_RADIUS_IN_FRAME = 0.377;
/** Where in the straightened frame a candidate stands: true from 90 % of the board radius outwards. */
export const inEdgeZone = (x: number, y: number): boolean => Math.hypot(x - 0.5, y - 0.5) / BOARD_RADIUS_IN_FRAME >= EDGE_ZONE_FROM_RADIUS;
/**
 * A dart is ~90 mm long and the model sometimes also reports its barrel or flight as a dart — a weak hit up to a dart's
 * length from a stronger one is that, not another dart. (Measured: after the first dart of a round the model gave
 * tip 0.73 and, 63 mm further along the barrel, "dart" 0.26; both stood on fresh pixels and the second one became a phantom.)
 */
export const GHOST_RADIUS = 0.2;
export const GHOST_MAX_SCORE = 0.4;
/** A weak hit must be this much weaker than the dart it shadows. */
export const GHOST_MARGIN = 0.2;
/** Next to an earlier dart the barrel/flight is old pixels, so a weak hit there needs a lot of fresh change to be a new dart. */
export const CHANGE_SUPPORT_NEAR_KNOWN_WEAK = 0.5;
/** Hits this confident count without fresh change — unless they sit this close to a known dart (frame fraction, ~40 mm),
 *  where a slightly shifted second hit on the same dart must not turn into a new one. */
/**
 * Two darts cannot have their tips within a few millimetres of each other, so a hit this close to a known dart IS that
 * dart, however much fresh change stands under it (measured on untouched play: the same tip came back two and three times
 * at coordinates identical to the third decimal, once per rest, because a later dart changed pixels around the earlier one).
 */
export const DUPLICATE_DART_RADIUS = 0.006;
export const CONFIDENT_DART_SCORE = 0.5;
export const CONFIDENT_BYPASS_MIN_DISTANCE = 0.09;

export interface SelectOptions {
  /** The candidates are positions in the straightened model frame (board centre 0.5/0.5), so the edge rule applies. */
  straightenedFrame?: boolean;
}

export function selectNewDart<T extends DartCandidate>(
  known: { x?: number; y?: number }[],
  candidates: T[],
  changeSupportAt: ((x: number, y: number) => number) | null,
  options: SelectOptions = {},
): T | null {
  let best: T | null = null;
  let bestScore = -1;
  for (const c of candidates) {
    const { x, y } = c;
    if (typeof x !== "number" || typeof y !== "number") continue;
    if (known.some((k) => typeof k.x === "number" && typeof k.y === "number" && Math.hypot(k.x - x, k.y - y) < DUPLICATE_DART_RADIUS)) continue;
    const nearKnown = known.some(
      (k) => typeof k.x === "number" && typeof k.y === "number" && Math.hypot(k.x - x, k.y - y) < KNOWN_DART_RADIUS,
    );
    const nearestKnown = Math.min(
      Infinity,
      ...known.map((k) => (typeof k.x === "number" && typeof k.y === "number" ? Math.hypot(k.x - x, k.y - y) : Infinity)),
    );
    let rank: number;
    if (changeSupportAt) {
      const confidentFar = c.confidence >= CONFIDENT_DART_SCORE && nearestKnown >= CONFIDENT_BYPASS_MIN_DISTANCE;
      const support = confidentFar ? 1 : changeSupportAt(x, y);
      const weakNearKnown = c.confidence < GHOST_MAX_SCORE && nearestKnown < GHOST_RADIUS;
      const needed = Math.max(
        nearKnown ? CHANGE_SUPPORT_NEAR_KNOWN : CHANGE_SUPPORT_MIN,
        c.confidence < WEAK_DART_SCORE ? (options.straightenedFrame && inEdgeZone(x, y) ? CHANGE_SUPPORT_WEAK_EDGE : CHANGE_SUPPORT_WEAK) : 0,
        weakNearKnown ? CHANGE_SUPPORT_NEAR_KNOWN_WEAK : 0,
      );
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
  options: SelectOptions = {},
): T[] {
  const picked: T[] = [];
  // Weak hits next to a clearly stronger hit of the same look are that dart's barrel or flight, not darts of their own.
  let remaining = candidates.filter(
    (c) =>
      !(
        typeof c.x === "number" &&
        typeof c.y === "number" &&
        c.confidence < GHOST_MAX_SCORE &&
        candidates.some(
          (o) => o !== c && typeof o.x === "number" && typeof o.y === "number" && o.confidence >= c.confidence + GHOST_MARGIN && Math.hypot(o.x - (c.x as number), o.y - (c.y as number)) < GHOST_RADIUS,
        )
      ),
  );
  while (picked.length < capacity) {
    const next = selectNewDart(known, remaining, changeSupportAt, options);
    if (!next) break;
    picked.push(next);
    // One dart gives the model several hits (tip, barrel, flight). All of them stand on the same fresh pixels, so
    // the change check cannot tell them from further darts — but they are within a few centimetres of the one just
    // taken, which two darts landing in one look practically never are. Throws that land in one spot arrive one by
    // one anyway, each at its own rest.
    remaining = remaining.filter(
      (c) => c !== next && !(typeof c.x === "number" && typeof c.y === "number" && typeof next.x === "number" && typeof next.y === "number" && Math.hypot(c.x - next.x, c.y - next.y) < NEW_DART_SEPARATION),
    );
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
