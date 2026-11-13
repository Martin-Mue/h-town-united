import type { GameMode } from "@/types/game";
import { useLanguage } from "@/contexts/LanguageContext";
import SetupSectionLabel from "./SetupSectionLabel";
import ChoiceChip from "./ChoiceChip";
import { CUSTOM_START_PRESETS, MIN_CUSTOM_START, MAX_CUSTOM_START } from "@/utils/customStart";

interface GameModePickerProps {
  mode: GameMode;
  onModeChange: (mode: GameMode) => void;
  customStartScore: number;
  onCustomStartScoreChange: (score: number) => void;
  /** Tournament matches: the bracket fixed the mode. */
  locked: boolean;
}

/** Four big mode tiles (301 · 501 · Cricket · Custom); Custom adds the start-value field below. */
const GameModePicker = ({ mode, onModeChange, customStartScore, onCustomStartScoreChange, locked }: GameModePickerProps) => {
  const { t } = useLanguage();
  const modes: { value: GameMode; label: string; numeric: boolean }[] = [
    { value: "301", label: "301", numeric: true },
    { value: "501", label: "501", numeric: true },
    { value: "cricket", label: "Cricket", numeric: false },
    { value: "custom", label: t("game.custom"), numeric: false },
  ];
  return (
    <section className="space-y-2" aria-labelledby="setup-mode-label">
      <SetupSectionLabel id="setup-mode-label">{t("game.gameMode")}</SetupSectionLabel>
      <div className="grid grid-cols-4 gap-2">
        {modes.map((m) => (
          <ChoiceChip
            key={m.value}
            selected={mode === m.value}
            disabled={locked}
            onClick={() => onModeChange(m.value)}
            className={`h-[60px] rounded-2xl px-1 font-display font-bold ${m.numeric ? "text-2xl" : "truncate text-lg"}`}
          >
            {m.label}
          </ChoiceChip>
        ))}
      </div>
      {mode === "custom" && (
        <div className="grid grid-cols-4 gap-2">
          {CUSTOM_START_PRESETS.map((score) => (
            <ChoiceChip
              key={score}
              selected={customStartScore === score}
              disabled={locked}
              onClick={() => onCustomStartScoreChange(score)}
              className="h-11 rounded-xl font-display text-lg font-bold tabular-nums"
            >
              {score}
            </ChoiceChip>
          ))}
        </div>
      )}
      {mode === "custom" && (
        <label className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-card px-4 py-2">
          <span className="text-sm text-muted-foreground">{t("game.startValue")}</span>
          <input
            type="number"
            inputMode="numeric"
            value={customStartScore}
            min={MIN_CUSTOM_START}
            max={MAX_CUSTOM_START}
            disabled={locked}
            onChange={(e) => onCustomStartScoreChange(parseInt(e.target.value) || 0)}
            className="h-11 w-28 rounded-xl border border-border bg-muted px-3 text-right font-display text-xl font-bold text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </label>
      )}
    </section>
  );
};

export default GameModePicker;
