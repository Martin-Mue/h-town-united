import { useEffect, useRef, useState, useCallback } from "react";
import { AlertCircle, Camera, Check, ChevronDown, ChevronUp, Loader2, RotateCcw, ScanLine, Target, X, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { playDartDetectedSound, playRoundCommittedSound, playScanStartSound } from "@/utils/sounds";

export interface DetectedDart {
  baseValue: number;
  multiplier: 1 | 2 | 3;
  points: number;
  confidence: number;
}

interface LiveCameraProps {
  onRoundCommit: (darts: DetectedDart[]) => void;
  enabled: boolean;
  onClose: () => void;
  dartsRemaining?: number;
  playerName?: string;
}

type Phase = "starting" | "detecting" | "baselining" | "live" | "scanning" | "review" | "error";

interface Calibration {
  x: number;
  y: number;
  size: number;
  baseline: number[] | null;
}

const CALIB_KEY = "dartcam-calibration-v3";
const AUTO_KEY = "dartcam-auto-commit-v1";
const GRID = 32;
// thresholds tuned for fewer false triggers
const MOTION_STILL = 0.020;        // frame-to-frame diff considered "still"
const OCCUPIED_DELTA = 0.085;      // baseline diff to consider darts present
const CLEAR_DELTA = 0.035;         // baseline diff to consider board free again
const STILL_FRAMES_REQUIRED = 4;   // ~1.4s at 350ms
const OCCUPIED_FRAMES_REQUIRED = 5;// ~1.75s of stable presence
const AUTO_COMMIT_CONFIDENCE = 0.78;
const AUTO_COMMIT_COUNTDOWN_MS = 1800;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

const loadCalib = (): Calibration => {
  if (typeof window === "undefined") return { x: 0.5, y: 0.5, size: 0.82, baseline: null };
  try {
    const raw = window.localStorage.getItem(CALIB_KEY);
    if (!raw) return { x: 0.5, y: 0.5, size: 0.82, baseline: null };
    const p = JSON.parse(raw);
    return {
      x: clamp(Number(p?.x) || 0.5, 0.15, 0.85),
      y: clamp(Number(p?.y) || 0.5, 0.15, 0.85),
      size: clamp(Number(p?.size) || 0.82, 0.4, 0.98),
      baseline: Array.isArray(p?.baseline) ? p.baseline.map((n: unknown) => Number(n) || 0) : null,
    };
  } catch {
    return { x: 0.5, y: 0.5, size: 0.82, baseline: null };
  }
};

const loadAuto = () => typeof window !== "undefined" && window.localStorage.getItem(AUTO_KEY) !== "false";

const LiveCamera = ({ onRoundCommit, enabled, onClose, dartsRemaining = 3, playerName }: LiveCameraProps) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const prevSigRef = useRef<number[] | null>(null);
  const stillFramesRef = useRef(0);
  const occupiedFramesRef = useRef(0);
  const clearFramesRef = useRef(0);
  const waitingClearRef = useRef(false);
  const scanLockRef = useRef(false);
  const baselineSamplesRef = useRef<number[][]>([]);

  const [phase, setPhase] = useState<Phase>("starting");
  const [error, setError] = useState<string | null>(null);
  const [detected, setDetected] = useState<DetectedDart[]>([]);
  const [snapshot, setSnapshot] = useState<string | null>(null);
  const [status, setStatus] = useState("Kamera startet …");
  const [motion, setMotion] = useState(0);
  const [boardDelta, setBoardDelta] = useState(0);
  const [confidence, setConfidence] = useState(0);
  const [autoCommit, setAutoCommit] = useState(loadAuto);
  const [calib, setCalib] = useState<Calibration>(() => loadCalib());
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [autoCommitIn, setAutoCommitIn] = useState<number | null>(null);
  const autoCommitTimerRef = useRef<number | null>(null);
  const pendingCommitRef = useRef<DetectedDart[] | null>(null);

  // persist calibration
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(CALIB_KEY, JSON.stringify(calib));
  }, [calib]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(AUTO_KEY, autoCommit ? "true" : "false");
  }, [autoCommit]);

  const resetLoop = useCallback(() => {
    prevSigRef.current = null;
    stillFramesRef.current = 0;
    occupiedFramesRef.current = 0;
    clearFramesRef.current = 0;
    waitingClearRef.current = false;
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
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
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
        // give the video a moment to deliver frames, then auto-detect the board
        setTimeout(() => { if (!cancelled) void autoDetectBoard(); }, 700);
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
        sig.push((data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) / 255);
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
      // try again with full-frame snapshot if crop fails
      startBaselining();
      return;
    }
    setPhase("detecting");
    setStatus("Suche Dartboard …");
    try {
      // capture the *full* video frame, not the current crop
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
        // board coordinates are relative to the cropped square we sent → map back
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
      setPhase("live");
      setStatus("Bereit – warte auf Würfe");
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

      // baselining: collect samples once still
      if (phase === "baselining") {
        if (stillFramesRef.current >= 2) {
          baselineSamplesRef.current.push(sig);
          setStatus(`Kalibriere … ${baselineSamplesRef.current.length}/4`);
          if (baselineSamplesRef.current.length >= 4) {
            // average the samples
            const len = sig.length;
            const avg = new Array(len).fill(0);
            for (const s of baselineSamplesRef.current) for (let i = 0; i < len; i++) avg[i] += s[i];
            for (let i = 0; i < len; i++) avg[i] /= baselineSamplesRef.current.length;
            setCalib((prev) => ({ ...prev, baseline: avg }));
            baselineSamplesRef.current = [];
            resetLoop();
            setPhase("live");
            setStatus("Board kalibriert · bereit für Würfe");
          }
        } else {
          setStatus("Board frei halten – warte auf ruhiges Bild …");
        }
        return;
      }

      if (!calib.baseline) return;

      const delta = sigDiff(calib.baseline, sig);
      setBoardDelta(delta);

      if (waitingClearRef.current) {
        clearFramesRef.current =
          delta < CLEAR_DELTA && stillFramesRef.current >= 2 ? clearFramesRef.current + 1 : 0;
        setStatus(delta < CLEAR_DELTA ? "Board wird frei …" : "Warte bis die Darts gezogen sind …");
        if (clearFramesRef.current >= 3) {
          waitingClearRef.current = false;
          resetLoop();
          setStatus("Board frei · bereit für nächsten Wurf");
        }
        return;
      }

      const occupied = delta > OCCUPIED_DELTA;
      if (occupied && stillFramesRef.current >= STILL_FRAMES_REQUIRED) {
        occupiedFramesRef.current += 1;
        if (occupiedFramesRef.current >= OCCUPIED_FRAMES_REQUIRED && !scanLockRef.current) {
          scanLockRef.current = true;
          void scanBoard(true);
        } else {
          setStatus(`Würfe erkannt · stabilisiere … ${occupiedFramesRef.current}/${OCCUPIED_FRAMES_REQUIRED}`);
        }
      } else if (occupied) {
        setStatus("Bewegung erkannt …");
      } else {
        occupiedFramesRef.current = 0;
        setStatus("Board frei · warte auf Würfe");
      }
    }, 350);

    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, phase, calib.baseline, autoCommit]);

  // ── scanning ──────────────────────────────────────────────────
  const scanBoard = async (automatic: boolean) => {
    const img = captureFrame();
    if (!img) {
      scanLockRef.current = false;
      setError("Kamerabild nicht verfügbar.");
      return;
    }
    setSnapshot(img);
    setPhase("scanning");
    setError(null);
    playScanStartSound();
    setStatus(automatic ? "Automatischer Scan läuft …" : "Scan läuft …");

    try {
      const { data, error: fe } = await supabase.functions.invoke("analyze-dartboard", { body: { imageBase64: img } });
      if (fe) throw fe;
      if (data?.error && (!Array.isArray(data?.darts) || data.darts.length === 0)) throw new Error(data.error);

      const darts: DetectedDart[] = Array.isArray(data?.darts)
        ? data.darts.slice(0, dartsRemaining).map((d: any) => ({
            baseValue: Number(d.segment) || 0,
            multiplier: ([1, 2, 3].includes(Number(d.multiplier)) ? Number(d.multiplier) : 1) as 1 | 2 | 3,
            points: Number(d.points) || 0,
            confidence: Number(d.confidence) || 0,
          }))
        : [];
      const conf = Number(data?.overallConfidence) || 0;
      setConfidence(conf);

      // automatic mode: if AI reports no darts but we thought the board was occupied,
      // it was likely a false trigger → reset and keep watching, no review screen.
      if (automatic && darts.length === 0) {
        scanLockRef.current = false;
        occupiedFramesRef.current = 0;
        setSnapshot(null);
        setPhase("live");
        setStatus("Kein sicherer Treffer – warte weiter …");
        return;
      }

      // play a ping per detected dart so the user can hear what was recognised
      darts.forEach((_, i) => {
        setTimeout(() => playDartDetectedSound(i), 120 * i);
      });

      setDetected(darts);
      setPhase("review");

      if (automatic && autoCommit && darts.length > 0 && conf >= AUTO_COMMIT_CONFIDENCE) {
        // give the user a moment to interrupt before we commit automatically
        pendingCommitRef.current = darts;
        const start = Date.now();
        setAutoCommitIn(Math.ceil(AUTO_COMMIT_COUNTDOWN_MS / 1000));
        if (autoCommitTimerRef.current) window.clearInterval(autoCommitTimerRef.current);
        autoCommitTimerRef.current = window.setInterval(() => {
          const left = Math.max(0, AUTO_COMMIT_COUNTDOWN_MS - (Date.now() - start));
          setAutoCommitIn(Math.ceil(left / 1000));
          if (left <= 0) {
            if (autoCommitTimerRef.current) window.clearInterval(autoCommitTimerRef.current);
            autoCommitTimerRef.current = null;
            const d = pendingCommitRef.current;
            pendingCommitRef.current = null;
            setAutoCommitIn(null);
            if (d) commitRound(d);
          }
        }, 200);
        setStatus(`Übernehme automatisch in ${Math.ceil(AUTO_COMMIT_COUNTDOWN_MS / 1000)}s – tippe zum Anpassen`);
      } else {
        setStatus(darts.length ? "Erkennung prüfen" : "Keine sicheren Treffer – bitte prüfen");
      }
    } catch (err: any) {
      console.error("scan error", err);
      setDetected([]);
      setConfidence(0);
      setError(err?.message || "Erkennung fehlgeschlagen. Bitte erneut versuchen oder manuell eintragen.");
      setPhase("review");
      setStatus("Scan unsicher · bitte prüfen");
    } finally {
      scanLockRef.current = false;
    }
  };

  const commitRound = (darts: DetectedDart[]) => {
    onRoundCommit(darts.slice(0, dartsRemaining));
    playRoundCommittedSound();
    setDetected([]);
    setSnapshot(null);
    setError(null);
    waitingClearRef.current = true;
    resetLoop();
    waitingClearRef.current = true; // resetLoop clears it; re-set
    if (autoCommitTimerRef.current) window.clearInterval(autoCommitTimerRef.current);
    autoCommitTimerRef.current = null;
    pendingCommitRef.current = null;
    setAutoCommitIn(null);
    setPhase("live");
    setStatus("Runde übernommen · bitte Darts ziehen");
  };

  const rescan = () => {
    setDetected([]);
    setSnapshot(null);
    setError(null);
    if (autoCommitTimerRef.current) window.clearInterval(autoCommitTimerRef.current);
    autoCommitTimerRef.current = null;
    pendingCommitRef.current = null;
    setAutoCommitIn(null);
    resetLoop();
    setPhase("live");
    setStatus("Neuer Scan – warte auf Würfe …");
  };

  const recalibrate = () => {
    setCalib((prev) => ({ ...prev, baseline: null }));
    setDetected([]);
    setSnapshot(null);
    resetLoop();
    setPhase("baselining");
    setStatus("Board frei halten – Neukalibrierung …");
    baselineSamplesRef.current = [];
  };

  const adjustDart = (i: number, field: "baseValue" | "multiplier", value: number) => {
    if (autoCommitTimerRef.current) {
      window.clearInterval(autoCommitTimerRef.current);
      autoCommitTimerRef.current = null;
      pendingCommitRef.current = null;
      setAutoCommitIn(null);
      setStatus("Erkennung prüfen");
    }
    setDetected((prev) => {
      const next = [...prev];
      const d = { ...next[i], [field]: value };
      d.points = d.baseValue === 25 ? (d.multiplier === 2 ? 50 : 25) : d.baseValue * d.multiplier;
      next[i] = d;
      return next;
    });
  };

  const roundTotal = detected.reduce((s, d) => s + d.points, 0);

  return (
    <div className="mb-3 space-y-2 rounded-xl border border-border bg-card p-3">
      {/* compact header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Camera className="h-4 w-4 text-primary" />
          <span className="font-display text-sm uppercase tracking-wider">Auto-Scoring</span>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} className="h-7 w-7">
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="relative mx-auto aspect-square w-full max-w-sm overflow-hidden rounded-lg border border-border bg-muted">
        {phase === "review" && snapshot ? (
          <img src={snapshot} alt="Letzter Scan" className="h-full w-full object-cover" />
        ) : (
          <video ref={videoRef} playsInline muted className="h-full w-full object-cover" />
        )}
        <canvas ref={canvasRef} className="hidden" />

        {/* board overlay */}
        {(phase === "live" || phase === "scanning" || phase === "baselining" || phase === "detecting") && (
          <div className="pointer-events-none absolute inset-0">
            <div
              className={`absolute rounded-full border-2 ${phase === "baselining" ? "border-accent animate-pulse" : "border-primary"}`}
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
          <div className="absolute inset-0 flex items-center justify-center bg-background/75 text-sm text-foreground">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Erkenne Darts…
          </div>
        )}
        {phase === "error" && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/85 px-4 text-center text-xs text-foreground">
            {error}
          </div>
        )}
      </div>

      {/* compact status bar */}
      <div className="flex items-center justify-between rounded-md border border-border bg-muted/40 px-3 py-2 text-xs">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${
              phase === "live"
                ? "bg-secondary animate-pulse-glow"
                : phase === "scanning"
                  ? "bg-primary animate-pulse"
                  : phase === "review"
                    ? "bg-accent"
                    : phase === "error"
                      ? "bg-destructive"
                      : "bg-muted-foreground"
            }`}
          />
          <div className="min-w-0">
            <p className="truncate font-medium text-foreground">
              {playerName ?? "Auto-Scoring"}
              {typeof dartsRemaining === "number" && phase !== "review" && (
                <span className="ml-1 text-muted-foreground">· noch {dartsRemaining} Dart{dartsRemaining === 1 ? "" : "s"}</span>
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

      {/* primary actions */}
      {phase === "live" && (
        <div className="flex gap-2">
          <Button onClick={() => scanBoard(false)} className="flex-1 gap-2 font-display uppercase" size="sm">
            <ScanLine className="h-4 w-4" /> Jetzt scannen
          </Button>
          <Button variant="outline" size="sm" onClick={recalibrate} className="gap-1" title="Board neu kalibrieren">
            <RotateCcw className="h-4 w-4" /> Neu kalibrieren
          </Button>
        </div>
      )}
      {phase === "baselining" && (
        <Button variant="outline" size="sm" className="w-full gap-2" onClick={() => { baselineSamplesRef.current = []; resetLoop(); }}>
          <RotateCcw className="h-4 w-4" /> Kalibrierung neu starten
        </Button>
      )}

      {/* advanced (collapsible) */}
      <button
        onClick={() => setShowAdvanced((v) => !v)}
        className="flex w-full items-center justify-between rounded border border-border px-3 py-1.5 text-[11px] text-muted-foreground hover:bg-muted"
      >
        <span>Feinjustierung & Auto-Übernahme</span>
        {showAdvanced ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
      </button>
      {showAdvanced && (
        <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-2 text-xs">
          <div className="flex items-center justify-between rounded-md bg-background/60 px-2 py-1.5">
            <div>
              <Label htmlFor="auto-commit" className="text-xs">Auto bestätigen</Label>
              <p className="text-[10px] text-muted-foreground">Nur bei hoher KI-Sicherheit</p>
            </div>
            <Switch id="auto-commit" checked={autoCommit} onCheckedChange={setAutoCommit} />
          </div>
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[10px] text-muted-foreground"><span>Horizontal</span><span>{Math.round(calib.x * 100)}%</span></div>
            <Slider value={[calib.x]} min={0.15} max={0.85} step={0.01} onValueChange={([x]) => setCalib((p) => ({ ...p, x }))} />
          </div>
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[10px] text-muted-foreground"><span>Vertikal</span><span>{Math.round(calib.y * 100)}%</span></div>
            <Slider value={[calib.y]} min={0.15} max={0.85} step={0.01} onValueChange={([y]) => setCalib((p) => ({ ...p, y }))} />
          </div>
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[10px] text-muted-foreground"><span>Größe</span><span>{Math.round(calib.size * 100)}%</span></div>
            <Slider value={[calib.size]} min={0.4} max={0.98} step={0.01} onValueChange={([size]) => setCalib((p) => ({ ...p, size }))} />
          </div>
        </div>
      )}

      {/* review */}
      {phase === "review" && (
        <div className="space-y-2 animate-scale-in">
          {error && (
            <div className="flex items-start gap-2 rounded bg-destructive/10 p-2 text-xs text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Big detected-score summary */}
          <div className="rounded-xl border border-primary/40 bg-gradient-to-br from-primary/15 via-primary/5 to-transparent p-3">
            <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-muted-foreground">
              <span className="flex items-center gap-1"><Zap className="h-3 w-3 text-accent" /> Erkannt</span>
              <span>KI {(confidence * 100).toFixed(0)}%</span>
            </div>
            <div className="mt-1 flex items-end justify-between">
              <div className="flex flex-wrap gap-1.5">
                {detected.length === 0 && (
                  <span className="text-xs text-muted-foreground">Keine sicheren Treffer</span>
                )}
                {detected.map((d, i) => {
                  const label = d.baseValue === 0
                    ? "Miss"
                    : d.baseValue === 25
                      ? (d.multiplier === 2 ? "Bull 50" : "Bull 25")
                      : `${d.multiplier === 1 ? "" : d.multiplier === 2 ? "D" : "T"}${d.baseValue}`;
                  return (
                    <span
                      key={i}
                      className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-display ${
                        d.points === 0
                          ? "border-muted bg-muted/40 text-muted-foreground"
                          : "border-primary/50 bg-primary/15 text-primary"
                      }`}
                    >
                      <Target className="h-3 w-3 opacity-70" /> {label}
                      <span className="text-foreground/90">· {d.points}</span>
                    </span>
                  );
                })}
              </div>
              <div className="ml-3 shrink-0 text-right">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Summe</div>
                <div className="font-display text-3xl leading-none text-primary">{roundTotal}</div>
              </div>
            </div>
            {autoCommitIn !== null && (
              <div className="mt-2 flex items-center justify-between rounded-md bg-background/60 px-2 py-1 text-[11px]">
                <span className="text-muted-foreground">Auto-Übernahme in {autoCommitIn}s</span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-[11px]"
                  onClick={() => {
                    if (autoCommitTimerRef.current) window.clearInterval(autoCommitTimerRef.current);
                    autoCommitTimerRef.current = null;
                    pendingCommitRef.current = null;
                    setAutoCommitIn(null);
                    setStatus("Erkennung prüfen");
                  }}
                >
                  Stop
                </Button>
              </div>
            )}
          </div>

          <div className="text-center text-[11px] text-muted-foreground">
            Vorschlag prüfen, bei Bedarf anpassen, dann bestätigen
          </div>
          <div className="space-y-1.5">
            {detected.map((dart, i) => (
              <div key={i} className="flex items-center gap-2 rounded-lg bg-muted p-2">
                <span className="w-10 text-[10px] text-muted-foreground">Dart {i + 1}</span>
                <select
                  value={dart.multiplier}
                  onChange={(e) => adjustDart(i, "multiplier", Number(e.target.value))}
                  className="rounded border border-border bg-background px-1 py-1 text-xs"
                  disabled={dart.baseValue === 0 || dart.baseValue === 25}
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
                    <option key={v} value={v}>{v}</option>
                  ))}
                  <option value={25}>Bull (25/50)</option>
                </select>
                <span className="w-10 text-right font-display text-primary">{dart.points}</span>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setDetected((prev) => prev.filter((_, k) => k !== i))}>
                  <X className="h-3 w-3" />
                </Button>
              </div>
            ))}
            {detected.length < dartsRemaining && (
              <Button
                variant="outline"
                size="sm"
                className="w-full text-xs"
                onClick={() => setDetected((prev) => [...prev, { baseValue: 0, multiplier: 1, points: 0, confidence: 1 }])}
              >
                + Dart hinzufügen
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={rescan} className="flex-1 gap-1">
              <RotateCcw className="h-4 w-4" /> Neu scannen
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => commitRound(Array.from({ length: dartsRemaining }, () => ({ baseValue: 0, multiplier: 1 as 1, points: 0, confidence: 1 })))}
              className="flex-1 gap-1"
            >
              0 Punkte
            </Button>
            <Button size="sm" onClick={() => detected.length > 0 && commitRound(detected)} disabled={detected.length === 0} className="flex-1 gap-1">
              <Check className="h-4 w-4" /> Bestätigen
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};

export default LiveCamera;