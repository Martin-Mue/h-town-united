import { Mic, MicOff, PhoneOff, Headphones } from "lucide-react";
import { DartLoaderIcon as Loader2 } from "@/components/icons/DartIcons";
import { useLanguage } from "@/contexts/LanguageContext";
import { useVoiceChat } from "@/hooks/useVoiceChat";

interface VoiceChatControlProps {
  matchId: string;
  userId: string | undefined;
  myName: string;
  opponentName: string;
}

/** Voice chat chip for the online-match bar: join, mute, leave, plus who is connected. */
const VoiceChatControl = ({ matchId, userId, myName, opponentName }: VoiceChatControlProps) => {
  const { t } = useLanguage();
  const voice = useVoiceChat(matchId, userId, myName);
  const chip = "flex h-7 items-center gap-1 rounded-full border px-2 leading-none";

  if (voice.status === "off" || voice.status === "error") {
    return (
      <button
        type="button"
        onClick={() => void voice.join()}
        className={`${chip} ${voice.status === "error" ? "border-destructive/50 text-destructive" : "border-border"}`}
        title={voice.status === "error" ? (voice.error === "mic" ? t("voice.micDenied") : t("voice.failed")) : t("voice.start")}
      >
        <Headphones className="h-3.5 w-3.5" aria-hidden="true" />
        <span>{voice.status === "error" ? (voice.error === "mic" ? t("voice.micDenied") : t("voice.failed")) : t("voice.start")}</span>
      </button>
    );
  }

  const connectedPeer = voice.peers.find((p) => p.connected);
  const label = voice.status === "connected"
    ? (connectedPeer?.name ?? t("voice.connected"))
    : voice.status === "waiting" ? t("voice.waiting").replace("{name}", opponentName) : t("voice.connecting");

  return (
    <span className={`${chip} border-primary/40`}>
      {voice.status === "connected"
        ? <span className="h-2 w-2 rounded-full bg-secondary" aria-hidden="true" />
        : <Loader2 className="h-3 w-3 animate-spin" />}
      <span className="max-w-[9rem] truncate">{label}</span>
      <button type="button" onClick={voice.toggleMute} aria-label={voice.muted ? t("voice.unmute") : t("voice.mute")} title={voice.muted ? t("voice.unmute") : t("voice.mute")} className="flex h-7 w-7 items-center justify-center">
        {voice.muted ? <MicOff className="h-3.5 w-3.5 text-destructive" /> : <Mic className="h-3.5 w-3.5" />}
      </button>
      <button type="button" onClick={voice.leave} aria-label={t("voice.leave")} title={t("voice.leave")} className="flex h-7 w-7 items-center justify-center text-destructive">
        <PhoneOff className="h-3.5 w-3.5" />
      </button>
    </span>
  );
};

export default VoiceChatControl;
