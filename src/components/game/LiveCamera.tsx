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
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import {
  playDartDetectedSound,
  playRoundCommittedSound,
  playScanStartSound,
} from "@/utils/sounds";

export interface DetectedDart {
  baseValue: number;
  multiplier: 1 | 2 | 3;
  points: number;
  confidence: number;
}

interface LiveCameraProps {
  onRoundCommit: (darts: DetectedDart[]) => void;
  onPendingChange?: (darts: DetectedDart[]) => void;
  enabled: boolean;
  onClose: () => void;
  dartsRemaining?: number;
  playerName?: string;
}

type Phase = "starting" | "detecting" | "baselining" | "live" | "scanning" | "error";

interface Calibration {
  x: number;
  y: number;
  size: number;
  baseline: number[] | null;
}

const CALIB_KEY = "dartcam-calibration-v3";
const GRID = 32;
const MOTION_STILL = 0.020;        // frame-to-frame diff considered "still"
const NEW_DART_DELTA = 0.045;      // signature jump vs last stable state → new dart landed
const CLEAR_DELTA = 0.030;         // signature diff vs empty baseline → board is free
const STILL_FRAMES_REQUIRED = 3;   // ~1s at 350ms
const NEW_DART_FRAMES = 3;         // stable frames after a jump before we scan
const CLEAR_FRAMES_REQUIRED = 4;   // stable frames of empty board before commit

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

const loadCalib = (): Calibration => {
  if (typeof window === "undefined")
    return { x: 0.5, y: 0.5, size: 0.82, baseline: null };
  try {
    const raw = window.localStorage.getItem(CALIB_KEY);
    if (!raw) return { x: 0.5, y: 0.5, size: 0.82, baseline: null };
    const p = JSON.parse(raw);
    return {
      x: clamp(Number(p?.x) || 0.5, 0.15, 0.85),
      y: clamp(Number(p?.y) || 0.5, 0.15, 0.85),
      size: clamp(Number(p?.size) || 0.82, 0.4, 0.98),
      baseline: Array.isArray(p?.baseline)
        ? p.baseline.map((n: unknown) => Number(n) || 0)
        : null,
    };
  } catch {
    return { x: 0.5, y: 0.5, size: 0.82, baseline: null };
  }
};

const dartLabel = (d: DetectedDart) => {
  if (d.baseValue === 0) return "Miss";
  if (d.baseValue === 25) return d.multiplier === 2 ? "Bull 50" : "Bull 25";
  const prefix = d.multiplier === 2 ? "D" : d.multiplier === 3 ? "T" : "";
  return `${prefix}${d.baseValue}`;
};

const LiveCamera = ({
  onRoundCommit,
  onPendingChange,
  enabled,
  onClose,
  dartsRemaining = 3,
  playerName,
}: LiveCameraProps) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const prevSigRef = useRef<number[] | null>(null);
  const roundBaselineRef = useRef<number[] | null>(null); // updated after each detected dart
  const stillFramesRef = useRef(0);
  const newDartFramesRef = useRef(0);
  const clearFramesRef = useRef(0);
  const scanLockRef = useRef(false);
  const baselineSamplesRef = useRef<number[][]>([]);

  const [phase, setPhase] = useState<Phase>("starting");
  const [error, setError] = useState<string | null>(null);
  const [accumulated, setAccumulated] = useState<DetectedDart[]>([]);
  const accumulatedRef = useRef<DetectedDart[]>([]);
  const [snapshot, setSnapshot] = useState<string | null>(null);
  const [status, setStatus] = useState("Kamera startet …");
  const [motion, setMotion] = useState(0);
  const [boardDelta, setBoardDelta] = useState(0);
  const [lastConfidence, setLastConfidence] = useState(0);
  const [calib, setCalib] = useState<Calibration>(() => loadCalib());
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [justAddedIndex, setJustAddedIndex] = useState<number | null>(null);

  // ── refs in sync with state ───────────────────────────────────
  useEffect(() => {
    accumulatedRef.current = accumulated;
    onPendingChange?.(accumulated);
  }, [accumulated, onPendingChange]);

  // persist calibration
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(CALIB_KEY, JSON.stringify(calib));
  }, [calib]);

  const resetLoop = useCallback(() => {
    prevSigRef.current = null;
    stillFramesRef.current = 0;
    newDartFramesRef.current = 0;
    clearFramesRef.current = 0;
    scanLockRef.current = false;
  }, []);

  // ── camera lifecycle ──────────────────────────────────────────
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
        setTimeout(() => {
          if (!cancelled) void autoDetectBoard();
        }, 700);
      } catch (err) {
        console.error("camera error", err);
        setError("Kamerazugriff nicht möglich. Bitte Berechtigung erteilen.");
        setPhase("error");
      }
    })();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  // ── helpers ───────────────────────────────────────────────────
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

  const captureFrame = () => {
    const c = drawToCanvas(768, true);
    return c ? c.toDataURL("image/jpeg", 0.72) : null;
  };

  // ── auto detect board via edge function ───────────────────────
  const autoDetectBoard = async () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) {
      startBaselining();
      return;
    }
    setPhase("detecting");
    setStatus("Suche Dartboard …");
    try {
      const c = canvasRef.current;
      if (!c) throw new Error("no canvas");
      const minSide = Math.min(v.videoWidth, v.videoHeight);
      c.width = 640;
      c.height = 640;
      const ctx = c.getContext("2d");
      if (!ctx) throw new Error("no ctx");
      const sx = (v.videoWidth - minSide) / 2;
      const sy = (v.videoHeight - minSide) / 2;
      ctx.drawImage(v, sx, sy, minSide, minSide, 0, 0, 640, 640);
      const dataUrl = c.toDataURL("image/jpeg", 0.7);
      const { data } = await supabase.functions.invoke("analyze-dartboard", {
        body: { imageBase64: dataUrl, detectBoard: true },
      });
      if (data?.board && Number(data.board.confidence) >= 0.4) {
        const nx = clamp(Number(data.board.cx) || 0.5, 0.1, 0.9);
        const ny = clamp(Number(data.board.cy) || 0.5, 0.1, 0.9);
        const nsize = clamp((Number(data.board.size) || 0.78) * 1.08, 0.5, 0.98);
        setCalib((prev) => ({ ...prev, x: nx, y: ny, size: nsize }));
      }
    } catch (err) {
      console.warn("auto-detect failed", err);
    }
    startBaselining();
  };

  // ── automatic baseline (empty board) ──────────────────────────
  const startBaselining = () => {
    baselineSamplesRef.current = [];
    if (!calib.baseline) {
      setPhase("baselining");
      setStatus("Halte das Board frei – Kalibrierung läuft …");
    } else {
      roundBaselineRef.current = calib.baseline;
      setPhase("live");
      setStatus("Bereit – wirf deinen ersten Dart");
      resetLoop();
    }
  };

  // ── main loop ─────────────────────────────────────────────────
  useEffect(() => {
    if (!enabled) return;
    if (phase !== "live" && phase !== "baselining") return;

    const id = window.setInterval(() => {
      const sig = buildSignature();
      if (!sig) return;

      const m = sigDiff(prevSigRef.current, sig);
      prevSigRef.current = sig;
      setMotion(m);
      stillFramesRef.current = m < MOTION_STILL ? stillFramesRef.current + 1 : 0;

      // ── baselining: average a few still frames into the empty signature
      if (phase === "baselining") {
        if (stillFramesRef.current >= 2) {
          baselineSamplesRef.current.push(sig);
          setStatus(`Kalibriere … ${baselineSamplesRef.current.length}/4`);
          if (baselineSamplesRef.current.length >= 4) {
            const len = sig.length;
            const avg = new Array(len).fill(0);
            for (const s of baselineSamplesRef.current)
              for (let i = 0; i < len; i++) avg[i] += s[i];
            for (let i = 0; i < len; i++)
              avg[i] /= baselineSamplesRef.current.length;
            setCalib((prev) => ({ ...prev, baseline: avg }));
            roundBaselineRef.current = avg;
            baselineSamplesRef.current = [];
            resetLoop();
            setPhase("live");
            setStatus("Board kalibriert · wirf deinen ersten Dart");
          }
        } else {
          setStatus("Board frei halten – warte auf ruhiges Bild …");
        }
        return;
      }

      if (!calib.baseline) return;

      const deltaFromEmpty = sigDiff(calib.baseline, sig);
      const deltaFromRound = sigDiff(roundBaselineRef.current, sig);
      setBoardDelta(deltaFromEmpty);

      const accCount = accumulatedRef.current.length;

      // ── waiting for board to clear → commit round
      if (accCount > 0 && deltaFromEmpty < CLEAR_DELTA && stillFramesRef.current >= 2) {
        clearFramesRef.current += 1;
        setStatus(`Darts werden gezogen … ${clearFramesRef.current}/${CLEAR_FRAMES_REQUIRED}`);
        if (clearFramesRef.current >= CLEAR_FRAMES_REQUIRED) {
          const toCommit = accumulatedRef.current;
          if (toCommit.length > 0) {
            commitRound(toCommit);
          }
        }
        return;
      } else {
        clearFramesRef.current = 0;
      }

      // ── waiting for a NEW dart since last stable state
      if (
        !scanLockRef.current &&
        accCount < dartsRemaining &&
        deltaFromRound > NEW_DART_DELTA
      ) {
        if (stillFramesRef.current >= STILL_FRAMES_REQUIRED) {
          newDartFramesRef.current += 1;
          if (newDartFramesRef.current >= NEW_DART_FRAMES) {
            scanLockRef.current = true;
            newDartFramesRef.current = 0;
            void scanForNewDarts();
          } else {
            setStatus(
              `Neuer Dart erkannt · stabilisiere … ${newDartFramesRef.current}/${NEW_DART_FRAMES}`,
            );
          }
        } else {
          setStatus("Bewegung erkannt – warte bis Dart still steht …");
        }
      } else if (accCount >= dartsRemaining) {
        setStatus(`${accCount} Darts erkannt · Darts ziehen zum Übernehmen`);
      } else if (accCount > 0) {
        setStatus(`${accCount}/${dartsRemaining} Darts erkannt · wirf nächsten Dart`);
      } else {
        setStatus("Bereit – wirf deinen ersten Dart");
      }
    }, 350);

    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, phase, calib.baseline, dartsRemaining]);

  // ── scan & append only newly arrived darts ────────────────────
  const scanForNewDarts = async () => {
    const img = captureFrame();
    if (!img) {
      scanLockRef.current = false;
      return;
    }
    setSnapshot(img);
    setPhase("scanning");
    setError(null);
    playScanStartSound();
    setStatus("Erkenne neuen Dart …");

    try {
      const { data, error: fe } = await supabase.functions.invoke("analyze-dartboard", {
        body: { imageBase64: img },
      });
      if (fe) throw fe;

      const aiDarts: DetectedDart[] = Array.isArray(data?.darts)
        ? data.darts.map((d: any) => ({
            baseValue: Number(d.segment) || 0,
            multiplier: ([1, 2, 3].includes(Number(d.multiplier))
              ? Number(d.multiplier)
              : 1) as 1 | 2 | 3,
            points: Number(d.points) || 0,
            confidence: Number(d.confidence) || 0,
          }))
        : [];
      const conf = Number(data?.overallConfidence) || 0;
      setLastConfidence(conf);

      const prevCount = accumulatedRef.current.length;
      // AI sees the *total* darts in the board. Anything beyond what we already
      // logged is considered new.
      if (aiDarts.length > prevCount) {
        const newDarts = aiDarts.slice(prevCount, dartsRemaining);
        // play one ping per new dart, staggered
        newDarts.forEach((_, i) => {
          setTimeout(() => playDartDetectedSound(prevCount + i), 120 * i);
        });
        setAccumulated((prev) => {
          const merged = [...prev, ...newDarts].slice(0, dartsRemaining);
          return merged;
        });
        setJustAddedIndex(prevCount);
        setTimeout(() => setJustAddedIndex(null), 1200);
      }

      // Always update the round baseline so we only react to the *next* change
      const newSig = buildSignature();
      if (newSig) roundBaselineRef.current = newSig;

      setSnapshot(null);
      setPhase("live");
      setStatus(
        aiDarts.length > prevCount
          ? `Dart ${Math.min(aiDarts.length, dartsRemaining)} erkannt`
          : "Kein neuer Dart erkannt – warte weiter …",
      );
    } catch (err: any) {
      console.error("scan error", err);
      setError(err?.message || "Erkennung fehlgeschlagen.");
      const newSig = buildSignature();
      if (newSig) roundBaselineRef.current = newSig;
      setSnapshot(null);
      setPhase("live");
      setStatus("Scan unsicher · weiter beobachten");
    } finally {
      scanLockRef.current = false;
    }
  };

  const commitRound = (darts: DetectedDart[]) => {
    onRoundCommit(darts.slice(0, dartsRemaining));
    playRoundCommittedSound();
    setAccumulated([]);
    accumulatedRef.current = [];
    setSnapshot(null);
    setError(null);
    resetLoop();
    // empty board is the new round baseline
    roundBaselineRef.current = calib.baseline;
    setPhase("live");
    setStatus("Runde übernommen · bereit für nächsten Wurf");
  };

  const discardRound = () => {
    setAccumulated([]);
    accumulatedRef.current = [];
    setError(null);
    resetLoop();
    roundBaselineRef.current = calib.baseline;
    setStatus("Runde verworfen · bereit für nächsten Wurf");
  };

  const recalibrate = () => {
    setCalib((prev) => ({ ...prev, baseline: null }));
    setAccumulated([]);
    accumulatedRef.current = [];
    setSnapshot(null);
    resetLoop();
    setPhase("baselining");
    setStatus("Board frei halten – Neukalibrierung …");
    baselineSamplesRef.current = [];
  };

  const manualScan = () => {
    if (!scanLockRef.current) {
      scanLockRef.current = true;
      void scanForNewDarts();
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
      {/* compact header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Camera className="h-4 w-4 text-primary" />
          <span className="font-display text-sm uppercase tracking-wider">
            Live-Erkennung
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

        {/* board overlay */}
        {(phase === "live" || phase === "scanning" || phase === "baselining" || phase === "detecting") && (
          <div className="pointer-events-none absolute inset-0">
            <div
              className={`absolute rounded-full border-2 ${
                phase === "baselining"
                  ? "border-accent animate-pulse"
                  : phase === "scanning"
                    ? "border-accent animate-pulse-glow"
                    : "border-primary"
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
          <div className="absolute inset-0 flex items-center justify-center bg-background/60 text-sm text-foreground">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Analysiere neuen Dart…
          </div>
        )}
        {phase === "error" && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/85 px-4 text-center text-xs text-foreground">
            {error}
          </div>
        )}
      </div>

      {/* status bar */}
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
          <div>Δ {(boardDelta * 100).toFixed(0)}%</div>
        </div>
      </div>

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

      {/* per-dart inline editor (compact) */}
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

      {/* primary actions */}
      <div className="flex gap-2">
        <Button
          onClick={manualScan}
          className="flex-1 gap-2 font-display uppercase"
          size="sm"
          variant="outline"
          disabled={phase !== "live"}
        >
          <ScanLine className="h-4 w-4" /> Manuell scannen
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

      {/* advanced (collapsible) */}
      <button
        onClick={() => setShowAdvanced((v) => !v)}
        className="flex w-full items-center justify-between rounded border border-border px-3 py-1.5 text-[11px] text-muted-foreground hover:bg-muted"
      >
        <span>Feinjustierung & Kalibrierung</span>
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
            onClick={recalibrate}
            className="w-full gap-1"
          >
            <RotateCcw className="h-4 w-4" /> Board neu kalibrieren
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
        </div>
      )}

      {/* hidden snapshot indicator while scanning */}
      {snapshot && phase === "scanning" && (
        <img src={snapshot} alt="" className="hidden" />
      )}
    </div>
  );
};

export default LiveCamera;