import { useState } from "react";
import { Volume2, VolumeX, Mic, MicOff, Keyboard, Sparkles } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { SectionCard } from "@/components/stats/StatPrimitives";
import { useLanguage } from "@/contexts/LanguageContext";
import { getCallerVoice, setCallerVoice, type CallerVoice } from "@/utils/speech";

// Same localStorage keys Game.tsx reads when a match screen mounts (INPUT_MODE_PREF_KEY,
// SOUND_PREF_KEY, WALKON_PREF_KEY there) — these are start-up defaults, so a change here simply
// shows up in the next game; nothing needs to be shared live with a running match.
const INPUT_MODE_KEY = "dart-input-mode";
const SOUND_KEY = "dart-sound-enabled";
const WALKON_KEY = "dart-walkon-enabled";

type InputMode = "single" | "quick" | "total";
const INPUT_MODES: { value: InputMode; labelKey: string }[] = [
  { value: "single", labelKey: "game.modeSingle" },
  { value: "quick", labelKey: "game.modeQuick" },
  { value: "total", labelKey: "game.modeTotal" },
];
const VOICES: { value: CallerVoice; labelKey: string }[] = [
  { value: "male", labelKey: "game.voiceMale" },
  { value: "female", labelKey: "game.voiceFemale" },
  { value: "yoda", labelKey: "game.voiceYoda" },
  { value: "off", labelKey: "game.voiceOff" },
];

const readStored = (key: string): string | null => {
  try { return window.localStorage.getItem(key); } catch { return null; }
};
const writeStored = (key: string, value: string) => {
  try { window.localStorage.setItem(key, value); } catch { /* storage unavailable: default just won't stick */ }
};

/** Settings → "Spiel-Standards": the per-device defaults a new match starts with (how darts are
 *  entered, sound, caller voice, walk-on intro). They used to live only inside the match setup
 *  screen; here they can be set once, up front, without starting a game. */
const GameDefaultsSection = () => {
  const { t } = useLanguage();
  const [inputMode, setInputMode] = useState<InputMode>(() => {
    const raw = readStored(INPUT_MODE_KEY);
    return raw === "quick" || raw === "total" ? raw : "single";
  });
  const [soundOn, setSoundOn] = useState(() => readStored(SOUND_KEY) !== "false");
  const [walkonOn, setWalkonOn] = useState(() => readStored(WALKON_KEY) !== "false");
  const [voice, setVoice] = useState<CallerVoice>(() => getCallerVoice());

  return (
    <div className="space-y-3">
      <SectionCard>
        <div className="flex items-center gap-3 mb-3">
          <Keyboard className="w-5 h-5 text-muted-foreground shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-medium">{t("settings.inputModeDefault")}</p>
            <p className="text-xs text-muted-foreground">{t("settings.inputModeDefaultDesc")}</p>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-1 rounded-xl bg-muted/50 p-1">
          {INPUT_MODES.map((m) => (
            <button
              key={m.value}
              onClick={() => { setInputMode(m.value); writeStored(INPUT_MODE_KEY, m.value); }}
              className={`py-2 rounded-lg text-xs font-bold uppercase tracking-wide transition-all ${inputMode === m.value ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
            >
              {t(m.labelKey)}
            </button>
          ))}
        </div>
      </SectionCard>

      <SectionCard className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          {soundOn ? <Volume2 className="w-5 h-5 text-muted-foreground shrink-0" /> : <VolumeX className="w-5 h-5 text-muted-foreground shrink-0" />}
          <div className="min-w-0">
            <p className="text-sm font-medium">{t("game.soundHaptics")}</p>
            <p className="text-xs text-muted-foreground">{t("settings.soundDefaultDesc")}</p>
          </div>
        </div>
        <Switch
          checked={soundOn}
          onCheckedChange={(on) => { setSoundOn(on); writeStored(SOUND_KEY, JSON.stringify(on)); }}
          aria-label={t("game.soundHaptics")}
        />
      </SectionCard>

      <SectionCard>
        <div className="flex items-center gap-3 mb-3">
          {voice === "off" ? <MicOff className="w-5 h-5 text-muted-foreground shrink-0" /> : <Mic className="w-5 h-5 text-muted-foreground shrink-0" />}
          <div className="min-w-0">
            <p className="text-sm font-medium">{t("game.callerVoice")}</p>
            <p className="text-xs text-muted-foreground">{t("settings.callerVoiceDefaultDesc")}</p>
          </div>
        </div>
        <div className="grid grid-cols-4 gap-1 rounded-xl bg-muted/50 p-1">
          {VOICES.map((opt) => (
            <button
              key={opt.value}
              onClick={() => { setVoice(opt.value); setCallerVoice(opt.value); }}
              className={`py-2 rounded-lg text-xs font-semibold transition-all ${voice === opt.value ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
            >
              {t(opt.labelKey)}
            </button>
          ))}
        </div>
      </SectionCard>

      <SectionCard className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <Sparkles className="w-5 h-5 text-muted-foreground shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-medium">{t("game.walkonIntro")}</p>
            <p className="text-xs text-muted-foreground">{t("game.walkonIntroDesc")}</p>
          </div>
        </div>
        <Switch
          checked={walkonOn}
          onCheckedChange={(on) => { setWalkonOn(on); writeStored(WALKON_KEY, JSON.stringify(on)); }}
          aria-label={t("game.walkonIntro")}
        />
      </SectionCard>
    </div>
  );
};

export default GameDefaultsSection;
