import { useLanguage } from "@/contexts/LanguageContext";
import SettingToggleRow from "./SettingToggleRow";

interface MatchStartOptionsProps {
  /** Two human contenders (two players, or two teams). */
  bullOffPossible: boolean;
  bullOffEnabled: boolean;
  onBullOffChange: (on: boolean) => void;
  /** The starter choices: one per player, or one per team in team mode. */
  starterChoices: { index: number; label: string; chosen: boolean }[];
  onPickStarter: (index: number) => void;
}

/** Bull-off before leg 1, or who throws first. */
const MatchStartOptions = ({ bullOffPossible, bullOffEnabled, onBullOffChange, starterChoices, onPickStarter }: MatchStartOptionsProps) => {
  const { t } = useLanguage();
  return (
    <>
      <SettingToggleRow
        id="bulloff-mode"
        label={t("game.bullOffEnabledLabel")}
        description={bullOffPossible ? t("game.bullOffEnabledDesc") : t("game.bullOffNeedTwo")}
        checked={bullOffEnabled && bullOffPossible}
        disabled={!bullOffPossible}
        onCheckedChange={onBullOffChange}
      />
      <div className={`space-y-2 rounded-xl border border-border bg-muted/40 px-4 py-3 ${bullOffEnabled ? "pointer-events-none opacity-50" : ""}`}>
        <p className="text-sm">{t("game.whoStarts")}</p>
        <p className="text-xs text-muted-foreground">{bullOffEnabled ? t("game.bullOffDecidesStarter") : t("game.whoStartsDesc")}</p>
        <div className="grid grid-cols-2 gap-1.5">
          {starterChoices.map((choice) => (
            <button
              key={choice.index}
              type="button"
              aria-pressed={choice.chosen}
              onClick={() => onPickStarter(choice.index)}
              className={`min-h-[44px] truncate rounded-xl border px-3 text-sm font-semibold transition-colors ${choice.chosen ? "border-primary bg-primary/15 text-primary" : "border-border bg-background text-muted-foreground"}`}
            >
              {choice.label}
            </button>
          ))}
        </div>
      </div>
    </>
  );
};

export default MatchStartOptions;
