/**
 * Snaps four rough calibration points onto the board's real wires by looking at the picture.
 *
 * The four points (D20 top, D3 bottom, D11 left, D6 right, all on the outer double edge) come from a
 * hand tap, the model or the last session — good for a few millimetres at best, and the camera on a
 * tripod with zoom moves between sessions. The board itself offers something far more exact: the
 * double and treble rings are the only strongly red/green parts, and the colour alternates segment by
 * segment (20 red, 1 green, 18 red, ...). So a calibration is right when, sampled along the predicted
 * double and treble rings, every point has exactly the colour the standard board has there — and just
 * inside/outside those rings there is no colour. That is a smooth score of the eight corner
 * coordinates, so a pattern search walks from the rough start to the best fit. Rotation is pinned by
 * the colour order, scale by the two rings, perspective by the whole outline.
 */
import { applyHomography, computeHomography, type Homography, type Point } from "./homography";
import { CANON_BOARD_POINTS } from "./cameraGeometry";

export interface WireFitImage {
  /** RGBA, row-major (ImageData layout). */
  data: ArrayLike<number>;
  width: number;
  height: number;
}

/** A picture prepared for fitting — build once per camera frame, fit as often as needed. */
export interface PreparedWireFit {
  width: number;
  height: number;
  fine: Float32Array;
  blurred: Map<number, Float32Array>;
}

export interface WireFitResult {
  /** Refined taps as picture fractions (0..1), same order as the input. */
  taps: Point[];
  /** Fit quality 0..1 after / before the search — how well the rings line up with real colour. */
  quality: number;
  startQuality: number;
}

/** Board order clockwise from the top; even index = red double/treble, odd = green. */
const RING_SAMPLE_STEP_DEG = 1.5;
/** Canonical radii (outer double edge = 1): centre of the double band and of the treble band. */
const DOUBLE_MID = 0.9765;
const TREBLE_MID = 0.6055;
/** Sample spots that must stay colourless: just outside / inside each band. */
const DOUBLE_OUT = 1.07;
const DOUBLE_IN = 0.905;
const TREBLE_OUT = 0.69;
const TREBLE_IN = 0.52;
/** Samples this close to a segment wire (degrees) are skipped — the colour flips there. */
const WIRE_MARGIN_DEG = 1.1;
/** No tap may travel further than this share of the board radius from where it started. */
const MAX_TRAVEL = 0.4;

/** Signed redness: + red, − green, ~0 for black/white/wood. Independent of overall brightness. */
const buildChromaMap = (img: WireFitImage): Float32Array => {
  const n = img.width * img.height;
  const out = new Float32Array(n);
  const d = img.data;
  for (let i = 0; i < n; i++) {
    const r = d[i * 4], g = d[i * 4 + 1];
    out[i] = (r - g) / (r + g + 40);
  }
  return out;
};

/** Separable box blur by running sums — widens the basin so the search finds the rings from afar. */
const boxBlur = (src: Float32Array, w: number, h: number, radius: number): Float32Array => {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  const span = radius * 2 + 1;
  for (let y = 0; y < h; y++) {
    let sum = 0;
    const row = y * w;
    for (let x = -radius; x <= radius; x++) sum += src[row + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = sum / span;
      sum += src[row + Math.min(w - 1, x + radius + 1)] - src[row + Math.max(0, x - radius)];
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let y = -radius; y <= radius; y++) sum += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = sum / span;
      sum += tmp[Math.min(h - 1, y + radius + 1) * w + x] - tmp[Math.max(0, y - radius) * w + x];
    }
  }
  return out;
};

const sampleBilinear = (map: Float32Array, w: number, h: number, x: number, y: number): number => {
  if (x < 0 || y < 0 || x > w - 1 || y > h - 1) return 0;
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1);
  const tx = x - x0, ty = y - y0;
  return (map[y0 * w + x0] * (1 - tx) + map[y0 * w + x1] * tx) * (1 - ty) + (map[y1 * w + x0] * (1 - tx) + map[y1 * w + x1] * tx) * ty;
};

interface RingSample { u: number; v: number; sign: number }

/** The fixed sample layout in canonical board space: where to look and which colour to expect. */
const buildRingSamples = () => {
  const mid: { double: RingSample[]; treble: RingSample[] } = { double: [], treble: [] };
  const off: Point[] = [];
  for (let deg = 0; deg < 360; deg += RING_SAMPLE_STEP_DEG) {
    const fromWire = ((deg + 9) % 18);
    const wireDistance = Math.min(fromWire, 18 - fromWire);
    if (wireDistance < WIRE_MARGIN_DEG) continue;
    const segment = Math.floor(((deg + 9) % 360) / 18);
    const sign = segment % 2 === 0 ? 1 : -1;
    const rad = (deg * Math.PI) / 180;
    const dirU = Math.sin(rad), dirV = -Math.cos(rad);
    mid.double.push({ u: dirU * DOUBLE_MID, v: dirV * DOUBLE_MID, sign });
    mid.treble.push({ u: dirU * TREBLE_MID, v: dirV * TREBLE_MID, sign });
    for (const r of [DOUBLE_OUT, DOUBLE_IN, TREBLE_OUT, TREBLE_IN]) off.push({ x: dirU * r, y: dirV * r });
  }
  return { mid, off };
};
const RING_SAMPLES = buildRingSamples();

const scoreHomography = (H: Homography, map: Float32Array, w: number, h: number): number => {
  let sum = 0, count = 0;
  for (const band of [RING_SAMPLES.mid.double, RING_SAMPLES.mid.treble]) {
    for (const s of band) {
      const p = applyHomography(H, { x: s.u, y: s.v });
      sum += s.sign * sampleBilinear(map, w, h, p.x, p.y);
      count++;
    }
  }
  // colourless spots: any red/green there means the ring is not where we think it is
  let stray = 0;
  for (const s of RING_SAMPLES.off) {
    const p = applyHomography(H, s);
    stray += Math.abs(sampleBilinear(map, w, h, p.x, p.y));
  }
  return sum / count - 0.5 * (stray / RING_SAMPLES.off.length);
};

type TapSet = Point[];

const homographyFor = (pointsPx: TapSet): Homography | null => computeHomography(CANON_BOARD_POINTS, pointsPx);

const coarseMapFor = (prepared: PreparedWireFit, radiusPx: number, divisor = 45): Float32Array => {
  const blurRadius = Math.max(2, Math.round(radiusPx / divisor));
  let coarse = prepared.blurred.get(blurRadius);
  if (!coarse) {
    coarse = boxBlur(prepared.fine, prepared.width, prepared.height, blurRadius);
    prepared.blurred.set(blurRadius, coarse);
  }
  return coarse;
};

export function prepareWireFit(img: WireFitImage): PreparedWireFit {
  return { width: img.width, height: img.height, fine: buildChromaMap(img), blurred: new Map() };
}

/** Quality from which a fit counts as "this really is the board" (a good fit scores ~0.65). */
export const WIRE_FIT_CONFIDENT = 0.45;

/**
 * @param taps the rough calibration, picture fractions (0..1)
 * @returns the refined taps, or null when the picture does not show a board where the taps say
 *  (no improvement / colour not found) — callers then keep what they had.
 */
export function refineTapsToWires(prepared: PreparedWireFit, taps: Point[]): WireFitResult | null {
  const { width: w, height: h, fine } = prepared;
  if (taps.length !== 4 || w < 64 || h < 64) return null;
  const start: TapSet = taps.map((t) => ({ x: t.x * w, y: t.y * h }));
  const radiusPx = Math.max(Math.hypot(start[3].x - start[2].x, start[3].y - start[2].y), Math.hypot(start[1].x - start[0].x, start[1].y - start[0].y)) / 2;
  if (radiusPx < 40) return null;

  const wide = coarseMapFor(prepared, radiusPx, 14);
  const coarse = coarseMapFor(prepared, radiusPx, 45);

  const evaluate = (pts: TapSet, map: Float32Array): number => {
    const H = homographyFor(pts);
    return H ? scoreHomography(H, map, w, h) : -Infinity;
  };

  const clampTravel = (pts: TapSet): TapSet =>
    pts.map((p, i) => {
      const dx = p.x - start[i].x, dy = p.y - start[i].y;
      const d = Math.hypot(dx, dy), max = MAX_TRAVEL * radiusPx;
      return d > max ? { x: start[i].x + (dx / d) * max, y: start[i].y + (dy / d) * max } : p;
    });

  /** The moves a step can make: each tap on its own, plus the whole outline shifted, scaled, turned. */
  const candidatesAround = (pts: TapSet, step: number): TapSet[] => {
    const out: TapSet[] = [];
    for (let i = 0; i < 4; i++) {
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        out.push(pts.map((p, j) => (j === i ? { x: p.x + dx * step, y: p.y + dy * step } : p)));
      }
    }
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) out.push(pts.map((p) => ({ x: p.x + dx * step, y: p.y + dy * step })));
    const mx = pts.reduce((a, p) => a + p.x, 0) / 4, my = pts.reduce((a, p) => a + p.y, 0) / 4;
    for (const k of [1 + step / radiusPx, 1 - step / radiusPx]) out.push(pts.map((p) => ({ x: mx + (p.x - mx) * k, y: my + (p.y - my) * k })));
    for (const a of [step / radiusPx, -step / radiusPx]) {
      const cos = Math.cos(a), sin = Math.sin(a);
      out.push(pts.map((p) => ({ x: mx + (p.x - mx) * cos - (p.y - my) * sin, y: my + (p.x - mx) * sin + (p.y - my) * cos })));
    }
    return out.map(clampTravel);
  };

  const search = (from: TapSet, map: Float32Array, firstStep: number, lastStep: number): { pts: TapSet; score: number } => {
    let pts = from;
    let score = evaluate(pts, map);
    for (let step = firstStep; step >= lastStep; step /= 2) {
      for (let guard = 0; guard < 80; guard++) {
        let bestPts: TapSet | null = null, bestScore = score;
        for (const cand of candidatesAround(pts, step)) {
          const s = evaluate(cand, map);
          if (s > bestScore + 1e-6) { bestScore = s; bestPts = cand; }
        }
        if (!bestPts) break;
        pts = bestPts;
        score = bestScore;
      }
    }
    return { pts, score };
  };

  const startQuality = evaluate(start, fine);
  const far = search(start, wide, radiusPx * 0.16, radiusPx * 0.04);
  const rough = search(far.pts, coarse, radiusPx * 0.06, radiusPx * 0.01);
  const exact = search(rough.pts, fine, radiusPx * 0.012, radiusPx * 0.0015);
  const quality = exact.score;

  // A real board gives clearly positive colour agreement. Anything weaker means "no board found".
  if (quality < 0.12 || quality < startQuality - 1e-6) return null;
  return { taps: exact.pts.map((p) => ({ x: p.x / w, y: p.y / h })), quality, startQuality };
}

/**
 * Rough starting positions for finding a board anywhere in the picture: centres on a grid, several
 * sizes, then squashed variants (a board seen from the side is an ellipse, not a circle). The fit only
 * travels ~40 % of the board radius, so one start is always close to a real board. Ordered most likely
 * first — a centred board of medium size is found by the first few.
 */
export function boardSearchStarts(width: number, height: number): Point[][] {
  const short = Math.min(width, height);
  const starts: Point[][] = [];
  const spots = [[0.5, 0.5], [0.5, 0.4], [0.5, 0.6], [0.38, 0.5], [0.62, 0.5], [0.38, 0.38], [0.62, 0.38], [0.38, 0.62], [0.62, 0.62]];
  for (const squash of [1, 0.8, 0.65]) {
    for (const r of [0.36, 0.28, 0.44, 0.2, 0.32, 0.4]) {
      for (const [fx, fy] of spots) {
        const cx = fx * width, cy = fy * height, rad = r * short;
        starts.push([
          { x: cx / width, y: (cy - rad * squash) / height },
          { x: cx / width, y: (cy + rad * squash) / height },
          { x: (cx - rad) / width, y: cy / height },
          { x: (cx + rad) / width, y: cy / height },
        ]);
      }
    }
  }
  return starts;
}

/** Tries the starts in order and returns the first really good fit, else the best confident one
 *  found within `maxMs` (a phone must not hang on a picture without a board). */
export function findBoardTaps(prepared: PreparedWireFit, maxMs = 3500, starts: Point[][] = boardSearchStarts(prepared.width, prepared.height)): WireFitResult | null {
  const began = Date.now();
  let best: WireFitResult | null = null;
  for (const start of starts) {
    if (Date.now() - began > maxMs) break;
    const fit = refineTapsToWires(prepared, start);
    if (fit && (!best || fit.quality > best.quality)) best = fit;
    if (best && best.quality >= 0.6) break;
  }
  return best && best.quality >= WIRE_FIT_CONFIDENT ? best : null;
}
