import { TrendingDown, TrendingUp, Minus } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { LOCALE_BY_LANGUAGE } from "@/i18n/translations";
import type { PlayDayAverage, PreviousPeriodKind } from "@/utils/statsHeadline";
import AveragePerPlayDayChart from "@/components/stats/AveragePerPlayDayChart";

const DELTA_LABEL_KEY: Record<PreviousPeriodKind, string> = {
  week: "stats.headDeltaVsWeek",
  month: "stats.headDeltaVsMonth",
  season: "stats.headDeltaVsSeason",
};

/** Change against the previous period, e.g. "+0,9 zur Vorwoche" — green up, red down, with an
 *  arrow so the direction does not depend on color alone. */
const AverageChangePill = ({ change, previousKind }: { change: number | null; previousKind: PreviousPeriodKind }) => {
  const { t, language } = useLanguage();
  if (change === null) {
    return <p className="mb-1.5 rounded-[10px] bg-muted px-2.5 py-1.5 text-xs text-muted-foreground">{t("stats.headNoPreviousGames")}</p>;
  }
  const Icon = change > 0 ? TrendingUp : change < 0 ? TrendingDown : Minus;
  const tone = change > 0 ? "bg-secondary/15 text-secondary" : change < 0 ? "bg-destructive/15 text-destructive" : "bg-muted text-muted-foreground";
  const value = change.toLocaleString(LOCALE_BY_LANGUAGE[language], { minimumFractionDigits: 1, maximumFractionDigits: 1, signDisplay: "exceptZero" });
  return (
    <p className={`mb-1.5 inline-flex items-center gap-1.5 rounded-[10px] px-2.5 py-1.5 text-sm font-semibold ${tone}`}>
      <Icon className="w-4 h-4 shrink-0" aria-hidden />
      <span>{value} {t(DELTA_LABEL_KEY[previousKind])}</span>
    </p>
  );
};

/** Hero card at the top of the Statistics page: the 3-dart average of the chosen period, its
 *  change against the previous one, and the per-play-day bars behind it. */
const AverageHeadlineCard = ({ subjectLabel, average, change, previousKind, days }: {
  /** Whose average this is — the club or the logged-in player's name. */
  subjectLabel: string;
  average: number | null;
  change: number | null;
  /** Null when the period has nothing to compare against (all time, custom filter mixes). */
  previousKind: PreviousPeriodKind | null;
  days: PlayDayAverage[];
}) => {
  const { t, language } = useLanguage();
  const formatted = average === null
    ? "–"
    : average.toLocaleString(LOCALE_BY_LANGUAGE[language], { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return (
    <section className="rounded-2xl border border-border bg-card p-4 flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-2">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-[0.12em] text-muted-foreground truncate">
            {t("stats.headThreeDartAverage")} · {subjectLabel}
          </p>
          <p className="font-display font-bold text-[72px] leading-[0.95] tabular-nums">{formatted}</p>
        </div>
        {average !== null && previousKind && <AverageChangePill change={change} previousKind={previousKind} />}
      </div>
      {average === null
        ? <p className="text-sm text-muted-foreground">{t("stats.headNoGamesInPeriod")}</p>
        : <AveragePerPlayDayChart days={days} />}
    </section>
  );
};

export default AverageHeadlineCard;
