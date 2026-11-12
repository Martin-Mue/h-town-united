import { useLanguage } from "@/contexts/LanguageContext";
import { LOCALE_BY_LANGUAGE } from "@/i18n/translations";
import { barHeightPercents, type PlayDayAverage } from "@/utils/statsHeadline";

/** Small bar chart "Average pro Spieltag": one bar per day with games, oldest left, the latest
 *  day highlighted in the primary color. Plain divs rather than recharts — it is a shape next to
 *  a hero number, not an explorable chart. Screen readers get one summary via role="img"; each
 *  bar carries its exact value as a hover title. */
const AveragePerPlayDayChart = ({ days }: { days: PlayDayAverage[] }) => {
  const { t, language } = useLanguage();
  if (days.length === 0) return null;
  const locale = LOCALE_BY_LANGUAGE[language];
  const formatDate = (ms: number) => new Date(ms).toLocaleDateString(locale, { day: "2-digit", month: "2-digit" });
  const formatAverage = (v: number) => v.toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const heights = barHeightPercents(days.map((d) => d.average));
  const first = days[0];
  const last = days[days.length - 1];
  const summary = [
    t("stats.headAvgPerPlayDay"),
    `${days.length} ${t("stats.headPlayDays")}`,
    `${t("stats.headFirstDay")} ${formatDate(first.firstPlayedAt)}: ${formatAverage(first.average)}`,
    `${t("stats.headLastDay")} ${formatDate(last.firstPlayedAt)}: ${formatAverage(last.average)}`,
  ].join(", ");

  return (
    <div>
      <div role="img" aria-label={summary} className="h-[110px] flex items-end gap-1.5 border-b border-border">
        {days.map((day, i) => (
          <div
            key={day.dayKey}
            title={`${formatDate(day.firstPlayedAt)}: ${formatAverage(day.average)}`}
            className={`flex-1 min-w-0 rounded-t-md ${i === days.length - 1 ? "bg-primary" : "bg-muted-foreground/25"}`}
            style={{ height: `${heights[i]}%` }}
          />
        ))}
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="tabular-nums">{formatDate(first.firstPlayedAt)}</span>
        <span className="truncate">{t("stats.headAvgPerPlayDay")}</span>
        <span className="tabular-nums">{formatDate(last.firstPlayedAt)}</span>
      </div>
    </div>
  );
};

export default AveragePerPlayDayChart;
