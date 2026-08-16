import { useEffect, useRef, useState, useCallback, forwardRef, useImperativeHandle } from "react";
import {
  AlertCircle,
  Camera,
  Check,
  ChevronDown,
  ChevronUp,
  Loader2,
  RotateCcw,
  ScanLine,
  Target,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { supabase } from "@/integrations/supabase/client";
import { SEGMENTS_CLOCKWISE, RING } from "@/utils/dartboardGeometry";
import { detectDartTipsLocally, VISION_ANALYSIS_SIZE } from "@/utils/dartVision";
import { detectDartsWithModel, detectCalibrationPointsWithModel, preloadDartModel, MODEL_INPUT_SIZE } from "@/utils/dartModel";
import { computeHomography, applyHomography, type Homography } from "@/utils/homography";
import {
  playDartDetectedSound,
  playRoundCommittedSound,
  playScanStartSound,
} from "@/utils/sounds";

/**
 * LiveCamera – fully automated dart auto-scoring (dartsmind-style).
 *
 * Pipeline:
 *   1. Camera starts, AI single-shot board detection → automatic crop / zoom.
 *   2. Frame-difference loop (no manual baseline calibration needed).
 *      When the picture *changes* (dart lands or is pulled) and then
 *      *settles*, we send one frame to the AI which returns ALL darts
 *      currently stuck in the board.
 *   3. Delta against last known darts → new darts get appended (+sound).
 *   4. When the board is empty again (darts pulled), the round commits
 *      automatically and the rolling video clip is forwarded.
 */

export interface DetectedDart {
  baseValue: number;
  multiplier: 1 | 2 | 3;
  points: number;
  confidence: number;
  /** Tip position relative to the cropped analysis frame (0-1) — for the live on-screen overlay only. */
  x?: number;
  y?: number;
  /** Tip position in board-relative unit coordinates (0,0 = bull, radius ~1 = double edge) — camera-framing-independent, safe to persist/aggregate (see heatmap). */
  boardU?: number;
  boardV?: number;
}

interface LiveCameraProps {
  onRoundCommit: (darts: DetectedDart[]) => void;
  onPendingChange?: (darts: DetectedDart[]) => void;
  enabled: boolean;
  onClose: () => void;
  dartsRemaining?: number;
  playerName?: string;
  /** Called when the player wants to give up on auto-scoring and switch to manual entry after a failed/empty scan. */
  onRequestManualEntry?: () => void;
}

/** Imperative handle so the parent can pull a just-recorded clip when a highlight happens. */
export interface LiveCameraHandle {
  /** The most recently completed rolling-buffer segment (a few seconds of trailing video), or null if none is ready yet. */
  getRecentClip(): { url: string; mime: string; blob: Blob } | null;
}

// Rolling video buffer: rather than one long recording, we record back-to-back
// self-contained segments and always keep the latest completed one in memory.
// A "true" ring buffer of MediaRecorder chunks isn't reliable — only the first
// chunk of a session carries the container header, so chunks can't be dropped
// from the front and reassembled into a valid clip. Short fixed segments avoid
// that entirely while still giving a no-manual-recording "it just captured it" feel.
const CLIP_SEGMENT_MS = 6000;
const pickClipMimeType = (): string => {
  const candidates = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm", "video/mp4"];
  for (const type of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported?.(type)) return type;
  }
  return "video/webm";
};

type Phase = "starting" | "detecting" | "calibrate" | "live" | "scanning" | "error";

interface Calibration {
  x: number;
  y: number;
  size: number;
  zoom: number;
  taps?: { x: number; y: number }[]; // 4 reference points in normalized video coords: D20, D3, D11, D6
}

/** "local" runs the whole pipeline on-device (no network call, no AI credits — see
 *  dartVision.ts); "cloud" keeps the original Gemini-vision-based detection as a fallback for
 *  setups where local blob-diffing proves too unreliable (bad lighting, overlapping darts).
 *  Device-wide, not per-board, since it reflects "does this tablet have/want a connection". */
type DetectionMode = "local" | "cloud";
const DETECTION_MODE_KEY = "dartcam-detection-mode";
const loadDetectionMode = (): DetectionMode => {
  if (typeof window === "undefined") return "local";
  return window.localStorage.getItem(DETECTION_MODE_KEY) === "cloud" ? "cloud" : "local";
};

/**
 * Opt-in, per-device: every local-mode scan already captures a matched "empty board" /
 * "darts stuck in" image pair (see dartVision.ts), and every manual correction the player makes
 * in the review UI (see accumulated/adjustDart/removeDart below) is a real, free label for that
 * pair. When enabled, a committed round's final (possibly player-corrected) dart positions get
 * uploaded alongside the image pair to the `dart-training` bucket / `training_samples` table —
 * so a labeled dataset for a real from-scratch model (see the dart-sense research) builds itself
 * from normal club play instead of needing a dedicated data-collection effort. Default ON since
 * that's the whole point, but stays a visible, per-device toggle (see the advanced panel) since
 * the captured frame is a live board photo, not something to upload silently without a way to opt out.
 */
const TRAINING_DATA_KEY = "dartcam-training-data-enabled";
const loadTrainingDataEnabled = (): boolean => {
  if (typeof window === "undefined") return true;
  return window.localStorage.getItem(TRAINING_DATA_KEY) !== "off";
};

const CALIB_KEY = "dartcam-calibration-v5";
const CALIB_LABELS = ["Doppel 20 (oben)", "Doppel 3 (unten)", "Doppel 11 (links)", "Doppel 6 (rechts)"] as const;
const CALIB_KEYS = ["D20", "D3", "D11", "D6"] as const;
// Just needs all 4 present — identity doesn't matter, see tryAutoCalibrate's geometric assignment.
const CAL_LABELS_ORDER = ["cal_1", "cal_2", "cal_3", "cal_4"] as const;

// Multi-board support: club nights run several boards (and cameras) at once. Each device
// remembers which physical board it's pointed at, and calibration + camera-device choice are
// namespaced per board so the same tablet can be reassigned between boards over an evening
// without clobbering another board's tap calibration. Board "1" reuses the original
// unsuffixed key so existing single-board calibrations keep working after this update.
const ACTIVE_BOARD_KEY = "dartcam-active-board";
const calibKeyFor = (board: string) => (board && board !== "1" ? `${CALIB_KEY}:${board}` : CALIB_KEY);
const deviceKeyFor = (board: string) => `dartcam-device:${board}`;

const loadActiveBoard = (): string => {
  if (typeof window === "undefined") return "1";
  const raw = window.localStorage.getItem(ACTIVE_BOARD_KEY);
  const n = raw ? parseInt(raw, 10) : 1;
  return String(Number.isFinite(n) && n > 0 ? n : 1);
};
const saveActiveBoard = (board: string) => {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(ACTIVE_BOARD_KEY, board);
};
const loadDeviceId = (board: string): string | null => {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(deviceKeyFor(board));
};
const saveDeviceId = (board: string, deviceId: string | null) => {
  if (typeof window === "undefined") return;
  if (deviceId) window.localStorage.setItem(deviceKeyFor(board), deviceId);
  else window.localStorage.removeItem(deviceKeyFor(board));
};
const GRID = 40;
const TARGET_BOARD_RATIO = 0.82;
const DEFAULT_ZOOM = 1;
const MIN_ANALYSIS_SIZE = 0.55;

// Frame-to-frame diff considered "still" (no motion). Tighter → weniger falsche Trigger.
const MOTION_STILL = 0.012;
// Diff between current and last *stable* frame → physical change occurred. Höher → weniger Reaktion auf Licht/Hand.
const CHANGE_DELTA = 0.075;
// Frames of stillness required after a change before scanning. ~1.6s bei 400ms Tick.
const STILL_AFTER_CHANGE = 4;
// Tick interval of the watcher loop.
const TICK_MS = 400;
const SCAN_COOLDOWN_MS = 3200;
// The client now derives the actual segment/ring geometrically from the tip
// position (see refineWithCalibration below), so the AI's confidence is really
// just "is this a real dart tip" — a lower bar than "did I classify it right".
// Keeping this too strict silently drops real detections, which reads as
// "nothing found" to the player. Better to show a borderline detection (which
// they can edit/remove) than to show nothing.
const MIN_DART_CONFIDENCE = 0.4;
// Below this, or if any dart is missing a usable tip position (falling back to the AI's
// much less reliable raw segment guess instead of the deterministic calibration math),
// the round is shown for manual review (Übernehmen/Verwerfen) instead of auto-committing.
const AUTO_COMMIT_CONFIDENCE = 0.6;
const EMPTY_BOARD_DELTA = 0.022;
const DART_POSITION_MATCH = 0.09;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

const loadCalib = (key: string = CALIB_KEY): Calibration => {
  if (typeof window === "undefined")
    return { x: 0.5, y: 0.5, size: 0.82, zoom: DEFAULT_ZOOM };
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return { x: 0.5, y: 0.5, size: 0.82, zoom: DEFAULT_ZOOM };
    const p = JSON.parse(raw);
    let taps = Array.isArray(p?.taps) && p.taps.length === 4
      ? p.taps.map((t: any) => ({ x: clamp(Number(t?.x) || 0.5, 0, 1), y: clamp(Number(t?.y) || 0.5, 0, 1) }))
      : undefined;
    // A calibration saved before the tap-validation check existed (or corrupted localStorage)
    // could be degenerate — silently scoring every dart as "Miss" forever if trusted as-is.
    // Discard it here so the app falls back to "not calibrated" and prompts a fresh 4-point tap.
    if (taps && !computeHomography(taps, CANON_BOARD_POINTS)) taps = undefined;
    return {
      x: clamp(Number(p?.x) || 0.5, 0.15, 0.85),
      y: clamp(Number(p?.y) || 0.5, 0.15, 0.85),
      size: clamp(Number(p?.size) || 0.82, 0.4, 0.98),
      zoom: clamp(Number(p?.zoom) || DEFAULT_ZOOM, 1, 4),
      taps,
    };
  } catch {
    return { x: 0.5, y: 0.5, size: 0.82, zoom: DEFAULT_ZOOM };
  }
};

type BoardDetection = {
  cx?: number;
  cy?: number;
  size?: number;
  confidence?: number;
};

type ZoomCapability = { min: number; max: number; step: number };

const dartLabel = (d: DetectedDart) => {
  if (d.baseValue === 0) return "Miss";
  if (d.baseValue === 25) return d.multiplier === 2 ? "Bull 50" : "Bull 25";
  const prefix = d.multiplier === 2 ? "D" : d.multiplier === 3 ? "T" : "";
  return `${prefix}${d.baseValue}`;
};

// ─── calibration-based scoring ──────────────────────────────────────
// The AI is good at pointing at a pixel, but unreliable at eyeballing which of
// 82 thin wedges that pixel falls in. Since every session already collects a
// precise 4-point calibration (D20/D3/D11/D6 outer-double-edge taps), we use
// that known geometry to compute the segment/ring deterministically instead
// of trusting the AI's own segment/multiplier guess.
const MISS_TOLERANCE = 1.06; // calibration is never pixel-perfect — a little slack beyond the double edge

// Canonical board-space targets for the 4 calibration taps — top/bottom/left/right of the
// double ring, mapped to a unit circle (radius 1 = double edge). Matches the angle convention
// scoreFromBoardPoint already used (0° = top = D20, growing clockwise).
const CANON_BOARD_POINTS = [
  { x: 0, y: -1 }, // D20 (top)
  { x: 0, y: 1 },  // D3 (bottom)
  { x: -1, y: 0 }, // D11 (left)
  { x: 1, y: 0 },  // D6 (right)
];

/**
 * Builds the perspective (homography) transform from the 4 raw calibration taps (video-frame
 * coords) to canonical board space. A full homography — not just an ellipse fit from a center +
 * two radii — correctly undoes camera *keystone* (an angled camera makes the board look like a
 * trapezoid, not just a squashed circle); see homography.ts for why this matters.
 *
 * `liveCenter`, when given, shifts all 4 taps by the same vector before solving — approximating
 * "the whole board drifted a few cm, camera angle unchanged" (bumped table, wobbly phone mount)
 * so scoring stays correct without a pixel-perfect re-tap, same intent as the previous
 * center-only tracking, just applied before the perspective solve instead of after.
 */
const boardTransformFromTaps = (taps?: { x: number; y: number }[], liveCenter?: { x: number; y: number }): Homography | null => {
  if (!taps || taps.length !== 4) return null;
  const [top, bottom, left, right] = taps; // D20, D3, D11, D6
  let src = taps;
  if (liveCenter) {
    const origCx = (left.x + right.x) / 2;
    const origCy = (top.y + bottom.y) / 2;
    const dx = liveCenter.x - origCx;
    const dy = liveCenter.y - origCy;
    if (Math.abs(dx) > 1e-6 || Math.abs(dy) > 1e-6) {
      src = taps.map((t) => ({ x: t.x + dx, y: t.y + dy }));
    }
  }
  return computeHomography(src, CANON_BOARD_POINTS);
};

// u/v are the tip position in board-relative unit coordinates (0,0 = bull center, radius
// ~1.0 = the calibrated double-ring edge) — independent of camera framing/zoom, so unlike
// the raw video-frame x/y they're safe to persist and compare across different games,
// sessions and devices (see the per-player heatmap in Statistics).
const scoreFromBoardPoint = (fx: number, fy: number, H: Homography) => {
  const { x: u, y: v } = applyHomography(H, { x: fx, y: fy });
  const radius = Math.hypot(u, v);
  let angleDeg = (Math.atan2(v, u) * 180) / Math.PI + 90; // 0° = top (D20), growing clockwise
  angleDeg = ((angleDeg % 360) + 360) % 360;
  const baseValue = SEGMENTS_CLOCKWISE[Math.round(angleDeg / 18) % 20];

  if (radius <= RING.bullInner) return { baseValue: 25, multiplier: 2 as const, points: 50, u, v };
  if (radius <= RING.bullOuter) return { baseValue: 25, multiplier: 1 as const, points: 25, u, v };
  if (radius <= RING.trebleInner) return { baseValue, multiplier: 1 as const, points: baseValue, u, v };
  if (radius <= RING.trebleOuter) return { baseValue, multiplier: 3 as const, points: baseValue * 3, u, v };
  if (radius <= RING.doubleInner) return { baseValue, multiplier: 1 as const, points: baseValue, u, v };
  if (radius <= MISS_TOLERANCE) return { baseValue, multiplier: 2 as const, points: baseValue * 2, u, v };
  return { baseValue: 0, multiplier: 1 as const, points: 0, u, v };
};

const dartKey = (d: DetectedDart) => `${d.baseValue}x${d.multiplier}`;

const hasPosition = (d: DetectedDart) =>
  typeof d.x === "number" && Number.isFinite(d.x) && typeof d.y === "number" && Number.isFinite(d.y);

const dartDistance = (a: DetectedDart, b: DetectedDart) => {
  if (!hasPosition(a) || !hasPosition(b)) return Number.POSITIVE_INFINITY;
  return Math.hypot((a.x ?? 0) - (b.x ?? 0), (a.y ?? 0) - (b.y ?? 0));
};

const samePhysicalDart = (a: DetectedDart, b: DetectedDart) =>
  dartDistance(a, b) < DART_POSITION_MATCH || (!hasPosition(a) && !hasPosition(b) && dartKey(a) === dartKey(b));

const sanitizeAiDarts = (raw: unknown, max: number): DetectedDart[] => {
  if (!Array.isArray(raw)) return [];
  const parsed = raw
    .map((d: unknown) => {
      const dart = d as Partial<DetectedDart> & {
        segment?: unknown;
        multiplier?: unknown;
        points?: unknown;
        confidence?: unknown;
        x?: unknown;
        y?: unknown;
      };
      const baseValue = Number(dart.segment ?? dart.baseValue) || 0;
      const multiplier = ([1, 2, 3].includes(Number(dart.multiplier))
        ? Number(dart.multiplier)
        : 1) as 1 | 2 | 3;
      const fallbackPoints = baseValue === 25 ? (multiplier === 2 ? 50 : 25) : baseValue * multiplier;
      const x = Number(dart.x);
      const y = Number(dart.y);
      // Tips near the double ring legitimately land close to the crop edge — clamp a
      // small overshoot into range instead of dropping the position outright, since
      // losing it means falling back to the AI's much less reliable raw segment guess.
      const EDGE_TOLERANCE = 0.08;
      const validX = Number.isFinite(x) && x >= -EDGE_TOLERANCE && x <= 1 + EDGE_TOLERANCE;
      const validY = Number.isFinite(y) && y >= -EDGE_TOLERANCE && y <= 1 + EDGE_TOLERANCE;
      return {
        baseValue,
        multiplier,
        points: Number.isFinite(Number(dart.points)) ? Number(dart.points) : fallbackPoints,
        confidence: Number(dart.confidence) || 0,
        ...(validX ? { x: clamp(x, 0, 1) } : {}),
        ...(validY ? { y: clamp(y, 0, 1) } : {}),
      };
    })
    .filter((d) => d.confidence >= MIN_DART_CONFIDENCE)
    .sort((a, b) => b.confidence - a.confidence);

  const deduped: DetectedDart[] = [];
  for (const dart of parsed) {
    if (deduped.some((existing) => samePhysicalDart(existing, dart))) continue;
    deduped.push(dart);
    if (deduped.length >= max) break;
  }
  return deduped;
};

function diffNewDarts(prev: DetectedDart[], ai: DetectedDart[]): DetectedDart[] {
  if (ai.length <= prev.length) return [];
  const remaining = ai.slice();
  for (const p of prev) {
    let idx = remaining.findIndex((d) => samePhysicalDart(p, d));
    if (idx < 0) idx = remaining.findIndex((d) => dartKey(d) === dartKey(p));
    if (idx >= 0) remaining.splice(idx, 1);
  }
  return remaining;
}

const LiveCamera = forwardRef<LiveCameraHandle, LiveCameraProps>(({
  onRoundCommit,
  onPendingChange,
  enabled,
  onClose,
  dartsRemaining = 3,
  playerName,
  onRequestManualEntry,
}, ref) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const zoomCapsRef = useRef<ZoomCapability | null>(null);

  // Rolling clip recorder
  const clipRecorderRef = useRef<MediaRecorder | null>(null);
  const clipChunksRef = useRef<BlobPart[]>([]);
  const clipMimeRef = useRef<string>("video/webm");
  const lastClipRef = useRef<{ blob: Blob; mime: string } | null>(null);
  const clipSegmentTimerRef = useRef<number | null>(null);

  // Frame state
  const prevSigRef = useRef<number[] | null>(null);
  const stableSigRef = useRef<number[] | null>(null);
  const emptyBoardSigRef = useRef<number[] | null>(null);
  const stillFramesRef = useRef(0);
  const changeSeenRef = useRef(false);
  const scanLockRef = useRef(false);
  const lastScanAtRef = useRef(0);
  // Cached last stable frame captured WHILE darts were on the board.
  // Used to send to AI once the user pulls the darts.
  const preRemovalFrameRef = useRef<string | null>(null);
  // Same two moments as above (empty baseline / just-before-pulled), but as raw pixel data
  // for local diff-based detection instead of a JPEG string for the cloud AI — see dartVision.ts.
  const emptyImageDataRef = useRef<ImageData | null>(null);
  const preRemovalImageDataRef = useRef<ImageData | null>(null);
  // Unclipped MODEL_INPUT_SIZE-square capture of the same "darts stuck in" moment, for the
  // trained ONNX model (see dartModel.ts) — separate from preRemovalImageDataRef above because
  // that one is circular-cropped at VISION_ANALYSIS_SIZE for the pixel-diff fallback/training
  // upload, a different framing than what the model was trained on. Only populated once the
  // model has actually finished loading (see modelReadyRef).
  const preRemovalModelFrameRef = useRef<ImageData | null>(null);
  const modelReadyRef = useRef(false);
  // Visually observed throws in the current turn (motion → still while board non-empty)
  const throwsSeenRef = useRef(0);
  const [throwsSeen, setThrowsSeen] = useState(0);
  const [detectionMode, setDetectionModeState] = useState<DetectionMode>(() => loadDetectionMode());
  const [modelReady, setModelReady] = useState(false);
  const [lastDetectionSource, setLastDetectionSource] = useState<"model" | "diff" | "cloud" | null>(null);
  const setDetectionMode = (mode: DetectionMode) => {
    if (typeof window !== "undefined") window.localStorage.setItem(DETECTION_MODE_KEY, mode);
    setDetectionModeState(mode);
  };
  const [trainingDataEnabled, setTrainingDataEnabledState] = useState<boolean>(() => loadTrainingDataEnabled());
  const setTrainingDataEnabled = (enabled: boolean) => {
    if (typeof window !== "undefined") window.localStorage.setItem(TRAINING_DATA_KEY, enabled ? "on" : "off");
    setTrainingDataEnabledState(enabled);
  };
  // Snapshot of the image pair a scan was just run on, held onto until the round is committed
  // (by then `preRemovalImageDataRef`/`emptyImageDataRef` have already been cleared/overwritten
  // for the next throw) — see uploadTrainingSample.
  const pendingTrainingCaptureRef = useRef<{ before: ImageData; after: ImageData } | null>(null);

  const [phase, setPhase] = useState<Phase>("starting");
  const [error, setError] = useState<string | null>(null);
  const [accumulated, setAccumulated] = useState<DetectedDart[]>([]);
  const accumulatedRef = useRef<DetectedDart[]>([]);
  const [status, setStatus] = useState("Kamera startet …");
  const [scanFailed, setScanFailed] = useState(false);
  const [needsReview, setNeedsReview] = useState(false);
  const [motion, setMotion] = useState(0);
  const [changeDelta, setChangeDelta] = useState(0);
  const [lastConfidence, setLastConfidence] = useState(0);
  const [activeBoard, setActiveBoard] = useState<string>(() => loadActiveBoard());
  const [calib, setCalib] = useState<Calibration>(() => loadCalib(calibKeyFor(loadActiveBoard())));
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(() => loadDeviceId(loadActiveBoard()));
  const [autoCalibrating, setAutoCalibrating] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [justAddedIndex, setJustAddedIndex] = useState<number | null>(null);
  const [calibStep, setCalibStep] = useState(0);
  const [pendingTaps, setPendingTaps] = useState<{ x: number; y: number }[]>([]);
  const [activeTap, setActiveTap] = useState<{ x: number; y: number } | null>(null);
  const calibOverlayRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    accumulatedRef.current = accumulated;
    onPendingChange?.(accumulated);
  }, [accumulated, onPendingChange]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(calibKeyFor(activeBoard), JSON.stringify(calib));
  }, [calib, activeBoard]);

  // Background-load the trained model once the camera panel is actually open — no point
  // fetching a 12MB model if the player never opens auto-scoring. A ref (not just state) tracks
  // readiness so the watcher-loop interval closure (set up once per phase, see below) always
  // reads the current value instead of whatever it was when that interval started.
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void preloadDartModel().then((ok) => {
      if (cancelled) return;
      modelReadyRef.current = ok;
      setModelReady(ok);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  const resetLoop = useCallback(() => {
    prevSigRef.current = null;
    stableSigRef.current = null;
    stillFramesRef.current = 0;
    changeSeenRef.current = false;
    scanLockRef.current = false;
    preRemovalFrameRef.current = null;
    preRemovalImageDataRef.current = null;
    preRemovalModelFrameRef.current = null;
    pendingTrainingCaptureRef.current = null;
    throwsSeenRef.current = 0;
    setThrowsSeen(0);
  }, []);

  // ─── rolling clip recorder ──────────────────────────────────────────
  // Records back-to-back short segments for as long as the camera is on, so a
  // "just captured it" clip is always ready without the user ever hitting record.
  const stopClipRecorder = useCallback(() => {
    if (clipSegmentTimerRef.current) {
      window.clearTimeout(clipSegmentTimerRef.current);
      clipSegmentTimerRef.current = null;
    }
    const rec = clipRecorderRef.current;
    clipRecorderRef.current = null;
    if (rec && rec.state !== "inactive") {
      rec.onstop = null;
      try { rec.stop(); } catch { /* already stopped */ }
    }
  }, []);

  const startClipSegment = useCallback(() => {
    const stream = streamRef.current;
    if (!stream || typeof MediaRecorder === "undefined") return;
    const mime = pickClipMimeType();
    clipMimeRef.current = mime;
    clipChunksRef.current = [];
    let recorder: MediaRecorder;
    try {
      // Modest bitrate — this is a short highlight replay, not archival footage, and
      // keeping the encoder light avoids competing with the frame-diff/AI-scan pipeline
      // for CPU on lower-end phones.
      recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 1_000_000 });
    } catch {
      return; // unsupported on this device — no clip feature, scoring still works
    }
    clipRecorderRef.current = recorder;
    recorder.ondataavailable = (e) => { if (e.data.size > 0) clipChunksRef.current.push(e.data); };
    recorder.onstop = () => {
      if (clipChunksRef.current.length > 0) {
        lastClipRef.current = { blob: new Blob(clipChunksRef.current, { type: mime }), mime };
      }
      // Immediately roll into the next segment for continuous coverage.
      if (clipRecorderRef.current === recorder) startClipSegment();
    };
    recorder.start();
    clipSegmentTimerRef.current = window.setTimeout(() => {
      if (clipRecorderRef.current === recorder && recorder.state !== "inactive") recorder.stop();
    }, CLIP_SEGMENT_MS);
  }, []);

  useImperativeHandle(ref, () => ({
    getRecentClip: () => {
      const clip = lastClipRef.current;
      if (!clip) return null;
      return { url: URL.createObjectURL(clip.blob), mime: clip.mime, blob: clip.blob };
    },
  }), []);

  // ─── camera lifecycle ───────────────────────────────────────────────
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    (async () => {
      try {
        setPhase("starting");
        setStatus("Kamera startet …");
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            ...(selectedDeviceId ? { deviceId: { exact: selectedDeviceId } } : { facingMode: { ideal: "environment" } }),
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => undefined);
        }
        // Device labels are only populated once permission has been granted — this is the
        // first point they're available, letting the "Kamera" picker show real names instead
        // of blank entries when a machine has more than one camera attached (multi-board rigs).
        navigator.mediaDevices.enumerateDevices()
          .then((all) => setDevices(all.filter((d) => d.kind === "videoinput")))
          .catch(() => undefined);
        startClipSegment();
        const track = stream.getVideoTracks()[0];
        const capabilities = track?.getCapabilities?.() as MediaTrackCapabilities & {
          zoom?: { min: number; max: number; step?: number };
        };
        if (capabilities?.zoom) {
          zoomCapsRef.current = {
            min: capabilities.zoom.min ?? 1,
            max: capabilities.zoom.max ?? 4,
            step: capabilities.zoom.step ?? 0.1,
          };
          await applyCameraZoom(calib.zoom);
        } else {
          zoomCapsRef.current = null;
        }
        setTimeout(() => {
          if (!cancelled) void autoDetectBoard();
        }, 600);
      } catch (err) {
        console.error("camera error", err);
        setError("Kamerazugriff nicht möglich. Bitte Berechtigung erteilen.");
        setPhase("error");
      }
    })();
    return () => {
      cancelled = true;
      stopClipRecorder();
      lastClipRef.current = null;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, selectedDeviceId, activeBoard]);

  // ─── helpers ────────────────────────────────────────────────────────
  const cropRect = () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return null;
    const minSide = Math.min(v.videoWidth, v.videoHeight);
    const side = clamp(minSide * calib.size, minSide * 0.4, minSide * 0.98);
    const cx = v.videoWidth * calib.x;
    const cy = v.videoHeight * calib.y;
    const sx = clamp(cx - side / 2, 0, v.videoWidth - side);
    const sy = clamp(cy - side / 2, 0, v.videoHeight - side);
    return { sx, sy, side };
  };

  // A point relative to the cropped/zoomed analysis frame (0-1) -> the full video frame (the
  // same space calibration taps and the live overlay both use). Shared by dart positions
  // (toFullFrameXY below) AND the model's auto-detected calibration corners (see
  // tryAutoCalibrate) — using the identical formula for both is what makes auto-calibration
  // self-consistent with dart scoring without needing to know how manual taps relate to it.
  const cropXYToFullFrame = (x: number, y: number): { fx: number; fy: number } | null => {
    const v = videoRef.current;
    const rect = cropRect();
    if (!v || !rect || !v.videoWidth || !v.videoHeight) return null;
    return {
      fx: (rect.sx + x * rect.side) / v.videoWidth,
      fy: (rect.sy + y * rect.side) / v.videoHeight,
    };
  };

  // Dart x/y come back relative to the cropped/zoomed analysis frame — map to the full
  // video frame (the same space calibration taps and the live overlay both use).
  const toFullFrameXY = (d: DetectedDart): { fx: number; fy: number } | null => {
    if (!hasPosition(d)) return null;
    return cropXYToFullFrame(d.x ?? 0, d.y ?? 0);
  };

  // Recompute each dart's segment/multiplier from its tip pixel via the 4-point
  // calibration instead of trusting the AI's own visual guess — much more reliable
  // since it turns "classify into 1 of 82 thin wedges" into simple geometry.
  const refineWithCalibration = (darts: DetectedDart[]): DetectedDart[] => {
    const transform = boardTransformFromTaps(calib.taps, { x: calib.x, y: calib.y });
    if (!transform) return darts;
    return darts.map((d) => {
      const full = toFullFrameXY(d);
      if (!full) return d;
      const scored = scoreFromBoardPoint(full.fx, full.fy, transform);
      return { ...d, baseValue: scored.baseValue, multiplier: scored.multiplier, points: scored.points, boardU: scored.u, boardV: scored.v };
    });
  };

  const drawToCanvas = (target: number, circular = true) => {
    const v = videoRef.current;
    const c = canvasRef.current;
    const r = cropRect();
    if (!v || !c || !r) return null;
    c.width = target;
    c.height = target;
    const ctx = c.getContext("2d");
    if (!ctx) return null;
    ctx.clearRect(0, 0, target, target);
    if (circular) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(target / 2, target / 2, target / 2 - 1, 0, Math.PI * 2);
      ctx.clip();
    }
    ctx.drawImage(v, r.sx, r.sy, r.side, r.side, 0, 0, target, target);
    if (circular) ctx.restore();
    return c;
  };

  /** Raw pixel snapshot of the current (circular-cropped) board view, for local diff-based
   *  detection — same crop/zoom as drawToCanvas so an "empty" and a "with darts" capture line
   *  up pixel-for-pixel. */
  const grabImageData = (target: number = VISION_ANALYSIS_SIZE, circular = true): ImageData | null => {
    const c = drawToCanvas(target, circular);
    if (!c) return null;
    const ctx = c.getContext("2d");
    if (!ctx) return null;
    return ctx.getImageData(0, 0, target, target);
  };

  const buildSignature = (): number[] | null => {
    const c = drawToCanvas(GRID, true);
    if (!c) return null;
    const ctx = c.getContext("2d");
    if (!ctx) return null;
    const { data } = ctx.getImageData(0, 0, GRID, GRID);
    const sig: number[] = [];
    const r = GRID / 2;
    for (let y = 0; y < GRID; y++) {
      for (let x = 0; x < GRID; x++) {
        const dx = x + 0.5 - r;
        const dy = y + 0.5 - r;
        if (dx * dx + dy * dy > (r - 1) ** 2) continue;
        const i = (y * GRID + x) * 4;
        sig.push(
          (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) / 255,
        );
      }
    }
    return sig;
  };

  const sigDiff = (a: number[] | null, b: number[] | null) => {
    if (!a || !b || a.length !== b.length) return 1;
    let s = 0;
    for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
    return s / a.length;
  };

  const getVideoTrack = () => streamRef.current?.getVideoTracks()[0] ?? null;

  const applyCameraZoom = useCallback(async (zoom: number) => {
    const track = getVideoTrack();
    if (!track || typeof track.applyConstraints !== "function") return;
    try {
      await track.applyConstraints({ advanced: [{ zoom } as MediaTrackConstraintSet] });
    } catch {
      /* unsupported */
    }
  }, []);

  const updateAutoCalibration = useCallback(async (board?: BoardDetection | null) => {
    if (!board?.confidence || Number(board.confidence) < 0.35) return;
    // Once the user has done the precise 4-point tap calibration, those tap coordinates
    // are recorded relative to the camera's physical framing at that moment. Letting
    // auto-calibration keep nudging the actual hardware zoom afterwards silently
    // invalidates every tap — the board transform in scoreFromBoardPoint would then be
    // computing segments/rings against a frame that's no longer what was calibrated,
    // which reads as "detection got worse over the session" even though nothing about
    // the AI changed. So: soft-drift the digital crop (x/y/size) for framing/motion-diff
    // purposes always, but never touch physical zoom again once real taps exist.
    const hasManualCalibration = (calib.taps?.length ?? 0) === 4;
    const nextX = clamp(Number(board.cx) || calib.x, 0.15, 0.85);
    const nextY = clamp(Number(board.cy) || calib.y, 0.15, 0.85);
    const boardSize = clamp(Number(board.size) || calib.size, 0.35, 0.98);
    const nextSize = clamp(boardSize * 1.08, MIN_ANALYSIS_SIZE, 0.98);
    const nextZoom = zoomCapsRef.current
      ? clamp(TARGET_BOARD_RATIO / boardSize, zoomCapsRef.current.min, zoomCapsRef.current.max)
      : calib.zoom;
    setCalib((prev) => ({
      ...prev,
      x: prev.x * 0.5 + nextX * 0.5,
      y: prev.y * 0.5 + nextY * 0.5,
      size: prev.size * 0.4 + nextSize * 0.6,
      zoom: hasManualCalibration ? prev.zoom : prev.zoom * 0.4 + nextZoom * 0.6,
    }));
    if (zoomCapsRef.current && !hasManualCalibration) await applyCameraZoom(nextZoom);
  }, [applyCameraZoom, calib.x, calib.y, calib.size, calib.zoom, calib.taps]);

  const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

  const captureFrame = (target = 1024, quality = 0.82) => {
    const c = drawToCanvas(target, true);
    return c ? c.toDataURL("image/jpeg", quality) : null;
  };

  const captureFullFrame = (target = 960, quality = 0.72) => {
    const v = videoRef.current;
    const c = canvasRef.current;
    if (!v || !c || !v.videoWidth || !v.videoHeight) return null;
    const scale = target / v.videoWidth;
    const height = Math.max(1, Math.round(v.videoHeight * scale));
    c.width = target;
    c.height = height;
    const ctx = c.getContext("2d");
    if (!ctx) return null;
    ctx.clearRect(0, 0, target, height);
    ctx.drawImage(v, 0, 0, v.videoWidth, v.videoHeight, 0, 0, target, height);
    return c.toDataURL("image/jpeg", quality);
  };

  const isRetryable = (error: unknown) => {
    const status =
      typeof error === "object" && error !== null && "status" in error
        ? Number((error as { status?: unknown }).status)
        : NaN;
    const retryable =
      typeof error === "object" && error !== null && "retryable" in error
        ? Boolean((error as { retryable?: unknown }).retryable)
        : null;
    const message = error instanceof Error ? error.message : String(error ?? "");
    return (
      retryable === true ||
      [429, 500, 502, 503, 504].includes(status) ||
      message.includes("non-2xx") ||
      message.includes("Rate limit") ||
      message.includes("AI analysis failed")
    );
  };

  const makeErr = (message: string, status?: number, retryable = true) => {
    const err = new Error(message) as Error & { status?: number; retryable?: boolean };
    if (typeof status === "number") err.status = status;
    err.retryable = retryable;
    return err;
  };

  /** Re-draws raw pixel data onto a scratch canvas to get a compressed, uploadable JPEG blob —
   *  ImageData itself can't be uploaded directly. */
  const imageDataToBlob = (img: ImageData, quality = 0.85): Promise<Blob | null> => {
    const canvas = document.createElement("canvas");
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return Promise.resolve(null);
    ctx.putImageData(img, 0, 0);
    return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/jpeg", quality));
  };

  /** Best-effort background upload of one training sample (see TRAINING_DATA_KEY doc comment) —
   *  never throws into the caller and never blocks/slows down the actual scoring flow it hangs
   *  off of. `darts` is the FINAL, possibly player-corrected list at the moment of commit, which
   *  is exactly the free label this whole feature exists to capture. */
  const uploadTrainingSample = async (
    capture: { before: ImageData; after: ImageData },
    darts: DetectedDart[],
  ) => {
    try {
      const labels = darts
        .filter(hasPosition)
        .map((d) => ({ x: d.x, y: d.y, baseValue: d.baseValue, multiplier: d.multiplier, boardU: d.boardU, boardV: d.boardV }));
      if (labels.length === 0) return;
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData?.user?.id;
      if (!userId) return;
      const [beforeBlob, afterBlob] = await Promise.all([
        imageDataToBlob(capture.before),
        imageDataToBlob(capture.after),
      ]);
      if (!beforeBlob || !afterBlob) return;
      const prefix = `${userId}/${crypto.randomUUID()}`;
      const [beforeUp, afterUp] = await Promise.all([
        supabase.storage.from("dart-training").upload(`${prefix}/before.jpg`, beforeBlob, { contentType: "image/jpeg" }),
        supabase.storage.from("dart-training").upload(`${prefix}/after.jpg`, afterBlob, { contentType: "image/jpeg" }),
      ]);
      if (beforeUp.error || afterUp.error) return;
      await supabase.from("training_samples").insert({
        user_id: userId,
        board: activeBoard,
        before_path: `${prefix}/before.jpg`,
        after_path: `${prefix}/after.jpg`,
        image_size: VISION_ANALYSIS_SIZE,
        labels,
      });
    } catch (err) {
      console.warn("[LiveCamera] training sample upload skipped", err);
    }
  };

  const analyzeFrame = async (imageBase64: string, detectBoard = false) => {
    const maxAttempts = 3;
    let lastError: unknown = null;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        const { data, error } = await supabase.functions.invoke("analyze-dartboard", {
          body: { imageBase64, detectBoard },
        });
        if (error) throw error;
        if (data?.error) {
          throw makeErr(
            String(data.error),
            Number(data.status) || undefined,
            Boolean(data.retryable ?? true),
          );
        }
        return data;
      } catch (error) {
        lastError = error;
        if (attempt === maxAttempts - 1 || !isRetryable(error)) throw error;
        await sleep(350 * (attempt + 1));
      }
    }
    throw lastError ?? new Error("Unknown analysis error");
  };

  // ─── auto-detect board ────────────────────────────────────────────
  const autoDetectBoard = async () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) {
      setPhase("live");
      setStatus("Bereit – wirf deinen ersten Dart");
      resetLoop();
      return;
    }
    // Local mode: no cloud call to auto-frame the board with. An earlier version of this ran
    // a local heuristic board-circle finder here and let it drive the crop/physical camera
    // zoom automatically — pulled back out after real-world testing found it made calibration
    // worse, not better (an unvalidated guess was moving the physical zoom to a bad spot before
    // the user even started tapping). Digital crop/zoom is left alone here; only the 4
    // calibration points are attempted automatically (via the trained model), with manual
    // tapping as the always-available fallback/override.
    if (detectionMode === "local") {
      resetLoop();
      if (!calib.taps || calib.taps.length !== 4) {
        await runLocalCalibrationFlow();
      } else {
        setPhase("live");
        setStatus("Bereit – wirf deinen ersten Dart");
      }
      return;
    }
    setPhase("detecting");
    setStatus("Suche Dartboard …");
    setAutoCalibrating(true);
    try {
      const dataUrl = captureFullFrame(960, 0.7);
      if (!dataUrl) throw new Error("no frame");
      const data = await analyzeFrame(dataUrl, true);
      if (data?.board && Number(data.board.confidence) >= 0.4) {
        await updateAutoCalibration(data.board as BoardDetection);
      }
    } catch (err) {
      console.warn("auto-detect failed", err);
    } finally {
      setAutoCalibrating(false);
    }
    resetLoop();
    // Prompt user to 4-point calibrate once per session/device
    if (!calib.taps || calib.taps.length !== 4) {
      setCalibStep(0);
      setPendingTaps([]);
      setPhase("calibrate");
      setStatus(`Kalibrierung 1/4: Tippe auf ${CALIB_LABELS[0]}`);
    } else {
      setPhase("live");
      setStatus("Bereit – wirf deinen ersten Dart");
    }
  };

  const handleCalibTap = (e: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>) => {
    if (phase !== "calibrate") return;
    const target = e.currentTarget as HTMLDivElement;
    const rect = target.getBoundingClientRect();
    const point = "touches" in e
      ? (e.touches[0] || e.changedTouches[0])
      : (e as React.MouseEvent<HTMLDivElement>);
    const clientX = (point as { clientX: number }).clientX;
    const clientY = (point as { clientY: number }).clientY;
    const nx = clamp((clientX - rect.left) / rect.width, 0, 1);
    const ny = clamp((clientY - rect.top) / rect.height, 0, 1);
    setActiveTap({ x: nx, y: ny });
  };

  const nudgeActive = (dx: number, dy: number) => {
    setActiveTap((prev) => prev
      ? { x: clamp(prev.x + dx, 0, 1), y: clamp(prev.y + dy, 0, 1) }
      : { x: 0.5, y: 0.5 });
  };

  /** Validates and commits 4 [D20,D3,D11,D6] points as the board calibration — shared by the
   *  manual 4-tap flow and the model-based auto-calibration below, so both go through the exact
   *  same degenerate-calibration rejection and crop-framing math. Returns false (and leaves
   *  `calib` untouched) if the 4 points don't form a usable calibration. */
  const applyCalibrationTaps = (next: { x: number; y: number }[]): boolean => {
    if (next.length !== 4) return false;
    const cx = (next[2].x + next[3].x) / 2;
    const cy = (next[0].y + next[1].y) / 2;
    const w = Math.abs(next[3].x - next[2].x);
    const h = Math.abs(next[1].y - next[0].y);
    // A degenerate (near-collinear/duplicate) or badly-clustered set of points would otherwise
    // silently score every dart as "Miss" for the rest of the session with no visible error —
    // reject it here instead of accepting a calibration that can't actually score anything.
    const MIN_CALIB_SPREAD = 0.15;
    if (!computeHomography(next, CANON_BOARD_POINTS) || w < MIN_CALIB_SPREAD || h < MIN_CALIB_SPREAD) {
      return false;
    }
    const size = clamp(Math.max(w, h) * 1.06, MIN_ANALYSIS_SIZE, 0.98);
    setCalib((prev) => ({ ...prev, x: cx, y: cy, size, taps: next }));
    return true;
  };

  const confirmActiveTap = () => {
    const tap = activeTap ?? { x: 0.5, y: 0.5 };
    const next = [...pendingTaps, tap];
    setPendingTaps(next);
    setActiveTap(null);
    if (next.length >= 4) {
      if (!applyCalibrationTaps(next)) {
        setPendingTaps([]);
        setActiveTap(null);
        setCalibStep(0);
        setStatus("Kalibrierung ungültig — Punkte zu nah beieinander oder auf einer Linie. Bitte die 4 Punkte nochmal genau auf die Doppel-Ring-Kanten tippen.");
        return;
      }
      setCalibStep(0);
      setPendingTaps([]);
      resetLoop();
      setPhase("live");
      setStatus("Kalibriert · bereit – wirf deinen ersten Dart");
    } else {
      setCalibStep(next.length);
      setStatus(`Kalibrierung ${next.length + 1}/4: ${CALIB_LABELS[next.length]}`);
    }
  };

  /**
   * One-shot calibration via the trained model's cal_1..cal_4 classes (see dartModel.ts).
   * Point IDENTITY isn't trusted (no documented convention for which numeric cal_x is which
   * physical corner) — instead the 4 detected points are assigned to D20/D3/D11/D6 purely by
   * geometry (topmost/bottommost/leftmost/rightmost), the same fixed orientation the manual
   * flow's labels already assume ("Doppel 20 (oben)" etc.). Requires all 4 classes confidently
   * detected AND cleanly separable by role; anything less falls back to manual tapping.
   */
  const tryAutoCalibrate = async (): Promise<boolean> => {
    const frame = grabImageData(MODEL_INPUT_SIZE, false);
    if (!frame) return false;
    const result = await detectCalibrationPointsWithModel(frame);
    // Always log the raw per-class detections — success or fail — this is the one place a bad
    // calibration actually originates, and without real numbers every threshold tweak here is
    // just another guess. See dartModel.ts's CAL_SCORE_THRESHOLD for the cutoff these were
    // measured against.
    console.info("[LiveCamera] auto-calibration raw candidates", result.points);
    if (result.unavailable) return false;
    const cropPoints = CAL_LABELS_ORDER.map((k) => result.points[k]).filter(
      (p): p is { x: number; y: number; score: number } => !!p
    );
    if (cropPoints.length !== 4) return false;
    const full = cropPoints
      .map((p) => cropXYToFullFrame(p.x, p.y))
      .filter((p): p is { fx: number; fy: number } => !!p);
    if (full.length !== 4) return false;
    const byY = [...full].sort((a, b) => a.fy - b.fy);
    const byX = [...full].sort((a, b) => a.fx - b.fx);
    const top = byY[0], bottom = byY[byY.length - 1];
    const left = byX[0], right = byX[byX.length - 1];
    // Couldn't cleanly separate all 4 roles (e.g. a point is simultaneously the topmost AND
    // leftmost) — a rotated/skewed camera angle confusing the geometric sort. Safer to fall
    // back to manual tapping than to guess a role assignment.
    if (new Set([top, bottom, left, right]).size < 4) {
      console.warn("[LiveCamera] auto-calibration rejected: couldn't separate 4 distinct roles", full);
      return false;
    }
    // Sanity check: cropRect() is centered on calib.x/calib.y at auto-calibration time (no taps
    // yet, so it's still the default 0.5/0.5 center-ish crop) — the board's own center should
    // therefore land reasonably close to frame-center too. A wildly off-center result means the
    // model mis-detected at least one corner rather than genuinely finding a very off-center
    // board, and a bad corner here silently wrecks every score for the rest of the session — far
    // worse than one bad dart read, which the review UI can catch. Reject rather than trust it.
    const centerFx = (left.fx + right.fx) / 2;
    const centerFy = (top.fy + bottom.fy) / 2;
    const MAX_CENTER_OFFSET = 0.3;
    if (Math.abs(centerFx - 0.5) > MAX_CENTER_OFFSET || Math.abs(centerFy - 0.5) > MAX_CENTER_OFFSET) {
      console.warn("[LiveCamera] auto-calibration rejected: implausible center", { centerFx, centerFy, top, bottom, left, right });
      return false;
    }
    const taps = [
      { x: top.fx, y: top.fy },
      { x: bottom.fx, y: bottom.fy },
      { x: left.fx, y: left.fy },
      { x: right.fx, y: right.fy },
    ];
    const applied = applyCalibrationTaps(taps);
    console.info("[LiveCamera] auto-calibration", applied ? "applied" : "rejected by applyCalibrationTaps (degenerate spread)", taps);
    return applied;
  };

  /** Clears any existing calibration and re-runs "try the model first, else manual taps" — used
   *  both right after the camera starts (autoDetectBoard) and by the manual "Kalibrierung neu
   *  starten" button, so a bad calibration (auto- or manually-derived) can always be redone
   *  without restarting the whole camera. */
  const runLocalCalibrationFlow = async () => {
    resetLoop();
    // Wait for the model to actually finish loading (idempotent — instant if already loaded)
    // before deciding whether auto-calibration is even possible. Just checking modelReadyRef
    // immediately would almost always lose the race: the model (12MB+ WASM compile) rarely
    // finishes within the ~600ms autoDetectBoard runs after camera start, so auto-calibration
    // would silently never fire in practice.
    setPhase("detecting");
    setStatus("KI-Modell lädt – suche Kalibrierpunkte …");
    const modelOk = await preloadDartModel();
    modelReadyRef.current = modelOk;
    setModelReady(modelOk);
    const autoOk = modelOk && (await tryAutoCalibrate());
    resetLoop();
    if (autoOk) {
      setPhase("live");
      setStatus("Automatisch kalibriert (KI-Modell) · bereit – wirf deinen ersten Dart. Stimmt die Lage nicht, unten „Kalibrierung neu starten“ tippen.");
    } else {
      setCalibStep(0);
      setPendingTaps([]);
      setPhase("calibrate");
      setStatus(`Kalibrierung 1/4: Tippe auf ${CALIB_LABELS[0]}`);
    }
  };

  // Previously dead code — nothing in the UI called this, so once a device had a saved
  // calibration there was no way to redo it short of clearing localStorage by hand. Now wired
  // to the "Kalibrierung neu starten" button in the advanced panel (local mode only), and reuses
  // the same "try the model, else manual" flow the very first calibration goes through.
  const restartCalibration = () => {
    void runLocalCalibrationFlow();
  };

  /** Switches which physical board this device is scoring — reloads that board's own saved
   *  calibration/camera choice and restarts the stream so autoDetectBoard re-checks it. */
  const switchBoard = (next: string) => {
    const board = String(Math.max(1, parseInt(next, 10) || 1));
    if (board === activeBoard) return;
    saveActiveBoard(board);
    setActiveBoard(board);
    setCalib(loadCalib(calibKeyFor(board)));
    setSelectedDeviceId(loadDeviceId(board));
    setPendingTaps([]);
    setActiveTap(null);
    setCalibStep(0);
    // A pending/unreviewed round from the board being left behind must not survive the switch —
    // otherwise tapping "Übernehmen" afterwards attributes board A's darts to whatever game is
    // active for board B, since onRoundCommit only knows the darts, not which board they're from.
    setScanFailed(false);
    setNeedsReview(false);
    setAccumulated([]);
    accumulatedRef.current = [];
    setError(null);
    setLastConfidence(0);
    resetLoop();
  };

  const switchCamera = (deviceId: string | null) => {
    saveDeviceId(activeBoard, deviceId);
    setSelectedDeviceId(deviceId);
  };

  /** Switching modes invalidates any in-flight baseline/pre-removal captures from the other
   *  mode (they're different data shapes), so just reset the watcher loop and re-arm live. */
  const changeDetectionMode = (mode: DetectionMode) => {
    if (mode === detectionMode) return;
    setDetectionMode(mode);
    resetLoop();
    emptyImageDataRef.current = null;
    if (phase === "live" || phase === "scanning") {
      setStatus("Stabilisiere Bild …");
    }
  };

  // ─── watcher loop ──────────────────────────────────────────────────
  useEffect(() => {
    if (!enabled) return;
    if (phase !== "live") return;

    const id = window.setInterval(() => {
      const sig = buildSignature();
      if (!sig) return;

      const m = sigDiff(prevSigRef.current, sig);
      prevSigRef.current = sig;
      setMotion(m);

      const still = m < MOTION_STILL;
      stillFramesRef.current = still ? stillFramesRef.current + 1 : 0;

      // First frame ever → just snapshot the reference and wait
      if (!stableSigRef.current) {
        if (stillFramesRef.current >= 2) {
          stableSigRef.current = sig;
          setStatus("Bereit – wirf deine Darts, dann alle 3 ziehen");
          emptyBoardSigRef.current = sig;
          if (detectionMode === "local") emptyImageDataRef.current = grabImageData();
        } else {
          setStatus("Stabilisiere Bild …");
        }
        return;
      }

      const delta = sigDiff(stableSigRef.current, sig);
      const emptyDelta = sigDiff(emptyBoardSigRef.current, sig);
      const boardEmpty = emptyBoardSigRef.current !== null && emptyDelta < EMPTY_BOARD_DELTA;
      setChangeDelta(emptyBoardSigRef.current ? emptyDelta : delta);

      if (!scanLockRef.current && delta > CHANGE_DELTA) {
        changeSeenRef.current = true;
      }

      if (
        !scanLockRef.current &&
        changeSeenRef.current &&
        stillFramesRef.current >= STILL_AFTER_CHANGE
      ) {
        changeSeenRef.current = false;
        stableSigRef.current = sig;
        if (boardEmpty) {
          const hasPreRemovalCapture = detectionMode === "local" ? !!preRemovalImageDataRef.current : !!preRemovalFrameRef.current;
          // A still-unreviewed round (accumulated darts awaiting Übernehmen/Verwerfen) must not
          // be silently overwritten by a new scan — if the player throws/pulls a second round
          // before acting on the first, this used to replace the pending darts with no trace of
          // the first round ever having been detected.
          if (throwsSeenRef.current > 0 && hasPreRemovalCapture && accumulatedRef.current.length === 0) {
            if (performance.now() - lastScanAtRef.current > SCAN_COOLDOWN_MS) {
              scanLockRef.current = true;
              void runPullScan();
              return;
            }
          }
          emptyBoardSigRef.current = sig;
          // Refresh the local baseline too — lighting can drift over a session, and this is
          // the moment we're most sure the board is genuinely empty.
          if (detectionMode === "local") emptyImageDataRef.current = grabImageData();
          setStatus("Board leer · wirf deinen ersten Dart");
        } else {
          if (detectionMode === "local") {
            preRemovalImageDataRef.current = grabImageData();
            if (modelReadyRef.current) preRemovalModelFrameRef.current = grabImageData(MODEL_INPUT_SIZE, false);
          } else {
            const frame = captureFrame(1280, 0.9);
            if (frame) preRemovalFrameRef.current = frame;
          }
          throwsSeenRef.current = Math.min(3, throwsSeenRef.current + 1);
          setThrowsSeen(throwsSeenRef.current);
          setStatus(
            throwsSeenRef.current >= dartsRemaining
              ? `${throwsSeenRef.current} Darts auf dem Board · jetzt ziehen`
              : `${throwsSeenRef.current}/${dartsRemaining} auf dem Board · nächsten werfen oder ziehen`,
          );
        }
        return;
      }

      if (!scanLockRef.current) {
        if (changeSeenRef.current) {
          setStatus("Bewegung erkannt – warte bis still …");
        } else if (throwsSeenRef.current === 0) {
          if (stillFramesRef.current >= 4 && boardEmpty) emptyBoardSigRef.current = sig;
          setStatus("Bereit – wirf deinen ersten Dart");
        }
      }
    }, TICK_MS);

    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, phase, dartsRemaining, detectionMode]);

  // ─── scan: analyze the pre-removal frame after darts are pulled ─────
  const runPullScan = async () => {
    const isLocal = detectionMode === "local";
    const img = preRemovalFrameRef.current;
    if (isLocal ? !preRemovalImageDataRef.current || !emptyImageDataRef.current : !img) {
      scanLockRef.current = false;
      return;
    }
    setPhase("scanning");
    lastScanAtRef.current = performance.now();
    setError(null);
    setScanFailed(false);
    playScanStartSound();
    setStatus("Erkenne Darts …");

    try {
      let candidateDarts: DetectedDart[];
      let overallConfidence: number;

      const runDiffFallback = () => {
        const result = detectDartTipsLocally(emptyImageDataRef.current!, preRemovalImageDataRef.current!, throwsSeenRef.current);
        const darts = refineWithCalibration(
          result.darts.map((d) => ({ baseValue: 0, multiplier: 1 as const, points: 0, confidence: d.confidence, x: d.x, y: d.y }))
        );
        let confidence = result.darts.length > 0
          ? result.darts.reduce((s, d) => s + d.confidence, 0) / result.darts.length
          : 0;
        // Blob count didn't match what we visually saw land (overlap, or noise got filtered
        // out) — force manual review instead of trusting a guess the pipeline itself is unsure of.
        if (result.uncertain) confidence = Math.min(confidence, AUTO_COMMIT_CONFIDENCE - 0.05);
        return { darts, confidence };
      };

      if (isLocal) {
        if (trainingDataEnabled) {
          // Stash the reference (not a copy) before the finally block below nulls these refs —
          // consumed at commit time with whatever the player ends up confirming/correcting.
          pendingTrainingCaptureRef.current = { before: emptyImageDataRef.current!, after: preRemovalImageDataRef.current! };
        }
        const modelFrame = preRemovalModelFrameRef.current;
        const modelResult = modelReadyRef.current && modelFrame
          ? await detectDartsWithModel(modelFrame, throwsSeenRef.current)
          : null;
        if (modelResult && !modelResult.unavailable && modelResult.darts.length > 0) {
          setLastDetectionSource("model");
          // Raw crop-space positions BEFORE calibration turns them into segments — if a report
          // ever again says "detection looks wrong", these numbers are what separate "the model
          // found the wrong spot" from "the model was right but calibration scored it wrong".
          console.info("[LiveCamera] model dart detections (crop-relative x/y, 0-1)", modelResult.darts);
          candidateDarts = refineWithCalibration(
            modelResult.darts.map((d) => ({ baseValue: 0, multiplier: 1 as const, points: 0, confidence: d.confidence, x: d.x, y: d.y }))
          );
          console.info("[LiveCamera] scored darts after calibration", candidateDarts);
          overallConfidence = modelResult.darts.reduce((s, d) => s + d.confidence, 0) / modelResult.darts.length;
          // Model found a different dart count than what we visually saw land (occlusion, or a
          // spurious low-confidence extra box) — force manual review instead of trusting the
          // count blindly.
          if (modelResult.darts.length !== throwsSeenRef.current) {
            overallConfidence = Math.min(overallConfidence, AUTO_COMMIT_CONFIDENCE - 0.05);
          }
        } else {
          // Model not loaded yet / inference failed / found nothing — the older motion-diff
          // heuristic is still here as a safety net so auto-scoring never just stops working.
          if (modelResult && !modelResult.unavailable) {
            // Diagnostic only — if the model ran but found nothing, the raw top score (even
            // below threshold) tells us whether it's "almost detecting" (real-world confidence
            // just runs lower than the Colab validation set) or "not detecting at all" (crop
            // framing / preprocessing mismatch) — very different problems to chase.
            console.warn("[LiveCamera] model found 0 darts, max raw score seen:", modelResult.maxDartScore);
          }
          setLastDetectionSource("diff");
          const fallback = runDiffFallback();
          candidateDarts = fallback.darts;
          overallConfidence = fallback.confidence;
        }
      } else {
        setLastDetectionSource("cloud");
        const data = await analyzeFrame(img!);
        overallConfidence = Number(data?.overallConfidence) || 0;
        candidateDarts = refineWithCalibration(sanitizeAiDarts(data?.darts, Math.max(throwsSeenRef.current, 1)));
        if (data?.board) void updateAutoCalibration(data.board as BoardDetection);
      }
      setLastConfidence(overallConfidence);

      if (candidateDarts.length === 0) {
        // Diagnostic only — helps tell "genuinely nothing found" apart from
        // "found darts but they got filtered out" when this happens in the field.
        console.warn("[LiveCamera] scan found 0 darts", { mode: detectionMode });
        setStatus("Keine Darts erkannt · bitte manuell erfassen");
        setScanFailed(true);
      } else {
        setAccumulated(candidateDarts);
        candidateDarts.forEach((_, i) => setTimeout(() => playDartDetectedSound(i), 90 * i));
        const allPositioned = candidateDarts.every(hasPosition);
        // Local detection has no real-world track record yet (unlike the cloud model) — never
        // auto-commit on its say-so alone, always make the player confirm/correct first. Prevents
        // a bad reading from silently scoring the wrong player and advancing the turn.
        const highConfidence = !isLocal && overallConfidence >= AUTO_COMMIT_CONFIDENCE && allPositioned;
        if (highConfidence) {
          // Board is already confirmed empty (that's what triggered this scan) and detection
          // is confident — safe to hand straight over to the next player.
          setNeedsReview(false);
          setTimeout(() => commitRound(candidateDarts), 250);
          setStatus(`Runde erkannt: ${candidateDarts.map(dartLabel).join(", ")}`);
        } else {
          // Unsure — wait for a manual Übernehmen/Verwerfen instead of guessing wrong
          // silently. The board is still empty either way, so nothing is lost by waiting.
          setNeedsReview(true);
          setStatus(`Bitte prüfen: ${candidateDarts.map(dartLabel).join(", ")}`);
        }
      }
      setPhase("live");
    } catch (err: unknown) {
      console.error("scan error", err);
      setError(err instanceof Error ? err.message : "Erkennung fehlgeschlagen.");
      setPhase("live");
      setStatus("Scan fehlgeschlagen · manuell erfassen");
      setScanFailed(true);
    } finally {
      scanLockRef.current = false;
      preRemovalFrameRef.current = null;
      preRemovalImageDataRef.current = null;
      preRemovalModelFrameRef.current = null;
    }
  };

  const commitRound = (darts: DetectedDart[]) => {
    if (pendingTrainingCaptureRef.current) {
      void uploadTrainingSample(pendingTrainingCaptureRef.current, darts);
    }
    onRoundCommit(darts.slice(0, dartsRemaining));
    playRoundCommittedSound();
    setAccumulated([]);
    accumulatedRef.current = [];
    setError(null);
    setScanFailed(false);
    setNeedsReview(false);
    const sig = buildSignature();
    if (sig) emptyBoardSigRef.current = sig;
    resetLoop();
    setPhase("live");
    setStatus("Runde übernommen · bereit für nächsten Wurf");
  };

  const discardRound = () => {
    setScanFailed(false);
    setNeedsReview(false);
    setAccumulated([]);
    accumulatedRef.current = [];
    setError(null);
    const sig = buildSignature();
    if (sig) emptyBoardSigRef.current = sig;
    resetLoop();
    setStatus("Runde verworfen · bereit für nächsten Wurf");
  };

  const manualScan = () => {
    if (!scanLockRef.current && accumulatedRef.current.length === 0) {
      if (detectionMode === "local") {
        preRemovalImageDataRef.current = grabImageData();
        if (modelReadyRef.current) preRemovalModelFrameRef.current = grabImageData(MODEL_INPUT_SIZE, false);
      } else {
        const frame = captureFrame(1280, 0.9);
        if (frame) preRemovalFrameRef.current = frame;
      }
      throwsSeenRef.current = Math.max(throwsSeenRef.current, dartsRemaining);
      scanLockRef.current = true;
      void runPullScan();
    }
  };

  const removeDart = (i: number) => {
    setAccumulated((prev) => prev.filter((_, k) => k !== i));
  };

  const adjustDart = (
    i: number,
    field: "baseValue" | "multiplier",
    value: number,
  ) => {
    setAccumulated((prev) => {
      const next = [...prev];
      const d = { ...next[i], [field]: value };
      d.points =
        d.baseValue === 25
          ? d.multiplier === 2
            ? 50
            : 25
          : d.baseValue * d.multiplier;
      next[i] = d;
      return next;
    });
  };

  const roundTotal = accumulated.reduce((s, d) => s + d.points, 0);

  // Tracking-health ring: green once calibrated and the live-tracked board center hasn't
  // drifted far from where it was calibrated, amber if it's drifted enough that a recalibration
  // is worth doing, cyan (neutral) if not calibrated yet at all. Board can still shift a few cm
  // — it doesn't need to be pixel-perfect, just still fully framed (see boardTransformFromTaps).
  const hasCalibration = (calib.taps?.length ?? 0) === 4;
  const calibOrigCenter = hasCalibration
    ? { x: (calib.taps![2].x + calib.taps![3].x) / 2, y: (calib.taps![0].y + calib.taps![1].y) / 2 }
    : null;
  const driftFraction = calibOrigCenter
    ? Math.hypot(calib.x - calibOrigCenter.x, calib.y - calibOrigCenter.y) / calib.size
    : 0;
  const trackingStatus: "uncalibrated" | "ok" | "warn" = !hasCalibration ? "uncalibrated" : driftFraction > 0.15 ? "warn" : "ok";
  const ringColorClass = trackingStatus === "ok" ? "border-secondary" : trackingStatus === "warn" ? "border-accent" : "border-primary/80";

  return (
    <div className="mb-3 space-y-2 rounded-xl border border-border bg-card p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Camera className="h-4 w-4 text-primary" />
          <span className="font-display text-sm uppercase tracking-wider">
            Auto-Scoring
          </span>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} className="h-9 w-9" title="Kamera schließen" aria-label="Kamera schließen">
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex items-center gap-1 rounded-lg border border-border bg-muted/40 p-1 text-[11px]">
        <button
          onClick={() => changeDetectionMode("local")}
          className={`flex-1 rounded-md py-1.5 font-medium transition-colors ${
            detectionMode === "local" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
          }`}
          title={
            modelReady
              ? "Erkennung läuft komplett auf dem Gerät — offline, keine KI-Kosten. Nutzt das trainierte KI-Modell, mit Bewegungserkennung als Rückfallebene."
              : "Erkennung läuft komplett auf dem Gerät — offline, keine KI-Kosten. KI-Modell lädt im Hintergrund; bis dahin läuft die Bewegungserkennung."
          }
        >
          Lokal (offline)
        </button>
        <button
          onClick={() => changeDetectionMode("cloud")}
          className={`flex-1 rounded-md py-1.5 font-medium transition-colors ${
            detectionMode === "cloud" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
          }`}
          title="Erkennung per Cloud-KI — braucht Internet, verursacht laufende KI-Kosten, dafür robuster"
        >
          Cloud-KI
        </button>
      </div>

      {detectionMode === "local" && (
        <button
          onClick={() => setTrainingDataEnabled(!trainingDataEnabled)}
          className="flex w-full items-center justify-between rounded-lg border border-border bg-muted/40 px-2.5 py-1.5 text-[11px]"
          title="Speichert bei jeder übernommenen Runde das Board-Bildpaar plus die (ggf. korrigierten) Dart-Positionen als Trainingsdaten für ein späteres, echtes Erkennungsmodell — nur der Board-Ausschnitt, kein weiteres Kamerabild."
        >
          <span className="text-muted-foreground">Trainingsdaten sammeln (für späteres eigenes Modell)</span>
          <span className={`shrink-0 rounded-full px-2 py-0.5 font-medium ${trainingDataEnabled ? "bg-secondary text-secondary-foreground" : "bg-muted text-muted-foreground"}`}>
            {trainingDataEnabled ? "An" : "Aus"}
          </span>
        </button>
      )}

      <div className="relative mx-auto aspect-square w-full max-w-sm overflow-hidden rounded-lg border border-border bg-muted">
        <video
          ref={videoRef}
          playsInline
          muted
          className="h-full w-full object-cover"
        />
        <canvas ref={canvasRef} className="hidden" />

        {phase === "calibrate" && (
          <div
            ref={calibOverlayRef}
            className="absolute inset-0 z-20 cursor-crosshair select-none bg-background/30"
            onClick={handleCalibTap}
          >
            {/* already confirmed taps */}
            {pendingTaps.map((t, i) => (
              <div key={i} className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-secondary ring-2 ring-background"
                style={{ left: `${t.x * 100}%`, top: `${t.y * 100}%` }}>
                <span className="absolute left-3 top-1/2 -translate-y-1/2 rounded bg-secondary/90 px-1 text-[9px] font-mono text-secondary-foreground">
                  {CALIB_KEYS[i]}
                </span>
              </div>
            ))}
            {/* active draggable marker */}
            {activeTap && (
              <>
                {/* crosshair lines through active point */}
                <div className="pointer-events-none absolute left-0 right-0 h-px bg-accent/60" style={{ top: `${activeTap.y * 100}%` }} />
                <div className="pointer-events-none absolute top-0 bottom-0 w-px bg-accent/60" style={{ left: `${activeTap.x * 100}%` }} />
                {/* magnifier ring */}
                <div className="pointer-events-none absolute h-14 w-14 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-accent shadow-lg glow-gold"
                  style={{ left: `${activeTap.x * 100}%`, top: `${activeTap.y * 100}%` }} />
                <div className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent ring-2 ring-background"
                  style={{ left: `${activeTap.x * 100}%`, top: `${activeTap.y * 100}%` }} />
              </>
            )}
            <div className="absolute inset-x-0 top-0 bg-accent px-2 py-1.5 text-center text-xs font-display uppercase text-accent-foreground">
              {calibStep + 1}/4 · {CALIB_LABELS[calibStep]}
            </div>
            {!activeTap && (
              <div className="pointer-events-none absolute inset-x-0 bottom-14 flex justify-center">
                <span className="rounded-md bg-background/80 px-3 py-1 text-[11px] text-foreground">
                  Tippe grob auf {CALIB_LABELS[calibStep]} – dann fein justieren
                </span>
              </div>
            )}
            {activeTap && (
              <div className="absolute inset-x-2 bottom-2 z-30 rounded-lg border border-border bg-background/95 p-2 shadow-lg" onClick={(e) => e.stopPropagation()}>
                <div className="mb-1 text-center text-[10px] uppercase tracking-widest text-muted-foreground">
                  Fein justieren – dann bestätigen
                </div>
                <div className="mx-auto grid w-32 grid-cols-3 gap-1">
                  <div />
                  <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => nudgeActive(0, -0.005)}>▲</Button>
                  <div />
                  <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => nudgeActive(-0.005, 0)}>◀</Button>
                  <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setActiveTap(null)} title="Neu setzen">
                    <RotateCcw className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => nudgeActive(0.005, 0)}>▶</Button>
                  <div />
                  <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => nudgeActive(0, 0.005)}>▼</Button>
                  <div />
                </div>
                <Button size="sm" className="mt-2 w-full gap-1 font-display uppercase" onClick={confirmActiveTap}>
                  <Check className="h-4 w-4" /> Punkt bestätigen
                </Button>
              </div>
            )}
          </div>
        )}

        {(phase === "live" || phase === "scanning" || phase === "detecting") && (
          <div className="pointer-events-none absolute inset-0">
            <div
              className={`absolute rounded-full border-2 transition-colors duration-500 ${
                phase === "scanning" ? "border-accent animate-pulse-glow" : ringColorClass
              }`}
              style={{
                width: `${calib.size * 100}%`,
                height: `${calib.size * 100}%`,
                left: `${calib.x * 100}%`,
                top: `${calib.y * 100}%`,
                transform: "translate(-50%, -50%)",
              }}
            >
              <div className="absolute inset-[35%] rounded-full border border-current opacity-40" />
              <div className="absolute inset-[48%] rounded-full bg-current opacity-70" />
            </div>
            {phase === "live" && trackingStatus === "warn" && (
              <div className="absolute inset-x-0 bottom-2 flex justify-center">
                <span className="rounded-md bg-accent/90 px-2.5 py-1 text-[10px] font-medium text-accent-foreground shadow">
                  Board hat sich verschoben — bei Bedarf neu kalibrieren
                </span>
              </div>
            )}
          </div>
        )}

        {/* Detected-dart markers — shows exactly what the AI saw, at the tip position it used. */}
        {accumulated.length > 0 && (
          <div className="pointer-events-none absolute inset-0">
            {accumulated.map((d, i) => {
              const full = toFullFrameXY(d);
              if (!full) return null;
              return (
                <div
                  key={i}
                  className="absolute -translate-x-1/2 -translate-y-1/2 animate-scale-in"
                  style={{ left: `${full.fx * 100}%`, top: `${full.fy * 100}%` }}
                >
                  <div className={`h-3.5 w-3.5 rounded-full ring-2 ring-background ${needsReview ? "bg-accent" : "bg-secondary"}`} />
                  <span className={`absolute left-1/2 top-4 -translate-x-1/2 whitespace-nowrap rounded px-1 py-0.5 text-[9px] font-display text-background ${needsReview ? "bg-accent" : "bg-secondary"}`}>
                    {dartLabel(d)}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {(phase === "starting" || phase === "detecting") && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-background/80 px-4 text-center text-xs text-foreground">
            <Loader2 className="mb-2 h-5 w-5 animate-spin" />
            {phase === "starting"
              ? "Kamera startet…"
              : detectionMode === "local"
                ? status
                : "Board wird automatisch erkannt…"}
          </div>
        )}
        {phase === "scanning" && (
          <div className="absolute inset-x-0 top-0 flex items-center justify-center bg-background/70 py-1.5 text-xs text-foreground">
            <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Analysiere…
          </div>
        )}
        {phase === "error" && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/85 px-4 text-center text-xs text-foreground">
            {error}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between rounded-md border border-border bg-muted/40 px-3 py-2 text-xs">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${
              phase === "live"
                ? "bg-secondary animate-pulse-glow"
                : phase === "scanning"
                  ? "bg-primary animate-pulse"
                  : phase === "error"
                    ? "bg-destructive"
                    : "bg-muted-foreground"
            }`}
          />
          <div className="min-w-0">
            <p className="truncate font-medium text-foreground">
              {playerName ?? "Auto-Scoring"}
              {accumulated.length < dartsRemaining && (
                <span className="ml-1 text-muted-foreground">
                  · noch {dartsRemaining - accumulated.length} Dart
                  {dartsRemaining - accumulated.length === 1 ? "" : "s"}
                </span>
              )}
            </p>
            <p className="truncate text-muted-foreground">{status}</p>
          </div>
        </div>
        <div className="ml-3 shrink-0 space-y-0.5 text-right text-[10px] uppercase tracking-wider text-muted-foreground">
          <div>Bew {(motion * 100).toFixed(0)}%</div>
          <div>Δ {(changeDelta * 100).toFixed(0)}%</div>
        </div>
      </div>

      {autoCalibrating && (
        <div className="rounded-md border border-accent/30 bg-accent/5 px-3 py-1.5 text-[11px] text-accent">
          Auto-Kalibrierung läuft – Zoom & Board-Lage werden angepasst.
        </div>
      )}

      {detectionMode === "local" && (phase === "live" || phase === "scanning") && (
        <button
          onClick={restartCalibration}
          className="w-full rounded-md border border-border px-3 py-1.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground flex items-center justify-center gap-1.5"
          title="Löscht die aktuelle Kalibrierung und versucht sie neu — erst automatisch per KI-Modell, sonst per manuellem 4-Punkt-Tap."
        >
          <Target className="h-3.5 w-3.5" /> Erkennung falsch? Kalibrierung neu starten
        </button>
      )}

      {scanFailed && onRequestManualEntry && (
        <div className="flex items-center justify-between gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-[11px]">
          <span className="text-destructive">Scan hat keine Darts gefunden.</span>
          <div className="flex shrink-0 gap-1.5">
            <Button size="sm" variant="outline" className="h-9 px-3 text-[11px]" onClick={() => { setScanFailed(false); manualScan(); }}>
              Erneut scannen
            </Button>
            <Button size="sm" variant="default" className="h-9 px-3 text-[11px]" onClick={onRequestManualEntry}>
              Manuell erfassen
            </Button>
          </div>
        </div>
      )}

      {needsReview && (
        <div className="rounded-md border border-accent/40 bg-accent/10 px-3 py-2 text-[11px] text-accent">
          Nicht ganz sicher erkannt — bitte unten prüfen und mit „Übernehmen" bestätigen (oder einzelne Darts korrigieren).
        </div>
      )}

      {/* live accumulated darts */}
      <div className={`rounded-xl border p-3 bg-gradient-to-br from-primary/10 via-primary/5 to-transparent ${needsReview ? "border-accent/50" : "border-primary/30"}`}>
        <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-muted-foreground">
          <span className="flex items-center gap-1">
            <Zap className="h-3 w-3 text-accent" /> Aktuelle Runde
          </span>
          <span>
            {accumulated.length}/{dartsRemaining}
            {lastConfidence > 0 && (
              <span className="ml-2">
                {lastDetectionSource === "model" ? "KI-Modell" : lastDetectionSource === "diff" ? "Bewegung" : "Cloud-KI"}{" "}
                {(lastConfidence * 100).toFixed(0)}%
              </span>
            )}
          </span>
        </div>
        <div className="mt-1 flex items-end justify-between">
          <div className="flex flex-wrap gap-1.5">
            {Array.from({ length: dartsRemaining }).map((_, i) => {
              const d = accumulated[i];
              if (!d) {
                return (
                  <span
                    key={`slot-${i}`}
                    className="inline-flex h-7 w-14 items-center justify-center rounded-md border border-dashed border-border/60 text-[10px] text-muted-foreground"
                  >
                    Dart {i + 1}
                  </span>
                );
              }
              return (
                <span
                  key={`dart-${i}`}
                  className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-display ${
                    d.points === 0
                      ? "border-muted bg-muted/40 text-muted-foreground"
                      : "border-primary/60 bg-primary/20 text-primary"
                  } ${justAddedIndex === i ? "animate-scale-in ring-2 ring-accent" : ""}`}
                >
                  <Target className="h-3 w-3 opacity-70" />
                  {dartLabel(d)} <span className="text-foreground/90">· {d.points}</span>
                </span>
              );
            })}
          </div>
          <div className="ml-3 shrink-0 text-right">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Summe
            </div>
            <div className="font-display text-3xl leading-none text-primary">
              {roundTotal}
            </div>
          </div>
        </div>
      </div>

      {accumulated.length > 0 && (
        <div className="space-y-1.5">
          {accumulated.map((dart, i) => (
            <div key={i} className="flex items-center gap-2 rounded-lg bg-muted p-2">
              <span className="w-10 text-[10px] text-muted-foreground">Dart {i + 1}</span>
              <select
                value={dart.multiplier}
                onChange={(e) => adjustDart(i, "multiplier", Number(e.target.value))}
                className="rounded border border-border bg-background px-1 py-1 text-xs"
                disabled={dart.baseValue === 0}
              >
                <option value={1}>S</option>
                <option value={2}>D</option>
                <option value={3}>T</option>
              </select>
              <select
                value={dart.baseValue}
                onChange={(e) => adjustDart(i, "baseValue", Number(e.target.value))}
                className="flex-1 rounded border border-border bg-background px-1 py-1 text-xs"
              >
                <option value={0}>Miss</option>
                {Array.from({ length: 20 }, (_, k) => k + 1).map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
                <option value={25}>Bull (25/50)</option>
              </select>
              <span className="w-10 text-right font-display text-primary">{dart.points}</span>
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9"
                onClick={() => removeDart(i)}
                title="Dart entfernen"
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded bg-destructive/10 p-2 text-xs text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="flex gap-2">
        <Button
          onClick={manualScan}
          className="flex-1 gap-2 font-display uppercase"
          size="sm"
          variant="outline"
          disabled={phase !== "live"}
        >
          <ScanLine className="h-4 w-4" /> Jetzt scannen
        </Button>
        {accumulated.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={discardRound}
            className="gap-1"
            title="Erkannte Darts verwerfen"
          >
            <RotateCcw className="h-4 w-4" /> Verwerfen
          </Button>
        )}
        {accumulated.length > 0 && (
          <Button
            size="sm"
            onClick={() => commitRound(accumulated)}
            className={`gap-1 ${needsReview ? "animate-pulse-glow" : ""}`}
            title="Runde übernehmen"
          >
            <Check className="h-4 w-4" /> Übernehmen
          </Button>
        )}
      </div>

      <button
        onClick={() => setShowAdvanced((v) => !v)}
        className="flex w-full items-center justify-between rounded border border-border px-3 py-1.5 text-[11px] text-muted-foreground hover:bg-muted"
      >
        <span>Bildausschnitt manuell anpassen</span>
        {showAdvanced ? (
          <ChevronUp className="h-3.5 w-3.5" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5" />
        )}
      </button>
      {showAdvanced && (
        <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-2 text-xs">
          <div className="space-y-1">
            <div className="text-[10px] text-muted-foreground">Dieses Gerät ist kalibriert für</div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8 shrink-0"
                onClick={() => switchBoard(String(Math.max(1, Number(activeBoard) - 1)))}
                disabled={activeBoard === "1"}
                title="Vorheriges Board"
              >
                −
              </Button>
              <span className="flex-1 text-center font-display text-sm text-foreground">Board {activeBoard}</span>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8 shrink-0"
                onClick={() => switchBoard(String(Number(activeBoard) + 1))}
                title="Nächstes Board"
              >
                +
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground">
              Jedes Board hat seine eigene Kalibrierung — praktisch, wenn dasselbe Tablet an mehreren Boards eines Vereinsabends läuft.
            </p>
          </div>
          {devices.length > 1 && (
            <div className="space-y-1">
              <div className="text-[10px] text-muted-foreground">Kamera für Board {activeBoard}</div>
              <select
                value={selectedDeviceId ?? ""}
                onChange={(e) => switchCamera(e.target.value || null)}
                className="w-full rounded border border-border bg-background px-2 py-1.5 text-xs"
              >
                <option value="">Automatisch</option>
                {devices.map((d, i) => (
                  <option key={d.deviceId} value={d.deviceId}>{d.label || `Kamera ${i + 1}`}</option>
                ))}
              </select>
            </div>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => void autoDetectBoard()}
            disabled={phase === "detecting"}
            className="w-full gap-1"
          >
            <RotateCcw className={`h-4 w-4 ${phase === "detecting" ? "animate-spin" : ""}`} /> {phase === "detecting" ? "Erkenne Board…" : "Board neu auto-erkennen"}
          </Button>
          {detectionMode === "local" && (
            <Button
              variant="outline"
              size="sm"
              onClick={restartCalibration}
              disabled={phase === "detecting"}
              className="w-full gap-1"
              title="Löscht die aktuelle Kalibrierung und versucht sie neu — erst automatisch per KI-Modell, sonst per manuellem 4-Punkt-Tap. Sinnvoll, wenn Darts zuletzt falsch bewertet wurden."
            >
              <Target className={`h-4 w-4 ${phase === "detecting" ? "animate-spin" : ""}`} /> Kalibrierung neu starten
            </Button>
          )}
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[10px] text-muted-foreground">
              <span>Horizontal</span>
              <span>{Math.round(calib.x * 100)}%</span>
            </div>
            <Slider
              value={[calib.x]}
              min={0.15}
              max={0.85}
              step={0.01}
              onValueChange={([x]) => setCalib((p) => ({ ...p, x }))}
            />
          </div>
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[10px] text-muted-foreground">
              <span>Vertikal</span>
              <span>{Math.round(calib.y * 100)}%</span>
            </div>
            <Slider
              value={[calib.y]}
              min={0.15}
              max={0.85}
              step={0.01}
              onValueChange={([y]) => setCalib((p) => ({ ...p, y }))}
            />
          </div>
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[10px] text-muted-foreground">
              <span>Größe</span>
              <span>{Math.round(calib.size * 100)}%</span>
            </div>
            <Slider
              value={[calib.size]}
              min={0.4}
              max={0.98}
              step={0.01}
              onValueChange={([size]) => setCalib((p) => ({ ...p, size }))}
            />
          </div>
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[10px] text-muted-foreground">
              <span>Zoom</span>
              <span>{calib.zoom.toFixed(1)}x</span>
            </div>
            <Slider
              value={[calib.zoom]}
              min={1}
              max={zoomCapsRef.current?.max ?? 4}
              step={zoomCapsRef.current?.step ?? 0.1}
              onValueChange={([zoom]) => {
                const nextZoom = clamp(zoom, 1, zoomCapsRef.current?.max ?? 4);
                setCalib((p) => ({ ...p, zoom: nextZoom }));
                void applyCameraZoom(nextZoom);
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
});

LiveCamera.displayName = "LiveCamera";

export default LiveCamera;