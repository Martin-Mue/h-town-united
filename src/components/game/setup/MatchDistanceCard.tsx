import { useLanguage } from "@/contexts/LanguageContext";
import { bestOfFromFirstTo, firstToFromBestOf } from "@/utils/playerLineup";
import NumberStepper from "./NumberStepper";

interface MatchDistanceCardProps {
  bestOfLegs: number;
  onBestOfLegsChange: (bestOf: number) => void;
  setsEnabled: boolean;
  bestOfSets: number;
  onBestOfSetsChange: (bestOf: number) => void;
  /** Tournament/league matches: the bracket fixed the distance. */
  locked: boolean;
}

// Same ranges the old pickers offered: legs best of 1…11, sets best of 1…9.
const MAX_FIRST_TO_LEGS = 6;
const MAX_FIRST_TO_SETS = 5;

interface DistanceRowProps {
  caption: string;
  unit: string;
  firstTo: number;
  max: number;
  onChange: (firstTo: number) => void;
  locked: boolean;
}

const DistanceRow = ({ caption, unit, firstTo, max, onChange, locked }: DistanceRowProps) => {
  const { t } = useLanguage();
  return (
    <div className="flex items-center gap-3">
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted-foreground">{caption}</p>
        <p className="truncate text-[17px] font-semibold">{t("stats.firstTo")} {firstTo} {unit}</p>
      </div>
      <NumberStepper
        value={firstTo}
        min={1}
        max={max}
        onChange={onChange}
        disabled={locked}
        decreaseLabel={`${t("game.decrease")}: ${unit}`}
        increaseLabel={`${t("game.increase")}: ${unit}`}
      />
    </div>
  );
};

/** "First to N Legs" with − / + (and a second row for the sets when sets mode is on). */
const MatchDistanceCard = ({ bestOfLegs, onBestOfLegsChange, setsEnabled, bestOfSets, onBestOfSetsChange, locked }: MatchDistanceCardProps) => {
  const { t } = useLanguage();
  return (
    <section className="space-y-3 rounded-2xl border border-border bg-card px-4 py-3">
      {setsEnabled && (
        <DistanceRow
          caption={t("game.setupDistance")}
          unit={t("game.setsWord")}
          firstTo={firstToFromBestOf(bestOfSets)}
          max={MAX_FIRST_TO_SETS}
          onChange={(n) => onBestOfSetsChange(bestOfFromFirstTo(n))}
          locked={locked}
        />
      )}
      <DistanceRow
        caption={setsEnabled ? t("game.legsPerSet") : t("game.setupDistance")}
        unit={t("game.legsWord")}
        firstTo={firstToFromBestOf(bestOfLegs)}
        max={MAX_FIRST_TO_LEGS}
        onChange={(n) => onBestOfLegsChange(bestOfFromFirstTo(n))}
        locked={locked}
      />
    </section>
  );
};

export default MatchDistanceCard;
