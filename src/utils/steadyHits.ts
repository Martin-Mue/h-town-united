/**
 * Steady hits: confident detections that sit on the same spot look after look.
 *
 * The normal new-dart rule needs fresh pixel change under a candidate and refuses everything while a
 * large part of the picture differs from the reference (a hand in view). When the reference itself was
 * taken at a bad moment (hand still in the picture), every later look differs by 30-80 % although the
 * board is at rest, and real darts were never taken (log 2026-11-12: two darts at 0.84-0.92 for 25 s,
 * the round lost). A dart does not move; a hand does. A confident hit that stays put over several looks
 * is therefore a dart, whatever the change map says.
 */

/** Only hits at least this confident can count as steady (v11: real darts 0.8-0.93, phantoms mostly < 0.3). */
export const STEADY_HIT_SCORE = 0.75;
/** The same spot across looks: closer than this (frame fraction, about 3 mm). */
export const STEADY_HIT_RADIUS = 0.007;
/** Looks in a row a hit must be seen on its spot before it is taken despite a hand-sized change. */
export const STEADY_HIT_LOOKS = 3;

export interface SteadyHit {
  x: number;
  y: number;
  looks: number;
}

/** Carries the track of steady hits one look forward: hits found again on their spot count up, new ones start at 1, vanished ones drop. */
export function trackSteadyHits(previous: SteadyHit[], current: { x?: number; y?: number; confidence: number }[]): SteadyHit[] {
  const next: SteadyHit[] = [];
  for (const d of current) {
    if (d.confidence < STEADY_HIT_SCORE || typeof d.x !== "number" || typeof d.y !== "number") continue;
    if (next.some((n) => Math.hypot(n.x - (d.x as number), n.y - (d.y as number)) < STEADY_HIT_RADIUS)) continue;
    const before = previous.find((p) => Math.hypot(p.x - (d.x as number), p.y - (d.y as number)) < STEADY_HIT_RADIUS);
    next.push({ x: d.x, y: d.y, looks: before ? before.looks + 1 : 1 });
  }
  return next;
}

/**
 * The candidates of this look that are steady hits and not darts already known — most confident first,
 * at most `capacity`, and never two on the same dart.
 */
export function selectSteadyNewDarts<T extends { x?: number; y?: number; confidence: number }>(
  known: { x?: number; y?: number }[],
  candidates: T[],
  steady: SteadyHit[],
  capacity: number,
  knownRadius: number,
): T[] {
  const picked: T[] = [];
  const sorted = [...candidates].sort((a, b) => b.confidence - a.confidence);
  for (const c of sorted) {
    if (picked.length >= capacity) break;
    if (c.confidence < STEADY_HIT_SCORE || typeof c.x !== "number" || typeof c.y !== "number") continue;
    const cx = c.x;
    const cy = c.y;
    if (!steady.some((s) => s.looks >= STEADY_HIT_LOOKS && Math.hypot(s.x - cx, s.y - cy) < STEADY_HIT_RADIUS)) continue;
    const taken = [...known, ...picked];
    if (taken.some((k) => typeof k.x === "number" && typeof k.y === "number" && Math.hypot(k.x - cx, k.y - cy) < knownRadius)) continue;
    picked.push(c);
  }
  return picked;
}
