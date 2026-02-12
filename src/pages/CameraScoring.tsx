import { useState, useRef, useCallback } from "react";
import { Camera, CameraOff, Target, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

const CameraPage = () => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    } catch (err) {
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

  return (
    <div className="container py-6 animate-slide-up max-w-lg mx-auto">
      <h2 className="text-2xl font-display uppercase mb-4 text-center">Kamera Scoring</h2>

      <div className="bg-card border border-border rounded-xl overflow-hidden mb-4 aspect-video relative">
        <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
        {!isStreaming && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground">
            <Target className="w-16 h-16 mb-3 opacity-30" />
            <p className="text-sm">Kamera starten um Darts zu erkennen</p>
          </div>
        )}
        {isStreaming && (
          <div className="absolute top-3 left-3 flex items-center gap-1.5 bg-primary/80 text-primary-foreground px-2 py-1 rounded-full text-xs font-medium">
            <div className="w-2 h-2 rounded-full bg-primary-foreground animate-pulse-glow" />
            LIVE
          </div>
        )}
      </div>

      {error && (
        <div className="flex items-center gap-2 bg-destructive/10 text-destructive rounded-lg p-3 mb-4 text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      <Button onClick={isStreaming ? stopCamera : startCamera} className="w-full font-display uppercase" variant={isStreaming ? "destructive" : "default"}>
        {isStreaming ? <><CameraOff className="w-4 h-4 mr-2" /> Kamera stoppen</> : <><Camera className="w-4 h-4 mr-2" /> Kamera starten</>}
      </Button>

      <div className="mt-6 bg-card border border-border rounded-xl p-4">
        <h3 className="font-display uppercase text-sm mb-2 text-accent">🚧 In Entwicklung</h3>
        <p className="text-sm text-muted-foreground">
          Die automatische Dart-Erkennung per Kamera wird in einem zukünftigen Update verfügbar sein. 
          Aktuell können Scores manuell im Spiel-Tab eingetragen werden.
        </p>
      </div>
    </div>
  );
};

export default CameraPage;
