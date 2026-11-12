import { useLanguage } from "@/contexts/LanguageContext";

/** Three dots for the darts already thrown in this visit, plus the dart/total counter. */
const VisitDartDots = ({ dartsThisRound, dartsThrown }: { dartsThisRound: number; dartsThrown: number }) => {
  const { t } = useLanguage();
  return (
    <div className="flex items-center justify-center gap-2">
      <div className="flex gap-1" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <span key={i} className={`h-2.5 w-2.5 rounded-full transition-colors ${i < dartsThisRound ? "bg-primary" : "bg-border"}`} />
        ))}
      </div>
      <p className="text-xs tabular-nums text-muted-foreground">
        {t("training.dartOfThree")} {dartsThisRound + 1} / 3 · {t("training.totalShort")} {dartsThrown}
      </p>
    </div>
  );
};

export default VisitDartDots;
