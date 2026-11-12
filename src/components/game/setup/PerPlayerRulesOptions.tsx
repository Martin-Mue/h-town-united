import { Switch } from "@/components/ui/switch";
import { useLanguage } from "@/contexts/LanguageContext";

interface PerPlayerRulesOptionsProps {
  numPlayers: number;
  teamMode: boolean;
  slotLabel: (slot: number) => string;
  playerDoubleIn: boolean[];
  onDoubleInChange: (slot: number, on: boolean) => void;
  playerDoubleOut: boolean[];
  onDoubleOutChange: (slot: number, on: boolean) => void;
  playerHandicap: number[];
  onHandicapChange: (slot: number, points: number) => void;
  startScore: number;
}

/** X01 only: double-in, double-out and handicap for each player separately (handicap not in team mode). */
const PerPlayerRulesOptions = ({
  numPlayers, teamMode, slotLabel, playerDoubleIn, onDoubleInChange, playerDoubleOut, onDoubleOutChange,
  playerHandicap, onHandicapChange, startScore,
}: PerPlayerRulesOptionsProps) => {
  const { t } = useLanguage();
  return (
    <ul className="space-y-2">
      {Array.from({ length: numPlayers }, (_, slot) => (
        <li key={slot} className="space-y-2 rounded-xl border border-border bg-muted/40 px-4 py-3">
          <p className="truncate text-sm font-semibold">{slotLabel(slot)}</p>
          <div className="flex min-h-[32px] items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">{playerDoubleIn[slot] ? t("game.doubleIn") : t("game.straightIn")}</span>
            <Switch checked={!!playerDoubleIn[slot]} aria-label={`${slotLabel(slot)}: ${t("game.doubleIn")}`} onCheckedChange={(v) => onDoubleInChange(slot, v)} />
          </div>
          <div className="flex min-h-[32px] items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">{playerDoubleOut[slot] ? t("game.doubleOut") : t("game.singleOut")}</span>
            <Switch checked={!!playerDoubleOut[slot]} aria-label={`${slotLabel(slot)}: ${t("game.doubleOut")}`} onCheckedChange={(v) => onDoubleOutChange(slot, v)} />
          </div>
          {!teamMode && (
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground" title={t("game.handicapTooltip")}>{t("game.handicap")}</span>
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  step={10}
                  value={playerHandicap[slot] || 0}
                  aria-label={`${slotLabel(slot)}: ${t("game.handicap")}`}
                  onChange={(e) => onHandicapChange(slot, Math.max(0, parseInt(e.target.value, 10) || 0))}
                  className="h-10 w-20 rounded-lg border border-border bg-background px-2 text-right text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
                <span className="text-[11px] text-muted-foreground">{t("game.points")}</span>
              </div>
            </div>
          )}
          {!teamMode && playerHandicap[slot] > 0 && (
            <p className="text-right text-[11px] text-muted-foreground">
              {t("game.startsAt")} {Math.max(2, startScore - playerHandicap[slot])} {t("game.insteadOf")} {startScore}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
};

export default PerPlayerRulesOptions;
