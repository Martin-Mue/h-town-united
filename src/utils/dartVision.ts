/**
 * Local, fully offline dart-tip detection via before/after frame differencing — no network
 * call, no AI credits. Runs entirely on two same-size ImageData frames the caller already has
 * on canvas (an "empty board" baseline and an "N darts stuck in" frame): pixels that changed
 * between them get grouped into connected blobs, and each blob's centroid is treated as a
 * dart tip. The actual segment/multiplier/points are then computed by the EXISTING calibration
 * geometry (see LiveCamera.tsx's scoreFromBoardPoint) — this module only has to answer
 * "where did something new appear", not "what score is that".
 *
 * Trade-off vs. the cloud vision model this replaces: a single 2D camera fundamentally can't
 * always separate two dart tips that land very close together (their diff blobs merge into
 * one), and a blob centroid is only an approximation of the true tip pixel — acceptable given
 * the calibration scoring already carries some slack (MISS_TOLERANCE), but less forgiving of
 * odd throw angles than a model that visually traces flight→barrel→tip. When the blob count
 * doesn't match the expected dart count, this reports `uncertain: true` so the caller can fall
 * back to the existing manual-review UI instead of guessing silently.
 *
 * DIFF_THRESHOLD / BLOB_MIN_PX / BLOB_MAX_PX are heuristics tuned for "a phone camera a
 * meter-ish from the board" — they will likely need adjusting against a real setup (different
 * lighting, camera distance, board type). If detection is consistently too jumpy (picks up
 * shadows/reflections) raise DIFF_THRESHOLD; if it consistently misses thin dart shafts,
 * lower it or BLOB_MIN_PX.
 */

// Luminance delta (0-255 scale) above which a pixel counts as "changed".
const DIFF_THRESHOLD = 30;
// Blob size band (in pixels, at VISION_ANALYSIS_SIZE resolution) considered "plausible dart".
// Too small = noise/reflection/JPEG-ish shimmer; too big = lighting change or a hand in frame.
const BLOB_MIN_PX = 8;
const BLOB_MAX_PX = 3500;
// Sub-band that gets a high confidence score — outside it we still report the blob (better a
// low-confidence guess the player can correct than a silently dropped dart) but flag it for review.
const CONFIDENT_MIN_PX = 15;
const CONFIDENT_MAX_PX = 1800;

/** Frame resolution used for local vision analysis — a compromise between tip-position
 *  precision and flood-fill cost on a mid-range phone. Independent of the resolution used
 *  for the (optional) cloud-AI fallback path. */
export const VISION_ANALYSIS_SIZE = 420;

interface Blob {
  x: number;
  y: number;
  pixelCount: number;
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
 *  to label connected components in the diff mask and return each one's centroid + size. */
function findBlobs(mask: Uint8Array, width: number, height: number): Blob[] {
  const visited = new Uint8Array(mask.length);
  const blobs: Blob[] = [];
  const stack: number[] = [];

  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || visited[start]) continue;
    stack.length = 0;
    stack.push(start);
    visited[start] = 1;
    let count = 0;
    let sumX = 0;
    let sumY = 0;
    while (stack.length > 0) {
      const p = stack.pop()!;
      const x = p % width;
      const y = (p / width) | 0;
      count++;
      sumX += x;
      sumY += y;
      if (x > 0 && mask[p - 1] && !visited[p - 1]) { visited[p - 1] = 1; stack.push(p - 1); }
      if (x < width - 1 && mask[p + 1] && !visited[p + 1]) { visited[p + 1] = 1; stack.push(p + 1); }
      if (y > 0 && mask[p - width] && !visited[p - width]) { visited[p - width] = 1; stack.push(p - width); }
      if (y < height - 1 && mask[p + width] && !visited[p + width]) { visited[p + width] = 1; stack.push(p + width); }
    }
    if (count >= BLOB_MIN_PX && count <= BLOB_MAX_PX) {
      blobs.push({ x: (sumX / count + 0.5) / width, y: (sumY / count + 0.5) / height, pixelCount: count });
    }
  }
  return blobs;
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
  const mask = buildDiffMask(before, after);
  const blobs = findBlobs(mask, before.width, before.height).sort((a, b) => b.pixelCount - a.pixelCount);
  const picked = blobs.slice(0, wanted);
  const darts = picked.map((b) => ({
    x: b.x,
    y: b.y,
    confidence: b.pixelCount >= CONFIDENT_MIN_PX && b.pixelCount <= CONFIDENT_MAX_PX ? 0.75 : 0.45,
  }));
  const uncertain = darts.length === 0 || darts.length !== wanted;
  return { darts, uncertain };
}
