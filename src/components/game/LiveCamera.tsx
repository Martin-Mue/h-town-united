import { useEffect, useRef, useState, useCallback } from "react";
import { Camera, CameraOff, Loader2, AlertCircle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

/** A single dart detected by the AI vision pipeline. */
export interface DetectedDart {
  baseValue: number;
  multiplier: 1 | 2 | 3;
  points: number;
  confidence: number;
}

interface LiveCameraProps {
  /** Called for each *newly* detected dart since the previous frame. */
  onDartDetected: (dart: DetectedDart) => void;
  /** Called when the board transitions from N>0 darts to 0 darts (= darts removed). */
  onBoardCleared: () => void;
  /** Poll interval in ms (default 5000). */
  pollIntervalMs?: number;
  /** Externally controlled enabled flag; when false camera stops. */
  enabled: boolean;
  onClose: () => void;
}

/**
 * Live camera scoring overlay: continuously analyzes the dartboard via Gemini Vision,
 * automatically submits newly detected darts and advances the turn when the board is cleared.
 */
const LiveCamera = ({ onDartDetected, onBoardCleared, pollIntervalMs = 5000, enabled, onClose }: LiveCameraProps) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const intervalRef = useRef<number | null>(null);
  const prevCountRef = useRef(0);
  const analyzingRef = useRef(false);

  const [status, setStatus] = useState<"idle" | "starting" | "live" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [lastDarts, setLastDarts] = useState<DetectedDart[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [confidenceWarn, setConfidenceWarn] = useState(false);

  const stopCamera = useCallback(() => {
    if (intervalRef.current) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setStatus("idle");
    prevCountRef.current = 0;
  }, []);

  const captureAndAnalyze = useCallback(async () => {
    if (analyzingRef.current || !videoRef.current || !canvasRef.current) return;
    if (videoRef.current.readyState < 2) return;
    analyzingRef.current = true;
    setAnalyzing(true);
    try {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      // Downscale for faster upload
      const maxW = 800;
      const scale = Math.min(1, maxW / video.videoWidth);
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const imageBase64 = canvas.toDataURL("image/jpeg", 0.75);

      const { data, error: invokeErr } = await supabase.functions.invoke("analyze-dartboard", {
        body: { imageBase64 },
      });
      if (invokeErr) throw invokeErr;
      if (!data || data.error) {
        // Soft-error: e.g. "no darts detected" → just reset
        return;
      }

      const darts: DetectedDart[] = (data.darts || []).map((d: any) => ({
        baseValue: d.segment,
        multiplier: d.multiplier,
        points: d.points,
        confidence: d.confidence ?? 0.5,
      }));
      setLastDarts(darts);
      setConfidenceWarn(darts.some((d) => d.confidence < 0.6));

      const newCount = darts.length;
      const prevCount = prevCountRef.current;

      if (newCount > prevCount) {
        // New darts since last frame → emit the trailing diff
        const newOnes = darts.slice(prevCount);
        for (const dart of newOnes) {
          onDartDetected(dart);
        }
      } else if (newCount === 0 && prevCount > 0) {
        // Board cleared → advance turn
        onBoardCleared();
      }
      prevCountRef.current = newCount;
    } catch (err: any) {
      console.error("Live capture error:", err);
    } finally {
      analyzingRef.current = false;
      setAnalyzing(false);
    }
  }, [onDartDetected, onBoardCleared]);

  // Start/stop camera when enabled toggles
  useEffect(() => {
    if (!enabled) {
      stopCamera();
      return;
    }
    let cancelled = false;
    const start = async () => {
      setStatus("starting");
      setError(null);
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        setStatus("live");
        // Start polling
        intervalRef.current = window.setInterval(captureAndAnalyze, pollIntervalMs);
      } catch (err: any) {
        console.error("Camera error:", err);
        setError(err?.message || "Kamera-Zugriff verweigert");
        setStatus("error");
      }
    };
    start();
    return () => {
      cancelled = true;
      stopCamera();
    };
  }, [enabled, pollIntervalMs, captureAndAnalyze, stopCamera]);

  return (
    <div className="bg-card rounded-xl border border-primary/30 p-3 mb-3 glow-cyan">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Camera className="w-4 h-4 text-primary" />
          <span className="text-xs font-display uppercase">Live-Cam</span>
          {status === "live" && <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />}
          {analyzing && <Loader2 className="w-3 h-3 animate-spin text-primary" />}
        </div>
        <Button variant="ghost" size="sm" onClick={onClose} className="h-7 px-2">
          <CameraOff className="w-3.5 h-3.5" />
        </Button>
      </div>

      <div className="relative rounded-lg overflow-hidden bg-black aspect-video">
        <video ref={videoRef} className="w-full h-full object-cover" muted playsInline />
        <canvas ref={canvasRef} className="hidden" />
        {status === "starting" && (
          <div className="absolute inset-0 flex items-center justify-center text-white text-xs">
            <Loader2 className="w-4 h-4 animate-spin mr-2" /> Kamera startet...
          </div>
        )}
        {status === "error" && (
          <div className="absolute inset-0 flex items-center justify-center text-destructive text-xs p-2 text-center">
            <AlertCircle className="w-4 h-4 mr-1" /> {error}
          </div>
        )}
        {confidenceWarn && status === "live" && (
          <div className="absolute top-1 right-1 bg-destructive/90 text-destructive-foreground text-[10px] px-1.5 py-0.5 rounded flex items-center gap-1">
            <AlertCircle className="w-3 h-3" /> Niedrige Confidence
          </div>
        )}
      </div>

      {/* Last detected darts */}
      {lastDarts.length > 0 && (
        <div className="flex items-center gap-1 mt-2 flex-wrap">
          <span className="text-[10px] text-muted-foreground uppercase">Erkannt:</span>
          {lastDarts.map((d, i) => (
            <span
              key={i}
              className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${
                d.confidence >= 0.7
                  ? "bg-primary/15 text-primary"
                  : "bg-destructive/15 text-destructive"
              }`}
              title={`Confidence ${(d.confidence * 100).toFixed(0)}%`}
            >
              {d.multiplier === 3 ? "T" : d.multiplier === 2 ? "D" : ""}
              {d.baseValue === 25 && d.multiplier === 2 ? "Bull" : d.baseValue}
              {d.confidence >= 0.8 && <CheckCircle2 className="w-2.5 h-2.5 inline ml-0.5" />}
            </span>
          ))}
          <span className="text-[10px] text-muted-foreground ml-auto">
            Σ {lastDarts.reduce((s, d) => s + d.points, 0)}
          </span>
        </div>
      )}
      <p className="text-[10px] text-muted-foreground mt-1.5 text-center">
        Pfeile vom Board entfernen wechselt automatisch zum nächsten Spieler. Korrekturen via „Rückgängig".
      </p>
    </div>
  );
};

export default LiveCamera;