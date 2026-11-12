import { useLanguage } from "@/contexts/LanguageContext";
import { STATS_PERIODS, type StatsPeriod } from "@/utils/statsHeadline";

const PERIOD_LABEL_KEY: Record<StatsPeriod, string> = {
  week: "stats.period7Days",
  month: "stats.period30Days",
  season: "home.season",
  all: "stats.overall",
};

/** Segmented period shortcut at the top of the Statistics page. It writes the page's existing
 *  time/season filters (see filterStateForPeriod) instead of keeping its own state, so it and the
 *  filter bar below can never disagree. `active` is null when the filter bar holds a combination
 *  none of the shortcuts stands for — then no button reads as pressed. */
const StatsPeriodSwitch = ({ active, onSelect }: { active: StatsPeriod | null; onSelect: (period: StatsPeriod) => void }) => {
  const { t } = useLanguage();
  return (
    <div role="group" aria-label={t("stats.timeframe")} className="grid grid-cols-4 gap-1 p-1 rounded-[14px] bg-card border border-border">
      {STATS_PERIODS.map((period) => {
        const pressed = active === period;
        return (
          <button
            key={period}
            type="button"
            aria-pressed={pressed}
            onClick={() => onSelect(period)}
            className={`h-11 min-w-0 truncate px-1 rounded-[10px] text-sm sm:text-[15px] font-semibold transition-colors ${pressed ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-muted"}`}
          >
            {t(PERIOD_LABEL_KEY[period])}
          </button>
        );
      })}
    </div>
  );
};

export default StatsPeriodSwitch;
