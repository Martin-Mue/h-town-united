import type { BotLevel } from "@/types/game";
import { BOT_PROFILES } from "@/pages/Game";
import { useLanguage } from "@/contexts/LanguageContext";

const BOT_LEVELS: BotLevel[] = ["easy", "medium", "hard", "elite", "legendary"];

interface BotLevelPickerProps {
  level: BotLevel;
  ghostTarget: "off" | "own-pb";
  /** Ghost needs X01 without teams. */
  ghostAllowed: boolean;
  onPickLevel: (level: BotLevel) => void;
  onPickGhost: () => void;
}

/** The five bot strengths (with their average) plus the Ghost challenge, three per row. */
const BotLevelPicker = ({ level, ghostTarget, ghostAllowed, onPickLevel, onPickGhost }: BotLevelPickerProps) => {
  const { t } = useLanguage();
  const tile = "min-h-[44px] rounded-lg px-2 py-1.5 text-center transition-colors";
  return (
    <div className="grid grid-cols-3 gap-1.5">
      {BOT_LEVELS.map((lvl) => {
        const chosen = level === lvl && ghostTarget === "off";
        return (
          <button key={lvl} type="button" aria-pressed={chosen} onClick={() => onPickLevel(lvl)}
            className={`${tile} ${chosen ? "bg-secondary/25 text-secondary" : "bg-background text-muted-foreground"}`}>
            <span className="block truncate font-display text-[11px] uppercase">{t(BOT_PROFILES[lvl].nameKey)}</span>
            <span className="block text-[10px] opacity-70">Ø {BOT_PROFILES[lvl].average}</span>
          </button>
        );
      })}
      {ghostAllowed && (
        <button type="button" aria-pressed={ghostTarget !== "off"} onClick={onPickGhost} title={t("game.ghostTooltip")}
          className={`${tile} ${ghostTarget !== "off" ? "bg-accent/25 text-accent" : "bg-background text-muted-foreground"}`}>
          <span className="block truncate font-display text-[11px] uppercase">👻 {t("game.ghost")}</span>
          <span className="block text-[10px] opacity-70">{t("game.ghostChallenge")}</span>
        </button>
      )}
    </div>
  );
};

export default BotLevelPicker;
