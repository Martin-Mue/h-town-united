import { Mic, MicOff, Volume2, VolumeX } from "lucide-react";
import type { CallerVoice } from "@/utils/speech";
import { useLanguage } from "@/contexts/LanguageContext";
import SettingToggleRow from "./SettingToggleRow";

interface AtmosphereOptionsProps {
  soundEnabled: boolean;
  onSoundChange: (on: boolean) => void;
  speechEnabled: boolean;
  callerVoice: CallerVoice;
  onCallerVoiceChange: (voice: CallerVoice) => void;
  warmupEnabled: boolean;
  onWarmupChange: (on: boolean) => void;
  warmupSeconds: number;
  onWarmupSecondsChange: (seconds: number) => void;
  walkonEnabled: boolean;
  onWalkonChange: (on: boolean) => void;
}

const VOICES: { value: CallerVoice; labelKey: string }[] = [
  { value: "male", labelKey: "game.voiceMale" },
  { value: "female", labelKey: "game.voiceFemale" },
  { value: "yoda", labelKey: "game.voiceYoda" },
  { value: "off", labelKey: "game.voiceOff" },
];

/** Sound, caller voice, warm-up and walk-on intro. */
const AtmosphereOptions = ({
  soundEnabled, onSoundChange, speechEnabled, callerVoice, onCallerVoiceChange,
  warmupEnabled, onWarmupChange, warmupSeconds, onWarmupSecondsChange, walkonEnabled, onWalkonChange,
}: AtmosphereOptionsProps) => {
  const { t } = useLanguage();
  const pick = (chosen: boolean) => `min-h-[44px] rounded-lg text-xs font-semibold transition-colors ${chosen ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:text-foreground"}`;
  return (
    <>
      <SettingToggleRow
        id="sound-mode"
        label={<span className="flex items-center gap-2">{soundEnabled ? <Volume2 className="h-4 w-4 text-primary" /> : <VolumeX className="h-4 w-4 text-muted-foreground" />}{t("game.soundHaptics")}</span>}
        checked={soundEnabled}
        onCheckedChange={onSoundChange}
      />
      <div className="space-y-2 rounded-xl border border-border bg-muted/40 px-4 py-3">
        <p className="flex items-center gap-2 text-sm">
          {speechEnabled ? <Mic className="h-4 w-4 text-primary" /> : <MicOff className="h-4 w-4 text-muted-foreground" />}
          {t("game.callerVoice")}
        </p>
        <div className="grid grid-cols-2 gap-1.5 min-[400px]:grid-cols-4">
          {VOICES.map((voice) => (
            <button key={voice.value} type="button" aria-pressed={callerVoice === voice.value} onClick={() => onCallerVoiceChange(voice.value)} className={pick(callerVoice === voice.value)}>
              {t(voice.labelKey)}
            </button>
          ))}
        </div>
      </div>
      <SettingToggleRow id="warmup-mode" label={t("game.warmupBeforeMatch")} description={t("game.warmupBeforeMatchDesc")} checked={warmupEnabled} onCheckedChange={onWarmupChange}>
        {warmupEnabled && (
          <div className="grid grid-cols-4 gap-1.5 pt-1">
            {[30, 60, 90, 120].map((s) => (
              <button key={s} type="button" aria-pressed={warmupSeconds === s} onClick={() => onWarmupSecondsChange(s)} className={`${pick(warmupSeconds === s)} font-display`}>
                {s}s
              </button>
            ))}
          </div>
        )}
      </SettingToggleRow>
      <SettingToggleRow id="walkon-mode" label={t("game.walkonIntro")} description={t("game.walkonIntroDesc")} checked={walkonEnabled} onCheckedChange={onWalkonChange} />
    </>
  );
};

export default AtmosphereOptions;
