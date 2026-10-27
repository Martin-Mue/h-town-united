import { useEffect, useRef, useState } from "react";
import { Video, VideoOff, Maximize2, Minimize2, AlertTriangle } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import type { BoardFeed } from "@/hooks/useBoardVideo";

interface TileProps {
  feed: BoardFeed;
  name: string;
  expanded: boolean;
  onToggle: () => void;
}

/** One remote board feed. `playsInline` + `muted` are what let Safari/iOS start the picture
 *  without a fullscreen takeover or an extra tap; the stream carries no audio anyway. */
const FeedTile = ({ feed, name, expanded, onToggle }: TileProps) => {
  const { t } = useLanguage();
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    if (video.srcObject !== feed.stream) video.srcObject = feed.stream;
    void video.play().catch(() => undefined);
  }, [feed.stream]);

  return (
    <div className={`relative overflow-hidden rounded-xl border border-border bg-black shadow-elevation-sm ${expanded ? "w-64" : "w-28"}`}>
      <video ref={ref} autoPlay muted playsInline className="block aspect-[4/3] w-full object-cover" />
      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/70 to-transparent px-1.5 pb-1 pt-4 text-[10px] text-white">
        <span className="truncate">{name}</span>
        <button type="button" onClick={onToggle} aria-label={expanded ? t("game.boardVideoShrink") : t("game.boardVideoEnlarge")} className="shrink-0 pl-1">
          {expanded ? <Minimize2 className="h-3 w-3" /> : <Maximize2 className="h-3 w-3" />}
        </button>
      </div>
      {feed.state !== "connected" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/70 px-2 text-center text-[10px] text-white">
          {feed.state === "failed" ? <><AlertTriangle className="h-4 w-4 text-accent" /> {t("game.boardVideoFailed")}</> : t("game.boardVideoConnecting")}
        </div>
      )}
    </div>
  );
};

interface Props {
  supported: boolean;
  sharing: boolean;
  error: string | null;
  feeds: BoardFeed[];
  nameOf: (userId: string) => string;
  onStart: () => void;
  onStop: () => void;
}

/** Floating stack of other players' board feeds (top-right, under the online bar) plus the
 *  share toggle. Hidden entirely on browsers without WebRTC/getUserMedia. */
const BoardVideoPanel = ({ supported, sharing, error, feeds, nameOf, onStart, onStop }: Props) => {
  const { t } = useLanguage();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  if (!supported) return null;

  return (
    <div className="pointer-events-none fixed right-2 top-28 z-40 flex flex-col items-end gap-1.5">
      <button
        type="button"
        onClick={sharing ? onStop : onStart}
        className={`pointer-events-auto flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] shadow-elevation-sm backdrop-blur ${sharing ? "border-destructive/50 bg-destructive/10 text-destructive" : "border-border bg-card/95 text-muted-foreground"}`}
      >
        {sharing ? <><span className="h-2 w-2 animate-pulse rounded-full bg-destructive" /> <VideoOff className="h-3.5 w-3.5" /> {t("game.boardVideoStop")}</> : <><Video className="h-3.5 w-3.5" /> {t("game.boardVideoShare")}</>}
      </button>
      {error && (
        <p className="pointer-events-auto max-w-[14rem] rounded-lg border border-destructive/40 bg-card/95 px-2 py-1 text-[10px] text-destructive">
          {error === "NotAllowedError" ? t("game.boardVideoDenied") : t("game.boardVideoError")}
        </p>
      )}
      {feeds.map((f) => (
        <div key={f.userId} className="pointer-events-auto">
          <FeedTile feed={f} name={nameOf(f.userId)} expanded={expandedId === f.userId} onToggle={() => setExpandedId((cur) => (cur === f.userId ? null : f.userId))} />
        </div>
      ))}
    </div>
  );
};

export default BoardVideoPanel;
