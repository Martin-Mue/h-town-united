import { useEffect, useRef, useState } from "react";
import { AlertCircle, Camera, Check, Loader2, RotateCcw, ScanLine, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";

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

type Phase = "starting" | "live" | "scanning" | "review" | "error";

interface CalibrationState {
  x: number;
  y: number;
  size: number;
  emptySignature: number[] | null;
}

const CALIBRATION_STORAGE_KEY = "dartcam-calibration-v2";
const AUTO_COMMIT_STORAGE_KEY = "dartcam-auto-commit-v1";
const SAMPLE_GRID_SIZE = 28;
const MOTION_THRESHOLD = 0.022;
const OCCUPIED_THRESHOLD = 0.05;
const CLEAR_THRESHOLD = 0.026;
const AUTO_COMMIT_CONFIDENCE = 0.78;
const DEFAULT_CALIBRATION: CalibrationState = { x: 0.5, y: 0.5, size: 0.82, emptySignature: null };

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const loadCalibration = (): CalibrationState => {
  if (typeof window === "undefined") return DEFAULT_CALIBRATION;
  try {
    const raw = window.localStorage.getItem(CALIBRATION_STORAGE_KEY);
    if (!raw) return DEFAULT_CALIBRATION;
    const parsed = JSON.parse(raw);
    return {
      x: clamp(Number(parsed?.x) || DEFAULT_CALIBRATION.x, 0.2, 0.8),
      y: clamp(Number(parsed?.y) || DEFAULT_CALIBRATION.y, 0.2, 0.8),
      size: clamp(Number(parsed?.size) || DEFAULT_CALIBRATION.size, 0.55, 0.95),
      emptySignature: Array.isArray(parsed?.emptySignature)
        ? parsed.emptySignature.map((entry: unknown) => Number(entry) || 0)
        : null,
    };
  } catch {
    return DEFAULT_CALIBRATION;
  }
};

const loadAutoCommit = () => {
  if (typeof window === "undefined") return true;
  return window.localStorage.getItem(AUTO_COMMIT_STORAGE_KEY) !== "false";
};

const saveCalibration = (calibration: CalibrationState) => {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(CALIBRATION_STORAGE_KEY, JSON.stringify(calibration));
};

const LiveCamera = ({ onRoundCommit, enabled, onClose, dartsRemaining = 3, playerName }: LiveCameraProps) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const previousSignatureRef = useRef<number[] | null>(null);
  const stableFramesRef = useRef(0);
  const occupiedFramesRef = useRef(0);
  const clearFramesRef = useRef(0);
  const waitingForClearRef = useRef(false);
  const scanLockRef = useRef(false);

  const [phase, setPhase] = useState<Phase>("starting");
  const [error, setError] = useState<string | null>(null);
  const [detected, setDetected] = useState<DetectedDart[]>([]);
  const [snapshot, setSnapshot] = useState<string | null>(null);
  const [statusText, setStatusText] = useState("Kamera startet …");
  const [motionLevel, setMotionLevel] = useState(0);
  const [boardDelta, setBoardDelta] = useState(0);
  const [overallConfidence, setOverallConfidence] = useState(0);
  const [autoCommitEnabled, setAutoCommitEnabled] = useState(loadAutoCommit);
  const [calibration, setCalibration] = useState<CalibrationState>(() => loadCalibration());

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    (async () => {
      try {
        setPhase("starting");
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => undefined);
        }
        setStatusText(calibration.emptySignature ? "Board kalibriert · warte auf Würfe" : "Bitte das leere Board einmal kalibrieren");
        setPhase("live");
      } catch (err) {
        console.error("Camera error:", err);
        setError("Kamerazugriff nicht möglich. Bitte Berechtigung erteilen.");
        setPhase("error");
      }
    })();

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, [enabled, calibration.emptySignature]);

  useEffect(() => {
    saveCalibration(calibration);
  }, [calibration]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(AUTO_COMMIT_STORAGE_KEY, autoCommitEnabled ? "true" : "false");
  }, [autoCommitEnabled]);

  const resetLoopState = () => {
    previousSignatureRef.current = null;
    stableFramesRef.current = 0;
    occupiedFramesRef.current = 0;
    clearFramesRef.current = 0;
    scanLockRef.current = false;
  };

  const getCropRect = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) return null;
    const minSide = Math.min(video.videoWidth, video.videoHeight);
    const cropSide = clamp(minSide * calibration.size, minSide * 0.55, minSide * 0.96);
    const centerX = video.videoWidth * calibration.x;
    const centerY = video.videoHeight * calibration.y;
    const sx = clamp(centerX - cropSide / 2, 0, video.videoWidth - cropSide);
    const sy = clamp(centerY - cropSide / 2, 0, video.videoHeight - cropSide);
    return { sx, sy, cropSide };
  };

  const drawBoardToCanvas = (targetSize: number, circularMask = true) => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const crop = getCropRect();
    if (!video || !canvas || !crop) return null;

    canvas.width = targetSize;
    canvas.height = targetSize;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    ctx.clearRect(0, 0, targetSize, targetSize);
    if (circularMask) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(targetSize / 2, targetSize / 2, targetSize / 2 - 2, 0, Math.PI * 2);
      ctx.clip();
    }
    ctx.drawImage(video, crop.sx, crop.sy, crop.cropSide, crop.cropSide, 0, 0, targetSize, targetSize);
    if (circularMask) ctx.restore();
    return canvas;
  };

  const createFrameSignature = () => {
    const canvas = drawBoardToCanvas(SAMPLE_GRID_SIZE, true);
    if (!canvas) return null;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    const { data } = ctx.getImageData(0, 0, SAMPLE_GRID_SIZE, SAMPLE_GRID_SIZE);
    const radius = SAMPLE_GRID_SIZE / 2;
    const signature: number[] = [];

    for (let y = 0; y < SAMPLE_GRID_SIZE; y += 1) {
      for (let x = 0; x < SAMPLE_GRID_SIZE; x += 1) {
        const dx = x + 0.5 - radius;
        const dy = y + 0.5 - radius;
        if (dx * dx + dy * dy > (radius - 1.5) ** 2) continue;
        const idx = (y * SAMPLE_GRID_SIZE + x) * 4;
        const luma = (data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114) / 255;
        signature.push(luma);
      }
    }

    return signature;
  };

  const signatureDiff = (a: number[] | null, b: number[] | null) => {
    if (!a || !b || a.length !== b.length) return 1;
    let sum = 0;
    for (let i = 0; i < a.length; i += 1) sum += Math.abs(a[i] - b[i]);
    return sum / a.length;
  };

  const captureFrame = () => {
    const canvas = drawBoardToCanvas(768, true);
    return canvas ? canvas.toDataURL("image/jpeg", 0.72) : null;
  };

  const commitRound = (darts: DetectedDart[]) => {
    onRoundCommit(darts.slice(0, dartsRemaining));
    setDetected([]);
    setSnapshot(null);
    setError(null);
    setPhase("live");
    waitingForClearRef.current = true;
    resetLoopState();
    setStatusText("Runde übernommen · bitte Darts ziehen");
  };

  const scanBoard = async (automatic = false) => {
    const image = captureFrame();
    if (!image) {
      setError("Kamerabild nicht verfügbar.");
      return;
    }

    setSnapshot(image);
    setPhase("scanning");
    setError(null);
    setStatusText(automatic ? "Automatischer Scan läuft …" : "Scan läuft …");

    try {
      const { data, error: functionError } = await supabase.functions.invoke("analyze-dartboard", {
        body: { imageBase64: image },
      });

      if (functionError) throw functionError;
      if (data?.error) throw new Error(data.error);

      const darts: DetectedDart[] = Array.isArray(data?.darts)
        ? data.darts.slice(0, dartsRemaining).map((dart: any) => ({
            baseValue: Number(dart.segment) || 0,
            multiplier: ([1, 2, 3].includes(Number(dart.multiplier)) ? Number(dart.multiplier) : 1) as 1 | 2 | 3,
            points: Number(dart.points) || 0,
            confidence: Number(dart.confidence) || 0,
          }))
        : [];

      const confidence = Number(data?.overallConfidence) || 0;
      setOverallConfidence(confidence);

      if (automatic && autoCommitEnabled && darts.length > 0 && confidence >= AUTO_COMMIT_CONFIDENCE) {
        setStatusText(`Auto übernommen · ${darts.reduce((sum, dart) => sum + dart.points, 0)} Punkte`);
        commitRound(darts);
        return;
      }

      setDetected(darts);
      setPhase("review");
      setStatusText(darts.length > 0 ? "Erkennung prüfen" : "Keine sicheren Treffer erkannt");
    } catch (err: any) {
      console.error("Scan error:", err);
      setDetected([]);
      setOverallConfidence(0);
      setError(err?.message || "Erkennung fehlgeschlagen. Bitte erneut versuchen oder manuell eintragen.");
      setPhase("review");
      setStatusText("Scan unsicher · bitte prüfen");
    } finally {
      scanLockRef.current = false;
    }
  };

  useEffect(() => {
    if (!enabled || phase !== "live") return;
    const interval = window.setInterval(() => {
      const signature = createFrameSignature();
      if (!signature) return;

      const motion = signatureDiff(previousSignatureRef.current, signature);
      previousSignatureRef.current = signature;
      setMotionLevel(motion);
      stableFramesRef.current = motion < MOTION_THRESHOLD ? stableFramesRef.current + 1 : 0;

      if (!calibration.emptySignature) {
        setBoardDelta(0);
        setStatusText("Leeres Board einmal kalibrieren, dann läuft die Automatik");
        return;
      }

      const delta = signatureDiff(calibration.emptySignature, signature);
      const boardOccupied = delta > OCCUPIED_THRESHOLD;
      const boardClear = delta < CLEAR_THRESHOLD;
      setBoardDelta(delta);

      if (waitingForClearRef.current) {
        clearFramesRef.current = boardClear && stableFramesRef.current >= 2 ? clearFramesRef.current + 1 : 0;
        setStatusText(boardClear ? "Board wird frei erkannt …" : "Warte bis die Darts gezogen sind …");
        if (clearFramesRef.current >= 3) {
          waitingForClearRef.current = false;
          resetLoopState();
          setStatusText("Board frei · bereit für den nächsten Spieler");
        }
        return;
      }

      if (boardOccupied) {
        occupiedFramesRef.current += 1;
        if (stableFramesRef.current >= 3 && occupiedFramesRef.current >= 3 && !scanLockRef.current) {
          scanLockRef.current = true;
          void scanBoard(true);
        } else {
          setStatusText(stableFramesRef.current >= 2 ? "Würfe erkannt · warte auf ruhiges Bild …" : "Bewegung erkannt …");
        }
      } else {
        occupiedFramesRef.current = 0;
        setStatusText(stableFramesRef.current >= 2 ? "Board frei · Automatik wartet auf Würfe" : "Board ausrichten …");
      }
    }, 350);

    return () => window.clearInterval(interval);
  }, [enabled, phase, calibration, autoCommitEnabled, dartsRemaining]);

  const adjustDart = (index: number, field: "baseValue" | "multiplier", value: number) => {
    setDetected((prev) => {
      const next = [...prev];
      const dart = { ...next[index], [field]: value };
      const points = dart.baseValue === 25 ? (dart.multiplier === 2 ? 50 : 25) : dart.baseValue * dart.multiplier;
      next[index] = { ...dart, points };
      return next;
    });
  };

  const addEmptyDart = () => {
    if (detected.length >= dartsRemaining) return;
    setDetected((prev) => [...prev, { baseValue: 0, multiplier: 1, points: 0, confidence: 1 }]);
  };

  const roundTotal = detected.reduce((sum, dart) => sum + dart.points, 0);

  return (
    <div className="mb-3 space-y-3 rounded-xl border border-border bg-card p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Camera className="h-4 w-4 text-primary" />
          <span className="font-display text-sm uppercase tracking-wider">Kamera-Scan</span>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} className="h-7 w-7">
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="relative mx-auto aspect-square w-full max-w-md overflow-hidden rounded-lg border border-border bg-muted">
        {phase === "review" && snapshot ? (
          <img src={snapshot} alt="Letzter Scan" className="h-full w-full object-cover" />
        ) : (
          <video ref={videoRef} playsInline muted className="h-full w-full object-cover" />
        )}
        <canvas ref={canvasRef} className="hidden" />

        {(phase === "live" || phase === "scanning") && (
          <div className="pointer-events-none absolute inset-0">
            <div
              className="absolute rounded-full border-2 border-primary"
              style={{
                width: `${calibration.size * 100}%`,
                height: `${calibration.size * 100}%`,
                left: `${calibration.x * 100}%`,
                top: `${calibration.y * 100}%`,
                transform: "translate(-50%, -50%)",
              }}
            >
              <div className="absolute inset-[35%] rounded-full border border-primary/40" />
              <div className="absolute inset-[48%] rounded-full bg-primary/70" />
            </div>
          </div>
        )}

        {phase === "starting" && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/80 text-sm text-foreground">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Kamera startet…
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

      <div className="space-y-3 rounded-lg border border-border bg-muted/40 p-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-foreground">{playerName ? `${playerName} · Kamera-Automatik` : "Kamera-Automatik"}</p>
            <p className="text-xs text-muted-foreground">{statusText}</p>
          </div>
          <div className="space-y-1 text-right text-[10px] uppercase tracking-wider text-muted-foreground">
            <div>Bewegung {(motionLevel * 100).toFixed(0)}%</div>
            <div>Board {(boardDelta * 100).toFixed(0)}%</div>
          </div>
        </div>

        <div className="flex items-center justify-between rounded-md border border-border bg-background/70 px-3 py-2">
          <div className="space-y-0.5">
            <Label htmlFor="auto-commit" className="text-sm">Auto bestätigen</Label>
            <p className="text-xs text-muted-foreground">Nur bei hoher Sicherheit automatisch übernehmen</p>
          </div>
          <Switch id="auto-commit" checked={autoCommitEnabled} onCheckedChange={setAutoCommitEnabled} />
        </div>

        <div className="grid gap-2">
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[11px] text-muted-foreground"><span>Horizontal</span><span>{Math.round(calibration.x * 100)}%</span></div>
            <Slider value={[calibration.x]} min={0.2} max={0.8} step={0.01} onValueChange={([x]) => setCalibration((prev) => ({ ...prev, x }))} />
          </div>
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[11px] text-muted-foreground"><span>Vertikal</span><span>{Math.round(calibration.y * 100)}%</span></div>
            <Slider value={[calibration.y]} min={0.2} max={0.8} step={0.01} onValueChange={([y]) => setCalibration((prev) => ({ ...prev, y }))} />
          </div>
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[11px] text-muted-foreground"><span>Größe</span><span>{Math.round(calibration.size * 100)}%</span></div>
            <Slider value={[calibration.size]} min={0.55} max={0.95} step={0.01} onValueChange={([size]) => setCalibration((prev) => ({ ...prev, size }))} />
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant={calibration.emptySignature ? "outline" : "default"} onClick={() => {
            const signature = createFrameSignature();
            if (!signature) {
              setError("Leeres Board konnte gerade nicht gelesen werden. Bitte erneut versuchen.");
              return;
            }
            setCalibration((prev) => ({ ...prev, emptySignature: signature }));
            waitingForClearRef.current = false;
            resetLoopState();
            setError(null);
            setStatusText("Leeres Board gespeichert · Automatik ist bereit");
          }} className="gap-2">
            <Sparkles className="h-4 w-4" /> Leeres Board kalibrieren
          </Button>
          {calibration.emptySignature && (
            <Button variant="ghost" onClick={() => setCalibration((prev) => ({ ...prev, emptySignature: null }))} className="gap-2">
              <RotateCcw className="h-4 w-4" /> Kalibrierung löschen
            </Button>
          )}
        </div>
      </div>

      {phase === "live" && (
        <>
          <p className="text-center text-xs text-muted-foreground">
            Kreis auf das Board legen · leeres Board einmal speichern · danach scannt die Kamera nach Ruhephase automatisch
          </p>
          <Button onClick={() => scanBoard(false)} className="w-full gap-2 font-display uppercase">
            <ScanLine className="h-4 w-4" /> Runde scannen
          </Button>
        </>
      )}

      {phase === "review" && (
        <div className="space-y-2">
          {error && (
            <div className="flex items-start gap-2 rounded p-2 text-xs text-destructive bg-destructive/10">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}
          <div className="text-center text-xs text-muted-foreground">Vorschlag prüfen, ggf. anpassen, dann bestätigen.</div>
          <div className="text-center text-xs text-muted-foreground">KI-Sicherheit: {(overallConfidence * 100).toFixed(0)}%</div>
          <div className="space-y-1.5">
            {detected.map((dart, index) => (
              <div key={index} className="flex items-center gap-2 rounded-lg bg-muted p-2">
                <span className="w-12 text-xs text-muted-foreground">Dart {index + 1}</span>
                <select
                  value={dart.multiplier}
                  onChange={(e) => adjustDart(index, "multiplier", Number(e.target.value))}
                  className="rounded border border-border bg-background px-1 py-1 text-xs"
                  disabled={dart.baseValue === 0 || dart.baseValue === 25}
                >
                  <option value={1}>S</option>
                  <option value={2}>D</option>
                  <option value={3}>T</option>
                </select>
                <select
                  value={dart.baseValue}
                  onChange={(e) => adjustDart(index, "baseValue", Number(e.target.value))}
                  className="flex-1 rounded border border-border bg-background px-1 py-1 text-xs"
                >
                  <option value={0}>Miss</option>
                  {Array.from({ length: 20 }, (_, i) => i + 1).map((value) => (
                    <option key={value} value={value}>{value}</option>
                  ))}
                  <option value={25}>Bull (25/50)</option>
                </select>
                <span className="w-10 text-right font-display text-primary">{dart.points}</span>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setDetected((prev) => prev.filter((_, idx) => idx !== index))}>
                  <X className="h-3 w-3" />
                </Button>
              </div>
            ))}
            {detected.length < dartsRemaining && (
              <Button variant="outline" size="sm" className="w-full text-xs" onClick={() => setDetected((prev) => [...prev, { baseValue: 0, multiplier: 1, points: 0, confidence: 1 }])}>
                + Dart hinzufügen
              </Button>
            )}
          </div>
          <div className="text-center font-display text-2xl text-primary">{roundTotal} Punkte</div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => { setDetected([]); setError(null); setPhase("live"); resetLoopState(); setStatusText("Warte auf ruhiges Board …"); }} className="flex-1 gap-1">
              <RotateCcw className="h-4 w-4" /> Neu scannen
            </Button>
            <Button variant="outline" onClick={() => commitRound(Array.from({ length: dartsRemaining }, () => ({ baseValue: 0, multiplier: 1 as 1, points: 0, confidence: 1 })))} className="flex-1 gap-1">
              0 Punkte
            </Button>
            <Button onClick={() => detected.length > 0 && commitRound(detected)} disabled={detected.length === 0} className="flex-1 gap-1">
              <Check className="h-4 w-4" /> Bestätigen
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};

export default LiveCamera;
