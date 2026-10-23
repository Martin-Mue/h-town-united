/**
 * Where did the picture change between two frames of the board?
 *
 * Exactly one dart lands per throw, so comparing the board picture before and after it shows where
 * that dart is — however tightly it sits next to the earlier ones, which are identical in both
 * pictures and therefore drop out. The review uses this to accept only a new-dart candidate that
 * stands on freshly changed pixels, which is what keeps clusters apart: an old dart that the model
 * merely re-detects with a slightly different position, or a phantom box on bare board, has no
 * change under it.
 */

import type { PixelBuffer } from "./boardRectify";

export interface ChangeMap {
  size: number;
  /** size x size grid, 1 where the picture changed noticeably. */
  changed: Uint8Array;
  /** Share of all cells that changed — a very high share means lighting or exposure moved. */
  share: number;
}

/** A pixel counts as changed when its colour moved by more than this (0-255, mean of R/G/B). */
const PIXEL_DELTA = 28;
/** A grid cell counts as changed when this share of its pixels did (a barrel is thin). */
const CELL_SHARE = 0.05;

export const buildChangeMap = (before: PixelBuffer, after: PixelBuffer, size = 100): ChangeMap | null => {
  if (before.width !== after.width || before.height !== after.height) return null;
  const { width, height } = before;
  const changed = new Uint8Array(size * size);
  let total = 0;
  for (let gy = 0; gy < size; gy++) {
    const y0 = Math.floor((gy * height) / size);
    const y1 = Math.floor(((gy + 1) * height) / size);
    for (let gx = 0; gx < size; gx++) {
      const x0 = Math.floor((gx * width) / size);
      const x1 = Math.floor(((gx + 1) * width) / size);
      let hits = 0;
      let samples = 0;
      for (let y = y0; y < y1; y += 2) {
        for (let x = x0; x < x1; x += 2) {
          const i = (y * width + x) * 4;
          const d = (Math.abs(before.data[i] - after.data[i]) + Math.abs(before.data[i + 1] - after.data[i + 1]) + Math.abs(before.data[i + 2] - after.data[i + 2])) / 3;
          if (d > PIXEL_DELTA) hits++;
          samples++;
        }
      }
      if (samples > 0 && hits / samples >= CELL_SHARE) {
        changed[gy * size + gx] = 1;
        total++;
      }
    }
  }
  return { size, changed, share: total / (size * size) };
};

/** Share (0-1) of the grid cells within `radius` (fraction of the frame width) of (x, y) that changed. */
export const changedShareNear = (map: ChangeMap, x: number, y: number, radius = 0.05): number => {
  const { size, changed } = map;
  let cells = 0;
  let hits = 0;
  const reach = Math.ceil(radius * size);
  const cx = Math.floor(x * size);
  const cy = Math.floor(y * size);
  for (let gy = Math.max(0, cy - reach); gy <= Math.min(size - 1, cy + reach); gy++) {
    for (let gx = Math.max(0, cx - reach); gx <= Math.min(size - 1, cx + reach); gx++) {
      const dx = (gx + 0.5) / size - x;
      const dy = (gy + 0.5) / size - y;
      if (Math.hypot(dx, dy) > radius) continue;
      cells++;
      if (changed[gy * size + gx]) hits++;
    }
  }
  return cells ? hits / cells : 0;
};
