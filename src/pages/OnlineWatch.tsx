import { Link, useParams } from "react-router-dom";
import { ChevronLeft, Eye } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { useOnlineMatch } from "@/hooks/useOnlineMatch";
import { teamIndexFor } from "@/utils/teamUtils";

/** Read-only live view of someone else's online match (/watch/:id). Reuses useOnlineMatch's
 *  realtime channel — the "Club members can watch active online matches" policy is what lets a
 *  non-participant load the row in the first place. */
const OnlineWatch = () => {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { t } = useLanguage();
  const { row, loading } = useOnlineMatch(id, user?.id);
  const game = row?.game_state;

  return (
    <div className="container py-4 max-w-lg mx-auto animate-slide-up">
      <header className="mb-4 flex items-center gap-2">
        <Link
          to="/"
          aria-label={t("common.back")}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-border text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-5 w-5" />
        </Link>
        <h1 className="min-w-0 flex-1 truncate font-display text-[28px] font-bold leading-tight">{t("home.watchMatch")}</h1>
        <Eye aria-hidden="true" className="h-5 w-5 shrink-0 text-accent" />
      </header>

      {loading ? <p className="text-sm text-muted-foreground">…</p>
        : !game || row?.status !== "active" ? <p className="text-sm text-muted-foreground">{t("game.onlineMatchNotActive")}</p>
        : (() => {
          const teams = game.teams && game.teams.length > 0;
          const slots = teams ? game.teams!.map((tm) => tm.name) : game.players.map((p) => p.name);
          const turnTeam = teamIndexFor(game.teams, game.currentPlayerIndex);
          return (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                {slots.map((name, i) => (
                  <div key={i} className={`rounded-2xl border bg-card px-3 py-4 text-center ${turnTeam === i ? "border-primary" : "border-border"}`}>
                    <p className={`text-sm font-semibold truncate ${turnTeam === i ? "" : "text-muted-foreground"}`}>{name}</p>
                    <p className={`font-display font-bold text-5xl leading-none tabular-nums my-2 ${turnTeam === i ? "" : "text-muted-foreground"}`}>{game.mode === "cricket" ? "–" : game.currentLeg.remaining[i]}</p>
                    <p className="text-xs text-muted-foreground">{t("game.legsSuffix")}: {game.legsWon[i] ?? 0}</p>
                  </div>
                ))}
              </div>
              <p className="text-center text-sm text-muted-foreground">
                {game.players[game.currentPlayerIndex]?.name} · {game.mode === "cricket" ? "Cricket" : game.mode} · {t("stats.firstTo")} {Math.ceil(game.bestOfLegs / 2)}
              </p>
            </div>
          );
        })()}
    </div>
  );
};

export default OnlineWatch;
