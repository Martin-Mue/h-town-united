import { useEffect, useRef, useState, useCallback, forwardRef, useImperativeHandle, type ComponentProps } from "react";
import { createPortal } from "react-dom";
import {
  AlertCircle,
  Camera,
  Check,
  ChevronDown,
  ChevronUp,
  Keyboard,
  RotateCcw,
  Settings,
  Target,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import { DartLoaderIcon as Loader2 } from "@/components/icons/DartIcons";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useLanguage } from "@/contexts/LanguageContext";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { detectDartTipsLocally, VISION_ANALYSIS_SIZE } from "@/utils/dartVision";
import { detectDartsWithModel, detectCalibrationPointsWithModel, preloadDartModel, modelDiagnostics, MODEL_INPUT_SIZE } from "@/utils/dartModel";
import { pointsFor, dartLabel } from "@/utils/x01Rules";
import BoardCalibrator from "@/components/game/BoardCalibrator";
import CameraScoreStrip from "@/components/game/CameraScoreStrip";
import { defaultCalibrationTaps } from "@/utils/calibrationHandles";
import { rectifyMappingFromTaps, warpToRectified, canonicalToRect, boardOverlayLines, RECT_BOARD_RADIUS, type RectifyMapping } from "@/utils/boardRectify";
import { applyHomography, computeHomography } from "@/utils/homography";
import DartReviewFrame from "@/components/game/DartReviewFrame";
import { buildChangeMap, changedShareNear } from "@/utils/changeMask";
import { selectNewDarts, keepSupportedDarts } from "@/utils/newDartSelection";
import { prepareWireFit, refineTapsToWires, findBoardTaps, WIRE_FIT_CONFIDENT } from "@/utils/boardWireFit";
import { canonicalPointForChoice, type ScoreChoice } from "@/utils/dartCorrection";
import {
  boardTransformFromTaps,
  scoreFromBoardPoint,
  computeVisibleWindow,
  screenToVideoFraction,
  videoToScreenFraction,
  computeCropRect,
  cropToVideoFraction,
  videoFractionToCrop,
  computeCropScreenRect,
  tapsFromModelCorners,
  MODEL_CORNERS_CANON,
  CANON_BOARD_POINTS,
} from "@/utils/cameraGeometry";
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
 *      *settles*, the trained model runs on that one frame and — as of
 *      2026-08-18 — is diffed against the darts already known this visit
 *      (see scoreNewlyLandedDart) to identify JUST the dart that landed,
 *      the moment it lands, in true throw order. This is what actually
 *      backs step 3 below; earlier versions only ever identified darts in
 *      one full batch at step 4, with no order information at all — the
 *      root cause of the "ambiguous checkout" resolver/prompt in
 *      Game.tsx's submitDetectedRound, which now stays as a safety net for
 *      whenever this still can't confidently isolate one new dart
 *      (occlusion, two darts landing the same tick, model not loaded yet —
 *      in any of those cases runPullScan's own end-of-visit batch pass
 *      picks up whatever wasn't identified incrementally, same as before).
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
  /** The player picked this score from the correction chips: the position is the middle of that
   *  field, not a measured tip — fine for the score, not to be trained on as a tip position. */
  snapped?: boolean;
}

interface LiveCameraProps {
  onRoundCommit: (darts: DetectedDart[]) => void;
  onPendingChange?: (darts: DetectedDart[]) => void;
  enabled: boolean;
  onClose: () => void;
  dartsRemaining?: number;
  playerName?: string;
  /** The player's remaining score, shown in the header so the full-screen camera still tells the state of the leg. */
  remainingScore?: number;
  /** Compact scoreboard shown on top of the camera picture (who throws, scores, leg starter, averages). */
  scoreStrip?: ComponentProps<typeof CameraScoreStrip>;
  /** Called when the player wants to give up on auto-scoring and switch to manual entry after a failed/empty scan. */
  onRequestManualEntry?: () => void;
  /** Freezes the watcher loop (no new scans start) without tearing down the camera stream — for
   *  a brief "waiting on the player to answer something outside this component" moment (e.g. the
   *  ambiguous-checkout prompt in Game.tsx). Deliberately NOT implemented via `enabled=false`:
   *  that tears down and re-acquires getUserMedia, which a 2026-08-17 field report tied directly
   *  to the camera going black and staying black after a checkout — re-requesting a camera stream
   *  moments after stopping the previous one isn't reliable on every device. Pausing just leaves
   *  the existing stream running and skips processing ticks instead. */
  paused?: boolean;
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
//
// Segment boundaries are realigned to actual visit boundaries (see restartClipSegment,
// called whenever the board goes empty) so a segment always starts right as a visit begins
// and gets cut right as it ends — this timer is now only a safety cap for the degenerate
// case of a visit that never gets pulled (camera left running, no one throws), not the
// primary trigger. It used to be: back when segments were purely time-boxed with no
// relationship to when darts actually landed, a highlight clip could just as easily capture
// a few seconds of a static, already-finished board as it could the actual throws — visually
// indistinguishable from a photo, which is exactly what got reported.
const CLIP_SEGMENT_MS = 20000;
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
  /** How these taps came about: the model found them ("auto") or the player tapped them
   *  ("manual"). Saved with the calibration so training samples can say which kind produced them. */
  source?: "auto" | "manual";
  /** Manual taps count as confirmed right away; an automatic result becomes confirmed once the
   *  player taps "Passt" on the check bar. */
  confirmed?: boolean;
}

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

/**
 * UX-Audit Befund #2 (Trainingsfoto-Zustimmung, Option A): the toggle above defaulted ON with
 * no explicit decision moment — a player could go through their first camera-scored round
 * never realizing a board photo just got uploaded. This gate asks exactly once, full-screen,
 * before the camera panel becomes usable; whatever the answer, TRAINING_DATA_KEY above is set
 * accordingly and stays changeable any time via the toggle further down (same key, same effect).
 */
const TRAINING_CONSENT_ASKED_KEY = "dartcam-training-consent-asked";

/** Hands-free play: once the darts are pulled and the board is empty again, the round is taken over
 *  after a short countdown unless the player touches a dart to correct it. Off by default — detection
 *  still needs corrections too often for rounds to be taken over unseen. */
const AUTO_COMMIT_KEY = "dartcam-auto-commit";
const AUTO_COMMIT_SECONDS = 2;
const loadAutoCommitEnabled = (): boolean => {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(AUTO_COMMIT_KEY) === "on";
};
const loadTrainingConsentAsked = (): boolean => {
  if (typeof window === "undefined") return true;
  return window.localStorage.getItem(TRAINING_CONSENT_ASKED_KEY) === "yes";
};

const CALIB_KEY = "dartcam-calibration-v5";
const CALIB_KEYS = ["D20", "D3", "D11", "D6"] as const;
/** The camera picture is downscaled to at most this long side before being straightened — plenty for
 *  the 800px output (the board covers only part of the picture) and keeps the pixel read cheap. */
const MAX_RECTIFY_SOURCE_SIDE = 1920;
/** Weakest model confidence a new-dart candidate may have — it must additionally stand on changed pixels. */
const NEW_DART_MIN_SCORE = 0.15;
/** The board only counts as "not empty" because of detections at least this confident — weaker ones can
 *  join a round (with fresh change under them, see selectNewDart) but must never keep a round from ending. */
const BOARD_OCCUPIED_SCORE = 0.25;
/** Cut-off of the final look at the finished visit; candidates must additionally stand on pixels that
 *  differ from the empty board, which a real dart always does. */
const FINAL_PASS_MIN_SCORE = 0.25;
/** A rest whose picture differs from the last evaluated one in fewer than this share of cells needs no new detection. */
const UNCHANGED_FRAME_SHARE = 0.0008;
/** A detection this confident counts as a dart even where the pictures show no fresh change. */
const CONFIDENT_DART_SCORE = 0.5;
/** How often (ms) a calm picture is used to settle the calibration back onto the board's wires. */
const CALIB_REFINE_MS = 4000;
/** A refit counts only with at least this colour agreement (a good fit scores ~0.65) ... */
const CALIB_REFINE_MIN_QUALITY = 0.5;
/** ... and only for small drift: each point may move at most this share of the board radius (a bigger
 *  jump means the camera was moved on purpose — that needs the calibration view, not a silent nudge). */
const CALIB_REFINE_MAX_MOVE = 0.15;
/** Moves below this share of the radius (<1 mm) are ignored so the calibration does not jitter. */
const CALIB_REFINE_MIN_MOVE = 0.004;
/** Within this distance (frame fraction, ~9 mm) a detection is a dart that was already in the board before the round. */
const KNOWN_DART_RADIUS_FOR_BASELINE = 0.02;
/** Detections this close (frame fraction, ~18 mm) to a dart the player removed by hand are not the same dart coming back. */
const DISMISSED_DART_RADIUS = 0.04;
/** A detection on a spot where the EMPTY board already produced one (a logo, the bull) only counts as a dart when it
 *  is clearly more confident than that. Otherwise a real dart landing in the bull would be filtered away as scenery. */
const BASELINE_BEATEN_BY = 0.15;
/** Above this share of changed cells the whole picture moved (exposure, bump) — no comparison possible. */
const GLOBAL_CHANGE_SHARE_MAX = 0.5;
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
const SIGNATURE_OVERSAMPLE = 4;
const TARGET_BOARD_RATIO = 0.82;
const DEFAULT_ZOOM = 1;
const MIN_ANALYSIS_SIZE = 0.55;
/** The one hidden canvas serves the motion signature AND the big analysis snapshots. A canvas that is read back
 *  often may switch between GPU and CPU rendering mid-session, and the two downscale the picture slightly
 *  differently — the signature jumped by ~0.1 every time that happened, which read as "movement" and made the
 *  watcher start a pointless detection cycle every couple of seconds. Reading back always on the CPU path keeps
 *  every sample comparable. */
const SHARED_CANVAS_OPTIONS: CanvasRenderingContext2DSettings = { willReadFrequently: true };
/** Longest side (px) of the picture the wire fit looks at — plenty for millimetre-exact rings. */
const WIRE_FIT_MAX_SIDE = 960;

// Frame-to-frame diff considered "still" (no motion). Tighter → weniger falsche Trigger.
const MOTION_STILL = 0.012;
/** Quiet-time motion samples (below this) feed the noise floor; the "still" threshold may rise up to MOTION_STILL_MAX. */
const MOTION_NOISE_SAMPLE_MAX = 0.05;
const MOTION_STILL_MAX = 0.035;
// Diff between current and last *stable* frame → physical change occurred. Höher → weniger Reaktion auf Licht/Hand.
const CHANGE_DELTA = 0.075;
// Frames of stillness required after a change before scanning. ~1.6s bei 400ms Tick.
const STILL_AFTER_CHANGE = 3;
/** The fine picture (see buildSignature) is compared cell by cell; a cell counts as changed above this luminance step (0-1)... */
const FINE_CELL_DELTA = 0.1;
/** ...and this many changed cells (of ~20,000 inside the circle) mean something new is in the picture — a dart is ~100. */
const FINE_CHANGE_MIN_CELLS = 25;
// Tick interval of the watcher loop.
const TICK_MS = 400;
const SCAN_COOLDOWN_MS = 3200;
// Below this, or if any dart is missing a usable tip position (falling back to the AI's
// much less reliable raw segment guess instead of the deterministic calibration math),
// the round is shown for manual review (Übernehmen/Verwerfen) instead of auto-committing.
const AUTO_COMMIT_CONFIDENCE = 0.6;
// Cloud-vision fallback (2026-09-10): when the on-device model AND the motion-diff heuristic
// BOTH come up completely empty, that's the clearest possible "uncertain" signal — rather than
// dropping straight to full manual entry, one Gemini vision call (analyze-dartboard) gets a shot
// at the same frame before giving up. Never blocks indefinitely: aborted after this long so a
// slow/hanging network call can't leave the "scanning" spinner stuck — falls straight through to
// the existing manual-entry path exactly as if Gemini had failed outright.
const GEMINI_FALLBACK_TIMEOUT_MS = 9000;
const EMPTY_BOARD_DELTA = 0.022;
const DART_POSITION_MATCH = 0.09;
// A genuine "something changed" event (a dart landing, a hand reaching in) sits around
// CHANGE_DELTA (0.075) — this needs to sit well above that, so normal play never trips it, but
// still clearly below "completely different scene" (pointing at a wall/ceiling/table isn't a
// subtle case — every pixel block differs, not just the handful a dart or a hand would change).
// Unverified against a real camera, same caveat as every threshold in this file — chosen by
// reasoning about the metric's scale, not measured against real "pointed at the wrong thing" footage.
const BOARD_MISSING_DELTA = 0.28;
// Consecutive ticks (at TICK_MS each) the frame must fail BOARD_MISSING_DELTA before declaring
// the board actually missing — long enough that a fast hand sweep across the board while pulling
// darts (which can transiently look nothing like the empty-board baseline) doesn't false-trigger,
// short enough that genuinely redirecting the camera is caught quickly.
const BOARD_MISSING_STREAK = 5;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

const loadCalib = (key: string = CALIB_KEY): Calibration => {
  if (typeof window === "undefined")
    return { x: 0.5, y: 0.5, size: 0.82, zoom: DEFAULT_ZOOM };
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return { x: 0.5, y: 0.5, size: 0.82, zoom: DEFAULT_ZOOM };
    const p = JSON.parse(raw);
    let taps = Array.isArray(p?.taps) && p.taps.length === 4
      ? p.taps.map((t: { x?: unknown; y?: unknown }) => ({ x: clamp(Number(t?.x) || 0.5, 0, 1), y: clamp(Number(t?.y) || 0.5, 0, 1) }))
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
      source: taps && (p?.source === "auto" || p?.source === "manual") ? p.source : undefined,
      confirmed: taps && typeof p?.confirmed === "boolean" ? p.confirmed : undefined,
    };
  } catch {
    return { x: 0.5, y: 0.5, size: 0.82, zoom: DEFAULT_ZOOM };
  }
};

type ZoomCapability = { min: number; max: number; step: number };

/**
 * Centers arbitrary content at (fx,fy) — a fraction (0-1) of the nearest positioned ancestor —
 * via the one correct "left/top % + transform: translate(-50%,-50%)" pattern every on-screen
 * marker in this file needs. Render plain, un-transformed content as children; if a child needs
 * to be independently centered on the SAME point (e.g. a small dot inside a bigger ring), give
 * it `left-1/2 top-1/2` (not left/top set again as a %) plus its own -translate-x/y-1/2 — that
 * positions it at the wrapper's own center, since the wrapper is already sized to its content
 * and already landed on the target point.
 *
 * This exists because a marker that instead re-applied its OWN "center on the target point"
 * transform on top of this wrapper's — instead of just being positioned relative to the
 * wrapper's already-correct center — silently rendered a fixed distance away from wherever was
 * actually tapped, however precisely (see the 2026-08-16 fix). Doing the centering exactly once,
 * in exactly one place, makes that class of bug impossible to reintroduce by copy-paste.
 */
const MapMarker = ({ fx, fy, className, children }: { fx: number; fy: number; className?: string; children?: React.ReactNode }) => (
  <div className={`absolute -translate-x-1/2 -translate-y-1/2 ${className ?? ""}`} style={{ left: `${fx * 100}%`, top: `${fy * 100}%` }}>
    {children}
  </div>
);

const dartKey = (d: DetectedDart) => `${d.baseValue}x${d.multiplier}`;

const hasPosition = (d: DetectedDart) =>
  typeof d.x === "number" && Number.isFinite(d.x) && typeof d.y === "number" && Number.isFinite(d.y);

const LiveCamera = forwardRef<LiveCameraHandle, LiveCameraProps>(({
  onRoundCommit,
  onPendingChange,
  enabled,
  onClose,
  dartsRemaining = 3,
  playerName,
  remainingScore,
  scoreStrip,
  onRequestManualEntry,
  paused = false,
}, ref) => {
  const { t } = useLanguage();
  const { session } = useAuth();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const zoomCapsRef = useRef<ZoomCapability | null>(null);

  // Rolling clip recorder
  const clipRecorderRef = useRef<MediaRecorder | null>(null);
  const clipChunksRef = useRef<BlobPart[]>([]);
  const clipMimeRef = useRef<string>("video/webm");
  const lastClipRef = useRef<{ seq: number; blob: Blob; mime: string } | null>(null);
  const clipSegmentTimerRef = useRef<number | null>(null);
  // Every recorded segment gets a sequence number, and getRecentClip() only ever returns the
  // segment whose number matches pinnedClipSeqRef — see the pinning logic at both
  // restartClipSegment call sites (the automatic board-empty branch in the watcher loop below,
  // and manualScan) for why this indirection exists. Both END-OF-VISIT triggers must pin, or
  // whichever one committed the round silently gets no clip (2026-09 field report).
  const clipSegmentSeqRef = useRef(0);
  const pinnedClipSeqRef = useRef<number | null>(null);

  // Frame state
  const prevSigRef = useRef<number[] | null>(null);
  const stableSigRef = useRef<number[] | null>(null);
  const emptyBoardSigRef = useRef<number[] | null>(null);
  const stillFramesRef = useRef(0);
  const changeSeenRef = useRef(false);
  // Consecutive ticks the frame has looked NOTHING like the calibrated board — see
  // BOARD_MISSING_DELTA's own comment for why this needs its own, much higher threshold than
  // "a dart landed" motion detection already uses.
  const boardMissingStreakRef = useRef(0);
  const scanLockRef = useRef(false);
  const lastScanAtRef = useRef(0);
  // Empty baseline / just-before-pulled moments, as raw pixel data for local diff-based
  // detection — see dartVision.ts.
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
  const [modelReady, setModelReady] = useState(false);
  /** Set while the model cannot be used (not loaded / failed to run): the fallback detection runs, and the player is told. */
  const [modelProblem, setModelProblem] = useState<string | null>(null);
  const [lastDetectionSource, setLastDetectionSource] = useState<"model" | "diff" | "gemini" | null>(null);
  // Background Gemini second opinion (2026-09-10) — unlike lastDetectionSource="gemini" above
  // (Gemini as the ONLY source, when the local pipeline found nothing at all), this is Gemini
  // running alongside an already-shown local result, purely as a "does the cloud read this
  // differently?" cross-check. Never blocks or replaces anything on its own — see
  // checkGeminiSecondOpinion's own doc comment for why it only ever offers a suggestion.
  const [geminiSuggestion, setGeminiSuggestion] = useState<DetectedDart[] | null>(null);
  const [autoCommitEnabled, setAutoCommitEnabledState] = useState<boolean>(() => loadAutoCommitEnabled());
  const setAutoCommitEnabled = (enabled: boolean) => {
    if (typeof window !== "undefined") window.localStorage.setItem(AUTO_COMMIT_KEY, enabled ? "on" : "off");
    setAutoCommitEnabledState(enabled);
  };
  /** Seconds left until the finished round is taken over by itself (null = not counting). */
  const [autoCommitLeft, setAutoCommitLeft] = useState<number | null>(null);
  /** Set as soon as the player touches a dart of the finished round — from then on only "Übernehmen" commits. */
  const [autoCommitHeld, setAutoCommitHeld] = useState(false);
  const autoCommitSnapshotRef = useRef<DetectedDart[] | null>(null);
  const [trainingDataEnabled, setTrainingDataEnabledState] = useState<boolean>(() => loadTrainingDataEnabled());
  const setTrainingDataEnabled = (enabled: boolean) => {
    if (typeof window !== "undefined") window.localStorage.setItem(TRAINING_DATA_KEY, enabled ? "on" : "off");
    setTrainingDataEnabledState(enabled);
  };
  const [trainingConsentAsked, setTrainingConsentAskedState] = useState<boolean>(() => loadTrainingConsentAsked());
  const answerTrainingConsent = (enabled: boolean) => {
    setTrainingDataEnabled(enabled);
    if (typeof window !== "undefined") window.localStorage.setItem(TRAINING_CONSENT_ASKED_KEY, "yes");
    setTrainingConsentAskedState(true);
  };
  // Snapshot of the image pair a scan was just run on, held onto until the round is committed
  // (by then `preRemovalImageDataRef`/`emptyImageDataRef` have already been cleared/overwritten
  // for the next throw) — see uploadTrainingSample.
  // `modelAfter` is the full-resolution, unclipped frame the ONNX model actually runs on — preferred as
  // the training image, because the 420px circle-clipped analysis frame looks nothing like the input
  // the model sees at inference (black corners, a fraction of the resolution). Same crop, so the
  // dart positions (0-1 fractions) are valid on either image.
  const pendingTrainingCaptureRef = useRef<{ before: ImageData; after: ImageData; modelAfter: ImageData | null; frame: "rectified" | "crop" } | null>(null);
  // Which kind of frame preRemovalModelFrameRef holds (set together with it).
  const preRemovalFrameKindRef = useRef<"rectified" | "crop">("crop");
  // The model frame as of the last stable moment (empty board, or the previous dart's landing) and the
  // pair of frames around the dart that just landed — comparing them shows where THAT dart is, even
  // when it sits right next to the earlier ones (see utils/changeMask.ts).
  const lastStableModelFrameRef = useRef<ImageData | null>(null);
  // Landings waiting for the model, oldest first. The model needs a few seconds on a phone and darts are
  // thrown faster than that, so landings are queued and judged one after the other — each against ITS
  // OWN before/after frames. (A single "busy" flag used to make the second and third dart of a round
  // simply be skipped whenever the first was still being analysed.)
  const landingQueueRef = useRef<{ before: ImageData | null; after: ImageData }[]>([]);
  /** The empty board as the model sees it — what a finished visit is compared with to tell darts from
   *  anything that was already there. */
  const emptyModelFrameRef = useRef<ImageData | null>(null);
  /** Darts that were already in the board when this round's empty-board baseline was taken (null = not looked yet). */
  const baselineDartsRef = useRef<{ x: number; y: number; confidence: number }[] | null>(null);
  /** Most darts seen at once this round — the picture with the most darts is the one kept for review. */
  const peakPresentRef = useRef(0);
  const stillMomentBusyRef = useRef(false);
  const noiseFloorRef = useRef(0);
  /** Fine luminance picture of the latest tick, and the one at the last evaluation (see FINE_CHANGE_MIN_CELLS). */
  const latestFineRef = useRef<Float32Array | null>(null);
  const evaluatedFineRef = useRef<Float32Array | null>(null);
  const stillThresholdRef = useRef(MOTION_STILL);
  const stillMomentQueuedRef = useRef(false);
  /** Spots of darts the player removed by hand this round — detections there are ignored from then on. */
  const dismissedRef = useRef<{ x: number; y: number }[]>([]);
  /** The last picture the model actually looked at (see handleStillMoment). */
  const lastEvaluatedFrameRef = useRef<ImageData | null>(null);

  const [phase, setPhase] = useState<Phase>("starting");
  const [error, setError] = useState<string | null>(null);
  const [accumulated, setAccumulated] = useState<DetectedDart[]>([]);
  const accumulatedRef = useRef<DetectedDart[]>([]);
  const [status, setStatus] = useState("Kamera startet …");
  // True once the live frame has looked nothing like the calibrated board for several
  // consecutive ticks — the camera got pointed away, bumped, or picked up mid-game. Deliberately
  // NOT the existing `phase === "error"` state, which covers the whole video with an opaque
  // panel (right for "camera access denied", wrong here — the user needs to actually SEE the
  // live image to realize it's not pointed at the board and redirect it).
  const [boardMissing, setBoardMissing] = useState(false);
  const [scanFailed, setScanFailed] = useState(false);
  const [needsReview, setNeedsReview] = useState(false);
  // Mirrors needsReview into a ref for the watcher-loop interval closure (same reason
  // accumulatedRef mirrors accumulated below) — used to tell "this visit's darts are still
  // being incrementally identified as they land" apart from "a fully-scanned round is already
  // sitting there awaiting Übernehmen/Verwerfen", which the interval must NOT overwrite with a
  // fresh scan if the player starts a second round before reviewing the first.
  const needsReviewRef = useRef(false);
  useEffect(() => { needsReviewRef.current = needsReview; }, [needsReview]);
  // Guards against overlapping per-throw identification attempts (scoreNewlyLandedDart is async
  // — ONNX inference isn't instant) the same way scanLockRef guards the end-of-visit batch scan.
  const perThrowLockRef = useRef(false);
  const [motion, setMotion] = useState(0);
  const [changeDelta, setChangeDelta] = useState(0);
  const [lastConfidence, setLastConfidence] = useState(0);
  const [activeBoard, setActiveBoard] = useState<string>(() => loadActiveBoard());
  const [calib, setCalib] = useState<Calibration>(() => loadCalib(calibKeyFor(loadActiveBoard())));
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(() => loadDeviceId(loadActiveBoard()));
  const [showAdvanced, setShowAdvanced] = useState(false);
  // Full-screen camera: the panel can be tucked away (to type a score by hand) and brought back by a pill.
  const [overlayHidden, setOverlayHidden] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // The room the picture can really use (what is left between header, scoreboard and the buttons below).
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [stageHeight, setStageHeight] = useState(0);
  useEffect(() => {
    const el = stageRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setStageHeight(Math.round(el.clientHeight)));
    observer.observe(el);
    setStageHeight(Math.round(el.clientHeight));
    return () => observer.disconnect();
  }, []);
  const [isLandscape, setIsLandscape] = useState(() => typeof window !== "undefined" && window.innerWidth > window.innerHeight);
  useEffect(() => {
    const onResize = () => setIsLandscape(window.innerWidth > window.innerHeight);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  // On-device visual check for the calibration, no browser devtools needed — many testers only
  // have the phone itself in hand. Shows exactly where the app thinks D20/D3/D11/D6 are, right
  // on top of the live feed, so a wrong calibration is visible at a glance instead of requiring
  // a console log from a machine that isn't there.
  const [showCalibDebug, setShowCalibDebug] = useState(false);
  // Index into `accumulated` currently being manually repositioned (tap-to-place), or null.
  // Exists because the review UI's dropdowns only ever corrected the SEGMENT value, never the
  // detected TIP POSITION — so a training sample "corrected" that way still stored the model's
  // original (possibly wrong) position paired with the right label, which would teach a future
  // fine-tune the wrong position/label association instead of fixing it.
  const [repositioningIndex, setRepositioningIndex] = useState<number | null>(null);
  const [justAddedIndex, setJustAddedIndex] = useState<number | null>(null);
  // Calibration being edited on screen (camera-video fractions: D20, D3, D11, D6) and where it came from.
  // The frozen picture of the finished visit (darts still in the board) the review works on, and
  // which dart is selected there.
  const [reviewFrame, setReviewFrame] = useState<{ url: string } | null>(null);
  const [selectedReviewIndex, setSelectedReviewIndex] = useState<number | null>(null);
  const [calibDraft, setCalibDraft] = useState<{ x: number; y: number }[] | null>(null);
  const [calibDraftSource, setCalibDraftSource] = useState<"auto" | "manual">("manual");
  // Native size of the camera picture, once known — the video box takes exactly this aspect ratio,
  // so the whole picture is always visible (a square box with object-cover used to cut away the
  // top and bottom of a portrait picture, or the sides of a landscape one, hiding board parts).
  const [videoSize, setVideoSize] = useState<{ w: number; h: number } | null>(null);
  const syncVideoSize = () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth || !v.videoHeight) return;
    setVideoSize((prev) => (prev && prev.w === v.videoWidth && prev.h === v.videoHeight ? prev : { w: v.videoWidth, h: v.videoHeight }));
  };
  // UX-Audit Befund #1 (Kamera-Review): Löschen/Verwerfen lösten bisher sofort aus, ohne
  // Rückfrage — anders als überall sonst in der App, wo destruktive Aktionen bestätigt werden
  // (siehe Players.tsx confirmDeleteId, Tournament.tsx Match-Reset). Dieselbe Absicherung jetzt
  // auch hier: removeDart/discardRound feuern erst nach Bestätigung im AlertDialog.
  const [confirmDiscardOpen, setConfirmDiscardOpen] = useState(false);
  const [confirmRemoveIndex, setConfirmRemoveIndex] = useState<number | null>(null);
  // UX-Audit Befund #4, Option B (Kamera-Review-Layout, "Alle drei auf einen Blick"): all three
  // darts already listed at once (kept — the "one at a time" alternative would have been a step
  // backward), but corrections went through two tiny native <select> dropdowns — exactly the
  // "winzige Bedienelemente an kritischer Stelle" the original audit flagged. Tapping a row now
  // expands it in place into large tap targets; the other rows stay visible in their compact
  // summary form, matching the chosen mockup. Only one row open at a time.
  const [expandedReviewIndex, setExpandedReviewIndex] = useState<number | null>(null);
  // How many of the four corners the model found with confidence in the last automatic attempt —
  // shown when it falls back to manual tapping, so "why didn't it work on my board?" has a visible
  // answer instead of a silent fallback.
  const [autoCalibFoundCount, setAutoCalibFoundCount] = useState<number | null>(null);

  // A finished round must never wait unseen behind the hidden panel.
  useEffect(() => {
    if (needsReview) setOverlayHidden(false);
  }, [needsReview]);
  // The frozen review picture is shown only for a finished visit waiting for confirmation — not after
  // every single throw, which would cover the live view while the player is still throwing.
  // The player can also open the frozen picture on purpose (tap a dart tile) to place a tip precisely with the loupe.
  const [reviewOpen, setReviewOpen] = useState(false);
  const showReview = !!reviewFrame && (needsReview || reviewOpen);
  const reviewAnchorRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (needsReview || reviewOpen) return;
    setSelectedReviewIndex(null);
    setReviewFrame((prev) => {
      if (prev) URL.revokeObjectURL(prev.url);
      return null;
    });
  }, [needsReview, reviewOpen]);
  // Hands-free hand-over: a finished round (board empty again) counts down and commits itself; touching a
  // dart (select, edit, remove) stops the countdown so a correction never races the clock.
  const autoCommitActive = needsReview && autoCommitEnabled && !autoCommitHeld && accumulated.length > 0 && !scanFailed;
  useEffect(() => {
    if (!autoCommitActive) { setAutoCommitLeft(null); return; }
    autoCommitSnapshotRef.current = accumulatedRef.current;
    setAutoCommitLeft(AUTO_COMMIT_SECONDS);
    const id = window.setInterval(() => setAutoCommitLeft((prev) => (prev === null ? null : prev - 1)), 1000);
    return () => window.clearInterval(id);
  }, [autoCommitActive]);
  useEffect(() => {
    if (autoCommitLeft !== null && autoCommitLeft <= 0) commitRound(accumulatedRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoCommitLeft]);
  useEffect(() => {
    if (!needsReview) { setAutoCommitHeld(false); return; }
    if (selectedReviewIndex !== null || expandedReviewIndex !== null) setAutoCommitHeld(true);
  }, [needsReview, selectedReviewIndex, expandedReviewIndex]);
  useEffect(() => {
    if (autoCommitActive && autoCommitSnapshotRef.current && accumulated !== autoCommitSnapshotRef.current) setAutoCommitHeld(true);
  }, [accumulated, autoCommitActive]);
  // A new review picture must not appear out of sight (the page may be scrolled down to the buttons).
  useEffect(() => {
    if (reviewFrame) reviewAnchorRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [reviewFrame]);

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
    preRemovalImageDataRef.current = null;
    preRemovalModelFrameRef.current = null;
    lastStableModelFrameRef.current = null;
    landingQueueRef.current = [];
    emptyModelFrameRef.current = null;
    baselineDartsRef.current = null;
    peakPresentRef.current = 0;
    stillMomentBusyRef.current = false;
    stillMomentQueuedRef.current = false;
    lastEvaluatedFrameRef.current = null;
    evaluatedFineRef.current = null;
    dismissedRef.current = [];
    pendingTrainingCaptureRef.current = null;
    throwsSeenRef.current = 0;
    setThrowsSeen(0);
    boardMissingStreakRef.current = 0;
    setBoardMissing(false);
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
    clipSegmentSeqRef.current += 1;
    const mySeq = clipSegmentSeqRef.current;
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
        lastClipRef.current = { seq: mySeq, blob: new Blob(clipChunksRef.current, { type: mime }), mime };
      }
      // Immediately roll into the next segment for continuous coverage.
      if (clipRecorderRef.current === recorder) startClipSegment();
    };
    recorder.start();
    clipSegmentTimerRef.current = window.setTimeout(() => {
      if (clipRecorderRef.current === recorder && recorder.state !== "inactive") recorder.stop();
    }, CLIP_SEGMENT_MS);
  }, []);

  /** Ends the current clip segment right now and starts a fresh one — called whenever the board
   *  goes empty (see the watcher loop below), which is exactly both "a visit just ended" and "the
   *  next one is about to begin". Stopping here (not via stopClipRecorder, which deliberately
   *  suppresses the auto-chain for a real shutdown) lets the recorder's own onstop finalize this
   *  segment into lastClipRef and immediately start the next one, so segment boundaries track
   *  actual visit boundaries instead of an arbitrary fixed interval. Returns the (about to be
   *  finalized) segment's sequence number so the caller can pin it — see pinnedClipSeqRef. */
  const restartClipSegment = useCallback((): number => {
    const endedSeq = clipSegmentSeqRef.current;
    if (clipSegmentTimerRef.current) {
      window.clearTimeout(clipSegmentTimerRef.current);
      clipSegmentTimerRef.current = null;
    }
    const rec = clipRecorderRef.current;
    if (rec && rec.state !== "inactive") {
      try { rec.stop(); } catch { startClipSegment(); }
    } else {
      startClipSegment();
    }
    return endedSeq;
  }, [startClipSegment]);

  useImperativeHandle(ref, () => ({
    getRecentClip: () => {
      const clip = lastClipRef.current;
      // Only ever hand back the segment actually pinned to the round currently under review /
      // just committed — never just "whatever finished recording most recently". Without this,
      // a highlight round left sitting unconfirmed (needsReview) while ANY later board activity
      // (the opponent's next visit, a stray practice throw) gets recorded and pulled would have
      // its clip silently stolen by that later segment by the time Übernehmen is finally tapped —
      // exactly the "checkout clip shows the opponent's throw" report this was built to prevent.
      if (!clip || clip.seq !== pinnedClipSeqRef.current) return null;
      return { url: URL.createObjectURL(clip.blob), mime: clip.mime, blob: clip.blob };
    },
  }), []);

  // Keep the video box's aspect ratio in step with the picture (phone rotated, camera switched).
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.addEventListener("resize", syncVideoSize);
    return () => v.removeEventListener("resize", syncVideoSize);
  }, [enabled]);

  // ─── camera lifecycle ───────────────────────────────────────────────
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    (async () => {
      try {
        setPhase("starting");
        setStatus(t("camera.starting"));
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
        setError(t("camera.accessDenied"));
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
  // Thin wrappers around the pure functions in @/utils/cameraGeometry — this component's job is
  // just to supply the live videoRef/calib values; the actual math (and its tests) live there.
  // See that file's header for what "screen", "video" and "crop" fraction mean.
  const cropRect = () => {
    const v = videoRef.current;
    if (!v) return null;
    return computeCropRect(v.videoWidth, v.videoHeight, calib.x, calib.y, calib.size);
  };

  const videoVisibleWindow = () => {
    const v = videoRef.current;
    if (!v) return null;
    // Measure the <video> element's own box, not its (bordered) parent container's —
    // getBoundingClientRect() includes the border, but absolutely-positioned overlay children
    // (the tap-catchers, the markers) and the video's own object-cover content all render
    // relative to the padding box, inside that border. A 1px mismatch is small, but it's a
    // real, avoidable systematic offset — measure the exact box that's actually relevant.
    const videoRect = v.getBoundingClientRect();
    return computeVisibleWindow(v.videoWidth, v.videoHeight, videoRect.width, videoRect.height);
  };

  /** On-screen tap (fraction of the displayed video box, 0-1) -> fraction of the native video
   *  frame — for calibration taps and reposition taps, which are captured via getBoundingClientRect
   *  of that on-screen box and must be converted before use in any board-geometry math. */
  const screenFractionToVideoFraction = (nx: number, ny: number): { x: number; y: number } | null => {
    const win = videoVisibleWindow();
    return win ? screenToVideoFraction(nx, ny, win) : null;
  };

  /** Inverse of the above — a fraction of the native video frame -> where that point actually
   *  renders within the on-screen (possibly cropped) video box, for drawing markers/rings/dots. */
  const videoFractionToScreenFraction = (fx: number, fy: number): { x: number; y: number } | null => {
    const win = videoVisibleWindow();
    return win ? videoToScreenFraction(fx, fy, win) : null;
  };

  /** Where the analysis crop actually renders on screen (top-left + size, as a fraction of the
   *  video box) — for the tracking ring. See computeCropScreenRect's doc comment for why this
   *  has to go through the real crop rect instead of scaling calib.size by the screen window. */
  const cropScreenRect = () => {
    const v = videoRef.current;
    const win = videoVisibleWindow();
    if (!v || !win) return null;
    return computeCropScreenRect(v.videoWidth, v.videoHeight, calib.x, calib.y, calib.size, win);
  };

  // A point relative to the cropped/zoomed analysis frame (0-1) -> the full video frame (the
  // same space calibration taps and the live overlay both use). Shared by dart positions
  // (toFullFrameXY below) AND the model's auto-detected calibration corners (see
  // tryAutoCalibrate) — using the identical formula for both is what makes auto-calibration
  // self-consistent with dart scoring without needing to know how manual taps relate to it.
  const cropXYToFullFrame = (x: number, y: number): { fx: number; fy: number } | null => {
    const v = videoRef.current;
    const rect = cropRect();
    if (!v || !rect) return null;
    const p = cropToVideoFraction(x, y, v.videoWidth, v.videoHeight, rect);
    return p ? { fx: p.x, fy: p.y } : null;
  };

  // Inverse of the above — a tap on the displayed video (full-frame-relative, same convention
  // the overlay markers already render at) back to crop-relative coordinates, for manually
  // repositioning a mis-detected dart. See repositioningIndex.
  const fullFrameXYToCropXY = (fx: number, fy: number): { x: number; y: number } | null => {
    const v = videoRef.current;
    const rect = cropRect();
    if (!v || !rect) return null;
    return videoFractionToCrop(fx, fy, v.videoWidth, v.videoHeight, rect);
  };

  // Dart x/y come back relative to the cropped/zoomed analysis frame — map to the full
  // video frame (the same space calibration taps and the live overlay both use).
  const toFullFrameXY = (d: DetectedDart): { fx: number; fy: number } | null => {
    if (!hasPosition(d)) return null;
    return frameXYToFull(d.x ?? 0, d.y ?? 0);
  };

  // ─── model frame: the board straightened into a flat top-down view ───────────────────
  // Once the board is calibrated, the model is shown a RECTIFIED frame (see utils/boardRectify.ts):
  // 20 on top, always the same size, no perspective, plenty of margin for the flights — the picture
  // the model was trained on, whatever the camera angle or zoom. Dart positions (DetectedDart.x/y)
  // are then fractions of that frame; before a calibration exists they stay fractions of the plain
  // analysis crop. These helpers are the only place that knows the difference.

  /** The calibration taps with the board-centre shift applied that boardTransformFromTaps(taps,
   *  {x: calib.x, y: calib.y}) makes for scoring — rectifying with the same taps keeps both in step. */
  const effectiveTaps = () => {
    const taps = calib.taps;
    if (!taps || taps.length !== 4) return undefined;
    const dx = calib.x - (taps[2].x + taps[3].x) / 2;
    const dy = calib.y - (taps[0].y + taps[1].y) / 2;
    if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) return taps;
    return taps.map((t) => ({ x: t.x + dx, y: t.y + dy }));
  };
  const rectMapping = () => rectifyMappingFromTaps(effectiveTaps());

  const fullFrameScratchRef = useRef<HTMLCanvasElement | null>(null);
  /** The board straightened to RECT_SIZE x RECT_SIZE, or null while uncalibrated / camera not ready. */
  const grabRectifiedFrame = (mappingOverride?: RectifyMapping | null): ImageData | null => {
    const v = videoRef.current;
    const mapping = mappingOverride ?? rectMapping();
    if (!v || !v.videoWidth || !mapping) return null;
    const scale = Math.min(1, MAX_RECTIFY_SOURCE_SIDE / Math.max(v.videoWidth, v.videoHeight));
    const w = Math.round(v.videoWidth * scale);
    const h = Math.round(v.videoHeight * scale);
    const canvas = fullFrameScratchRef.current ?? (fullFrameScratchRef.current = document.createElement("canvas"));
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(v, 0, 0, w, h);
    const source = ctx.getImageData(0, 0, w, h);
    const out = warpToRectified({ data: source.data, width: w, height: h }, mapping.rectToVideo);
    return new ImageData(out.data as Uint8ClampedArray<ArrayBuffer>, out.width, out.height);
  };

  /** What the model gets to see: the rectified board when calibrated, else the plain crop. */
  const grabModelFrame = (): ImageData | null => grabRectifiedFrame() ?? grabImageData(MODEL_INPUT_SIZE, false);

  /** Freezes the current model frame as THE picture of this visit (review + training sample). Taken
   *  whenever it can be used — model loaded, or a calibration exists to straighten the board with. */
  const captureModelFrame = () => {
    const rectified = !!rectMapping();
    if (!modelReadyRef.current && !rectified) return;
    preRemovalModelFrameRef.current = grabModelFrame();
    preRemovalFrameKindRef.current = rectified ? "rectified" : "crop";
  };

  /** A point on the model frame (0-1) -> the camera video (0-1). */
  const frameXYToFull = (x: number, y: number): { fx: number; fy: number } | null => {
    const mapping = rectMapping();
    if (mapping) {
      const p = applyHomography(mapping.rectToVideo, { x, y });
      return { fx: p.x, fy: p.y };
    }
    return cropXYToFullFrame(x, y);
  };

  /** Detectors that work on the plain analysis crop (pixel diff, Gemini) report fractions of THAT crop;
   *  bring them into the model frame so every dart position means the same thing. */
  const cropPointToFrameXY = (x: number, y: number): { x: number; y: number } => {
    if (!rectMapping()) return { x, y };
    const full = cropXYToFullFrame(x, y);
    return (full && fullToFrameXY(full.fx, full.fy)) ?? { x, y };
  };

  /** A point on the camera video (0-1) -> the model frame (0-1, clamped to the frame). */
  const fullToFrameXY = (fx: number, fy: number): { x: number; y: number } | null => {
    const mapping = rectMapping();
    if (mapping) {
      const p = applyHomography(mapping.videoToRect, { x: fx, y: fy });
      return { x: clamp(p.x, 0, 1), y: clamp(p.y, 0, 1) };
    }
    return fullFrameXYToCropXY(fx, fy);
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
    const ctx = c.getContext("2d", SHARED_CANVAS_OPTIONS);
    if (!ctx) return null;
    ctx.clearRect(0, 0, target, target);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
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
  /** A square of the camera picture (unclipped, MODEL_INPUT_SIZE) at an arbitrary position and size —
   *  used to search for the board when no calibration exists yet. */
  const cropScratchRef = useRef<HTMLCanvasElement | null>(null);
  const grabCropFrame = (calibX: number, calibY: number, size: number) => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return null;
    const rect = computeCropRect(v.videoWidth, v.videoHeight, calibX, calibY, size);
    if (!rect) return null;
    const canvas = cropScratchRef.current ?? (cropScratchRef.current = document.createElement("canvas"));
    canvas.width = MODEL_INPUT_SIZE;
    canvas.height = MODEL_INPUT_SIZE;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(v, rect.sx, rect.sy, rect.side, rect.side, 0, 0, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE);
    return { frame: ctx.getImageData(0, 0, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE), rect };
  };

  const grabImageData = (target: number = VISION_ANALYSIS_SIZE, circular = true): ImageData | null => {
    const c = drawToCanvas(target, circular);
    if (!c) return null;
    const ctx = c.getContext("2d", SHARED_CANVAS_OPTIONS);
    if (!ctx) return null;
    return ctx.getImageData(0, 0, target, target);
  };

  const buildSignature = (): number[] | null => {
    // Drawn 4x larger than the grid and averaged block by block: shrinking a 1080p camera picture straight to
    // 40 px samples only a few pixels per cell, so the sensor noise alone moved the signature past the "still"
    // threshold and the watcher never saw a quiet moment (it sat on "movement detected" with darts in the board).
    const source = GRID * SIGNATURE_OVERSAMPLE;
    const c = drawToCanvas(source, true);
    if (!c) return null;
    const ctx = c.getContext("2d", SHARED_CANVAS_OPTIONS);
    if (!ctx) return null;
    const { data } = ctx.getImageData(0, 0, source, source);
    // The same read-out as a fine luminance picture: a dart landing changes the 40x40 signature by far less than
    // any threshold that hand movement needs, but it is plain to see cell by cell on this one.
    const fine = new Float32Array(source * source);
    for (let p = 0, i = 0; p < fine.length; p++, i += 4) fine[p] = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) / 255;
    latestFineRef.current = fine;
    const sig: number[] = [];
    const r = GRID / 2;
    const cell = SIGNATURE_OVERSAMPLE * SIGNATURE_OVERSAMPLE;
    for (let y = 0; y < GRID; y++) {
      for (let x = 0; x < GRID; x++) {
        const dx = x + 0.5 - r;
        const dy = y + 0.5 - r;
        if (dx * dx + dy * dy > (r - 1) ** 2) continue;
        let sum = 0;
        for (let by = 0; by < SIGNATURE_OVERSAMPLE; by++) {
          for (let bx = 0; bx < SIGNATURE_OVERSAMPLE; bx++) {
            const i = ((y * SIGNATURE_OVERSAMPLE + by) * source + x * SIGNATURE_OVERSAMPLE + bx) * 4;
            sum += data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
          }
        }
        sig.push(sum / cell / 255);
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

  /** Same re-draw trick as imageDataToBlob, but synchronous and returns a ready-to-send
   *  "data:image/jpeg;base64,..." string — what analyze-dartboard's imageBase64 body field wants,
   *  no separate upload/round-trip needed the way storage uploads do. */
  const imageDataToBase64 = (img: ImageData, quality = 0.85): string | null => {
    const canvas = document.createElement("canvas");
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.putImageData(img, 0, 0);
    return canvas.toDataURL("image/jpeg", quality);
  };

  /** Cloud-vision fallback for when the on-device pipeline (trained model + motion-diff) found
   *  NOTHING at all — see GEMINI_FALLBACK_TIMEOUT_MS's own doc comment for why this only fires in
   *  that specific case. Deliberately mirrors how the local model's raw output is treated just
   *  above (candidateDarts = refineWithCalibration(modelResult.darts.map(...))): Gemini's own
   *  segment/multiplier guess is discarded on purpose and only its x/y tip estimate is kept, then
   *  run through the SAME calibrated-geometry scoring every other detection source uses — keeps
   *  this fallback indistinguishable from any other detection source to all the downstream code
   *  (review UI, training-sample upload, etc.). Never throws — any failure (no session, network
   *  error, bad response, timeout) just resolves to null so the caller falls through to today's
   *  "no darts detected, please enter manually" behavior exactly as before this existed. */
  const tryGeminiFallback = async (frame: ImageData | null): Promise<DetectedDart[] | null> => {
    if (!frame || !session?.access_token) return null;
    const imageBase64 = imageDataToBase64(frame);
    if (!imageBase64) return null;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), GEMINI_FALLBACK_TIMEOUT_MS);
    try {
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/analyze-dartboard`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ imageBase64, detectBoard: false }),
        signal: controller.signal,
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data || !Array.isArray(data.darts) || data.darts.length === 0) return null;
      type GeminiDart = { x?: unknown; y?: unknown; confidence?: unknown };
      const raw = (data.darts as GeminiDart[])
        .filter((d) => typeof d.x === "number" && typeof d.y === "number")
        .map((d) => ({
          baseValue: 0,
          multiplier: 1 as const,
          points: 0,
          confidence: typeof d.confidence === "number" ? clamp(d.confidence, 0, 1) : 0.5,
          ...cropPointToFrameXY(d.x as number, d.y as number),
        }))
        // Keep at most as many darts as this visit could actually hold — Gemini has no notion of
        // throwsSeenRef, so cap+sort-by-confidence guards against an over-eager extra detection.
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, Math.max(1, throwsSeenRef.current || dartsRemaining));
      if (raw.length === 0) return null;
      return refineWithCalibration(raw);
    } catch {
      return null;
    } finally {
      window.clearTimeout(timeout);
    }
  };

  /** Unordered "which darts, how scored" fingerprint — used only to decide whether two readings
   *  of the same visit actually disagree, never for display. Position isn't part of the key on
   *  purpose: two sources landing on the same segment/multiplier via slightly different tip pixels
   *  still count as agreeing. */
  const dartMultisetKey = (darts: DetectedDart[]) => darts.map(dartKey).sort().join(",");

  /** Background cross-check (2026-09-10): fires once per visit, right alongside the local
   *  detection result that's already on screen — NEVER awaited by the caller, so it adds zero
   *  wait time to a round that already showed a result (this is what Martin actually asked for:
   *  most rounds already need some manual correction today, and a several-second wait on every
   *  single one to maybe get a better first guess would be a worse trade than what it fixes).
   *  When Gemini's reading of the same frame comes back — a second or few later — it's compared
   *  against whatever's CURRENTLY in the review list (accumulatedRef.current, not a stale
   *  snapshot, since the player may already be mid-correction by the time this resolves). Only
   *  disagreement is surfaced (see dartMultisetKey) — silent agreement would just be visual noise
   *  on the common case where the local model already got it right. Purely a suggestion: nothing
   *  is applied automatically, review still ends the same way it always has, via the player's own
   *  Übernehmen tap. Guarded on the round still being open for review (needsReviewRef.current) so
   *  a suggestion can't resurrect itself after the round's already been committed or discarded. */
  const checkGeminiSecondOpinion = async (frame: ImageData | null) => {
    const result = await tryGeminiFallback(frame);
    if (!result || result.length === 0) return;
    if (!needsReviewRef.current) return;
    if (dartMultisetKey(result) === dartMultisetKey(accumulatedRef.current)) return;
    setGeminiSuggestion(result);
  };

  /** Everything needed to turn this sample's calibration into corner labels later, written at
   *  capture time when the real video size and crop are known (reconstructing them afterwards
   *  from the taps alone is guesswork — the video orientation isn't stored anywhere else).
   *  `corners` are the four D20/D3/D11/D6 points as 0-1 fractions of the saved training image
   *  (same crop for the analysis frame and the model frame, so they hold for either). */
  const buildCalibrationMeta = (frame: "rectified" | "crop") => {
    const v = videoRef.current;
    const rect = cropRect();
    if (!v || !rect || !v.videoWidth || !v.videoHeight) return null;
    const rectified = frame === "rectified";
    // Corner positions in the saved image: in the rectified frame they are fixed by construction.
    const corners = rectified
      ? Object.fromEntries(CALIB_KEYS.map((key, i) => {
          const p = canonicalToRect(CANON_BOARD_POINTS[i].x, CANON_BOARD_POINTS[i].y);
          return [key, { x: p.x, y: p.y }];
        }))
      : calib.taps?.length === 4
        ? Object.fromEntries(CALIB_KEYS.map((key, i) => {
            const t = calib.taps![i];
            return [key, { x: (t.x * v.videoWidth - rect.sx) / rect.side, y: (t.y * v.videoHeight - rect.sy) / rect.side }];
          }))
        : null;
    return {
      version: 2,
      // "rectified": the saved image is the board straightened by boardRectify (20 on top, the
      // double edge at rectBoardRadius of the width). "crop": the plain analysis crop.
      frame,
      rectBoardRadius: rectified ? RECT_BOARD_RADIUS : null,
      // cal_1..cal_4 of the model, i.e. the wire crossings, in the saved image (rectified frames only).
      modelCorners: rectified
        ? MODEL_CORNERS_CANON.map((p) => {
            const c = canonicalToRect(p.x, p.y);
            return { x: c.x, y: c.y };
          })
        : null,
      source: calib.source ?? "unknown",
      confirmed: calib.confirmed ?? null,
      video: { w: v.videoWidth, h: v.videoHeight },
      crop: { sx: rect.sx, sy: rect.sy, side: rect.side },
      calib: { x: calib.x, y: calib.y, size: calib.size, zoom: calib.zoom },
      corners,
      cornersInsideImage: corners
        ? Object.values(corners).every((c) => c.x >= 0 && c.x <= 1 && c.y >= 0 && c.y <= 1)
        : false,
    };
  };

  /** Best-effort background upload of one training sample (see TRAINING_DATA_KEY doc comment) —
   *  never throws into the caller and never blocks/slows down the actual scoring flow it hangs
   *  off of. `darts` is the FINAL, possibly player-corrected list at the moment of commit, which
   *  is exactly the free label this whole feature exists to capture. */
  const uploadTrainingSample = async (
    capture: { before: ImageData; after: ImageData; modelAfter: ImageData | null; frame: "rectified" | "crop" },
    darts: DetectedDart[],
  ) => {
    try {
      // confidence is the ORIGINAL detector's score for the position, kept even though baseValue
      // may since have been player-corrected — needed to tell apart "wrong but the model was
      // sure" from "wrong and the model was already unsure", which matters a lot when tuning
      // DART_SCORE_THRESHOLD against this data later.
      const labels = darts
        .filter(hasPosition)
        .map((d) => ({ x: d.x, y: d.y, baseValue: d.baseValue, multiplier: d.multiplier, boardU: d.boardU, boardV: d.boardV, confidence: d.confidence, snapped: d.snapped === true }));
      if (labels.length === 0) return;
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData?.user?.id;
      if (!userId) return;
      const trainingAfter = capture.modelAfter ?? capture.after;
      const [beforeBlob, afterBlob] = await Promise.all([
        imageDataToBlob(capture.before),
        imageDataToBlob(trainingAfter),
      ]);
      if (!beforeBlob || !afterBlob) return;
      const calibrationMeta = buildCalibrationMeta(capture.modelAfter ? capture.frame : "crop");
      const prefix = `${userId}/${crypto.randomUUID()}`;
      const [beforeUp, afterUp] = await Promise.all([
        supabase.storage.from("dart-training").upload(`${prefix}/before.jpg`, beforeBlob, { contentType: "image/jpeg" }),
        supabase.storage.from("dart-training").upload(`${prefix}/after.jpg`, afterBlob, { contentType: "image/jpeg" }),
      ]);
      if (beforeUp.error || afterUp.error) return;
      const row = {
        user_id: userId,
        board: activeBoard,
        before_path: `${prefix}/before.jpg`,
        after_path: `${prefix}/after.jpg`,
        image_size: trainingAfter.width,
        labels,
        // Read live off `calib` right here at commit time (not a value captured back when the
        // scan started) — lets the set later be evaluated/stratified by zoom level and camera
        // angle instead of accumulating blind to how skewed its coverage is toward one setup.
        camera_zoom: calib.zoom,
        calib_taps: calib.taps ?? null,
      };
      const { error: insertError } = await supabase.from("training_samples").insert({ ...row, calibration_meta: calibrationMeta });
      // Until the calibration_meta column exists in a given database, PostgREST rejects the whole
      // row — keep collecting samples without the metadata instead of silently losing them.
      if (insertError && /calibration_meta/.test(insertError.message ?? "")) {
        await supabase.from("training_samples").insert(row);
      }
    } catch (err) {
      console.warn("[LiveCamera] training sample upload skipped", err);
    }
  };

  // ─── auto-detect board ────────────────────────────────────────────
  // Digital crop/zoom is left alone here; only the 4 calibration points are attempted
  // automatically (via the trained model — see runLocalCalibrationFlow/tryAutoCalibrate), with
  // manual tapping as the always-available fallback/override. An earlier version of this ran a
  // heuristic board-circle finder to drive the crop/physical camera zoom automatically — pulled
  // back out after real-world testing found it made calibration worse, not better (an
  // unvalidated guess was moving the physical zoom to a bad spot before the user even started
  // tapping).
  const autoDetectBoard = async () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) {
      setPhase("live");
      setStatus(t("camera.readyThrowFirst"));
      resetLoop();
      return;
    }
    resetLoop();
    if (!calib.taps || calib.taps.length !== 4) {
      await runLocalCalibrationFlow();
    } else {
      // A saved calibration drifts between sessions (tripod nudged, zoom touched): settle it onto the
      // wires again before the first throw, silently.
      const settled = snapTapsToWires(calib.taps);
      if (settled) applyCalibrationTaps(settled, calib.source ?? "manual", calib.confirmed ?? true, false);
      setPhase("live");
      setStatus(t("camera.readyThrowFirst"));
    }
  };

  /** Validates and commits 4 [D20,D3,D11,D6] points as the board calibration — shared by the
   *  manual 4-tap flow and the model-based auto-calibration below, so both go through the exact
   *  same degenerate-calibration rejection and crop-framing math. Returns false (and leaves
   *  `calib` untouched) if the 4 points don't form a usable calibration. */
  const applyCalibrationTaps = (next: { x: number; y: number }[], source: "auto" | "manual", confirmed = source === "manual", reveal = true): boolean => {
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
    // 1.18 (was 1.06): the training_samples data showed several manually-repositioned darts
    // clamped to the crop's exact edge (y=0) — real single-band darts near the top of the board
    // that the analysis crop wasn't wide enough to actually reach, since fullFrameXYToCropXY
    // can't place a point outside the region the model actually saw. More margin here reduces
    // how often a real dart near the double ring falls outside the captured frame entirely.
    const size = clamp(Math.max(w, h) * 1.18, MIN_ANALYSIS_SIZE, 0.98);
    setCalib((prev) => ({ ...prev, x: cx, y: cy, size, taps: next, source, confirmed }));
    // Show the D20/D3/D11/D6 check by default right after (re)calibrating instead of requiring
    // an extra manual tap to verify — the whole point of that overlay is catching a bad
    // calibration immediately, so it should be the default view of a fresh one, not opt-in.
    if (reveal) setShowCalibDebug(true);
    return true;
  };

  /**
   * One-shot calibration via the trained model's cal_1..cal_4 classes (see dartModel.ts).
   *
   * What those classes mean was measured, not guessed (see MODEL_CORNER_ANGLES_DEG in
   * cameraGeometry.ts): cal_1 top, cal_2 bottom, cal_3 left, cal_4 right, each on the wire crossing
   * 9° beside D20/D3/D11/D6, not in the middle of the double. tapsFromModelCorners turns the four
   * found points into the equivalent D20/D3/D11/D6 taps, which become the STARTING POSITION of the
   * handles in the calibration view — the player checks the drawn rings against the real wires and
   * drags where needed, so a wrong or missing suggestion costs a few seconds, not a bad session.
   * (The first version assigned the classes to the wrong corners and ignored the 9° offset — it
   * only never showed because the model could not load at all, see onnxRuntimeFiles in
   * vite.config.ts.)
   */
  /** The whole camera picture, prepared for fitting the calibration onto the real wires of the board. */
  const wireFitCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const prepareFrameForWireFit = () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth || !v.videoHeight) return null;
    const scale = Math.min(1, WIRE_FIT_MAX_SIDE / Math.max(v.videoWidth, v.videoHeight));
    const w = Math.round(v.videoWidth * scale);
    const h = Math.round(v.videoHeight * scale);
    const canvas = wireFitCanvasRef.current ?? (wireFitCanvasRef.current = document.createElement("canvas"));
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(v, 0, 0, w, h);
    return prepareWireFit(ctx.getImageData(0, 0, w, h));
  };

  /** Moves rough taps onto the real wires of the board (see utils/boardWireFit). Null = the picture shows
   *  no board where the taps say, or the fit moved them implausibly far — keep what the player had. */
  const snapTapsToWires = (taps: { x: number; y: number }[], maxMoveShare = 0.3): { x: number; y: number }[] | null => {
    const v = videoRef.current;
    const prepared = prepareFrameForWireFit();
    if (!v || !prepared) return null;
    const fit = refineTapsToWires(prepared, taps);
    if (!fit || fit.quality < WIRE_FIT_CONFIDENT) return null;
    const radiusPx = Math.hypot((taps[3].x - taps[2].x) * v.videoWidth, (taps[3].y - taps[2].y) * v.videoHeight) / 2;
    const moved = fit.taps.some((p, i) => Math.hypot((p.x - taps[i].x) * v.videoWidth, (p.y - taps[i].y) * v.videoHeight) > maxMoveShare * radiusPx);
    return moved ? null : fit.taps;
  };

  /**
   * Keeps the calibration on the board while playing: a tripod or phone that shifts a little (a tap on the
   * screen is enough) is settled back onto the wires by itself. Only small moves are applied and only when
   * the picture shows the board clearly — if it is gone or only partly visible the fit is weak and nothing
   * changes, so the last good calibration stays.
   */
  const refineCalibrationQuietly = () => {
    const taps = calib.taps;
    const v = videoRef.current;
    if (!taps || taps.length !== 4 || !v || !v.videoWidth) return;
    if (scanLockRef.current || stillMomentBusyRef.current || stillFramesRef.current < 3 || boardMissing) return;
    // Never while darts are in the board: their flights colour the rings and pull the fit, and every dart already
    // found sits in the OLD picture's coordinates — a shifted calibration made the same dart show up again as a new one.
    if (accumulatedRef.current.length > 0 || peakPresentRef.current > 0 || needsReviewRef.current) return;
    const prepared = prepareFrameForWireFit();
    if (!prepared) return;
    const fit = refineTapsToWires(prepared, taps);
    if (!fit || fit.quality < CALIB_REFINE_MIN_QUALITY) return;
    const radiusPx = Math.hypot((taps[3].x - taps[2].x) * v.videoWidth, (taps[3].y - taps[2].y) * v.videoHeight) / 2;
    const moves = fit.taps.map((p, i) => Math.hypot((p.x - taps[i].x) * v.videoWidth, (p.y - taps[i].y) * v.videoHeight) / radiusPx);
    const biggest = Math.max(...moves);
    if (biggest > CALIB_REFINE_MAX_MOVE || biggest < CALIB_REFINE_MIN_MOVE) return;
    applyCalibrationTaps(fit.taps, calib.source ?? "manual", calib.confirmed ?? true, false);
    // The reference pictures of this round were straightened with the old calibration; take them again with the new one
    // (the board is empty, see above) so later comparisons are made in one and the same picture.
    const fresh = grabRectifiedFrame(rectifyMappingFromTaps(fit.taps));
    if (fresh) {
      lastStableModelFrameRef.current = fresh;
      emptyModelFrameRef.current = fresh;
      lastEvaluatedFrameRef.current = fresh;
      baselineDartsRef.current = null;
    }
  };
  const refineCalibrationRef = useRef(refineCalibrationQuietly);
  refineCalibrationRef.current = refineCalibrationQuietly;
  useEffect(() => {
    if (!enabled || phase !== "live") return;
    const id = window.setInterval(() => { if (!paused) refineCalibrationRef.current(); }, CALIB_REFINE_MS);
    return () => window.clearInterval(id);
  }, [enabled, phase, paused]);

  const tryAutoCalibrate = async (): Promise<{ x: number; y: number }[] | null> => {
    const v = videoRef.current;
    if (!v || !v.videoWidth || !v.videoHeight) return null;
    const landscape = v.videoWidth >= v.videoHeight;
    // The board can sit anywhere in the camera picture and at any size, while the model expects it
    // to fill about two thirds of a square. So look at several squares: first near-full-height ones
    // at three positions along the long side, then tighter ones for a board that is far away.
    const attempts = [
      ...[0.5, 0.3, 0.7].map((at) => ({ at, size: 0.98 })),
      ...[0.5, 0.3, 0.7, 0.15, 0.85].map((at) => ({ at, size: 0.7 })),
    ];
    let bestFound = 0;
    for (const { at, size } of attempts) {
      const grabbed = grabCropFrame(landscape ? at : 0.5, landscape ? 0.5 : at, size);
      if (!grabbed) continue;
      const result = await detectCalibrationPointsWithModel(grabbed.frame);
      // Always log the raw per-class detections — this is the one place a bad calibration
      // originates, and without real numbers every threshold tweak is just another guess.
      console.info("[LiveCamera] auto-calibration raw candidates", { at, size, points: result.points });
      if (result.unavailable) return null;
      const found = [result.points.cal_1, result.points.cal_2, result.points.cal_3, result.points.cal_4];
      bestFound = Math.max(bestFound, found.filter(Boolean).length);
      setAutoCalibFoundCount(bestFound);
      if (found.some((p) => !p)) continue;
      const corners = found.map((p) => cropToVideoFraction(p!.x, p!.y, v.videoWidth, v.videoHeight, grabbed.rect));
      if (corners.some((p) => !p)) continue;
      const taps = tapsFromModelCorners(corners.map((p) => ({ x: p!.x, y: p!.y })));
      if (!taps) continue;
      // The board has to be inside the picture, at a believable size — otherwise this is a false
      // detection and the handles are better off at their default position.
      const inside = taps.every((t) => t.x > -0.05 && t.x < 1.05 && t.y > -0.05 && t.y < 1.05);
      const spreadX = Math.abs(taps[3].x - taps[2].x);
      const spreadY = Math.abs(taps[1].y - taps[0].y);
      if (!inside || spreadX < 0.2 || spreadY < 0.1) continue;
      console.info("[LiveCamera] auto-calibration taps (video fractions)", taps);
      return taps;
    }
    return null;
  };

  /** Clears any existing calibration and re-runs "try the model first, else manual taps" — used
   *  both right after the camera starts (autoDetectBoard) and by the manual "Kalibrierung neu
   *  starten" button, so a bad calibration (auto- or manually-derived) can always be redone
   *  without restarting the whole camera. */
  const runLocalCalibrationFlow = async () => {
    resetLoop();
    // Wait for the model to actually finish loading (idempotent — instant if already loaded)
    // before deciding whether a suggestion is even possible.
    setPhase("detecting");
    setStatus(t("camera.modelLoadingCalib"));
    const modelOk = await preloadDartModel();
    modelReadyRef.current = modelOk;
    setModelReady(modelOk);
    setAutoCalibFoundCount(null);
    const suggestion = modelOk ? await tryAutoCalibrate() : null;
    resetLoop();
    // The model's corners are only a rough hint; the picture itself decides the exact position. Fit the
    // rings onto the real double/treble wires — first from the model's hint and the saved calibration,
    // then by searching the whole picture — and use the result without any dragging.
    setStatus(t("camera.calibSearching"));
    await new Promise((resolve) => window.setTimeout(resolve, 30));
    const prepared = prepareFrameForWireFit();
    let fitted: { x: number; y: number }[] | null = null;
    if (prepared) {
      for (const start of [suggestion, calib.taps?.length === 4 ? calib.taps : null]) {
        const fit = start ? refineTapsToWires(prepared, start) : null;
        if (fit && fit.quality >= WIRE_FIT_CONFIDENT) { fitted = fit.taps; break; }
      }
      fitted ??= findBoardTaps(prepared)?.taps ?? null;
    }
    if (fitted && applyCalibrationTaps(fitted, "auto", false)) {
      // The rings stay drawn over the picture so a wrong fit is obvious, and "Kalibrierung anpassen" is one tap away.
      setCalibDraft(null);
      setPhase("live");
      setStatus(t("camera.autoCalibratedCheck"));
      return;
    }
    openCalibrator(suggestion ?? undefined);
  };

  /** Opens the calibration view on the current calibration (or a default one) for adjusting by hand. */
  const openCalibrator = (startTaps?: { x: number; y: number }[]) => {
    const size = videoSize ?? (videoRef.current ? { w: videoRef.current.videoWidth, h: videoRef.current.videoHeight } : { w: 1, h: 1 });
    setCalibDraft(startTaps ?? (calib.taps?.length === 4 ? calib.taps : defaultCalibrationTaps(size)));
    setCalibDraftSource("manual");
    setPhase("calibrate");
    setStatus(t("camera.calibDragHint"));
  };

  /** Commits the calibration shown on screen (handles as the player left them). */
  const confirmCalibration = () => {
    if (!calibDraft) return;
    // A hand-placed handle is a few millimetres off at best — settle it onto the wires it was aimed at.
    const snapped = snapTapsToWires(calibDraft);
    if (!applyCalibrationTaps(snapped ?? calibDraft, calibDraftSource, true)) {
      setStatus(t("camera.calibInvalid"));
      return;
    }
    setCalibDraft(null);
    resetLoop();
    setPhase("live");
    setStatus(t(snapped ? "camera.calibSnapped" : "camera.calibratedReady"));
  };

  const cancelCalibration = () => {
    setCalibDraft(null);
    resetLoop();
    setPhase("live");
    setStatus(t("camera.readyThrowFirst"));
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
    setCalibDraft(null);
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

  /**
   * Identifies and scores exactly the dart that just landed — called from the watcher loop the
   * moment a throw event is detected (motion settled, board non-empty), instead of only ever
   * identifying darts as one unordered batch after all of them are pulled (see runPullScan).
   * This is what actually fixes the root cause behind the ambiguous-checkout prompt in
   * Game.tsx: with darts identified in true chronological order as they land, its resolver
   * hits the genuinely-ambiguous case far less often — that prompt stays in place as the
   * fallback for whenever this still can't confidently isolate one specific new dart.
   *
   * Model-only by design: the diff-based fallback (dartVision.ts) has no real-world track
   * record and is explicitly a safety net for when the model isn't available at all — running
   * it incrementally too would add real complexity (a rolling before/after baseline, on top of
   * the existing empty-board one) for a path that's already the less-trusted one. When the
   * model isn't loaded, this simply does nothing and the pipeline behaves exactly as before:
   * darts still get identified as a batch once the board goes empty.
   *
   * Deliberately additive-only and best-effort: if it can't confidently identify a new dart
   * this tick, it leaves `accumulated` exactly as it was and returns — there's no failure mode
   * here worse than "try again next tick, or let the end-of-visit batch scan catch it instead",
   * which is the ENTIRE existing pipeline, unchanged as a fallback (see runPullScan's own
   * "already identified everything incrementally" fast path for how the two connect).
   */
  const scoreNewlyLandedDart = async (landing: { before: ImageData | null; after: ImageData }) => {
    if (!modelReadyRef.current) return;
    const already = accumulatedRef.current;

    // Low cut-off on purpose: a weak detection is fine as long as it stands on freshly changed pixels
    // (selectNewDart checks that); a high cut-off just loses darts.
    const result = await detectDartsWithModel(landing.after, dartsRemaining + 3, NEW_DART_MIN_SCORE);
    if (result.unavailable || result.darts.length === 0) return;

    const scored = refineWithCalibration(
      result.darts.map((d) => ({ baseValue: 0, multiplier: 1 as const, points: 0, confidence: d.confidence, x: d.x, y: d.y }))
    );
    const changeMap = landing.before ? buildChangeMap(landing.before, landing.after) : null;
    const usable = changeMap && changeMap.share < GLOBAL_CHANGE_SHARE_MAX ? changeMap : null;
    // A weak earlier dart that this picture no longer shows was a phantom (hand, shadow, exposure jump):
    // dropping it frees its slot instead of leaving the round one real dart short.
    const kept = keepSupportedDarts(already, scored);
    // Several darts can land between two looks (quick throws), so take every new one, not just the best.
    const newDarts = selectNewDarts(kept, scored, usable ? (x, y) => changedShareNear(usable, x, y) : null, dartsRemaining - kept.length);
    if (newDarts.length === 0 && kept.length === already.length) return; // nothing new — the end-of-visit pass gets another look

    // A discarded/committed round replaces the array underneath us — then this result is stale.
    if (accumulatedRef.current !== already) return;
    const next = [...kept, ...newDarts];
    accumulatedRef.current = next;
    setAccumulated(next);
    if (newDarts.length === 0) return;
    setLastDetectionSource("model");
    playDartDetectedSound(kept.length);
    setJustAddedIndex(kept.length);
    window.setTimeout(() => setJustAddedIndex((cur) => (cur === kept.length ? null : cur)), 900);
  };

  /**
   * The last word on a finished visit: one more look at the picture with all darts still in the board,
   * compared with the empty board. It (1) drops weak darts it cannot see (phantoms), and (2) adds the
   * darts the throw-by-throw detection missed — quick throws merged into one landing, a dart in a tight
   * group, one the model scored low at first. Only candidates standing on pixels that differ from the
   * empty board count, so nothing that was always there can turn into a dart.
   */
  const reconcileWithFinalFrame = async () => {
    // let the throw-by-throw queue finish first, so this works on the up-to-date list
    for (let waited = 0; perThrowLockRef.current && waited < 60; waited++) await new Promise((r) => window.setTimeout(r, 100));
    const frame = preRemovalModelFrameRef.current;
    if (!frame || !modelReadyRef.current) return;
    const result = await detectDartsWithModel(frame, dartsRemaining + 3, FINAL_PASS_MIN_SCORE);
    if (result.unavailable) return;
    const found = refineWithCalibration(
      result.darts.map((d) => ({ baseValue: 0, multiplier: 1 as const, points: 0, confidence: d.confidence, x: d.x, y: d.y }))
    ).filter((d) => !dismissedRef.current.some((g) => Math.hypot(g.x - (d.x ?? 0), g.y - (d.y ?? 0)) < DISMISSED_DART_RADIUS));
    const before = accumulatedRef.current;
    const kept = keepSupportedDarts(before, found);
    const baseline = emptyModelFrameRef.current;
    const map = baseline ? buildChangeMap(baseline, frame) : null;
    const usable = map && map.share < GLOBAL_CHANGE_SHARE_MAX ? map : null;
    // Without a usable comparison picture only confident detections may add anything.
    const eligible = usable ? found : found.filter((d) => d.confidence >= 0.4);
    const added = selectNewDarts(kept, eligible, usable ? (x, y) => changedShareNear(usable, x, y) : null, dartsRemaining - kept.length);
    if (added.length === 0 && kept.length === before.length) return;
    if (accumulatedRef.current !== before) return;
    const next = [...kept, ...added];
    accumulatedRef.current = next;
    setAccumulated(next);
    // the visit's dart count is whatever the picture shows — a phantom landing must not inflate it
    if (next.length > 0) {
      throwsSeenRef.current = next.length;
      setThrowsSeen(next.length);
    }
  };

  /** Works through the queued landings one after the other (see landingQueueRef). */
  const drainLandingQueue = async () => {
    if (perThrowLockRef.current) return;
    perThrowLockRef.current = true;
    try {
      while (landingQueueRef.current.length > 0) {
        const next = landingQueueRef.current.shift()!;
        await scoreNewlyLandedDart(next);
      }
    } finally {
      perThrowLockRef.current = false;
    }
  };

  /**
   * What the picture shows every time the board comes to rest after a movement — the heart of the
   * hands-free flow. The model looks at the board and answers "which darts are in it right now?":
   *  - none (that were not already there before the round)  -> the board is empty: darts were pulled,
   *    so a finished round goes to review/commit;
   *  - some -> every dart not yet known is added (several at once if throws came quickly), each judged
   *    on its own, earlier darts stay known even when a later one hides them from this angle.
   * The old signature rule (whole-picture brightness vs the empty board) could not tell one thin dart
   * from an empty board — it counted a lone dart as "empty" and ended rounds while darts still stuck.
   */
  const handleStillMoment = async (sig: number[], signatureSaysEmpty: boolean) => {
    stillMomentBusyRef.current = true;
    try {
      if (!modelReadyRef.current) {
        setModelProblem(modelDiagnostics.loadError ?? "lädt noch");
        return legacyStillMoment(sig, signatureSaysEmpty);
      }
      const frame = grabModelFrame();
      if (!frame) {
        setModelProblem("Kamerabild nicht lesbar");
        return legacyStillMoment(sig, signatureSaysEmpty);
      }

      // A rest with the picture unchanged since the last look (a flicker, a nudge) needs no detection — on a phone
      // every detection costs seconds of a frozen screen.
      const lastLook = lastEvaluatedFrameRef.current;
      if (lastLook) {
        const sinceLastLook = buildChangeMap(lastLook, frame);
        if (sinceLastLook && sinceLastLook.share < UNCHANGED_FRAME_SHARE) {
          const seenNow = Math.min(3, accumulatedRef.current.length);
          setStatus(
            seenNow === 0
              ? t("camera.readyThrowFirst")
              : seenNow >= dartsRemaining
                ? `${seenNow} ${t("camera.dartsOnBoardPullNow")}`
                : `${seenNow}/${dartsRemaining} ${t("camera.onBoardNextOrPull")}`,
          );
          return;
        }
      }

      // darts that were already stuck in the board when this round's baseline was taken are not new
      if (baselineDartsRef.current === null) {
        const baselineFrame = emptyModelFrameRef.current;
        const base = baselineFrame ? await detectDartsWithModel(baselineFrame, 8, NEW_DART_MIN_SCORE) : null;
        baselineDartsRef.current = base && !base.unavailable ? base.darts.map((d) => ({ x: d.x, y: d.y, confidence: d.confidence })) : [];
      }
      const result = await detectDartsWithModel(frame, 8, NEW_DART_MIN_SCORE);
      if (result.unavailable) {
        setModelProblem(modelDiagnostics.inferenceError ?? "Auswertung fehlgeschlagen");
        return legacyStillMoment(sig, signatureSaysEmpty);
      }
      setModelProblem(null);
      lastEvaluatedFrameRef.current = frame;
      const baselineDarts = baselineDartsRef.current;
      const present = refineWithCalibration(
        result.darts.map((d) => ({ baseValue: 0, multiplier: 1 as const, points: 0, confidence: d.confidence, x: d.x, y: d.y }))
      )
        .filter((d) => !baselineDarts.some((b) => Math.hypot(b.x - (d.x ?? 0), b.y - (d.y ?? 0)) < KNOWN_DART_RADIUS_FOR_BASELINE && d.confidence < b.confidence + BASELINE_BEATEN_BY))
        .filter((d) => !dismissedRef.current.some((g) => Math.hypot(g.x - (d.x ?? 0), g.y - (d.y ?? 0)) < DISMISSED_DART_RADIUS));

      const before = lastStableModelFrameRef.current;
      const known = accumulatedRef.current;
      const changeMap = before ? buildChangeMap(before, frame) : null;
      const usable = changeMap && changeMap.share < GLOBAL_CHANGE_SHARE_MAX ? changeMap : null;
      // Changed pixels gate weak detections; a confident one needs no confirmation (a dart that an earlier
      // picture already contained, but the model only recognised now, must not be lost).
      const support = usable
        ? (x: number, y: number) => {
            const hit = present.find((d) => d.x === x && d.y === y);
            return hit && hit.confidence >= CONFIDENT_DART_SCORE ? 1 : changedShareNear(usable, x, y);
          }
        : null;
      const added = selectNewDarts(known, present, support, dartsRemaining - known.length);
      if (accumulatedRef.current !== known) return; // the round was committed/discarded meanwhile

      // Occupied = a confident detection OR a weaker one that stands on fresh change (it just joined the round).
      // Weak detections alone never keep a round from ending, but they must not make a real dart invisible either.
      if (!present.some((d) => d.confidence >= BOARD_OCCUPIED_SCORE) && added.length === 0) {
        onBoardEmptyMoment(sig);
        return;
      }

      // darts are on the board: remember this picture as the round's peak (the one the review and the
      // final look use) — but not while the player is pulling darts one by one (the count only drops)
      if (present.length >= peakPresentRef.current) {
        peakPresentRef.current = present.length;
        preRemovalImageDataRef.current = grabImageData();
        preRemovalModelFrameRef.current = frame;
        preRemovalFrameKindRef.current = rectMapping() ? "rectified" : "crop";
      }
      lastStableModelFrameRef.current = frame;

      if (added.length > 0) {
        const next = [...known, ...added];
        accumulatedRef.current = next;
        setAccumulated(next);
        setLastDetectionSource("model");
        playDartDetectedSound(known.length);
        setJustAddedIndex(known.length);
        window.setTimeout(() => setJustAddedIndex((cur) => (cur === known.length ? null : cur)), 900);
      }
      const seen = Math.min(3, accumulatedRef.current.length);
      throwsSeenRef.current = seen;
      setThrowsSeen(seen);
      setStatus(
        seen >= dartsRemaining
          ? `${seen} ${t("camera.dartsOnBoardPullNow")}`
          : `${seen}/${dartsRemaining} ${t("camera.onBoardNextOrPull")}`,
      );
    } finally {
      stillMomentBusyRef.current = false;
      if (stillMomentQueuedRef.current) {
        stillMomentQueuedRef.current = false;
        const latest = prevSigRef.current;
        if (latest) void stillMomentRef.current(latest, false);
      }
    }
  };

  /** The model sees no (new) dart: either nothing was thrown yet, or the darts were just pulled. */
  const onBoardEmptyMoment = (sig: number[]) => {
    const endedClipSeq = restartClipSegment();
    const finishedRound = accumulatedRef.current.length > 0 && !!preRemovalImageDataRef.current && !needsReviewRef.current;
    if (finishedRound && performance.now() - lastScanAtRef.current > SCAN_COOLDOWN_MS) {
      scanLockRef.current = true;
      pinnedClipSeqRef.current = endedClipSeq;
      void runPullScan();
      return;
    }
    // idle: refresh the empty-board baseline (lighting drifts over a session)
    emptyBoardSigRef.current = sig;
    emptyImageDataRef.current = grabImageData();
    lastStableModelFrameRef.current = grabModelFrame();
    emptyModelFrameRef.current = lastStableModelFrameRef.current;
    peakPresentRef.current = 0;
    setStatus(t("camera.boardEmptyThrowFirst"));
  };

  /** Signature-based rule from before the model existed — only used while the model is unavailable. */
  const legacyStillMoment = (sig: number[], boardEmpty: boolean) => {
    if (boardEmpty) {
      // The board just went empty — whether that's "a visit just finished and got pulled"
      // (about to trigger runPullScan below) or "still idle, nothing thrown yet", either way
      // a new visit starts from here. Cut the clip segment here so its footage lines up with
      // real throws instead of an arbitrary timer (see restartClipSegment/CLIP_SEGMENT_MS).
      const endedClipSeq = restartClipSegment();
      const hasPreRemovalCapture = !!preRemovalImageDataRef.current;
      // A still-unreviewed round (accumulated darts awaiting Übernehmen/Verwerfen) must not
      // be silently overwritten by a new scan — if the player throws/pulls a second round
      // before acting on the first, this used to replace the pending darts with no trace of
      // the first round ever having been detected. Checking needsReview specifically (not
      // accumulated.length) is what makes this still correct now that accumulated legitimately
      // fills up incrementally WHILE a visit is still in progress, before it's actually done —
      // that in-progress state must still let this fire, only an already-finished, still-
      // pending-review round should block it.
      if (throwsSeenRef.current > 0 && hasPreRemovalCapture && !needsReviewRef.current) {
        if (performance.now() - lastScanAtRef.current > SCAN_COOLDOWN_MS) {
          scanLockRef.current = true;
          // Pin the clip to THIS visit now, at detection time — not whenever the player
          // eventually taps Übernehmen. Same needsReview guard as above keeps this from
          // being reassigned to a later, unrelated visit while this one still sits
          // awaiting review (see getRecentClip's doc comment for the bug this fixes).
          pinnedClipSeqRef.current = endedClipSeq;
          void runPullScan();
          return;
        }
      }
      emptyBoardSigRef.current = sig;
      // Refresh the local baseline too — lighting can drift over a session, and this is
      // the moment we're most sure the board is genuinely empty.
      emptyImageDataRef.current = grabImageData();
      lastStableModelFrameRef.current = modelReadyRef.current || rectMapping() ? grabModelFrame() : null;
      emptyModelFrameRef.current = lastStableModelFrameRef.current;
      setStatus(t("camera.boardEmptyThrowFirst"));
    } else {
      preRemovalImageDataRef.current = grabImageData();
      const stableBefore = lastStableModelFrameRef.current;
      captureModelFrame();
      const stableAfter = preRemovalModelFrameRef.current;
      lastStableModelFrameRef.current = stableAfter;
      throwsSeenRef.current = Math.min(3, throwsSeenRef.current + 1);
      setThrowsSeen(throwsSeenRef.current);
      setStatus(
        throwsSeenRef.current >= dartsRemaining
          ? `${throwsSeenRef.current} ${t("camera.dartsOnBoardPullNow")}`
          : `${throwsSeenRef.current}/${dartsRemaining} ${t("camera.onBoardNextOrPull")}`,
      );
      // Try to identify THIS dart right now, in true throw order — see
      // scoreNewlyLandedDart's doc comment. Best-effort: if it can't, the status text above
      // still holds and the existing end-of-visit batch scan picks up the slack later.
      if (stableAfter && modelReadyRef.current) {
        landingQueueRef.current.push({ before: stableBefore, after: stableAfter });
        void drainLandingQueue();
      }
    }
  };
  const stillMomentRef = useRef(handleStillMoment);
  stillMomentRef.current = handleStillMoment;

  // ─── watcher loop ──────────────────────────────────────────────────
  useEffect(() => {
    if (!enabled) return;
    if (phase !== "live") return;

    const id = window.setInterval(() => {
      if (paused) return; // camera stream stays live — see the `paused` prop's doc comment
      const sig = buildSignature();
      if (!sig) return;

      const m = sigDiff(prevSigRef.current, sig);
      prevSigRef.current = sig;
      setMotion(m);

      // Every camera has its own noise floor (sensor noise, auto exposure, compression). A fixed "still" threshold
      // that is below it means the picture never counts as still and nothing is ever evaluated, so the threshold
      // follows the typical quiet-time motion (capped, so a real movement still never counts as still).
      if (m < MOTION_NOISE_SAMPLE_MAX) noiseFloorRef.current = noiseFloorRef.current * 0.9 + m * 0.1;
      const stillBelow = Math.min(MOTION_STILL_MAX, Math.max(MOTION_STILL, noiseFloorRef.current * 2.5 + 0.004));
      stillThresholdRef.current = stillBelow;
      const still = m < stillBelow;
      stillFramesRef.current = still ? stillFramesRef.current + 1 : 0;

      // First frame ever → just snapshot the reference and wait
      if (!stableSigRef.current) {
        if (stillFramesRef.current >= 2) {
          stableSigRef.current = sig;
          evaluatedFineRef.current = latestFineRef.current;
          setStatus(t("camera.readyThrowAllThenPull"));
          emptyBoardSigRef.current = sig;
          emptyImageDataRef.current = grabImageData();
          lastStableModelFrameRef.current = modelReadyRef.current || rectMapping() ? grabModelFrame() : null;
          emptyModelFrameRef.current = lastStableModelFrameRef.current;
        } else {
          setStatus(t("camera.stabilizing"));
        }
        return;
      }

      const delta = sigDiff(stableSigRef.current, sig);
      const emptyDelta = sigDiff(emptyBoardSigRef.current, sig);
      const boardEmpty = emptyBoardSigRef.current !== null && emptyDelta < EMPTY_BOARD_DELTA;
      setChangeDelta(emptyBoardSigRef.current ? emptyDelta : delta);

      // Board-presence gate: if the frame looks nothing like the calibrated board for several
      // ticks running, the camera got pointed away, bumped, or picked up — stop here, before any
      // detection logic below runs, so nothing gets (mis)detected against a scene that isn't the
      // board at all. Recovery is immediate (no streak needed) the moment a plausible frame
      // reappears; only triggering needs the sustained-streak guard, so a genuinely brief motion
      // blur doesn't cause a false trip.
      const looksLikeSomethingElse = emptyBoardSigRef.current !== null && emptyDelta > BOARD_MISSING_DELTA;
      boardMissingStreakRef.current = looksLikeSomethingElse ? boardMissingStreakRef.current + 1 : 0;
      const nowMissing = boardMissingStreakRef.current >= BOARD_MISSING_STREAK;
      if (nowMissing !== boardMissing) {
        setBoardMissing(nowMissing);
        if (nowMissing) {
          setStatus(t("camera.noBoardDetected"));
        } else {
          // Re-anchor "stable" to this frame so the large jump back to a real board image isn't
          // itself immediately read as a change-event the instant detection resumes.
          stableSigRef.current = sig;
          changeSeenRef.current = false;
          setStatus(t("camera.boardReacquired"));
        }
      }
      if (nowMissing) return;

      if (!scanLockRef.current && delta > CHANGE_DELTA) {
        changeSeenRef.current = true;
      }
      // Something new in a quiet picture (a dart that landed with nobody reaching in) is no big movement, so the
      // coarse signature never notices it: compare the fine picture with the one at the last evaluation.
      if (!scanLockRef.current && !changeSeenRef.current && stillFramesRef.current >= 2 && latestFineRef.current && evaluatedFineRef.current) {
        const a = latestFineRef.current;
        const b = evaluatedFineRef.current;
        let changedCells = 0;
        if (a.length === b.length) for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > FINE_CELL_DELTA) changedCells++;
        if (changedCells >= FINE_CHANGE_MIN_CELLS) changeSeenRef.current = true;
      }

      if (
        !scanLockRef.current &&
        changeSeenRef.current &&
        stillFramesRef.current >= STILL_AFTER_CHANGE
      ) {
        changeSeenRef.current = false;
        stableSigRef.current = sig;
        evaluatedFineRef.current = latestFineRef.current;
        // Read through a ref so the handler always sees the current calibration, even though this
        // interval closure was created many renders ago.
        // A phone needs seconds per detection; the next dart often lands meanwhile. That moment must not be lost,
        // so it is remembered and handled right after the running one.
        if (stillMomentBusyRef.current) stillMomentQueuedRef.current = true;
        else void stillMomentRef.current(sig, boardEmpty);
        return;
      }

      if (!scanLockRef.current) {
        if (changeSeenRef.current) {
          setStatus(t("camera.motionDetectedWait"));
        } else if (throwsSeenRef.current === 0) {
          if (stillFramesRef.current >= 4 && boardEmpty) emptyBoardSigRef.current = sig;
          setStatus(t("camera.readyThrowFirst"));
        }
      }
    }, TICK_MS);

    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, phase, dartsRemaining, paused, boardMissing]);

  // ─── scan: analyze the pre-removal frame after darts are pulled ─────
  /** Keeps the picture of the visit that just ended (darts still stuck in) for the review. */
  const freezeReviewFrame = () => showReviewPicture(preRemovalModelFrameRef.current ?? preRemovalImageDataRef.current);

  /** Shows `frame` (the board with the darts in it) as the review picture — after every landing, so the
   *  player sees what was detected right away instead of only after pulling the darts. */
  const showReviewPicture = (frame: ImageData | null, selectIndex: number | null = null) => {
    if (!frame) return;
    void imageDataToBlob(frame, 0.9).then((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      setReviewFrame((prev) => {
        if (prev) URL.revokeObjectURL(prev.url);
        return { url };
      });
      setSelectedReviewIndex(selectIndex);
    });
  };

  /** Opens the frozen picture of the round with dart `index` selected: drag its tip with the loupe, or pick the
   *  neighbouring field from the chips. Works mid-round too, not only after the darts are pulled. */
  const openReviewFor = (index: number) => {
    const frame = preRemovalModelFrameRef.current ?? lastStableModelFrameRef.current ?? grabModelFrame();
    if (!frame) {
      setExpandedReviewIndex(index); // no picture to show: fall back to picking the value from a list
      return;
    }
    setReviewOpen(true);
    showReviewPicture(frame, index);
  };

  const closeReview = () => {
    setReviewOpen(false);
    setSelectedReviewIndex(null);
  };

  const runPullScan = async () => {
    freezeReviewFrame();
    await reconcileWithFinalFrame();
    // Every dart in this visit was already identified incrementally, in true chronological
    // order, as it landed (see scoreNewlyLandedDart) — nothing left to batch-detect, and
    // re-running detection now would only risk REPLACING a correctly-ordered result with a
    // fresh, unordered one. Skip straight to the same review stance the batch path below
    // reaches at its own end (this mode always reviews — see its own comment further down).
    const alreadyIdentified = accumulatedRef.current;
    if (throwsSeenRef.current > 0 && alreadyIdentified.length >= throwsSeenRef.current) {
      setPhase("scanning");
      lastScanAtRef.current = performance.now();
      setError(null);
      setScanFailed(false);
      setGeminiSuggestion(null);
      playScanStartSound();
      if (trainingDataEnabled && emptyImageDataRef.current && preRemovalImageDataRef.current) {
        pendingTrainingCaptureRef.current = { before: emptyImageDataRef.current, after: preRemovalImageDataRef.current, modelAfter: preRemovalModelFrameRef.current, frame: preRemovalFrameKindRef.current };
      }
      const overallConfidence = alreadyIdentified.reduce((s, d) => s + d.confidence, 0) / alreadyIdentified.length;
      setLastConfidence(overallConfidence);
      setLastDetectionSource("model");
      setNeedsReview(true);
      setStatus(`${t("camera.pleaseCheck")} ${alreadyIdentified.map(dartLabel).join(", ")}`);
      setPhase("live");
      scanLockRef.current = false;
      // Fire-and-forget — see checkGeminiSecondOpinion's own doc comment for why this never
      // delays anything already on screen. The ImageData reference is read as the argument
      // RIGHT NOW (synchronous, before the ref is cleared on the next line) — the async call
      // itself only resolves later, well after this function has already returned.
      void checkGeminiSecondOpinion(preRemovalImageDataRef.current);
      preRemovalImageDataRef.current = null;
      preRemovalModelFrameRef.current = null;
      return;
    }

    if (!preRemovalImageDataRef.current || !emptyImageDataRef.current) {
      scanLockRef.current = false;
      return;
    }
    setPhase("scanning");
    lastScanAtRef.current = performance.now();
    setError(null);
    setScanFailed(false);
    setGeminiSuggestion(null);
    playScanStartSound();
    setStatus(t("camera.detectingDarts"));

    try {
      let candidateDarts: DetectedDart[];
      let overallConfidence: number;

      const runDiffFallback = () => {
        const result = detectDartTipsLocally(emptyImageDataRef.current!, preRemovalImageDataRef.current!, throwsSeenRef.current);
        const darts = refineWithCalibration(
          result.darts.map((d) => ({ baseValue: 0, multiplier: 1 as const, points: 0, confidence: d.confidence, ...cropPointToFrameXY(d.x, d.y) }))
        );
        let confidence = result.darts.length > 0
          ? result.darts.reduce((s, d) => s + d.confidence, 0) / result.darts.length
          : 0;
        // Blob count didn't match what we visually saw land (overlap, or noise got filtered
        // out) — force manual review instead of trusting a guess the pipeline itself is unsure of.
        if (result.uncertain) confidence = Math.min(confidence, AUTO_COMMIT_CONFIDENCE - 0.05);
        return { darts, confidence };
      };

      if (trainingDataEnabled) {
        // Stash the reference (not a copy) before the finally block below nulls these refs —
        // consumed at commit time with whatever the player ends up confirming/correcting.
        pendingTrainingCaptureRef.current = { before: emptyImageDataRef.current!, after: preRemovalImageDataRef.current!, modelAfter: preRemovalModelFrameRef.current, frame: preRemovalFrameKindRef.current };
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
      setLastConfidence(overallConfidence);

      if (candidateDarts.length === 0) {
        // Diagnostic only — helps tell "genuinely nothing found" apart from
        // "found darts but they got filtered out" when this happens in the field.
        console.warn("[LiveCamera] scan found 0 darts, trying Gemini cloud fallback");
        setStatus(t("camera.tryingCloudFallback"));
        const geminiDarts = await tryGeminiFallback(preRemovalImageDataRef.current);
        if (geminiDarts && geminiDarts.length > 0) {
          setLastDetectionSource("gemini");
          setLastConfidence(geminiDarts.reduce((s, d) => s + d.confidence, 0) / geminiDarts.length);
          setAccumulated(geminiDarts);
          geminiDarts.forEach((_, i) => setTimeout(() => playDartDetectedSound(i), 90 * i));
          // Same stance as every other detection source here — never auto-commit, always make
          // the player confirm/correct first (doubly true for a source with zero real-world
          // track record yet).
          setNeedsReview(true);
          setStatus(`${t("camera.pleaseCheck")} ${geminiDarts.map(dartLabel).join(", ")}`);
        } else {
          console.warn("[LiveCamera] scan found 0 darts, Gemini fallback also found nothing");
          setStatus(t("camera.noDartsDetectedManual"));
          setScanFailed(true);
        }
      } else {
        setAccumulated(candidateDarts);
        candidateDarts.forEach((_, i) => setTimeout(() => playDartDetectedSound(i), 90 * i));
        // No real-world track record yet — never auto-commit on the detector's say-so alone,
        // always make the player confirm/correct first. Prevents a bad reading from silently
        // scoring the wrong player and advancing the turn.
        setNeedsReview(true);
        setStatus(`${t("camera.pleaseCheck")} ${candidateDarts.map(dartLabel).join(", ")}`);
        // Background cross-check — see checkGeminiSecondOpinion's own doc comment. Fires
        // alongside the result just shown above, never awaited, so this round's review starts
        // exactly as fast as it always has.
        void checkGeminiSecondOpinion(preRemovalImageDataRef.current);
      }
      setPhase("live");
    } catch (err: unknown) {
      console.error("scan error", err);
      setError(err instanceof Error ? err.message : t("camera.detectionFailed"));
      setPhase("live");
      setStatus(t("camera.scanFailed"));
      setScanFailed(true);
    } finally {
      scanLockRef.current = false;
      preRemovalImageDataRef.current = null;
      preRemovalModelFrameRef.current = null;
    }
  };

  const commitRound = (darts: DetectedDart[]) => {
    setReviewOpen(false);
    if (pendingTrainingCaptureRef.current) {
      void uploadTrainingSample(pendingTrainingCaptureRef.current, darts);
    }
    onRoundCommit(darts.slice(0, dartsRemaining));
    playRoundCommittedSound();
    setAccumulated([]);
    accumulatedRef.current = [];
    setExpandedReviewIndex(null);
    setError(null);
    setScanFailed(false);
    setNeedsReview(false);
    setGeminiSuggestion(null);
    const sig = buildSignature();
    if (sig) emptyBoardSigRef.current = sig;
    resetLoop();
    setPhase("live");
    setStatus(t("camera.roundCommittedReady"));
  };

  const discardRound = () => {
    setReviewOpen(false);
    setScanFailed(false);
    setNeedsReview(false);
    setAccumulated([]);
    accumulatedRef.current = [];
    setExpandedReviewIndex(null);
    setError(null);
    setGeminiSuggestion(null);
    const sig = buildSignature();
    if (sig) emptyBoardSigRef.current = sig;
    resetLoop();
    setStatus(t("camera.roundDiscardedReady"));
  };

  const manualScan = () => {
    // Was gated on accumulated being empty — no longer a meaningful signal now that it fills up
    // incrementally mid-visit (see scoreNewlyLandedDart); needsReview (an already-finished round
    // sitting there awaiting Übernehmen/Verwerfen) is the actual thing this must not disturb.
    if (!scanLockRef.current && !needsReviewRef.current) {
      preRemovalImageDataRef.current = grabImageData();
      captureModelFrame();
      throwsSeenRef.current = Math.max(throwsSeenRef.current, dartsRemaining);
      scanLockRef.current = true;
      // Root cause of "highlight clips stopped appearing": this manual "Jetzt scannen" button is
      // the OTHER way a visit ends (the automatic board-empty branch in the watcher loop above is
      // the other), but until this line it never called restartClipSegment()/pinned a seq at all —
      // so getRecentClip() kept comparing against whatever (stale, or null) seq was pinned by the
      // PREVIOUS visit and always came back empty for any round confirmed via this button. Mirror
      // the auto-detected path exactly: cut the clip segment right here, at end-of-visit, and pin
      // it so the highlight this round is about to produce (see submitDetectedRound in Game.tsx)
      // actually has a clip to hand back.
      pinnedClipSeqRef.current = restartClipSegment();
      void runPullScan();
    }
  };

  /** A dart the camera cannot see (hidden behind another one in a tight group): added with the same score as
   *  the previous dart — it nearly always sits in the same spot — and opened for adjusting. */
  const addHiddenDart = () => {
    const current = accumulatedRef.current;
    if (current.length >= dartsRemaining || current.length === 0) return;
    const last = current[current.length - 1];
    const next = [...current, { ...last, confidence: 1 }];
    accumulatedRef.current = next;
    setAccumulated(next);
    openReviewFor(next.length - 1);
  };

  /** A dart that missed the board: scored as a miss, so the visit still counts all the darts thrown. */
  const addMissDart = () => {
    const current = accumulatedRef.current;
    if (current.length >= dartsRemaining) return;
    const next = [...current, { baseValue: 0, multiplier: 1 as const, points: 0, confidence: 1 }];
    accumulatedRef.current = next;
    setAccumulated(next);
  };

  /** A visit in which every dart missed the board: the camera has nothing to see, so the player says so. */
  const commitMissRound = () => {
    pendingTrainingCaptureRef.current = null; // no board picture worth learning from
    commitRound(Array.from({ length: dartsRemaining }, () => ({ baseValue: 0, multiplier: 1 as const, points: 0, confidence: 1 })));
  };

  const removeDart = (i: number) => {
    // Remember where the removed dart was seen: the model will keep seeing it (or its shaft) there, and a dart the
    // player has just thrown out must not come back with the next detection.
    const gone = accumulatedRef.current[i];
    if (gone && typeof gone.x === "number" && typeof gone.y === "number") dismissedRef.current.push({ x: gone.x, y: gone.y });
    const next = accumulatedRef.current.filter((_, k) => k !== i);
    accumulatedRef.current = next;
    setAccumulated(next);
    setExpandedReviewIndex(null);
    setSelectedReviewIndex(null);
  };

  const adjustDart = (
    i: number,
    field: "baseValue" | "multiplier",
    value: number,
  ) => {
    setAccumulated((prev) => {
      const next = [...prev];
      const d = { ...next[i], [field]: value };
      // Bull has no triple ring — if a stale "T" selection from before baseValue was changed to
      // 25 (or vice versa) slips through, fall back to single rather than silently scoring 0.
      if (d.baseValue === 25 && d.multiplier === 3) d.multiplier = 1;
      d.points = pointsFor(d.baseValue, d.multiplier);
      next[i] = d;
      return next;
    });
  };

  /** Takes over the background Gemini cross-check's reading into the same editable review list
   *  everything else here goes through — the player still taps the normal Übernehmen button
   *  afterward, and can still adjust/reposition individual darts first exactly as with any other
   *  source. Not a commit on its own. */
  const applyGeminiSuggestion = () => {
    if (!geminiSuggestion) return;
    setAccumulated(geminiSuggestion);
    setLastDetectionSource("gemini");
    setLastConfidence(geminiSuggestion.reduce((s, d) => s + d.confidence, 0) / geminiSuggestion.length);
    setGeminiSuggestion(null);
  };

  /**
   * Tap-to-place correction for a mis-detected dart's TIP POSITION (not just its scored value —
   * see adjustDart, which only ever fixed the label). Every tap just moves a DRAFT marker —
   * nothing commits until confirmReposition, so a mis-tap is fixed by tapping again right there,
   * not by leaving the mode and scrolling back down to the review list to re-arm it.
   */
  const handleRepositionTap = (e: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>) => {
    if (repositioningIndex === null) return;
    // A tap on the image IS the correction: it commits right away (see commitRepositionAt) and the
    // marker shows the re-scored value immediately, so a wrong tap is fixed by tapping the marker
    // and the image again — no separate confirm step to scroll to.
    const target = e.currentTarget as HTMLDivElement;
    const rect = target.getBoundingClientRect();
    const point = "touches" in e ? (e.touches[0] || e.changedTouches[0]) : (e as React.MouseEvent<HTMLDivElement>);
    const clientX = (point as { clientX: number }).clientX;
    const clientY = (point as { clientY: number }).clientY;
    const fx = clamp((clientX - rect.left) / rect.width, 0, 1);
    const fy = clamp((clientY - rect.top) / rect.height, 0, 1);
    commitRepositionAt(fx, fy);
  };

  /** Commits the draft position, re-scoring through the exact same calibration math live
   *  detections use — so a repositioned dart is indistinguishable from a well-detected one
   *  downstream, both for the player's score and for the training-sample upload. */
  const commitRepositionAt = (fx: number, fy: number) => {
    if (repositioningIndex === null) return;
    const idx = repositioningIndex;
    // repositionDraft is on-screen box-fraction (see handleRepositionTap) — convert to
    // native-video-frame fraction before handing it to fullFrameXYToCropXY, which (like
    // boardTransformFromTaps) expects that space. Without this the draft marker could look
    // right on screen right up until confirming, then score against the wrong geometry —
    // the "value resets to something wrong" bug.
    const videoXY = screenFractionToVideoFraction(fx, fy);
    const cropXY = videoXY ? fullToFrameXY(videoXY.x, videoXY.y) : null;
    setRepositioningIndex(null);
    if (!cropXY) return;
    const transform = boardTransformFromTaps(calib.taps, { x: calib.x, y: calib.y });
    const full = frameXYToFull(cropXY.x, cropXY.y);
    setAccumulated((prev) => {
      const next = [...prev];
      const d = next[idx];
      if (!d) return prev;
      // confidence: 1 — a human just pointed at it, this is now ground truth, not a guess.
      let updated: DetectedDart = { ...d, x: cropXY.x, y: cropXY.y, confidence: 1 };
      if (transform && full) {
        const scored = scoreFromBoardPoint(full.fx, full.fy, transform);
        updated = {
          ...updated,
          baseValue: scored.baseValue,
          multiplier: scored.multiplier,
          points: scored.points,
          boardU: scored.u,
          boardV: scored.v,
        };
      }
      next[idx] = updated;
      return next;
    });
  };

  const cancelReposition = () => {
    setRepositioningIndex(null);
  };

  /** The player dragged/tapped the tip of dart `index` to this spot on the review frame. */
  const moveDartTo = (index: number, x: number, y: number) => {
    const transform = boardTransformFromTaps(calib.taps, { x: calib.x, y: calib.y });
    const full = frameXYToFull(x, y);
    setAccumulated((prev) => {
      const d = prev[index];
      if (!d) return prev;
      let updated: DetectedDart = { ...d, x, y, confidence: 1, snapped: false };
      if (transform && full) {
        const scored = scoreFromBoardPoint(full.fx, full.fy, transform);
        updated = { ...updated, baseValue: scored.baseValue, multiplier: scored.multiplier, points: scored.points, boardU: scored.u, boardV: scored.v };
      }
      const next = [...prev];
      next[index] = updated;
      return next;
    });
  };

  /** The player chose a different score for dart `index` from the chips: set it, and move the dart
   *  into that field (nearest sensible point) so position and score never contradict each other. */
  const applyDartChoice = (index: number, choice: ScoreChoice) => {
    const taps = effectiveTaps();
    const toCanonical = taps ? computeHomography(taps, CANON_BOARD_POINTS) : null;
    const canonToVideo = taps ? computeHomography(CANON_BOARD_POINTS, taps) : null;
    setAccumulated((prev) => {
      const d = prev[index];
      if (!d) return prev;
      const full = toFullFrameXY(d);
      const near = toCanonical && full ? applyHomography(toCanonical, { x: full.fx, y: full.fy }) : null;
      const target = canonicalPointForChoice(choice, near);
      let position: { x: number; y: number } | null = null;
      if (rectMapping()) {
        position = canonicalToRect(target.x, target.y);
      } else if (canonToVideo) {
        const video = applyHomography(canonToVideo, target);
        position = fullToFrameXY(video.x, video.y);
      }
      const next = [...prev];
      next[index] = {
        ...d,
        baseValue: choice.baseValue,
        multiplier: choice.multiplier,
        points: pointsFor(choice.baseValue, choice.multiplier),
        confidence: 1,
        snapped: true,
        ...(position ? { x: position.x, y: position.y, boardU: target.x, boardV: target.y } : {}),
      };
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

  // calib.x/y/size and calib.taps live in native-video-frame fraction space (see
  // screenFractionToVideoFraction) — convert back to on-screen box fractions for rendering, so
  // the tracking ring and debug dots land where the board actually appears on screen instead of
  // silently drifting off it whenever the video's native aspect ratio isn't square.
  const ringRect = cropScreenRect();

  const panel = (
    <div
      className={`fixed inset-0 z-[70] flex flex-col bg-background ${overlayHidden ? "invisible pointer-events-none" : ""}`}
      style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {/* UX-Audit Befund #2, Option A (Vollbild-Gate, einmalig): blocks the whole panel until
          answered once; camera preview may already be initializing underneath (a separate OS
          permission, not this consent), but nothing here is interactive and no round can be
          committed — so no training upload can fire — before this is answered. Changeable any
          time afterward via the toggle further down in this same panel (same TRAINING_DATA_KEY). */}
      {!trainingConsentAsked && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/95 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-2xl border border-border gradient-card shadow-elevation-lg p-5">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-xl border border-primary/20 bg-primary/10">
              <Camera className="h-7 w-7 text-primary" />
            </div>
            <h3 className="mb-2 text-center font-display text-base uppercase">
              {t("camera.trainingConsentTitle")}
            </h3>
            <p className="mb-4 text-center text-xs leading-relaxed text-muted-foreground">
              {t("camera.trainingDataDesc")}
            </p>
            <div className="space-y-2">
              <Button className="w-full justify-center gap-2" onClick={() => answerTrainingConsent(true)}>
                <Check className="h-4 w-4" /> {t("camera.trainingConsentAccept")}
              </Button>
              <Button variant="outline" className="w-full justify-center gap-2" onClick={() => answerTrainingConsent(false)}>
                <X className="h-4 w-4" /> {t("camera.trainingConsentDecline")}
              </Button>
            </div>
            <p className="mt-4 text-center text-[10px] text-muted-foreground">
              {t("camera.trainingConsentFootnote")}
            </p>
          </div>
        </div>
      )}

      <div className="flex shrink-0 items-center gap-2 border-b border-border/60 px-3 py-2">
        <span
          className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${
            boardMissing
              ? "bg-destructive animate-pulse"
              : phase === "live"
                ? "bg-secondary animate-pulse-glow"
                : phase === "scanning"
                  ? "bg-primary animate-pulse"
                  : phase === "error"
                    ? "bg-destructive"
                    : "bg-muted-foreground"
          }`}
        />
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-sm leading-tight text-foreground">
            {playerName ?? "Auto-Scoring"}
            {remainingScore !== undefined && <span className="ml-2 text-primary">{remainingScore}</span>}
          </p>
          <p className="truncate text-[11px] leading-tight text-muted-foreground">{status}</p>
        </div>
        <Button variant="outline" size="sm" className="h-9 gap-1 px-2.5 text-xs" onClick={() => setOverlayHidden(true)} title={t("camera.manualShort")}>
          <Keyboard className="h-4 w-4" /> <span className="hidden min-[400px]:inline">{t("camera.manualShort")}</span>
        </Button>
        <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => setSettingsOpen(true)} title={t("camera.settingsTitle")} aria-label={t("camera.settingsTitle")}>
          <Settings className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" onClick={onClose} className="h-9 w-9" title={t("game.closeCamera")} aria-label={t("game.closeCamera")}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      {scoreStrip && !isLandscape && <CameraScoreStrip {...scoreStrip} />}

      <div className="flex min-h-0 flex-1 flex-col landscape:flex-row">
        <div ref={stageRef} className="relative flex min-h-0 flex-1 flex-col items-center justify-center gap-2 overflow-y-auto p-2">
      {showReview && (
        <div ref={reviewAnchorRef}>
        <DartReviewFrame
          maxSide={stageHeight > 0 ? `${Math.max(170, stageHeight - 200)}px` : `calc(100dvh - ${isLandscape ? "7rem" : "24rem"})`}
          imageUrl={reviewFrame.url}
          darts={accumulated.map((d) => ({ x: d.x ?? 0.5, y: d.y ?? 0.5, baseValue: d.baseValue, multiplier: d.multiplier }))}
          selectedIndex={selectedReviewIndex}
          onSelect={setSelectedReviewIndex}
          onMove={moveDartTo}
          onChoose={applyDartChoice}
          labels={{
            hintPick: t("camera.reviewHintPick"),
            hintMove: t("camera.reviewHintMove"),
            miss: t("game.miss"),
            bullOuter: "25",
            bullInner: "Bull",
          }}
        />
        <div className="mt-2 flex gap-2">
          {selectedReviewIndex !== null && (
            <Button variant="outline" size="sm" className="flex-1 gap-1.5" onClick={() => setExpandedReviewIndex(selectedReviewIndex)}>
              {t("camera.pickValueInstead")}
            </Button>
          )}
          {selectedReviewIndex !== null && (
            <Button variant="outline" size="sm" className="gap-1.5 text-destructive" onClick={() => setConfirmRemoveIndex(selectedReviewIndex)}>
              <Trash2 className="h-4 w-4" /> {t("camera.removeDartTitle")}
            </Button>
          )}
          {reviewOpen && !needsReview && (
            <Button size="sm" className="flex-1 gap-1.5" onClick={closeReview}>
              <Check className="h-4 w-4" /> {t("camera.reviewDone")}
            </Button>
          )}
        </div>
        </div>
      )}


      <div
        className={`relative mx-auto shrink-0 overflow-hidden rounded-lg border border-border bg-muted ${showReview ? "hidden" : ""}`}
        style={{
          aspectRatio: videoSize ? `${videoSize.w} / ${videoSize.h}` : "1 / 1",
          width: stageHeight > 0
            ? `min(100%, ${Math.max(120, stageHeight - 16) * (videoSize ? videoSize.w / videoSize.h : 1)}px)`
            : `min(100%, calc((100dvh - ${isLandscape ? "5.5rem" : "19rem"}) * ${videoSize ? videoSize.w / videoSize.h : 1}))`,
        }}
      >
        <video
          ref={videoRef}
          playsInline
          muted
          onLoadedMetadata={syncVideoSize}
          className="h-full w-full object-cover"
        />
        <canvas ref={canvasRef} className="hidden" />

        {phase === "calibrate" && calibDraft && videoSize && (
          <BoardCalibrator
            videoRef={videoRef}
            videoSize={videoSize}
            taps={calibDraft}
            onChange={(taps) => { setCalibDraft(taps); setCalibDraftSource("manual"); }}
          />
        )}

        {(phase === "live" || phase === "scanning" || phase === "detecting") && ringRect && (
          <div className="pointer-events-none absolute inset-0">
            <div
              className={`absolute rounded-full border-2 transition-colors duration-500 ${
                phase === "scanning" ? "border-accent animate-pulse-glow" : ringColorClass
              }`}
              style={{
                width: `${ringRect.width * 100}%`,
                height: `${ringRect.height * 100}%`,
                left: `${ringRect.x * 100}%`,
                top: `${ringRect.y * 100}%`,
              }}
            >
              <div className="absolute inset-[35%] rounded-full border border-current opacity-40" />
              <div className="absolute inset-[48%] rounded-full bg-current opacity-70" />
            </div>
          </div>
        )}

        {/* Calibration-point debug overlay — where the app thinks D20/D3/D11/D6 actually are,
            right on the live feed. Toggle via "Kalibrierpunkte anzeigen" below; the only way to
            sanity-check a calibration on a phone with no devtools access. Same left/top-percent
            placement the tracking ring already uses for calib.x/y. */}
        {showCalibDebug && (calib.taps?.length ?? 0) === 4 && (phase === "live" || phase === "scanning") && (
          <div className="pointer-events-none absolute inset-0">
            {(() => {
              // The scoring rings and segment lines as the app currently understands the board — a bad
              // calibration is visible at a glance.
              const mapping = rectMapping();
              if (!mapping) return null;
              const lines = boardOverlayLines(mapping.canonToVideo);
              return (
                <svg className="absolute inset-0 h-full w-full" viewBox="0 0 1 1" preserveAspectRatio="none">
                  {lines.rings.map((ring, i) => (
                    <polyline
                      key={i}
                      points={ring.map((p) => `${p.x},${p.y}`).join(" ")}
                      fill="none"
                      stroke={i <= 1 ? "hsl(48 100% 60%)" : i <= 3 ? "hsl(150 80% 55%)" : "hsl(185 90% 58%)"}
                      strokeWidth={i === 5 ? 1.6 : 1}
                      strokeOpacity={0.85}
                      vectorEffect="non-scaling-stroke"
                    />
                  ))}
                  {lines.spokes.map(([a, b], i) => (
                    <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="rgba(255,255,255,0.35)" strokeWidth={0.8} vectorEffect="non-scaling-stroke" />
                  ))}
                </svg>
              );
            })()}
            {calib.taps!.map((t, i) => {
              const screenPos = videoFractionToScreenFraction(t.x, t.y) ?? t;
              return (
                <MapMarker key={i} fx={screenPos.x} fy={screenPos.y}>
                  <div className="h-3.5 w-3.5 rounded-full bg-yellow-400 ring-2 ring-background" />
                  <span className="absolute left-1/2 top-4 -translate-x-1/2 whitespace-nowrap rounded bg-yellow-400 px-1 py-0.5 text-[9px] font-display text-background">
                    {CALIB_KEYS[i]}
                  </span>
                </MapMarker>
              );
            })}
          </div>
        )}

        {/* Detected-dart markers — shows exactly what the AI saw, at the tip position it used. */}
        {accumulated.length > 0 && (
          <div className="pointer-events-none absolute inset-0">
            {accumulated.map((d, i) => {
              const full = toFullFrameXY(d);
              const screenPos = full ? videoFractionToScreenFraction(full.fx, full.fy) : null;
              if (!screenPos) return null;
              const selected = repositioningIndex === i;
              const tone = selected ? "bg-primary" : needsReview ? "bg-accent" : "bg-secondary";
              return (
                <MapMarker key={i} fx={screenPos.x} fy={screenPos.y} className={selected ? "z-30" : "animate-scale-in"}>
                  {/* Generous invisible hit area around the 14px dot — a fingertip on a phone can
                      not reliably hit the dot itself. Tapping selects this dart for correction. */}
                  <button
                    type="button"
                    disabled={repositioningIndex !== null && !selected}
                    onClick={() => openReviewFor(i)}
                    className="pointer-events-auto absolute left-1/2 top-1/2 h-11 w-11 -translate-x-1/2 -translate-y-1/2 rounded-full"
                    aria-label={`${t("game.dartCounterLabel")} ${i + 1} ${dartLabel(d)} — ${t("camera.correctPositionTitle")}`}
                  />
                  <div className={`h-3.5 w-3.5 rounded-full ring-2 ${selected ? "ring-primary animate-pulse-glow" : "ring-background"} ${tone}`} />
                  <span className={`pointer-events-none absolute left-1/2 top-4 -translate-x-1/2 whitespace-nowrap rounded px-1 py-0.5 text-[9px] font-display ${selected ? "text-primary-foreground" : "text-background"} ${tone}`}>
                    {i + 1} · {dartLabel(d)}
                  </span>
                </MapMarker>
              );
            })}
          </div>
        )}

        {/* Video stream stays live and visible here on purpose — only a light translucent hint,
            not an opaque cover — since this fires while the player answers the "which dart
            finished it" prompt elsewhere on the page (see the `paused` prop). Tearing the camera
            down for this used to be handled via `enabled`, which a field report tied directly to
            the camera going black and staying black afterward. */}
        {paused && phase === "live" && (
          <div className="pointer-events-none absolute inset-x-0 top-2 flex justify-center">
            <span className="rounded-full bg-background/85 px-3 py-1 text-[11px] text-foreground shadow">
              {t("camera.pausedAnswerAbove")}
            </span>
          </div>
        )}

        {(phase === "starting" || phase === "detecting") && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-background/80 px-4 text-center text-xs text-foreground">
            <Loader2 className="mb-2 h-5 w-5 animate-spin" />
            {phase === "starting" ? t("camera.starting") : status}
          </div>
        )}
        {phase === "scanning" && (
          <div className="absolute inset-x-0 top-0 flex items-center justify-center bg-background/70 py-1.5 text-xs text-foreground">
            <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> {t("camera.analyzing")}
          </div>
        )}
        {boardMissing && (phase === "live" || phase === "scanning") && (
          <div className="absolute inset-x-0 top-0 flex items-center justify-center gap-1.5 bg-destructive/90 py-1.5 text-xs font-medium text-destructive-foreground">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" /> {t("camera.noBoardDetected")}
          </div>
        )}
        {phase === "error" && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/85 px-4 text-center text-xs text-foreground">
            {error}
          </div>
        )}

        {repositioningIndex !== null && accumulated[repositioningIndex] && (
          <div
            className="absolute inset-0 z-20 cursor-crosshair select-none bg-background/30"
            onClick={handleRepositionTap}
          >
            {/* The instruction and the way out live ON the image — nothing to scroll to. */}
            <div className="absolute inset-x-0 top-2 flex items-center justify-center gap-2 px-2">
              <span className="rounded-full bg-background/90 px-3 py-1 text-[11px] font-medium text-foreground shadow">
                {t("game.dartCounterLabel")} {repositioningIndex + 1} — {t("camera.tapDartTipNow")}
              </span>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); cancelReposition(); }}
                className="rounded-full bg-background/90 p-1.5 text-foreground shadow"
                aria-label={t("common.cancel")}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </div>


        </div>
        <div className="shrink-0 space-y-2 border-t border-border bg-background/95 p-2 landscape:w-[24rem] landscape:overflow-y-auto landscape:border-l landscape:border-t-0">
      {scoreStrip && isLandscape && <CameraScoreStrip {...scoreStrip} />}
      {/* Board drifted warning, calibration fine-tune controls, and the reposition confirm bar
          all render here, below the video, instead of overlaid on it — depending on zoom/crop
          they could otherwise land right on top of the exact spot the player needs to see (the
          old calibration step pill sat at the top of the frame, exactly where D20 needs
          tapping). Keeping this docked immediately below the video (not down in the review list)
          still means no scrolling to reach it. */}
      {phase === "live" && trackingStatus === "warn" && (
        <div className="rounded-md border border-accent/40 bg-accent/10 px-2.5 py-1.5 text-center text-[11px] font-medium text-accent">
          {t("camera.boardDrifted")}
        </div>
      )}

      {phase === "calibrate" && calibDraft && (
        <div className="space-y-2 rounded-lg border border-border bg-card p-2.5 shadow-sm">
          <p className="text-center text-[11px] leading-snug text-muted-foreground">{t("camera.calibDragHint")}</p>
          {autoCalibFoundCount !== null && autoCalibFoundCount < 4 && (
            <p className="text-center text-[11px] text-muted-foreground">{t("camera.autoCalibFound").replace("{n}", String(autoCalibFoundCount))}</p>
          )}
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="flex-1" onClick={() => void runLocalCalibrationFlow()}>
              {t("camera.calibAiSuggest")}
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-9 w-9 shrink-0"
              onClick={() => { setCalibDraft(defaultCalibrationTaps(videoSize ?? { w: 1, h: 1 })); setCalibDraftSource("manual"); }}
              title={t("camera.calibReset")}
              aria-label={t("camera.calibReset")}
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </Button>
            <Button size="sm" className="flex-1 gap-1 font-display uppercase" onClick={confirmCalibration}>
              <Check className="h-4 w-4" /> {t("camera.calibDone")}
            </Button>
          </div>
          {(calib.taps?.length ?? 0) === 4 && (
            <button type="button" onClick={cancelCalibration} className="w-full text-center text-[11px] text-muted-foreground underline">
              {t("common.cancel")}
            </button>
          )}
        </div>
      )}

      {scanFailed && onRequestManualEntry && (
        <div className="flex items-center justify-between gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-[11px]">
          <span className="text-destructive">{t("camera.scanFoundNoDarts")}</span>
          <div className="flex shrink-0 gap-1.5">
            <Button size="sm" variant="outline" className="h-9 px-3 text-[11px]" onClick={() => { setScanFailed(false); manualScan(); }}>
              {t("camera.rescan")}
            </Button>
            <Button size="sm" variant="default" className="h-9 px-3 text-[11px]" onClick={onRequestManualEntry}>
              {t("camera.enterManually")}
            </Button>
          </div>
        </div>
      )}

      {needsReview && (
        <div className="flex items-center justify-between gap-2 rounded-md border border-accent/40 bg-accent/10 px-3 py-2 text-[11px] text-accent">
          <span>
            {autoCommitLeft !== null
              ? t("camera.autoCommitIn").replace("{n}", String(Math.max(0, autoCommitLeft)))
              : t("camera.notQuiteSureDetected")}
          </span>
          {autoCommitLeft !== null && (
            <Button size="sm" variant="outline" className="h-8 shrink-0 px-3 text-[11px]" onClick={() => setAutoCommitHeld(true)}>
              {t("camera.autoCommitStop")}
            </Button>
          )}
        </div>
      )}

      {/* Background Gemini cross-check (2026-09-10) — only ever appears when the cloud reading
          actually disagrees with what's already shown above (see checkGeminiSecondOpinion), and
          only ever offers, never applies on its own. Dismissing just hides it; nothing about the
          current review list changes either way. */}
      {geminiSuggestion && (
        <div className="rounded-md border border-primary/40 bg-primary/10 px-3 py-2 text-[11px] text-primary flex items-center justify-between gap-2 flex-wrap">
          <span>{t("camera.geminiSuggests")} {geminiSuggestion.map(dartLabel).join(", ")}</span>
          <div className="flex gap-1.5 shrink-0">
            <Button size="sm" variant="secondary" className="h-7 gap-1 px-2 text-[10px]" onClick={applyGeminiSuggestion}>
              <Check className="h-3 w-3" /> {t("camera.accept")}
            </Button>
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setGeminiSuggestion(null)} title={t("camera.dismiss")}>
              <X className="h-3 w-3" />
            </Button>
          </div>
        </div>
      )}

      {/* live accumulated darts */}
      <div className={`rounded-xl border p-3 bg-gradient-to-br from-primary/10 via-primary/5 to-transparent ${needsReview ? "border-accent/50" : "border-primary/30"}`}>
        <div className="flex items-stretch gap-3">
          {/* One big tile per dart — readable at arm's length; tapping one selects it on the picture
              (or opens its editor), which is also what stops the hands-free countdown. */}
          <div className="grid flex-1 grid-cols-3 gap-2">
            {Array.from({ length: dartsRemaining }).map((_, i) => {
              const d = accumulated[i];
              if (!d) {
                // Once darts were detected, an empty slot is one tap from a miss: a dart that missed the
                // board (or bounced out) leaves nothing for the camera to see.
                const canAdd = accumulated.length > 0 && i === accumulated.length;
                return canAdd ? (
                  <div key={`slot-${i}`} className="grid h-[4.5rem] grid-rows-2 gap-1">
                    <button
                      type="button"
                      onClick={addHiddenDart}
                      className="rounded-md border border-dashed border-primary/50 text-[11px] text-primary hover:bg-primary/10"
                    >
                      + {t("camera.addDart")}
                    </button>
                    <button
                      type="button"
                      onClick={addMissDart}
                      className="rounded-md border border-dashed border-border text-[11px] text-muted-foreground hover:bg-muted"
                    >
                      + {t("camera.addMiss")}
                    </button>
                  </div>
                ) : (
                  <div
                    key={`slot-${i}`}
                    className="flex h-[4.5rem] items-center justify-center rounded-lg border border-dashed border-border/60 text-[11px] text-muted-foreground"
                  >
                    {t("game.dartCounterLabel")} {i + 1}
                  </div>
                );
              }
              const miss = d.baseValue === 0;
              const selected = selectedReviewIndex === i || expandedReviewIndex === i;
              return (
                <button
                  key={`dart-${i}`}
                  type="button"
                  onClick={() => (showReview ? setSelectedReviewIndex(selectedReviewIndex === i ? null : i) : openReviewFor(i))}
                  className={`flex h-[4.5rem] flex-col items-center justify-center rounded-lg border-2 transition-colors ${
                    miss ? "border-muted bg-muted/40 text-muted-foreground" : "border-primary/60 bg-primary/15 text-primary"
                  } ${justAddedIndex === i ? "animate-scale-in ring-2 ring-accent" : ""} ${selected ? "ring-2 ring-accent" : ""}`}
                >
                  <span className="font-display text-3xl leading-none">{miss ? t("game.miss") : dartLabel(d)}</span>
                  <span className="mt-1 text-xs text-muted-foreground">{d.points}</span>
                </button>
              );
            })}
          </div>
          <div className="flex shrink-0 flex-col items-end justify-center text-right">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {t("camera.sum")}
            </div>
            <div className="font-display text-5xl leading-none text-primary">
              {roundTotal}
            </div>
          </div>
        </div>
      </div>

      {modelProblem && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{t("camera.modelProblem").replace("{reason}", modelProblem)}</span>
        </div>
      )}

      {accumulated.length === 0 && phase === "live" && !needsReview && !paused && (
        <Button variant="outline" className="h-11 w-full gap-2 text-sm" onClick={commitMissRound}>
          {t("camera.missRound")}
        </Button>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded bg-destructive/10 p-2 text-xs text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Sticky: the round's action buttons stay on screen however far the review list or the
          camera view has been scrolled — correcting happens on the image, accepting right here. */}
      <div className="flex gap-2">
        {accumulated.length > 0 && (
          <AlertDialog open={confirmDiscardOpen} onOpenChange={setConfirmDiscardOpen}>
            <AlertDialogTrigger asChild>
              <Button
                variant="outline"
                size="lg"
                className="h-12 gap-1 px-4"
                title={t("camera.discardDetectedTitle")}
              >
                <RotateCcw className="h-4 w-4" /> <span className="hidden sm:inline">{t("camera.discard")}</span>
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t("camera.discardRoundConfirmTitle")}</AlertDialogTitle>
                <AlertDialogDescription>{t("camera.discardRoundConfirmDesc")}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => {
                    discardRound();
                    setConfirmDiscardOpen(false);
                  }}
                >
                  {t("camera.discard")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
        {/* Gated on a complete round OR a confirmed end-of-visit, not just accumulated.length > 0
            — darts fill in incrementally as they're thrown (see scoreNewlyLandedDart), so
            accumulated can be legitimately non-empty while the player is still mid-visit, and
            committing early on that alone would hand a short round to Game.tsx and wrongly
            advance the turn. But a checkout (or a bust the player doesn't play out) can validly
            end a visit in 1 or 2 darts — accumulated.length never reaches dartsRemaining (3) in
            that case, and needsReview is exactly the signal that runPullScan already saw the
            board go empty and isn't expecting more. Without it, a real checkout left this button
            permanently hidden — detected correctly, nothing to tap to confirm it. */}
        {(accumulated.length >= dartsRemaining || needsReview) && (
          <Button
            size="lg"
            onClick={() => commitRound(accumulated)}
            className={`h-12 flex-1 gap-1.5 text-base font-display uppercase ${needsReview ? "animate-pulse-glow" : ""}`}
            title={t("camera.commitRoundTitle")}
          >
            <Check className="h-4 w-4" /> {t("camera.accept")}
            {autoCommitLeft !== null && <span className="tabular-nums">({Math.max(0, autoCommitLeft)})</span>}
          </Button>
        )}
      </div>


        </div>
      </div>

      {/* One dart's editor: a bottom sheet instead of a list that pushes everything down. */}
      <Drawer open={expandedReviewIndex !== null && !!accumulated[expandedReviewIndex ?? -1]} onOpenChange={(open) => { if (!open) setExpandedReviewIndex(null); }} shouldScaleBackground={false}>
        <DrawerContent className="max-h-[85dvh]">
          {expandedReviewIndex !== null && accumulated[expandedReviewIndex] && (() => {
            const i = expandedReviewIndex;
            const dart = accumulated[i];
            return (
              <div className="space-y-2 overflow-y-auto p-3 pb-5">
                <DrawerHeader className="p-0 text-left">
                  <DrawerTitle className="font-display text-base">
                    {t("camera.editDartTitle").replace("{n}", String(i + 1))} · {dart.baseValue === 0 ? t("game.miss") : dartLabel(dart)} · {dart.points}
                  </DrawerTitle>
                </DrawerHeader>
                <div className="grid grid-cols-3 gap-1.5">
                  {([[1, "S"], [2, "D"], [3, "T"]] as const).map(([m, label]) => (
                    <button
                      key={m}
                      type="button"
                      disabled={dart.baseValue === 0 || (dart.baseValue === 25 && m === 3)}
                      onClick={() => adjustDart(i, "multiplier", m)}
                      className={`rounded-lg py-3 text-base font-display font-medium transition-colors disabled:opacity-40 ${
                        dart.multiplier === m ? "bg-primary text-primary-foreground" : "bg-muted-foreground/10 text-foreground/80"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="grid grid-cols-5 gap-1.5">
                  {Array.from({ length: 20 }, (_, k) => k + 1).map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => adjustDart(i, "baseValue", v)}
                      className={`rounded-lg py-2.5 text-sm font-display transition-colors ${
                        dart.baseValue === v ? "bg-secondary text-secondary-foreground font-bold" : "bg-muted-foreground/10 text-foreground/80"
                      }`}
                    >
                      {v}
                    </button>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    onClick={() => adjustDart(i, "baseValue", 25)}
                    className={`rounded-lg py-2.5 text-sm font-medium transition-colors ${
                      dart.baseValue === 25 ? "bg-secondary text-secondary-foreground font-bold" : "bg-muted-foreground/10 text-foreground/80"
                    }`}
                  >
                    {t("camera.bullOption")}
                  </button>
                  <button
                    type="button"
                    onClick={() => adjustDart(i, "baseValue", 0)}
                    className={`rounded-lg py-2.5 text-sm font-medium transition-colors ${
                      dart.baseValue === 0 ? "bg-primary text-primary-foreground" : "bg-muted-foreground/10 text-foreground/80"
                    }`}
                  >
                    {t("game.miss")}
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-1.5 pt-1">
                  <Button
                    variant="outline"
                    className="gap-1.5"
                    onClick={() => { setExpandedReviewIndex(null); openReviewFor(i); }}
                  >
                    <Target className="h-4 w-4" /> {t("camera.correctPositionTitle")}
                  </Button>
                  <Button variant="outline" className="gap-1.5 text-destructive" onClick={() => setConfirmRemoveIndex(i)}>
                    <Trash2 className="h-4 w-4" /> {t("camera.removeDartTitle")}
                  </Button>
                </div>
              </div>
            );
          })()}
        </DrawerContent>
      </Drawer>
      <AlertDialog open={confirmRemoveIndex !== null} onOpenChange={(open) => { if (!open) setConfirmRemoveIndex(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("camera.removeDartConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("camera.removeDartConfirmDesc")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirmRemoveIndex !== null) removeDart(confirmRemoveIndex);
                setConfirmRemoveIndex(null);
                setExpandedReviewIndex(null);
                setSelectedReviewIndex(null);
              }}
            >
              {t("camera.removeDartConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Drawer open={settingsOpen} onOpenChange={setSettingsOpen} shouldScaleBackground={false}>
        <DrawerContent className="max-h-[88dvh]">
          <div className="space-y-2 overflow-y-auto p-3 pb-6">
            <DrawerHeader className="p-0 text-left">
              <DrawerTitle className="font-display text-base">{t("camera.settingsTitle")}</DrawerTitle>
            </DrawerHeader>
        {showAdvanced && (
          <div className="rounded-md border border-border bg-muted/40 px-2 py-1 text-right text-[10px] uppercase tracking-wider text-muted-foreground" title={t("camera.motionDiffTooltip")}>
            {t("camera.motionAbbrev")} {(motion * 100).toFixed(0)}% · Δ {(changeDelta * 100).toFixed(0)}%
          </div>
        )}
      {(phase === "live" || phase === "scanning") && (
        <div className="flex gap-1.5">
          <button
            onClick={() => openCalibrator()}
            className="flex-1 rounded-md border border-border px-3 py-1.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground flex items-center justify-center gap-1.5"
          >
            <Target className="h-3.5 w-3.5" /> {t("camera.calibAdjust")}
          </button>
          <button
            onClick={restartCalibration}
            className="flex-1 rounded-md border border-border px-3 py-1.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground flex items-center justify-center gap-1.5"
            title={t("camera.restartCalibTooltip")}
          >
            <Target className="h-3.5 w-3.5" /> {t("camera.restartCalibButton")}
          </button>
          <button
            onClick={() => setShowCalibDebug((v) => !v)}
            className={`shrink-0 rounded-md border px-3 py-1.5 text-[11px] flex items-center justify-center gap-1.5 ${
              showCalibDebug ? "border-accent bg-accent/15 text-accent" : "border-border text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
            title={t("camera.showCalibPointsTooltip")}
          >
            {showCalibDebug ? t("camera.hidePoints") : t("camera.showCalibPoints")}
          </button>
        </div>
      )}

      {/* Detection-model status and the training-data toggle used to sit above the video and
          pushed it ~450px down the screen on a phone — the image is what the player works with
          (tap-to-correct), so it comes first and this reference info lives below it. */}
      {/* Was a hover-only `title` before the local/cloud mode toggle sat here — kept visible
          (not touch-hidden) now that this is the only mode there is to explain. */}
      <p className="px-0.5 text-[10px] leading-snug text-muted-foreground">
        {modelReady ? t("camera.localDetectionModel") : t("camera.localDetectionLoading")}
      </p>
      <p className="px-0.5 font-mono text-[10px] leading-snug text-muted-foreground">
        KI: {modelReady ? "geladen" : "nicht geladen"} · Läufe {modelDiagnostics.runs} · zuletzt {modelDiagnostics.lastRunMs} ms · Bewegung {(motion * 100).toFixed(1)} % (ruhig unter {(stillThresholdRef.current * 100).toFixed(1)} %)
        {modelDiagnostics.loadError ? ` · Ladefehler: ${modelDiagnostics.loadError}` : ""}
        {modelDiagnostics.inferenceError ? ` · Fehler: ${modelDiagnostics.inferenceError}` : ""}
      </p>

      <div className="rounded-lg border border-border bg-muted/40 px-2.5 py-1.5">
        <button
          onClick={() => setAutoCommitEnabled(!autoCommitEnabled)}
          className="flex w-full items-center justify-between text-[11px]"
        >
          <span className="text-muted-foreground">{t("camera.autoCommitSetting")}</span>
          <span className={`shrink-0 rounded-full px-2 py-0.5 font-medium ${autoCommitEnabled ? "bg-secondary text-secondary-foreground" : "bg-muted text-muted-foreground"}`}>
            {autoCommitEnabled ? t("common.on") : t("common.off")}
          </span>
        </button>
        <p className="mt-1 text-[10px] leading-snug text-muted-foreground">{t("camera.autoCommitDesc")}</p>
      </div>

      <div className="rounded-lg border border-border bg-muted/40 px-2.5 py-1.5">
        <button
          onClick={() => setTrainingDataEnabled(!trainingDataEnabled)}
          className="flex w-full items-center justify-between text-[11px]"
        >
          <span className="text-muted-foreground">{t("camera.collectTrainingData")}</span>
          <span className={`shrink-0 rounded-full px-2 py-0.5 font-medium ${trainingDataEnabled ? "bg-secondary text-secondary-foreground" : "bg-muted text-muted-foreground"}`}>
            {trainingDataEnabled ? t("common.on") : t("common.off")}
          </span>
        </button>
        {/* Same reasoning as above — this is the privacy-relevant one (uploads a real board
            photo) and defaults on, so its explanation can't be hover-only. */}
        <p className="mt-1 text-[10px] leading-snug text-muted-foreground">
          {t("camera.trainingDataDesc")}
        </p>
      </div>

      <button
        onClick={() => setShowAdvanced((v) => !v)}
        className="flex w-full items-center justify-between rounded border border-border px-3 py-1.5 text-[11px] text-muted-foreground hover:bg-muted"
      >
        <span>{t("camera.adjustCropManually")}</span>
        {showAdvanced ? (
          <ChevronUp className="h-3.5 w-3.5" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5" />
        )}
      </button>
      {showAdvanced && (
        <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-2 text-xs">
          <div className="space-y-1">
            <div className="text-[10px] text-muted-foreground">{t("camera.deviceCalibratedFor")}</div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8 shrink-0"
                onClick={() => switchBoard(String(Math.max(1, Number(activeBoard) - 1)))}
                disabled={activeBoard === "1"}
                title={t("camera.previousBoard")}
              >
                −
              </Button>
              <span className="flex-1 text-center font-display text-sm text-foreground">{t("camera.board")} {activeBoard}</span>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8 shrink-0"
                onClick={() => switchBoard(String(Number(activeBoard) + 1))}
                title={t("camera.nextBoard")}
              >
                +
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground">
              {t("camera.multiboardExplain")}
            </p>
          </div>
          {devices.length > 1 && (
            <div className="space-y-1">
              <div className="text-[10px] text-muted-foreground">{t("camera.cameraForBoard")} {activeBoard}</div>
              <select
                value={selectedDeviceId ?? ""}
                onChange={(e) => switchCamera(e.target.value || null)}
                className="w-full rounded border border-border bg-background px-2 py-1.5 text-xs"
              >
                <option value="">{t("camera.auto")}</option>
                {devices.map((d, i) => (
                  <option key={d.deviceId} value={d.deviceId}>{d.label || `${t("camera.cameraLabel")} ${i + 1}`}</option>
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
            <RotateCcw className={`h-4 w-4 ${phase === "detecting" ? "animate-spin" : ""}`} /> {phase === "detecting" ? t("camera.detectingBoard") : t("camera.reAutoDetectBoard")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={restartCalibration}
            disabled={phase === "detecting"}
            className="w-full gap-1"
            title={`${t("camera.restartCalibTooltip")} ${t("camera.restartCalibTooltipSuffix")}`}
          >
            <Target className={`h-4 w-4 ${phase === "detecting" ? "animate-spin" : ""}`} /> {t("camera.restartCalibButton")}
          </Button>
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[10px] text-muted-foreground">
              <span>{t("camera.horizontal")}</span>
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
              <span>{t("camera.vertical")}</span>
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
              <span>{t("camera.size")}</span>
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
              <span>{t("camera.zoom")}</span>
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
        </DrawerContent>
      </Drawer>

      {overlayHidden && (
        <button
          type="button"
          onClick={() => setOverlayHidden(false)}
          className={`fixed bottom-20 right-3 z-[70] flex items-center gap-2 rounded-full border border-primary/50 bg-card px-4 py-2.5 text-sm font-display text-primary shadow-elevation-lg ${needsReview ? "animate-pulse-glow" : ""}`}
          style={{ visibility: "visible", pointerEvents: "auto" }}
        >
          <Camera className="h-4 w-4" /> {accumulated.length}/{dartsRemaining} · {roundTotal}
        </button>
      )}
    </div>
  );
  return createPortal(panel, document.body);
});

LiveCamera.displayName = "LiveCamera";

export default LiveCamera;