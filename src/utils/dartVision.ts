/**
 * Local, fully offline dart-tip detection via before/after frame differencing — no network
 * call, no AI credits. Runs entirely on two same-size ImageData frames the caller already has
 * on canvas (an "empty board" baseline and an "N darts stuck in" frame): pixels that changed
 * between them get grouped into connected blobs, and each blob is treated as one dart. The
 * actual segment/multiplier/points are then computed by the EXISTING calibration geometry
 * (see LiveCamera.tsx's scoreFromBoardPoint) — this module only has to answer "where did
 * something new appear", not "what score is that".
 *
 * Trade-off vs. the cloud vision model this replaces: a single 2D camera fundamentally can't
 * always separate two dart tips that land very close together (see splitIfLikelyTwoDarts
 * below for the mitigation), and a blob-derived point is only an approximation of the true tip
 * pixel — acceptable given the calibration scoring already carries some slack
 * (MISS_TOLERANCE), but less forgiving of odd throw angles than a model that visually traces
 * flight→barrel→tip. When the blob count doesn't match the expected dart count, this reports
 * `uncertain: true` so the caller can fall back to the existing manual-review UI instead of
 * guessing silently.
 *
 * Why "closest-to-center" instead of centroid: the crop this runs on is always centered on the
 * calibrated board center (see LiveCamera.tsx's cropRect), so image-center == board-center in
 * this coordinate space. A dart sticking out of the board is visually barrel+flight trailing
 * AWAY from the board surface — the tip is where it's actually embedded, which is the part of
 * the diff blob closest to board center, while the flight (usually the biggest, highest-
 * contrast part of the diff) pulls a plain centroid outward, past the real tip. Averaging a
 * small cluster of the closest pixels (not just the single nearest one) keeps this robust to
 * one noisy pixel.
 *
 * DIFF_THRESHOLD / BLOB_MIN_PX / BLOB_MAX_PX are heuristics tuned for "a phone camera a
 * meter-ish from the board" — they will likely need adjusting against a real setup (different
 * lighting, camera distance, board type). If detection is consistently too jumpy (picks up
 * shadows/reflections) raise DIFF_THRESHOLD; if it consistently misses thin dart shafts,
 * lower it or BLOB_MIN_PX.
 */

// Luminance delta (0-255 scale) above which a pixel counts as "changed".
const DIFF_THRESHOLD = 30;
// Blob size band (in pixels, at VISION_ANALYSIS_SIZE resolution) considered "one plausible dart".
// Too small = noise/reflection/JPEG-ish shimmer; too big = lighting change or a hand in frame.
const BLOB_MIN_PX = 8;
const BLOB_MAX_PX = 3500;
// Above BLOB_MAX_PX but below this, an elongated blob is treated as "maybe two darts that
// landed close together and merged" and a split is attempted (see splitIfLikelyTwoDarts).
// Above THIS, it's almost certainly a lighting change or an arm/hand in frame, not darts.
const MERGED_MAX_PX = BLOB_MAX_PX * 1.7;
// Long-side/short-side bounding-box ratio above which a big blob looks like "two round-ish
// things in a line" rather than one irregular blob — the shape check before attempting a split.
const MERGED_ASPECT_RATIO = 1.6;
// Sub-band that gets a high confidence score — outside it we still report the blob (better a
// low-confidence guess the player can correct than a silently dropped dart) but flag it for review.
const CONFIDENT_MIN_PX = 15;
const CONFIDENT_MAX_PX = 1800;
// How many of a blob's pixels (closest to board center) get averaged into the tip estimate.
const INNER_POINT_SAMPLE = 12;

/** Frame resolution used for local vision analysis — a compromise between tip-position
 *  precision and flood-fill cost on a mid-range phone. Independent of the resolution used
 *  for the (optional) cloud-AI fallback path. */
export const VISION_ANALYSIS_SIZE = 420;

interface RawBlob {
  pixels: { x: number; y: number }[];
  minX: number; maxX: number; minY: number; maxY: number;
}

interface ScoredBlob {
  x: number;
  y: number;
  pixelCount: number;
  /** True if this came out of splitting a larger merged blob — inherently less certain. */
  wasSplit: boolean;
}

/** Binary "changed" mask (1 = changed) from two same-size ImageData frames. Fully-transparent
 *  pixels (outside the circular board crop, see drawToCanvas's clip) never count as changed. */
function buildDiffMask(before: ImageData, after: ImageData): Uint8Array {
  const { width, height, data: a } = before;
  const b = after.data;
  const mask = new Uint8Array(width * height);
  for (let i = 0, p = 0; p < width * height; i += 4, p++) {
    if (a[i + 3] === 0 || b[i + 3] === 0) continue;
    const dl =
      Math.abs(a[i] - b[i]) * 0.299 +
      Math.abs(a[i + 1] - b[i + 1]) * 0.587 +
      Math.abs(a[i + 2] - b[i + 2]) * 0.114;
    if (dl >= DIFF_THRESHOLD) mask[p] = 1;
  }
  return mask;
}

/** Iterative (stack-based — avoids call-stack overflow on a big blob) 4-connected flood fill
 *  to label connected components in the diff mask. Keeps every pixel (not just running sums)
 *  so callers can compute a center-weighted tip point and, for oversized blobs, attempt a split. */
function findRawBlobs(mask: Uint8Array, width: number, height: number): RawBlob[] {
  const visited = new Uint8Array(mask.length);
  const blobs: RawBlob[] = [];
  const stack: number[] = [];

  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || visited[start]) continue;
    stack.length = 0;
    stack.push(start);
    visited[start] = 1;
    const pixels: { x: number; y: number }[] = [];
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    while (stack.length > 0) {
      const p = stack.pop()!;
      const x = p % width;
      const y = (p / width) | 0;
      pixels.push({ x, y });
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (x > 0 && mask[p - 1] && !visited[p - 1]) { visited[p - 1] = 1; stack.push(p - 1); }
      if (x < width - 1 && mask[p + 1] && !visited[p + 1]) { visited[p + 1] = 1; stack.push(p + 1); }
      if (y > 0 && mask[p - width] && !visited[p - width]) { visited[p - width] = 1; stack.push(p - width); }
      if (y < height - 1 && mask[p + width] && !visited[p + width]) { visited[p + width] = 1; stack.push(p + width); }
      // A blob this big is never going to pass MERGED_MAX_PX anyway (lighting change / arm in
      // frame) — stop growing it early rather than flood-filling the whole frame for nothing.
      if (pixels.length > MERGED_MAX_PX * 2) break;
    }
    blobs.push({ pixels, minX, maxX, minY, maxY });
  }
  return blobs;
}

/** Average of the `INNER_POINT_SAMPLE` pixels closest to (cx, cy) — the tip estimate. See the
 *  module doc comment for why "closest to board/image center" beats a plain centroid here. */
function innerPoint(pixels: { x: number; y: number }[], cx: number, cy: number): { x: number; y: number } {
  const withDist = pixels.map((p) => ({ p, d: (p.x - cx) ** 2 + (p.y - cy) ** 2 }));
  withDist.sort((a, b) => a.d - b.d);
  const sample = withDist.slice(0, Math.min(INNER_POINT_SAMPLE, withDist.length));
  const sx = sample.reduce((s, v) => s + v.p.x, 0) / sample.length;
  const sy = sample.reduce((s, v) => s + v.p.y, 0) / sample.length;
  return { x: sx, y: sy };
}

/**
 * A blob in the "too big for one dart, not absurdly big either" band gets checked for the
 * classic "two darts landed close together" shape: elongated (long/short bounding-box ratio
 * above MERGED_ASPECT_RATIO). If it looks like that, split its pixels into two halves along
 * the long axis at the bounding-box midpoint and treat each half as its own candidate dart —
 * both halves must independently land in the valid single-dart size band or the whole blob is
 * rejected (safer to fall back to manual review than to guess two darts that aren't really there).
 */
function splitIfLikelyTwoDarts(blob: RawBlob, cx: number, cy: number): ScoredBlob[] | null {
  const w = blob.maxX - blob.minX;
  const h = blob.maxY - blob.minY;
  const long = Math.max(w, h);
  const short = Math.max(1, Math.min(w, h));
  if (long / short < MERGED_ASPECT_RATIO) return null;

  const splitOnX = w >= h;
  const mid = splitOnX ? (blob.minX + blob.maxX) / 2 : (blob.minY + blob.maxY) / 2;
  const groupA = blob.pixels.filter((p) => (splitOnX ? p.x : p.y) < mid);
  const groupB = blob.pixels.filter((p) => (splitOnX ? p.x : p.y) >= mid);
  if (groupA.length < BLOB_MIN_PX || groupA.length > BLOB_MAX_PX) return null;
  if (groupB.length < BLOB_MIN_PX || groupB.length > BLOB_MAX_PX) return null;

  return [groupA, groupB].map((group) => {
    const pt = innerPoint(group, cx, cy);
    return { x: pt.x, y: pt.y, pixelCount: group.length, wasSplit: true };
  });
}

function scoreBlobs(raw: RawBlob[], width: number, height: number): ScoredBlob[] {
  const cx = width / 2;
  const cy = height / 2;
  const out: ScoredBlob[] = [];
  for (const blob of raw) {
    const count = blob.pixels.length;
    if (count >= BLOB_MIN_PX && count <= BLOB_MAX_PX) {
      const pt = innerPoint(blob.pixels, cx, cy);
      out.push({ x: pt.x, y: pt.y, pixelCount: count, wasSplit: false });
    } else if (count > BLOB_MAX_PX && count <= MERGED_MAX_PX) {
      const split = splitIfLikelyTwoDarts(blob, cx, cy);
      if (split) out.push(...split);
      // else: doesn't look like two merged darts either — drop it (probably noise/lighting).
    }
    // count < BLOB_MIN_PX or count > MERGED_MAX_PX: not dart-shaped, ignored.
  }
  return out;
}

export interface LocalDetection {
  /** Tip position, 0-1 relative to the analyzed (circular-cropped) frame — same convention
   *  the cloud AI's x/y used, so it drops straight into refineWithCalibration. */
  x: number;
  y: number;
  confidence: number;
}

export interface LocalDetectionResult {
  darts: LocalDetection[];
  /** True when the number of plausible blobs found didn't match what was expected, or none
   *  were found at all — the caller should route this to manual review, not auto-commit. */
  uncertain: boolean;
}

/**
 * Compares an "empty board" baseline against an "after N darts" frame (must be the same
 * pixel size — same crop/zoom) and returns up to `expectedCount` dart-tip candidates,
 * largest (= most likely a real dart, not noise) blobs first.
 */
export function detectDartTipsLocally(
  before: ImageData,
  after: ImageData,
  expectedCount: number
): LocalDetectionResult {
  if (before.width !== after.width || before.height !== after.height) {
    return { darts: [], uncertain: true };
  }
  const wanted = Math.max(1, expectedCount);
  const { width, height } = before;
  const mask = buildDiffMask(before, after);
  const raw = findRawBlobs(mask, width, height);
  const scored = scoreBlobs(raw, width, height).sort((a, b) => b.pixelCount - a.pixelCount);
  const picked = scored.slice(0, wanted);
  const darts = picked.map((b) => ({
    x: (b.x + 0.5) / width,
    y: (b.y + 0.5) / height,
    confidence: b.wasSplit
      ? 0.5 // split blobs get a manual-review nudge even in the "confident" size band
      : b.pixelCount >= CONFIDENT_MIN_PX && b.pixelCount <= CONFIDENT_MAX_PX ? 0.75 : 0.45,
  }));
  const uncertain = darts.length === 0 || darts.length !== wanted;
  return { darts, uncertain };
}
