import { useEffect, useRef } from "react";
import { Download, Sparkles, Trophy, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { DetectedDart } from "@/components/game/LiveCamera";

export interface ThrowClipPopup {
  url: string;
  mime: string;
  total: number;
  is180: boolean;
  isCheckout: boolean;
  isTonPlus: boolean;
  playerName: string;
  darts: DetectedDart[];
  ts: number;
}

const dartLabel = (d: DetectedDart) => {
  if (d.baseValue === 0) return "Miss";
  if (d.baseValue === 25) return d.multiplier === 2 ? "Bull 50" : "25";
  const prefix = d.multiplier === 2 ? "D" : d.multiplier === 3 ? "T" : "";
  return `${prefix}${d.baseValue}`;
};

interface Props {
  popup: ThrowClipPopup | null;
  onClose: () => void;
}

const ThrowClipDialog = ({ popup, onClose }: Props) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (popup && videoRef.current) {
      videoRef.current.currentTime = 0;
      videoRef.current.play().catch(() => undefined);
    }
  }, [popup]);

  if (!popup) return null;
  const isHighlight = popup.is180 || popup.isCheckout || popup.isTonPlus;
  const ext = popup.mime.includes("mp4") ? "mp4" : "webm";
  const stamp = new Date(popup.ts).toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const tag = popup.is180 ? "180" : popup.isCheckout ? "checkout" : popup.isTonPlus ? "ton-plus" : `${popup.total}`;
  const filename = `dart-${popup.playerName.replace(/\s+/g, "_")}-${tag}-${stamp}.${ext}`;

  return (
    <Dialog open={!!popup} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-md p-0 overflow-hidden border-primary/30 bg-card">
        <DialogHeader className="p-4 pb-2">
          <DialogTitle className="flex items-center gap-2 font-display uppercase">
            {isHighlight ? (
              <Sparkles className="h-5 w-5 text-accent" />
            ) : (
              <Trophy className="h-5 w-5 text-primary" />
            )}
            <span>Wurf-Clip · {popup.playerName}</span>
          </DialogTitle>
        </DialogHeader>

        {isHighlight && (
          <div className="mx-4 -mt-1 mb-2 rounded-lg border border-accent/40 bg-accent/10 px-3 py-1.5 text-center text-xs font-display uppercase tracking-wider text-accent">
            {popup.is180 ? "🎯 180!" : popup.isCheckout ? "🏆 Checkout!" : `🔥 ${popup.total} Punkte`}
          </div>
        )}

        <div className="bg-background">
          <video
            ref={videoRef}
            src={popup.url}
            controls
            playsInline
            className="w-full max-h-[55vh] bg-black"
          />
        </div>

        <div className="px-4 py-3 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex flex-wrap gap-1.5">
              {popup.darts.map((d, i) => (
                <span
                  key={i}
                  className={`rounded-md border px-2 py-0.5 text-xs font-display ${
                    d.points === 0
                      ? "border-muted bg-muted/40 text-muted-foreground"
                      : "border-primary/40 bg-primary/15 text-primary"
                  }`}
                >
                  {dartLabel(d)} · {d.points}
                </span>
              ))}
            </div>
            <div className="text-right shrink-0">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Summe</div>
              <div className="font-display text-2xl leading-none text-primary">{popup.total}</div>
            </div>
          </div>

          <div className="flex gap-2">
            <Button asChild className="flex-1 gap-2 font-display uppercase">
              <a href={popup.url} download={filename}>
                <Download className="h-4 w-4" /> Speichern
              </a>
            </Button>
            <Button variant="outline" onClick={onClose} className="gap-1">
              <X className="h-4 w-4" /> Schließen
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground text-center">
            Tipp: 180er und Checkouts werden automatisch als Highlight markiert.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ThrowClipDialog;