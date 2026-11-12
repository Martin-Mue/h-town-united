import { Trophy } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";

interface TournamentChampionBannerProps {
  champion: string;
  /** Re-opens the trophy ceremony; left out where no ceremony can be shown (board kiosk). */
  onShowCeremony?: () => void;
}

/** Flat card naming the winner of a finished tournament, with an optional button back into the trophy ceremony. */
const TournamentChampionBanner = ({ champion, onShowCeremony }: TournamentChampionBannerProps) => {
  const { t } = useLanguage();
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-accent/40 bg-card px-4 py-3">
      <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-accent/15 text-accent">
        <Trophy className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">{t("tournament.championSuffix")}</p>
        <p className="truncate font-display text-lg font-bold leading-tight">{champion}</p>
      </div>
      {onShowCeremony && (
        <button
          type="button"
          onClick={onShowCeremony}
          className="min-h-11 shrink-0 rounded-xl border border-border px-3 text-sm font-semibold text-foreground transition-colors hover:bg-muted"
        >
          {t("tournament.ceremony")}
        </button>
      )}
    </div>
  );
};

export default TournamentChampionBanner;
