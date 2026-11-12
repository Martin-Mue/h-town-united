import { useState } from "react";
import { Volume2, VolumeX, Mic, MicOff, Keyboard, Sparkles } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { useLanguage } from "@/contexts/LanguageContext";
import { getCallerVoice, setCallerVoice, type CallerVoice } from "@/utils/speech";
import SettingsSection from "@/components/settings/SettingsSection";
import SettingsRow from "@/components/settings/SettingsRow";
import SegmentedControl from "@/components/settings/SegmentedControl";

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
    <SettingsSection>
      <SettingsRow icon={Keyboard} label={t("settings.inputModeDefault")} description={t("settings.inputModeDefaultDesc")}>
        <SegmentedControl
          ariaLabel={t("settings.inputModeDefault")}
          options={INPUT_MODES.map((m) => ({ value: m.value, label: t(m.labelKey) }))}
          value={inputMode}
          onChange={(mode) => { setInputMode(mode); writeStored(INPUT_MODE_KEY, mode); }}
          columnsClassName="grid-cols-3"
          surfaceClassName="bg-background"
        />
      </SettingsRow>

      <SettingsRow
        icon={soundOn ? Volume2 : VolumeX}
        label={t("game.soundHaptics")}
        description={t("settings.soundDefaultDesc")}
        control={
          <Switch
            checked={soundOn}
            onCheckedChange={(on) => { setSoundOn(on); writeStored(SOUND_KEY, JSON.stringify(on)); }}
            aria-label={t("game.soundHaptics")}
          />
        }
      />

      <SettingsRow icon={voice === "off" ? MicOff : Mic} label={t("game.callerVoice")} description={t("settings.callerVoiceDefaultDesc")}>
        <SegmentedControl
          ariaLabel={t("game.callerVoice")}
          options={VOICES.map((opt) => ({ value: opt.value, label: t(opt.labelKey) }))}
          value={voice}
          onChange={(next) => { setVoice(next); setCallerVoice(next); }}
          columnsClassName="grid-cols-2 min-[400px]:grid-cols-4"
          surfaceClassName="bg-background"
        />
      </SettingsRow>

      <SettingsRow
        icon={Sparkles}
        label={t("game.walkonIntro")}
        description={t("game.walkonIntroDesc")}
        control={
          <Switch
            checked={walkonOn}
            onCheckedChange={(on) => { setWalkonOn(on); writeStored(WALKON_KEY, JSON.stringify(on)); }}
            aria-label={t("game.walkonIntro")}
          />
        }
      />
    </SettingsSection>
  );
};

export default GameDefaultsSection;
