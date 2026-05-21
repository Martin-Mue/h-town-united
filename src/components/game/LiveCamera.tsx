import { useEffect, useRef, useState } from "react";
import { Camera, Loader2, X, ScanLine, Check, RotateCcw, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

export interface DetectedDart {
  baseValue: number;
  multiplier: 1 | 2 | 3;
  points: number;
  confidence: number;
}

interface LiveCameraProps {
  /** Called once when the user confirms the scanned darts. */
  onRoundCommit: (darts: DetectedDart[]) => void;
  enabled: boolean;
  onClose: () => void;
}

type Phase = "starting" | "live" | "scanning" | "review" | "error";

/**
 * Photo-based dart scoring helper.
 *  - Live camera preview with a circular guide overlay for the dartboard.
 *  - User wirft 3 Darts, drückt "Runde scannen": ein einziges Foto wird an die
 *    AI gesendet. Vorschlag wird angezeigt, Nutzer bestätigt oder verwirft.
 *  - Keine Dauer-Polls, keine Timeouts, ~1 AI-Call pro Runde.
 */
const LiveCamera = ({ onRoundCommit, enabled, onClose }: LiveCameraProps) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [phase, setPhase] = useState<Phase>("starting");
  const [error, setError] = useState<string | null>(null);
  const [detected, setDetected] = useState<DetectedDart[]>([]);
  const [snapshot, setSnapshot] = useState<string | null>(null);

  // Start camera on mount
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
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        setPhase("live");
      } catch (e) {
        console.error("Camera error:", e);
        setError("Kamerazugriff nicht möglich. Bitte Berechtigung erteilen.");
        setPhase("error");
      }
    })();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [enabled]);

  const captureFrame = (): string | null => {
    const v = videoRef.current;
    const c = canvasRef.current;
    if (!v || !c || !v.videoWidth) return null;
    // Crop to a centred square around the circular guide (where the board should be)
    const size = Math.min(v.videoWidth, v.videoHeight);
    c.width = size;
    c.height = size;
    const ctx = c.getContext("2d");
    if (!ctx) return null;
    const sx = (v.videoWidth - size) / 2;
    const sy = (v.videoHeight - size) / 2;
    ctx.drawImage(v, sx, sy, size, size, 0, 0, size, size);
    return c.toDataURL("image/jpeg", 0.82);
  };

  const handleScan = async () => {
    const img = captureFrame();
    if (!img) {
      setError("Kamerabild nicht verfügbar.");
      return;
    }
    setSnapshot(img);
    setPhase("scanning");
    setError(null);
    try {
      const { data, error: fnErr } = await supabase.functions.invoke("analyze-dartboard", {
        body: { imageBase64: img },
      });
      if (fnErr) throw fnErr;
      if (data?.error) throw new Error(data.error);
      const darts: DetectedDart[] = Array.isArray(data?.darts)
        ? data.darts.slice(0, 3).map((d: any) => ({
            baseValue: Number(d.segment) || 0,
            multiplier: ([1, 2, 3].includes(Number(d.multiplier)) ? Number(d.multiplier) : 1) as 1 | 2 | 3,
            points: Number(d.points) || 0,
            confidence: Number(d.confidence) || 0,
          }))
        : [];
      setDetected(darts);
      setPhase("review");
    } catch (e: any) {
      console.error("Scan error:", e);
      setError(e?.message || "Erkennung fehlgeschlagen. Bitte erneut versuchen oder manuell eintragen.");
      setPhase("review");
      setDetected([]);
    }
  };

  const adjustDart = (idx: number, field: "baseValue" | "multiplier", value: number) => {
    setDetected((prev) => {
      const copy = [...prev];
      const d = { ...copy[idx], [field]: value };
      const pts = d.baseValue === 25 ? (d.multiplier === 2 ? 50 : 25) : d.baseValue * d.multiplier;
      copy[idx] = { ...d, points: pts };
      return copy;
    });
  };

  const addEmptyDart = () => {
    if (detected.length >= 3) return;
    setDetected((p) => [...p, { baseValue: 0, multiplier: 1, points: 0, confidence: 1 }]);
  };

  const removeDart = (idx: number) => {
    setDetected((p) => p.filter((_, i) => i !== idx));
  };

  const confirmRound = () => {
    if (detected.length === 0) return;
    onRoundCommit(detected);
    setDetected([]);
    setSnapshot(null);
    setPhase("live");
  };

  const retake = () => {
    setDetected([]);
    setSnapshot(null);
    setError(null);
    setPhase("live");
  };

  const roundTotal = detected.reduce((s, d) => s + d.points, 0);

  return (
    <div className="bg-card rounded-xl border border-border p-3 mb-3 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Camera className="w-4 h-4 text-primary" />
          <span className="font-display text-sm uppercase tracking-wider">Kamera-Scan</span>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} className="h-7 w-7">
          <X className="w-4 h-4" />
        </Button>
      </div>

      <div className="relative w-full aspect-square max-w-md mx-auto bg-black rounded-lg overflow-hidden">
        {phase === "review" && snapshot ? (
          <img src={snapshot} alt="Letzter Scan" className="w-full h-full object-cover" />
        ) : (
          <video ref={videoRef} playsInline muted className="w-full h-full object-cover" />
        )}
        <canvas ref={canvasRef} className="hidden" />

        {/* Circular dartboard guide */}
        {(phase === "live" || phase === "scanning") && (
          <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
            <div className="relative" style={{ width: "85%", aspectRatio: "1 / 1" }}>
              <div className="absolute inset-0 rounded-full border-2 border-primary/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
              <div className="absolute inset-[35%] rounded-full border border-primary/40" />
              <div className="absolute inset-[48%] rounded-full bg-primary/60" />
            </div>
          </div>
        )}

        {phase === "starting" && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/70 text-white text-sm">
            <Loader2 className="w-5 h-5 animate-spin mr-2" /> Kamera startet…
          </div>
        )}
        {phase === "scanning" && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-white text-sm">
            <Loader2 className="w-5 h-5 animate-spin mr-2" /> Erkenne Darts…
          </div>
        )}
        {phase === "error" && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/80 text-white text-xs px-4 text-center">
            {error}
          </div>
        )}
      </div>

      {phase === "live" && (
        <>
          <p className="text-xs text-muted-foreground text-center">
            Board mittig im Kreis platzieren · 3 Darts werfen · dann scannen
          </p>
          <Button onClick={handleScan} className="w-full gap-2 font-display uppercase">
            <ScanLine className="w-4 h-4" /> Runde scannen
          </Button>
        </>
      )}

      {phase === "review" && (
        <div className="space-y-2">
          {error && (
            <div className="flex items-start gap-2 text-xs text-destructive bg-destructive/10 rounded p-2">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}
          <div className="text-xs text-muted-foreground text-center">
            Vorschlag prüfen, ggf. anpassen, dann bestätigen.
          </div>
          <div className="space-y-1.5">
            {detected.map((d, i) => (
              <div key={i} className="flex items-center gap-2 bg-muted rounded-lg p-2">
                <span className="text-xs text-muted-foreground w-12">Dart {i + 1}</span>
                <select
                  value={d.multiplier}
                  onChange={(e) => adjustDart(i, "multiplier", Number(e.target.value))}
                  className="bg-background border border-border rounded px-1 py-1 text-xs"
                  disabled={d.baseValue === 0 || d.baseValue === 25}
                >
                  <option value={1}>S</option>
                  <option value={2}>D</option>
                  <option value={3}>T</option>
                </select>
                <select
                  value={d.baseValue}
                  onChange={(e) => adjustDart(i, "baseValue", Number(e.target.value))}
                  className="bg-background border border-border rounded px-1 py-1 text-xs flex-1"
                >
                  <option value={0}>Miss</option>
                  {Array.from({ length: 20 }, (_, n) => n + 1).map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                  <option value={25}>Bull (25/50)</option>
                </select>
                <span className="font-display text-primary w-10 text-right">{d.points}</span>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => removeDart(i)}>
                  <X className="w-3 h-3" />
                </Button>
              </div>
            ))}
            {detected.length < 3 && (
              <Button variant="outline" size="sm" className="w-full text-xs" onClick={addEmptyDart}>
                + Dart hinzufügen
              </Button>
            )}
          </div>
          <div className="text-center font-display text-2xl text-primary">
            {roundTotal} Punkte
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={retake} className="flex-1 gap-1">
              <RotateCcw className="w-4 h-4" /> Neu scannen
            </Button>
            <Button onClick={confirmRound} disabled={detected.length === 0} className="flex-1 gap-1">
              <Check className="w-4 h-4" /> Bestätigen
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};

export default LiveCamera;