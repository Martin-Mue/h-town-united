import type { DartThrow } from "@/types/game";
import { RING, SEGMENTS_CLOCKWISE } from "./dartboardGeometry";

/**
 * A bot's dart as a real throw: it aims at a point on the board and lands somewhere around it, spread by its skill
 * (a round normal distribution with standard deviation `sigmaMm` on each axis). Where it lands decides the field, so a
 * miss of T20 lands in T5/T1, the single 20 or the neighbours as often as the board's geometry says, not by a table.
 *
 * Board coordinates: (0, 0) = bull, radius 1 = outer edge of the double ring (170 mm), 0° = top (20), clockwise.
 */

const DOUBLE_RING_MM = 170;

/** Where a thrower aims to hit `baseValue` with `multiplier` (25 = bull). A single aims at the big outer single. */
export function aimPointFor(baseValue: number, multiplier: 1 | 2 | 3): { u: number; v: number } {
  if (baseValue === 25 || baseValue === 50) return { u: 0, v: 0 };
  const index = SEGMENTS_CLOCKWISE.indexOf(baseValue);
  if (index < 0) return { u: 0, v: 0 };
  const radius =
    multiplier === 3 ? (RING.trebleInner + RING.trebleOuter) / 2
      : multiplier === 2 ? (RING.doubleInner + RING.doubleOuter) / 2
        : (RING.trebleOuter + RING.doubleInner) / 2;
  const angle = ((index * 18) * Math.PI) / 180;
  return { u: Math.sin(angle) * radius, v: -Math.cos(angle) * radius };
}

/** The field a point on the board lies in. Outside the double ring is a miss. */
export function dartAtBoardPoint(u: number, v: number): DartThrow {
  const radius = Math.hypot(u, v);
  if (radius > RING.doubleOuter) return { baseValue: 0, multiplier: 1, points: 0, boardU: u, boardV: v };
  if (radius <= RING.bullInner) return { baseValue: 25, multiplier: 2, points: 50, boardU: u, boardV: v };
  if (radius <= RING.bullOuter) return { baseValue: 25, multiplier: 1, points: 25, boardU: u, boardV: v };
  let angleDeg = (Math.atan2(v, u) * 180) / Math.PI + 90;
  angleDeg = ((angleDeg % 360) + 360) % 360;
  const baseValue = SEGMENTS_CLOCKWISE[Math.round(angleDeg / 18) % 20];
  const multiplier: 1 | 2 | 3 =
    radius >= RING.doubleInner ? 2 : radius >= RING.trebleInner && radius <= RING.trebleOuter ? 3 : 1;
  return { baseValue, multiplier, points: baseValue * multiplier, boardU: u, boardV: v };
}

/**
 * Spread (mm) for a wanted 3-dart average over whole legs, checkout play included. Measured 2026-11-25 by
 * simulating 3000 legs of 501 double-out per spread with the bots' own targeting (T20, checkout routes, set-up
 * shots); interpolated linearly in between.
 */
const SPREAD_FOR_AVERAGE: { avg: number; sigmaMm: number }[] = [
  { avg: 11.1, sigmaMm: 70 }, { avg: 13.5, sigmaMm: 60 }, { avg: 16.8, sigmaMm: 50 }, { avg: 19.1, sigmaMm: 45 },
  { avg: 21.7, sigmaMm: 40 }, { avg: 24.3, sigmaMm: 36 }, { avg: 28.3, sigmaMm: 30 }, { avg: 32.6, sigmaMm: 26 },
  { avg: 36.5, sigmaMm: 23 }, { avg: 39.9, sigmaMm: 21 }, { avg: 43.3, sigmaMm: 19 }, { avg: 48.5, sigmaMm: 17 },
  { avg: 54.3, sigmaMm: 15 }, { avg: 62.1, sigmaMm: 13 }, { avg: 70.8, sigmaMm: 11 }, { avg: 76.4, sigmaMm: 10 },
  { avg: 82.3, sigmaMm: 9 }, { avg: 88.2, sigmaMm: 8 }, { avg: 94.9, sigmaMm: 7 }, { avg: 103.1, sigmaMm: 6 },
  { avg: 113.5, sigmaMm: 5 }, { avg: 125.3, sigmaMm: 4 },
];

export function spreadForAverage(avg: number): number {
  const table = SPREAD_FOR_AVERAGE;
  if (avg <= table[0].avg) return table[0].sigmaMm;
  for (let i = 1; i < table.length; i++) {
    if (avg <= table[i].avg) {
      const t = (avg - table[i - 1].avg) / (table[i].avg - table[i - 1].avg);
      return table[i - 1].sigmaMm + (table[i].sigmaMm - table[i - 1].sigmaMm) * t;
    }
  }
  return table[table.length - 1].sigmaMm;
}

/** A standard normal number (Box-Muller). */
function gaussian(random: () => number): number {
  let a = 0;
  while (a === 0) a = random();
  return Math.sqrt(-2 * Math.log(a)) * Math.cos(2 * Math.PI * random());
}

/** One dart aimed at `baseValue`/`multiplier`, spread by `sigmaMm`. */
export function throwAimedDart(baseValue: number, multiplier: 1 | 2 | 3, sigmaMm: number, random: () => number = Math.random): DartThrow {
  const aim = aimPointFor(baseValue, multiplier);
  const spread = sigmaMm / DOUBLE_RING_MM;
  return dartAtBoardPoint(aim.u + gaussian(random) * spread, aim.v + gaussian(random) * spread);
}
