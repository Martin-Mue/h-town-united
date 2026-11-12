import { Link } from "react-router-dom";
import { ChevronRight, Radio } from "lucide-react";
import { DartTrophyIcon } from "@/components/icons/DartIcons";
import { useLanguage } from "@/contexts/LanguageContext";
import { roundLabelFor } from "@/utils/tournament";
import type { NextTournamentMatch } from "@/utils/homeHighlights";

export interface LiveTournamentInfo {
  id: string;
  name: string;
}

const rowClass = "rounded-2xl border border-border bg-card px-3.5 py-3 flex items-center gap-3 active:scale-[0.99] transition-transform";

/** Start page rows under the open-game card: the member's own next tournament match first, then
 *  any tournament running right now. Renders nothing when there is neither. */
const TournamentRows = ({ next, live }: { next: NextTournamentMatch | null; live: LiveTournamentInfo[] }) => {
  const { t } = useLanguage();
  const otherLive = live.filter((x) => x.id !== next?.tournamentId);
  if (!next && otherLive.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      {next && (
        <Link to={`/tournament/${next.tournamentId}`} className={rowClass}>
          <span aria-hidden="true" className="w-10 h-10 rounded-[10px] bg-accent/15 text-accent flex items-center justify-center shrink-0">
            <DartTrophyIcon className="w-5 h-5" />
          </span>
          <span className="flex-1 min-w-0">
            <span className="block text-xs text-muted-foreground truncate">
              {t("home.nextMatchTitle")}
              {next.round !== null && next.totalRounds !== null ? ` · ${roundLabelFor(next.round, next.totalRounds, t)}` : ""}
            </span>
            <span className="block text-[15px] font-semibold truncate">
              {next.opponent ? t("home.nextMatchVs").replace("{name}", next.opponent) : t("home.nextMatchTbd")}
            </span>
          </span>
          <ChevronRight aria-hidden="true" className="w-[18px] h-[18px] text-muted-foreground shrink-0" />
        </Link>
      )}
      {otherLive.map((x) => (
        <Link key={x.id} to={`/tournament/${x.id}`} className={rowClass}>
          <span aria-hidden="true" className="w-10 h-10 rounded-[10px] bg-secondary/15 text-secondary flex items-center justify-center shrink-0">
            <Radio className="w-5 h-5" />
          </span>
          <span className="flex-1 min-w-0">
            <span className="block text-xs text-muted-foreground">{t("home.liveTournament")}</span>
            <span className="block text-[15px] font-semibold truncate">{x.name}</span>
          </span>
          <ChevronRight aria-hidden="true" className="w-[18px] h-[18px] text-muted-foreground shrink-0" />
        </Link>
      ))}
    </div>
  );
};

export default TournamentRows;
