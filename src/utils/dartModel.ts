/**
 * On-device inference for the trained YOLOv8 dart-detection model (public/models/best.onnx,
 * trained via the Colab pipeline discussed with the user — 5 classes: `dart` + 4 calibration-
 * corner classes `cal_1..cal_4`, input 800x800, see the model's embedded ultralytics metadata).
 * Runs fully offline via onnxruntime-web (WASM execution provider, self-hosted binary under
 * public/ort/ — no CDN dependency, matches this app's "local mode = no network call" contract).
 *
 * Only the `dart` class is decoded here. The `cal_1..cal_4` calibration-point classes are in the
 * model output too, but auto-calibration isn't wired up yet: mapping a model-space detection into
 * the same coordinate convention as a manual calibration tap (LiveCamera.tsx's CSS-object-cover
 * display rect, vs. this module's digital cropRect()-relative frame) needs verifying against a
 * real camera/board, which isn't available in this environment — left as a follow-up so a wrong
 * mapping can't silently miscalibrate scoring.
 *
 * Unlike dartVision.ts's before/after pixel-diff heuristic, this needs only ONE frame (with darts
 * already stuck in) — a real trained detector finds each dart directly instead of finding "what
 * changed". Training used small boxes (~2.5% of image size) tightly centered on each dart's tip,
 * so a predicted box's center IS the tip estimate, same convention LocalDetection already uses.
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
const DART_CLASS_INDEX = 0;
const NUM_CLASSES = CLASS_NAMES.length;

const DART_SCORE_THRESHOLD = 0.35;
const NMS_IOU_THRESHOLD = 0.5;

let sessionPromise: Promise<ort.InferenceSession> | null = null;

function getSession(): Promise<ort.InferenceSession> {
  if (!sessionPromise) {
    sessionPromise = ort.InferenceSession.create(MODEL_URL, { executionProviders: ["wasm"] });
  }
  return sessionPromise;
}

/** Kicks off model download+compile in the background; safe to call repeatedly (idempotent).
 *  Resolves false (never throws) if the model can't be loaded, so callers can fall back. */
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

/**
 * Decodes the raw model output into `dart`-class boxes above threshold. Ultralytics' (non-NMS,
 * non-end2end) ONNX export shape is normally [1, 4+nc, numAnchors] (channels-first), but this
 * reads `dims` at runtime and handles the transposed [1, numAnchors, 4+nc] layout too, rather than
 * assuming one — a wrong assumption here would silently decode garbage boxes instead of erroring.
 */
function decodeDartDetections(output: ort.Tensor): RawDet[] {
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
    return [];
  }
  const at = (c: number, k: number) => (channelsFirst ? data[c * numAnchors + k] : data[k * channels + c]);
  const out: RawDet[] = [];
  for (let k = 0; k < numAnchors; k++) {
    const score = at(4 + DART_CLASS_INDEX, k);
    if (score < DART_SCORE_THRESHOLD) continue;
    out.push({ cx: at(0, k), cy: at(1, k), w: at(2, k), h: at(3, k), score });
  }
  return out;
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

export interface ModelDetectionResult {
  darts: LocalDetection[];
  /** True if the model couldn't be used at all (not loaded yet / inference threw) — caller
   *  should fall back to the pixel-diff heuristic rather than trusting an empty result. */
  unavailable: boolean;
}

/** Runs the trained model on one MODEL_INPUT_SIZE-square frame and returns up to `maxDarts`
 *  dart-tip detections, highest-confidence first, in the frame's own 0-1 coordinate space. */
export async function detectDartsWithModel(frame: ImageData, maxDarts: number): Promise<ModelDetectionResult> {
  let session: ort.InferenceSession;
  try {
    session = await getSession();
  } catch {
    return { darts: [], unavailable: true };
  }
  try {
    const input = toTensor(frame);
    const results = await session.run({ [session.inputNames[0]]: input });
    const output = results[session.outputNames[0]];
    const raw = decodeDartDetections(output);
    const kept = nms(raw, NMS_IOU_THRESHOLD, Math.max(1, maxDarts));
    const darts: LocalDetection[] = kept.map((d) => ({
      x: clamp01(d.cx / frame.width),
      y: clamp01(d.cy / frame.height),
      confidence: d.score,
    }));
    return { darts, unavailable: false };
  } catch (err) {
    console.warn("[dartModel] inference failed", err);
    return { darts: [], unavailable: true };
  }
}
