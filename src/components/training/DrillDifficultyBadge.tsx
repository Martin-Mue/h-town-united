import { useLanguage } from "@/contexts/LanguageContext";
import { DIFFICULTY_LABEL_KEY, type TrainingDrill } from "@/lib/trainingRecords";

const FILLED_BARS: Record<TrainingDrill["difficulty"], number> = { beginner: 1, intermediate: 2, pro: 3 };
const BAR_HEIGHTS = ["h-1.5", "h-2.5", "h-3.5"];

/** Difficulty as a 3-step bar meter plus its label — one neutral look instead of three colored
 *  pills, so the level reads the same in every club theme. */
const DrillDifficultyBadge = ({ difficulty }: { difficulty: TrainingDrill["difficulty"] }) => {
  const { t } = useLanguage();
  const filled = FILLED_BARS[difficulty] ?? 1;
  return (
    <span className="flex items-center gap-1.5">
      <span className="flex items-end gap-0.5" aria-hidden="true">
        {BAR_HEIGHTS.map((height, i) => (
          <span key={height} className={`w-1 rounded-sm ${height} ${i < filled ? "bg-primary" : "bg-border"}`} />
        ))}
      </span>
      {t(DIFFICULTY_LABEL_KEY[difficulty])}
    </span>
  );
};

export default DrillDifficultyBadge;
