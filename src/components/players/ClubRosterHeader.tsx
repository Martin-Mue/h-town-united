import { useLanguage } from "@/contexts/LanguageContext";
import { PlayerNumberTile } from "./PlayersPagePrimitives";
import type { PlayerProfile } from "./playerProfile";

/** Top of the club page: club name as small label, page title, and three club totals
 *  (members, wins, best visit). The crest already sits in the app header right above. */
const ClubRosterHeader = ({ clubName, players }: { clubName: string; players: PlayerProfile[] }) => {
  const { t } = useLanguage();
  const totalWins = players.reduce((sum, p) => sum + p.games_won, 0);
  const bestVisit = Math.max(0, ...players.map((p) => p.high_score));

  return (
    <header className="space-y-3.5">
      <div className="min-w-0">
        <p className="text-xs uppercase tracking-[0.12em] text-muted-foreground truncate">{clubName}</p>
        <h1 className="font-display font-bold text-[28px] leading-tight">{t("players.clubPageTitle")}</h1>
      </div>
      <section aria-label={t("players.clubTotalsLabel")} className="grid grid-cols-3 gap-2.5">
        <PlayerNumberTile label={t("stats.members")} value={players.length} />
        <PlayerNumberTile label={t("game.winsLabel")} value={totalWins} />
        <PlayerNumberTile label="Highscore" value={bestVisit} />
      </section>
    </header>
  );
};

export default ClubRosterHeader;
