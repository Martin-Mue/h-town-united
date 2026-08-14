/**
 * Local, offline dartboard framing detection — a classical-CV replacement for the cloud AI's
 * "find the board center/size" step (analyze-dartboard's detectBoard mode), used only to give
 * the manual 4-point tap calibration a good starting crop/zoom instead of whatever the camera
 * happened to be pointed at. It does NOT replace the manual taps — a coarse circle search like
 * this is nowhere near precise enough to trust blind for actual scoring geometry (segments are
 * only ~4.5° wide), it just gets the board roughly centered and appropriately zoomed so the
 * manual calibration tap points are easy to place accurately.
 *
 * Method: a dartboard is a small, high-local-contrast circular region (alternating black/white/
 * colored wedges, a dark outer wire) against a comparatively low-contrast background (wall,
 * cabinet, surround). This scores a grid of candidate (center, radius) circles by how much
 * busier ("livelier") the inside is than a ring just outside it, plus how sharp the actual
 * boundary between them is, and returns the best-scoring one. It's a coarse search on a small
 * downsampled grayscale grid — cheap enough to run once at camera startup, not meant for
 * per-frame use.
 */

export interface BoardCircleDetection {
  /** Center, 0-1 normalized to the full video frame. */
  cx: number;
  cy: number;
  /** Diameter as a fraction of min(frameWidth, frameHeight). */
  size: number;
  /** 0-1 — how much better the best candidate scored vs. a "no real circle" baseline. Coarse,
   *  not a real probability; only meant to gate "is this worth trusting at all". */
  confidence: number;
}

const GRID = 96;
// Candidate centers: an NxN grid within this fraction of the frame around its geometric
// center — assumes the camera is roughly (not perfectly) pointed at the board already.
const CENTER_SEARCH_STEPS = 7;
const CENTER_SEARCH_SPAN = 0.3;
// Candidate board diameters as a fraction of min(width, height) — matches this app's own
// calib.size convention/range (0.4-0.98, default target ~0.82) rather than an arbitrary range.
const SIZE_CANDIDATES = [0.4, 0.5, 0.6, 0.7, 0.8, 0.9];
const OUTER_RING_FACTOR = 1.18;

interface Grid {
  data: Float32Array;
  width: number;
  height: number;
}

/** Downsamples to a max side of `maxSize`, preserving aspect ratio — a non-square scale
 *  (e.g. mapping a 4:3 frame into a square grid) would turn circles into ellipses and throw
 *  off every radius/position calculation downstream, so both axes always use the same factor. */
function downsampleLuminance(image: ImageData, maxSize: number): Grid {
  const { width, height, data } = image;
  const scale = maxSize / Math.max(width, height);
  const gw = Math.max(1, Math.round(width * scale));
  const gh = Math.max(1, Math.round(height * scale));
  const out = new Float32Array(gw * gh);
  for (let gy = 0; gy < gh; gy++) {
    const sy = Math.min(height - 1, Math.floor(((gy + 0.5) / gh) * height));
    for (let gx = 0; gx < gw; gx++) {
      const sx = Math.min(width - 1, Math.floor(((gx + 0.5) / gw) * width));
      const i = (sy * width + sx) * 4;
      out[gy * gw + gx] = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
    }
  }
  return { data: out, width: gw, height: gh };
}

function statsInRing(grid: Grid, cx: number, cy: number, rMin: number, rMax: number) {
  const { data: lum, width, height } = grid;
  let sum = 0, sumSq = 0, count = 0;
  const minX = Math.max(0, Math.floor(cx - rMax));
  const maxX = Math.min(width - 1, Math.ceil(cx + rMax));
  const minY = Math.max(0, Math.floor(cy - rMax));
  const maxY = Math.min(height - 1, Math.ceil(cy + rMax));
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (d < rMin || d > rMax) continue;
      const v = lum[y * width + x];
      sum += v;
      sumSq += v * v;
      count++;
    }
  }
  if (count === 0) return { mean: 0, std: 0, count: 0 };
  const mean = sum / count;
  const variance = Math.max(0, sumSq / count - mean * mean);
  return { mean, std: Math.sqrt(variance), count };
}

/**
 * Searches a coarse grid of candidate board circles against a full video frame and returns the
 * best-scoring one, or null if nothing scored convincingly (e.g. camera not pointed at a board
 * yet, or too dark/blurry). Caller should still route the result through the normal manual
 * calibration step — see the module doc comment.
 */
export function detectBoardCircleLocally(image: ImageData): BoardCircleDetection | null {
  const grid = downsampleLuminance(image, GRID);
  // Same convention as calib.size elsewhere in the app: diameter as a fraction of the SHORTER
  // side, since that's what limits how big a centered circle can be regardless of aspect ratio.
  const minSideGrid = Math.min(grid.width, grid.height);
  const half = minSideGrid / 2;

  let best: { cx: number; cy: number; r: number; score: number } | null = null;

  for (let iy = 0; iy < CENTER_SEARCH_STEPS; iy++) {
    const fy = 0.5 + (iy / (CENTER_SEARCH_STEPS - 1) - 0.5) * CENTER_SEARCH_SPAN;
    const cy = fy * grid.height;
    for (let ix = 0; ix < CENTER_SEARCH_STEPS; ix++) {
      const fx = 0.5 + (ix / (CENTER_SEARCH_STEPS - 1) - 0.5) * CENTER_SEARCH_SPAN;
      const cx = fx * grid.width;
      for (const sizeFrac of SIZE_CANDIDATES) {
        const r = (sizeFrac * minSideGrid) / 2;
        const outerR = Math.min(half, r * OUTER_RING_FACTOR);
        if (outerR <= r) continue;
        const inside = statsInRing(grid, cx, cy, 0, r);
        const outside = statsInRing(grid, cx, cy, r, outerR);
        if (inside.count < 20 || outside.count < 20) continue;
        // "Busier" inside than outside (a board is a patchwork of colors; a wall/surround is
        // comparatively uniform), plus a real boundary should show up as a mean brightness jump.
        const varianceScore = inside.std - outside.std;
        const edgeScore = Math.abs(inside.mean - outside.mean) / 255;
        const score = varianceScore + edgeScore * 40;
        if (!best || score > best.score) best = { cx, cy, r, score };
      }
    }
  }

  if (!best || best.score <= 0) return null;
  // Rough, heuristic confidence — not calibrated against real data, just "did the best
  // candidate clearly beat a flat/no-circle reading" so a near-zero score doesn't get reported
  // as if it were a real find.
  const confidence = Math.max(0, Math.min(1, best.score / 60));
  return {
    cx: best.cx / grid.width,
    cy: best.cy / grid.height,
    size: (best.r * 2) / minSideGrid,
    confidence,
  };
}
