import { useState, useRef, useCallback } from "react";
import { Camera, CameraOff, Target, AlertCircle, Loader2, CheckCircle, XCircle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";

interface DetectedDart {
  segment: number;
  multiplier: number;
  points: number;
  confidence: number;
}

interface AnalysisResult {
  darts: DetectedDart[];
  totalScore: number;
  overallConfidence: number;
  dartsDetected: number;
  error?: string;
}

const CameraPage = () => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const { toast } = useToast();
  const { session } = useAuth();

  const startCamera = useCallback(async () => {
    try {
      setError(null);
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        setIsStreaming(true);
      }
    } catch {
      setError("Kamerazugriff verweigert. Bitte erlaube den Zugriff in den Geräteeinstellungen.");
    }
  }, []);

  const stopCamera = useCallback(() => {
    if (videoRef.current?.srcObject) {
      const tracks = (videoRef.current.srcObject as MediaStream).getTracks();
      tracks.forEach((t) => t.stop());
      videoRef.current.srcObject = null;
      setIsStreaming(false);
    }
  }, []);

  const captureAndAnalyze = useCallback(async () => {
    if (!videoRef.current || !canvasRef.current) return;
    setAnalyzing(true);
    setResult(null);

    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    const imageBase64 = canvas.toDataURL("image/jpeg", 0.85);
    setCapturedImage(imageBase64);

    try {
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/analyze-dartboard`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            Authorization: `Bearer ${session?.access_token}`,
          },
          body: JSON.stringify({ imageBase64 }),
        }
      );

      if (response.status === 429) {
        toast({ title: "Rate Limit", description: "Zu viele Anfragen. Bitte warte kurz.", variant: "destructive" });
        setAnalyzing(false);
        return;
      }
      if (response.status === 402) {
        toast({ title: "Credits aufgebraucht", description: "Bitte lade deine KI-Credits auf.", variant: "destructive" });
        setAnalyzing(false);
        return;
      }

      const data: AnalysisResult = await response.json();
      setResult(data);

      if (data.error) {
        toast({ title: "Erkennung", description: data.error, variant: "destructive" });
      } else if (data.dartsDetected > 0) {
        // Haptic feedback
        if (navigator.vibrate) navigator.vibrate(100);
        toast({ title: `${data.dartsDetected} Darts erkannt!`, description: `Score: ${data.totalScore}` });
      }
    } catch (err: any) {
      console.error("Analysis error:", err);
      toast({ title: "Fehler", description: "Analyse fehlgeschlagen.", variant: "destructive" });
    } finally {
      setAnalyzing(false);
    }
  }, [session, toast]);

  const resetAnalysis = () => {
    setResult(null);
    setCapturedImage(null);
  };

  const formatDart = (d: DetectedDart) => {
    if (d.segment === 25 && d.multiplier === 2) return "Bullseye";
    if (d.segment === 25) return "Bull";
    const prefix = d.multiplier === 3 ? "T" : d.multiplier === 2 ? "D" : "";
    return `${prefix}${d.segment}`;
  };

  const confidenceColor = (c: number) => {
    if (c >= 0.8) return "text-secondary";
    if (c >= 0.5) return "text-accent";
    return "text-destructive";
  };

  const confidenceLabel = (c: number) => {
    if (c >= 0.8) return "Hoch";
    if (c >= 0.5) return "Mittel";
    return "Niedrig";
  };

  return (
    <div className="container py-6 animate-slide-up max-w-lg mx-auto">
      <h2 className="text-2xl font-display uppercase mb-4 text-center flex items-center justify-center gap-2">
        <Camera className="w-6 h-6 text-primary" />
        Kamera Scoring
      </h2>

      {/* Camera / captured image view */}
      <div className="bg-card border border-border rounded-xl overflow-hidden mb-4 aspect-video relative">
        <video ref={videoRef} autoPlay playsInline muted className={`w-full h-full object-cover ${capturedImage ? "hidden" : ""}`} />
        <canvas ref={canvasRef} className="hidden" />
        {capturedImage && (
          <img src={capturedImage} alt="Captured" className="w-full h-full object-cover" />
        )}
        {!isStreaming && !capturedImage && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground">
            <Target className="w-16 h-16 mb-3 opacity-30" />
            <p className="text-sm">Kamera starten um Darts zu erkennen</p>
          </div>
        )}
        {isStreaming && !capturedImage && (
          <div className="absolute top-3 left-3 flex items-center gap-1.5 bg-primary/80 text-primary-foreground px-2 py-1 rounded-full text-xs font-medium">
            <div className="w-2 h-2 rounded-full bg-primary-foreground animate-pulse" />
            LIVE
          </div>
        )}
        {analyzing && (
          <div className="absolute inset-0 bg-background/70 flex flex-col items-center justify-center">
            <Loader2 className="w-10 h-10 animate-spin text-primary mb-2" />
            <p className="text-sm text-primary font-display">KI analysiert Board...</p>
          </div>
        )}
      </div>

      {error && (
        <div className="flex items-center gap-2 bg-destructive/10 text-destructive rounded-lg p-3 mb-4 text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Results */}
      {result && !result.error && result.dartsDetected > 0 && (
        <div className="bg-card border border-primary/30 rounded-xl p-4 mb-4 glow-cyan animate-scale-in">
          <div className="text-center mb-3">
            <p className="text-5xl font-display text-primary">{result.totalScore}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {result.dartsDetected} Dart{result.dartsDetected > 1 ? "s" : ""} erkannt
            </p>
          </div>

          {/* Confidence indicator */}
          <div className="flex items-center justify-center gap-2 mb-3">
            <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  result.overallConfidence >= 0.8 ? "bg-secondary" :
                  result.overallConfidence >= 0.5 ? "bg-accent" : "bg-destructive"
                }`}
                style={{ width: `${result.overallConfidence * 100}%` }}
              />
            </div>
            <span className={`text-xs font-medium whitespace-nowrap ${confidenceColor(result.overallConfidence)}`}>
              {confidenceLabel(result.overallConfidence)} ({Math.round(result.overallConfidence * 100)}%)
            </span>
          </div>

          {/* Individual darts */}
          <div className="space-y-2">
            {result.darts.map((d, i) => (
              <div key={i} className="flex items-center justify-between bg-muted/50 rounded-lg px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Dart {i + 1}</span>
                  <span className={`font-display text-lg ${
                    d.multiplier === 3 ? "text-destructive" :
                    d.multiplier === 2 ? "text-secondary" :
                    d.segment === 25 ? "text-accent" : "text-foreground"
                  }`}>
                    {formatDart(d)}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-display text-lg text-primary">{d.points}</span>
                  <span className={`text-xs ${confidenceColor(d.confidence)}`}>
                    {Math.round(d.confidence * 100)}%
                  </span>
                </div>
              </div>
            ))}
          </div>

          <Button onClick={resetAnalysis} variant="outline" className="w-full mt-3 gap-1">
            <RotateCcw className="w-4 h-4" /> Nächste Aufnahme
          </Button>
        </div>
      )}

      {result && result.error && (
        <div className="bg-card border border-destructive/30 rounded-xl p-4 mb-4 text-center">
          <XCircle className="w-8 h-8 text-destructive mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">{result.error}</p>
          <Button onClick={resetAnalysis} variant="outline" className="mt-3 gap-1" size="sm">
            <RotateCcw className="w-4 h-4" /> Erneut versuchen
          </Button>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex gap-2">
        <Button
          onClick={isStreaming ? stopCamera : startCamera}
          className="flex-1 font-display uppercase"
          variant={isStreaming ? "destructive" : "default"}
        >
          {isStreaming ? <><CameraOff className="w-4 h-4 mr-2" /> Stop</> : <><Camera className="w-4 h-4 mr-2" /> Kamera</>}
        </Button>
        {isStreaming && !capturedImage && (
          <Button
            onClick={captureAndAnalyze}
            disabled={analyzing}
            className="flex-1 font-display uppercase bg-secondary hover:bg-secondary/90 text-secondary-foreground"
          >
            {analyzing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Target className="w-4 h-4 mr-2" />}
            Erkennen
          </Button>
        )}
      </div>

      {/* Instructions */}
      <div className="mt-6 bg-card border border-border rounded-xl p-4">
        <h3 className="font-display uppercase text-sm mb-2 text-accent">📸 So funktioniert's</h3>
        <ol className="text-sm text-muted-foreground space-y-1.5 list-decimal list-inside">
          <li>Kamera starten und auf das Dartboard richten</li>
          <li>Alle 3 Darts werfen</li>
          <li>„Erkennen" drücken – die KI analysiert das Bild</li>
          <li>Score wird automatisch erkannt und angezeigt</li>
        </ol>
        <p className="text-xs text-muted-foreground mt-3 border-t border-border pt-3">
          💡 Tipp: Gute Beleuchtung und ein gerader Blick auf das Board verbessern die Erkennung erheblich.
        </p>
      </div>
    </div>
  );
};

export default CameraPage;
