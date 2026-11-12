import { ChevronRight, Clock } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import type { TrainingDrill } from "@/lib/trainingRecords";
import DrillDifficultyBadge from "./DrillDifficultyBadge";

/** One drill in the Training list: icon tile, name, two-line description, difficulty + duration. */
const DrillListCard = ({ drill, onSelect }: { drill: TrainingDrill; onSelect: () => void }) => {
  const { t } = useLanguage();
  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex w-full items-center gap-3 rounded-2xl border border-border bg-card p-3.5 text-left transition-colors hover:border-primary/40"
    >
      <span aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-muted text-primary">
        <drill.icon className="h-6 w-6" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-semibold">{drill.name}</span>
        <span className="line-clamp-2 text-[13px] text-muted-foreground">{t(drill.descriptionKey)}</span>
        <span className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <DrillDifficultyBadge difficulty={drill.difficulty} />
          <span className="flex items-center gap-1">
            <Clock className="h-3.5 w-3.5" aria-hidden="true" /> {drill.durationMinutes} {t("training.minutesSuffix")}
          </span>
        </span>
      </span>
      <ChevronRight className="h-[18px] w-[18px] shrink-0 text-muted-foreground" aria-hidden="true" />
    </button>
  );
};

export default DrillListCard;
