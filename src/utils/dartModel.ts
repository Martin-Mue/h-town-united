/**
 * On-device inference for the trained YOLOv8 dart-detection model (public/models/best.onnx,
 * trained via the Colab pipeline discussed with the user — 5 classes: `dart` + 4 calibration-
 * corner classes `cal_1..cal_4`, input 800x800, see the model's embedded ultralytics metadata).
 * Runs fully offline via onnxruntime-web (WASM execution provider, self-hosted binary under
 * public/ort/ — no CDN dependency, matches this app's "local mode = no network call" contract).
 *
 * Unlike dartVision.ts's before/after pixel-diff heuristic, dart detection needs only ONE frame
 * (with darts already stuck in) — a real trained detector finds each dart directly instead of
 * finding "what changed". Training used small boxes (~2.5% of image size) tightly centered on
 * each dart's tip, so a predicted box's center IS the tip estimate, same convention
 * LocalDetection already uses.
 *
 * The `cal_1..cal_4` calibration-corner classes are also decoded (see
 * detectCalibrationPointsWithModel), which LiveCamera.tsx uses for one-shot auto-calibration
 * instead of requiring 4 manual taps every time. Point IDENTITY (which numeric cal_x is which
 * physical double-20/6/3/11 corner) is intentionally NOT trusted here — nothing in this repo
 * documents that labeling convention, and guessing wrong would silently swap two corners. The
 * caller instead assigns roles geometrically (topmost -> D20, etc.), which only assumes a
 * normally-mounted, non-rotated board — see LiveCamera.tsx's tryAutoCalibrate. Auto-calibration
 * always falls back to manual tapping (still available on demand via "Kalibrierung neu
 * starten") whenever the model isn't confident enough or the 4 points can't be cleanly told
 * apart by position.
 */

import * as ort from "onnxruntime-web/wasm";
import type { LocalDetection } from "./dartVision";

ort.env.wasm.wasmPaths = "/ort/";
// Force single-threaded: the threaded wasm binary works fine at numThreads=1 without
// cross-origin-isolation (COOP/COEP) headers, which this app's static hosting doesn't set.
// Multi-threading would need SharedArrayBuffer, which is unavailable without those headers.
ort.env.wasm.numThreads = 1;

/** Model was trained/exported at this fixed square input size — see the embedded metadata. */
export const MODEL_INPUT_SIZE = 800;

const MODEL_URL = "/models/best.onnx";
// Order matches the model's embedded `names` metadata exactly — index IS the class id.
const CLASS_NAMES = ["dart", "cal_1", "cal_2", "cal_3", "cal_4"] as const;
type CalLabel = Exclude<(typeof CLASS_NAMES)[number], "dart">;
const CAL_LABELS = CLASS_NAMES.slice(1) as CalLabel[];
const DART_CLASS_INDEX = 0;
const NUM_CLASSES = CLASS_NAMES.length;

// The Colab validation metrics (mAP50 ~0.99) are against images from the SAME distribution as
// training — a real club board/camera/lighting is a different distribution, and real-world
// confidence commonly comes in well below validation-set confidence for exactly that reason.
// Kept low deliberately: local mode never auto-commits regardless (see LiveCamera.tsx), so a
// low-confidence hit still just becomes "please review", which is strictly better than silently
// finding nothing and falling back to the older, less accurate motion-diff heuristic.
const DART_SCORE_THRESHOLD = 0.15;
// Calibration is higher-stakes than a single dart — a wrong corner miscalibrates the WHOLE
// session, not just one throw — so this stays conservative; a low-confidence calibration attempt
// just falls back to manual tapping instead of committing to a shaky guess.
const CAL_SCORE_THRESHOLD = 0.45;
const NMS_IOU_THRESHOLD = 0.5;

let sessionPromise: Promise<ort.InferenceSession> | null = null;

function getSession(): Promise<ort.InferenceSession> {
  if (!sessionPromise) {
    sessionPromise = ort.InferenceSession.create(MODEL_URL, { executionProviders: ["wasm"] });
  }
  return sessionPromise;
}

/** Kicks off model download+compile in the background; safe to call repeatedly (idempotent) —
 *  a second call while the first is still in flight returns the SAME promise, and a caller that
 *  needs to be sure the model is actually ready (e.g. before attempting auto-calibration) can
 *  just await this again instead of polling. Resolves false (never throws) if the model can't be
 *  loaded, so callers can fall back. */
export async function preloadDartModel(): Promise<boolean> {
  try {
    await getSession();
    return true;
  } catch (err) {
    console.warn("[dartModel] failed to load", err);
    sessionPromise = null; // allow a later retry instead of permanently caching the failure
    return false;
  }
}

interface RawDet {
  cx: number;
  cy: number;
  w: number;
  h: number;
  score: number;
}

interface DecodedOutput {
  darts: RawDet[];
  /** Best-scoring box per calibration class, keyed by class name — undefined if that class
   *  never crossed CAL_SCORE_THRESHOLD anywhere in the frame. */
  calPoints: Partial<Record<CalLabel, RawDet>>;
  /** Highest raw dart-class score seen in the whole frame, threshold or not — for diagnostics
   *  when nothing crosses DART_SCORE_THRESHOLD, so a field report can include a real number
   *  ("model saw 0.09 max") instead of just "nothing found". */
  maxDartScore: number;
}

/**
 * Decodes the raw model output into per-class candidates. Ultralytics' (non-NMS, non-end2end)
 * ONNX export shape is normally [1, 4+nc, numAnchors] (channels-first), but this reads `dims` at
 * runtime and handles the transposed [1, numAnchors, 4+nc] layout too, rather than assuming one —
 * a wrong assumption here would silently decode garbage boxes instead of erroring.
 */
function decodeOutput(output: ort.Tensor): DecodedOutput {
  const empty: DecodedOutput = { darts: [], calPoints: {}, maxDartScore: 0 };
  const dims = output.dims;
  const data = output.data as Float32Array;
  const channels = 4 + NUM_CLASSES;
  let numAnchors: number;
  let channelsFirst: boolean;
  if (dims.length === 3 && dims[1] === channels) {
    numAnchors = dims[2];
    channelsFirst = true;
  } else if (dims.length === 3 && dims[2] === channels) {
    numAnchors = dims[1];
    channelsFirst = false;
  } else {
    console.warn("[dartModel] unexpected output shape", dims);
    return empty;
  }
  const at = (c: number, k: number) => (channelsFirst ? data[c * numAnchors + k] : data[k * channels + c]);
  const darts: RawDet[] = [];
  const calPoints: Partial<Record<CalLabel, RawDet>> = {};
  let maxDartScore = 0;
  for (let k = 0; k < numAnchors; k++) {
    const cx = at(0, k), cy = at(1, k), w = at(2, k), h = at(3, k);
    const dartScore = at(4 + DART_CLASS_INDEX, k);
    if (dartScore > maxDartScore) maxDartScore = dartScore;
    if (dartScore >= DART_SCORE_THRESHOLD) darts.push({ cx, cy, w, h, score: dartScore });
    for (let ci = 0; ci < CAL_LABELS.length; ci++) {
      const score = at(4 + 1 + ci, k);
      if (score < CAL_SCORE_THRESHOLD) continue;
      const label = CAL_LABELS[ci];
      if (!calPoints[label] || score > calPoints[label]!.score) {
        calPoints[label] = { cx, cy, w, h, score };
      }
    }
  }
  return { darts, calPoints, maxDartScore };
}

function iou(a: RawDet, b: RawDet): number {
  const ax1 = a.cx - a.w / 2, ay1 = a.cy - a.h / 2, ax2 = a.cx + a.w / 2, ay2 = a.cy + a.h / 2;
  const bx1 = b.cx - b.w / 2, by1 = b.cy - b.h / 2, bx2 = b.cx + b.w / 2, by2 = b.cy + b.h / 2;
  const iw = Math.max(0, Math.min(ax2, bx2) - Math.max(ax1, bx1));
  const ih = Math.max(0, Math.min(ay2, by2) - Math.max(ay1, by1));
  const inter = iw * ih;
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
}

/** Greedy NMS, highest score first, capped at `max` (the number of darts still expected). */
function nms(dets: RawDet[], iouThreshold: number, max: number): RawDet[] {
  const sorted = dets.slice().sort((a, b) => b.score - a.score);
  const kept: RawDet[] = [];
  for (const d of sorted) {
    if (kept.length >= max) break;
    if (kept.some((k) => iou(k, d) > iouThreshold)) continue;
    kept.push(d);
  }
  return kept;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** RGBA ImageData -> NCHW float32 tensor, 0-1 normalized. `img` must already be MODEL_INPUT_SIZE
 *  square (see LiveCamera.tsx's grabImageData(MODEL_INPUT_SIZE, false) — unclipped, matching the
 *  full-square-board-photo framing the model was trained on, not the circular analysis crop used
 *  by the pixel-diff fallback). */
function toTensor(img: ImageData): ort.Tensor {
  const { width, height, data } = img;
  const plane = width * height;
  const chw = new Float32Array(3 * plane);
  for (let i = 0, p = 0; p < plane; i += 4, p++) {
    chw[p] = data[i] / 255;
    chw[plane + p] = data[i + 1] / 255;
    chw[2 * plane + p] = data[i + 2] / 255;
  }
  return new ort.Tensor("float32", chw, [1, 3, height, width]);
}

async function runModel(frame: ImageData): Promise<DecodedOutput | null> {
  let session: ort.InferenceSession;
  try {
    session = await getSession();
  } catch {
    return null;
  }
  try {
    const input = toTensor(frame);
    const results = await session.run({ [session.inputNames[0]]: input });
    const output = results[session.outputNames[0]];
    return decodeOutput(output);
  } catch (err) {
    console.warn("[dartModel] inference failed", err);
    return null;
  }
}

export interface ModelDetectionResult {
  darts: LocalDetection[];
  /** True if the model couldn't be used at all (not loaded yet / inference threw) — caller
   *  should fall back to the pixel-diff heuristic rather than trusting an empty result. */
  unavailable: boolean;
  /** See DecodedOutput.maxDartScore — only meaningful when `darts` came back empty. */
  maxDartScore?: number;
}

/** Runs the trained model on one MODEL_INPUT_SIZE-square frame and returns up to `maxDarts`
 *  dart-tip detections, highest-confidence first, in the frame's own 0-1 coordinate space. */
export async function detectDartsWithModel(frame: ImageData, maxDarts: number): Promise<ModelDetectionResult> {
  const decoded = await runModel(frame);
  if (!decoded) return { darts: [], unavailable: true };
  const kept = nms(decoded.darts, NMS_IOU_THRESHOLD, Math.max(1, maxDarts));
  const darts: LocalDetection[] = kept.map((d) => ({
    x: clamp01(d.cx / frame.width),
    y: clamp01(d.cy / frame.height),
    confidence: d.score,
  }));
  return { darts, unavailable: false, maxDartScore: decoded.maxDartScore };
}

export interface CalibrationPointResult {
  /** One point per cal_x class that crossed CAL_SCORE_THRESHOLD — may have fewer than 4 entries.
   *  Coordinates are in the frame's own 0-1 space, same convention as dart detections. */
  points: Partial<Record<CalLabel, { x: number; y: number; score: number }>>;
  unavailable: boolean;
}

/** Runs the trained model on one MODEL_INPUT_SIZE-square frame and returns the best candidate for
 *  each of the 4 calibration-corner classes (fewer than 4 if some weren't confidently found). */
export async function detectCalibrationPointsWithModel(frame: ImageData): Promise<CalibrationPointResult> {
  const decoded = await runModel(frame);
  if (!decoded) return { points: {}, unavailable: true };
  const points: CalibrationPointResult["points"] = {};
  for (const label of CAL_LABELS) {
    const d = decoded.calPoints[label];
    if (d) points[label] = { x: clamp01(d.cx / frame.width), y: clamp01(d.cy / frame.height), score: d.score };
  }
  return { points, unavailable: false };
}
