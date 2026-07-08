import { useEffect, useRef, useState, useCallback } from "react";
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
  x?: number;
  y?: number;
}

interface LiveCameraProps {
  onRoundCommit: (darts: DetectedDart[]) => void;
  onPendingChange?: (darts: DetectedDart[]) => void;
  onClipReady?: (blob: Blob, darts: DetectedDart[]) => void;
  enabled: boolean;
  onClose: () => void;
  dartsRemaining?: number;
  playerName?: string;
}

type Phase = "starting" | "detecting" | "live" | "scanning" | "error";

interface Calibration {
  x: number;
  y: number;
  size: number;
  zoom: number;
}

const CALIB_KEY = "dartcam-calibration-v4";
const GRID = 32;
const TARGET_BOARD_RATIO = 0.82;
const DEFAULT_ZOOM = 1;
const MIN_ANALYSIS_SIZE = 0.55;

// Frame-to-frame diff considered "still" (no motion).
const MOTION_STILL = 0.022;
// Diff between current and last *stable* frame → physical change occurred.
const CHANGE_DELTA = 0.045;
// Frames of stillness required after a change before scanning.
const STILL_AFTER_CHANGE = 3; // ~0.6s at 300ms
// Tick interval of the watcher loop.
const TICK_MS = 300;
// Rolling video buffer length for throw clip.
const CLIP_BUFFER_MS = 12000;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

const loadCalib = (): Calibration => {
  if (typeof window === "undefined")
    return { x: 0.5, y: 0.5, size: 0.82, zoom: DEFAULT_ZOOM };
  try {
    const raw = window.localStorage.getItem(CALIB_KEY);
    if (!raw) return { x: 0.5, y: 0.5, size: 0.82, zoom: DEFAULT_ZOOM };
    const p = JSON.parse(raw);
    return {
      x: clamp(Number(p?.x) || 0.5, 0.15, 0.85),
      y: clamp(Number(p?.y) || 0.5, 0.15, 0.85),
      size: clamp(Number(p?.size) || 0.82, 0.4, 0.98),
      zoom: clamp(Number(p?.zoom) || DEFAULT_ZOOM, 1, 4),
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

const dartKey = (d: DetectedDart) => `${d.baseValue}x${d.multiplier}`;

/**
 * Try to match darts returned by AI against darts we already accumulated,
 * accounting for slight re-classifications across frames. Returns the
 * darts in `ai` that are genuinely *new* compared to `prev`.
 */
/**
 * Matches new AI detections against previous darts using spatial coordinates.
 * Returns the updated list of existing darts (with refreshed scores) and
 * a list of genuinely new darts.
 */
function matchDarts(prev: DetectedDart[], ai: DetectedDart[]): { updated: DetectedDart[], newlyDetected: DetectedDart[] } {
  const DIST_THRESHOLD = 0.08;
  const unmatchedAI = ai.map(d => ({ ...d, matched: false }));
  const updated = [...prev];
  const newlyDetected: DetectedDart[] = [];

  // 1. Update existing darts with latest AI results if they match spatially
  for (let i = 0; i < updated.length; i++) {
    const p = updated[i];
    let bestIdx = -1;
    let bestDist = Infinity;

    for (let j = 0; j < unmatchedAI.length; j++) {
      if (unmatchedAI[j].matched) continue;
      const d = unmatchedAI[j];
      if (p.x !== undefined && p.y !== undefined && d.x !== undefined && d.y !== undefined) {
        const dist = Math.sqrt(Math.pow(p.x - d.x, 2) + Math.pow(p.y - d.y, 2));
        if (dist < DIST_THRESHOLD && dist < bestDist) {
          bestDist = dist;
          bestIdx = j;
        }
      } else if (dartKey(p) === dartKey(d)) {
        bestDist = 0;
        bestIdx = j;
        break;
      }
    }

    if (bestIdx !== -1) {
      updated[i] = { ...unmatchedAI[bestIdx] };
      unmatchedAI[bestIdx].matched = true;
    }
  }

  // 2. Any unmatched AI darts are new
  for (const d of unmatchedAI) {
    if (!d.matched) {
      newlyDetected.push(d);
    }
  }

  return { updated, newlyDetected };
}));
  
  // For each previous dart, find the best match in the current AI results
  for (const p of prev) {
    let bestIdx = -1;
    let bestDist = Infinity;
    
    for (let i = 0; i < unmatchedAI.length; i++) {
      if (unmatchedAI[i].matched) continue;
      const d = unmatchedAI[i];
      
      // If coordinates are available, use distance
      if (p.x !== undefined && p.y !== undefined && d.x !== undefined && d.y !== undefined) {
        const dist = Math.sqrt(Math.pow(p.x - d.x, 2) + Math.pow(p.y - d.y, 2));
        if (dist < DIST_THRESHOLD && dist < bestDist) {
          bestDist = dist;
          bestIdx = i;
        }
      } else {
        // Fallback to score-only matching if no coordinates
        if (dartKey(p) === dartKey(d)) {
          bestDist = 0;
          bestIdx = i;
          break;
        }
      }
    }
    
    if (bestIdx !== -1) {
      unmatchedAI[bestIdx].matched = true;
    }
  }
  
  // Return AI detections that couldn't be mapped to a previously seen dart
  return unmatchedAI.filter(d => !d.matched).map(({ matched, ...d }) => d as DetectedDart);
}
  return remaining;
}

const LiveCamera = ({
  onRoundCommit,
  onPendingChange,
  onClipReady,
  enabled,
  onClose,
  dartsRemaining = 3,
  playerName,
}: LiveCameraProps) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const zoomCapsRef = useRef<ZoomCapability | null>(null);

  // Rolling video buffer
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recorderMimeRef = useRef<string>("video/webm");
  const clipChunksRef = useRef<Array<{ blob: Blob; ts: number }>>([]);

  // Frame state
  const prevSigRef = useRef<number[] | null>(null);
  const stableSigRef = useRef<number[] | null>(null);
  const stillFramesRef = useRef(0);
  const changeSeenRef = useRef(false);
  const scanLockRef = useRef(false);
  // Track how many AI scans in a row report zero darts AFTER we had some.
  const emptyConfirmRef = useRef(0);

  const [phase, setPhase] = useState<Phase>("starting");
  const [error, setError] = useState<string | null>(null);
  const [accumulated, setAccumulated] = useState<DetectedDart[]>([]);
  const accumulatedRef = useRef<DetectedDart[]>([]);
  const [status, setStatus] = useState("Kamera startet …");
  const [motion, setMotion] = useState(0);
  const [changeDelta, setChangeDelta] = useState(0);
  const [lastConfidence, setLastConfidence] = useState(0);
  const [calib, setCalib] = useState<Calibration>(() => loadCalib());
  const [autoCalibrating, setAutoCalibrating] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [justAddedIndex, setJustAddedIndex] = useState<number | null>(null);

  useEffect(() => {
    accumulatedRef.current = accumulated;
    onPendingChange?.(accumulated);
  }, [accumulated, onPendingChange]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(CALIB_KEY, JSON.stringify(calib));
  }, [calib]);

  const resetLoop = useCallback(() => {
    prevSigRef.current = null;
    stableSigRef.current = null;
    stillFramesRef.current = 0;
    changeSeenRef.current = false;
    scanLockRef.current = false;
    emptyConfirmRef.current = 0;
  }, []);

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
            facingMode: { ideal: "environment" },
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
        // Rolling MediaRecorder for clip dialog
        try {
          if (typeof MediaRecorder !== "undefined") {
            const candidates = [
              "video/webm;codecs=vp9",
              "video/webm;codecs=vp8",
              "video/webm",
              "video/mp4",
            ];
            const mime = candidates.find((m) => MediaRecorder.isTypeSupported?.(m)) ?? "";
            const rec = mime
              ? new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 1_500_000 })
              : new MediaRecorder(stream);
            recorderMimeRef.current = rec.mimeType || mime || "video/webm";
            rec.ondataavailable = (e) => {
              if (!e.data || e.data.size === 0) return;
              const now = performance.now();
              clipChunksRef.current.push({ blob: e.data, ts: now });
              const cutoff = now - CLIP_BUFFER_MS - 1500;
              while (
                clipChunksRef.current.length > 0 &&
                clipChunksRef.current[0].ts < cutoff
              ) {
                clipChunksRef.current.shift();
              }
            };
            rec.start(500);
            recorderRef.current = rec;
          }
        } catch (e) {
          console.warn("recorder init failed", e);
        }

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
      try {
        if (recorderRef.current && recorderRef.current.state !== "inactive") {
          recorderRef.current.stop();
        }
      } catch {
        /* noop */
      }
      recorderRef.current = null;
      clipChunksRef.current = [];
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

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
      zoom: prev.zoom * 0.4 + nextZoom * 0.6,
    }));
    if (zoomCapsRef.current) await applyCameraZoom(nextZoom);
  }, [applyCameraZoom, calib.x, calib.y, calib.size, calib.zoom]);

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
    setPhase("live");
    setStatus("Bereit – wirf deinen ersten Dart");
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
          setStatus(
            accumulatedRef.current.length > 0
              ? `${accumulatedRef.current.length}/${dartsRemaining} erkannt · wirf nächsten Dart`
              : "Bereit – wirf deinen ersten Dart",
          );
        } else {
          setStatus("Stabilisiere Bild …");
        }
        return;
      }

      const delta = sigDiff(stableSigRef.current, sig);
      setChangeDelta(delta);

      // If picture changed significantly compared to last stable frame,
      // remember that change happened.
      if (!scanLockRef.current && delta > CHANGE_DELTA) {
        changeSeenRef.current = true;
      }

      // When a change has been observed AND the picture is still again,
      // run an AI scan.
      if (
        !scanLockRef.current &&
        changeSeenRef.current &&
        stillFramesRef.current >= STILL_AFTER_CHANGE
      ) {
        scanLockRef.current = true;
        changeSeenRef.current = false;
        void runScan();
        return;
      }

      // Idle status text
      if (!scanLockRef.current) {
        const accCount = accumulatedRef.current.length;
        if (changeSeenRef.current) {
          setStatus("Bewegung erkannt – warte bis still …");
        } else if (accCount >= dartsRemaining) {
          setStatus(`${accCount} Darts erkannt · Darts ziehen zum Übernehmen`);
        } else if (accCount > 0) {
          setStatus(
            `${accCount}/${dartsRemaining} erkannt · wirf nächsten Dart oder zieh Darts`,
          );
        } else {
          setStatus("Bereit – wirf deinen ersten Dart");
        }
      }
    }, TICK_MS);

    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, phase, dartsRemaining]);

  // ─── scan: ask AI for the full board state ──────────────────────────
  const runScan = async () => {
    const img = captureFrame(1024, 0.82);
    if (!img) {
      scanLockRef.current = false;
      return;
    }
    setPhase("scanning");
    setError(null);
    playScanStartSound();
    setStatus("Erkenne Darts …");

    try {
      const data = await analyzeFrame(img);
      const aiDarts: DetectedDart[] = Array.isArray(data?.darts)
        ? data.darts.map((d: unknown) => {
            const dart = d as Partial<DetectedDart> & {
              segment?: unknown;
              multiplier?: unknown;
              points?: unknown;
              confidence?: unknown;
            };
            return {
              baseValue: Number(dart.segment) || 0,
              multiplier: ([1, 2, 3].includes(Number(dart.multiplier))
                ? Number(dart.multiplier)
                : 1) as 1 | 2 | 3,
              points: Number(dart.points) || 0,
              confidence: Number(dart.confidence) || 0,
              x: typeof dart.x === 'number' ? dart.x : undefined,
              y: typeof dart.y === 'number' ? dart.y : undefined,
            };
          })
        : [];
      setLastConfidence(Number(data?.overallConfidence) || 0);
      if (data?.board) void updateAutoCalibration(data.board as BoardDetection);

      const prev = accumulatedRef.current;

      // Case A: board went empty AFTER having darts → likely user pulled them.
      if (aiDarts.length === 0 && prev.length > 0) {
        emptyConfirmRef.current += 1;
        if (emptyConfirmRef.current >= 2) {
          commitRound(prev);
          return;
        }
      } else {
        emptyConfirmRef.current = 0;
      }

      // Case B: Spatial matching for new/updated darts
      const { updated, newlyDetected } = matchDarts(prev, aiDarts);

      if (newlyDetected.length > 0) {
        const finalMerged = [...updated, ...newlyDetected].slice(0, dartsRemaining);
        setAccumulated(finalMerged);
        newlyDetected.forEach((_, i) => {
          setTimeout(() => playDartDetectedSound(updated.length + i), 110 * i);
        });
        setJustAddedIndex(updated.length);
        setTimeout(() => setJustAddedIndex(null), 1100);
      } else if (aiDarts.length > 0) {
        // If some darts disappeared (but not all), we trim the list to match AI count
        if (aiDarts.length < prev.length) {
          setAccumulated(aiDarts.slice(0, dartsRemaining));
        } else {
          setAccumulated(updated.slice(0, dartsRemaining));
        }
      }

      // refresh stable reference to the post-scan frame
      const newSig = buildSignature();
      if (newSig) stableSigRef.current = newSig;

      setPhase("live");
      setStatus(
        newOnes.length > 0
          ? `Dart erkannt: ${newOnes.map(dartLabel).join(", ")}`
          : aiDarts.length === 0
            ? "Board leer"
            : "Bereit für nächsten Wurf",
      );
    } catch (err: unknown) {
      console.error("scan error", err);
      setError(err instanceof Error ? err.message : "Erkennung fehlgeschlagen.");
      const newSig = buildSignature();
      if (newSig) stableSigRef.current = newSig;
      setPhase("live");
      setStatus("Scan unsicher · weiter beobachten");
    } finally {
      scanLockRef.current = false;
    }
  };

  const commitRound = (darts: DetectedDart[]) => {
    try {
      if (onClipReady && clipChunksRef.current.length > 0) {
        const blobs = clipChunksRef.current.map((c) => c.blob);
        if (blobs.length > 0) {
          const clip = new Blob(blobs, { type: recorderMimeRef.current });
          onClipReady(clip, darts.slice(0, dartsRemaining));
        }
      }
    } catch (e) {
      console.warn("clip capture failed", e);
    }
    onRoundCommit(darts.slice(0, dartsRemaining));
    playRoundCommittedSound();
    setAccumulated([]);
    accumulatedRef.current = [];
    setError(null);
    resetLoop();
    setPhase("live");
    setStatus("Runde übernommen · bereit für nächsten Wurf");
  };

  const discardRound = () => {
    setAccumulated([]);
    accumulatedRef.current = [];
    setError(null);
    resetLoop();
    setStatus("Runde verworfen · bereit für nächsten Wurf");
  };

  const manualScan = () => {
    if (!scanLockRef.current) {
      scanLockRef.current = true;
      void runScan();
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

  return (
    <div className="mb-3 space-y-2 rounded-xl border border-border bg-card p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Camera className="h-4 w-4 text-primary" />
          <span className="font-display text-sm uppercase tracking-wider">
            Auto-Scoring
          </span>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} className="h-7 w-7">
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="relative mx-auto aspect-square w-full max-w-sm overflow-hidden rounded-lg border border-border bg-muted">
        <video
          ref={videoRef}
          playsInline
          muted
          className="h-full w-full object-cover"
        />
        <canvas ref={canvasRef} className="hidden" />

        {(phase === "live" || phase === "scanning" || phase === "detecting") && (
          <div className="pointer-events-none absolute inset-0">
            <div
              className={`absolute rounded-full border-2 ${
                phase === "scanning"
                  ? "border-accent animate-pulse-glow"
                  : "border-primary/80"
              }`}
              style={{
                width: `${calib.size * 100}%`,
                height: `${calib.size * 100}%`,
                left: `${calib.x * 100}%`,
                top: `${calib.y * 100}%`,
                transform: "translate(-50%, -50%)",
              }}
            >
              <div className="absolute inset-[35%] rounded-full border border-primary/40" />
              <div className="absolute inset-[48%] rounded-full bg-primary/70" />
            </div>
          </div>
        )}

        {(phase === "starting" || phase === "detecting") && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-background/80 px-4 text-center text-xs text-foreground">
            <Loader2 className="mb-2 h-5 w-5 animate-spin" />
            {phase === "starting" ? "Kamera startet…" : "Board wird automatisch erkannt…"}
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

      {/* live accumulated darts */}
      <div className="rounded-xl border border-primary/30 bg-gradient-to-br from-primary/10 via-primary/5 to-transparent p-3">
        <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-muted-foreground">
          <span className="flex items-center gap-1">
            <Zap className="h-3 w-3 text-accent" /> Aktuelle Runde
          </span>
          <span>
            {accumulated.length}/{dartsRemaining}
            {lastConfidence > 0 && (
              <span className="ml-2">KI {(lastConfidence * 100).toFixed(0)}%</span>
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
                className="h-7 w-7"
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
            className="gap-1"
            title="Runde sofort übernehmen"
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
          <Button
            variant="outline"
            size="sm"
            onClick={() => void autoDetectBoard()}
            className="w-full gap-1"
          >
            <RotateCcw className="h-4 w-4" /> Board neu auto-erkennen
          </Button>
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
};

export default LiveCamera;