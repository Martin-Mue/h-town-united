import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
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
    <div className="container py-6 max-w-lg mx-auto animate-slide-up">
      <Button asChild variant="ghost" className="mb-4 -ml-2 text-muted-foreground">
        <Link to="/"><ArrowLeft className="w-4 h-4 mr-1" /> {t("common.back")}</Link>
      </Button>
      <h1 className="font-display uppercase text-xl mb-4 flex items-center gap-2"><Eye className="w-5 h-5 text-accent" /> {t("home.watchMatch")}</h1>

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
                  <div key={i} className={`rounded-xl border px-3 py-4 text-center ${turnTeam === i ? "border-primary bg-primary/10" : "border-border bg-card"}`}>
                    <p className="text-sm font-semibold truncate">{name}</p>
                    <p className="font-display text-4xl tabular-nums my-1">{game.mode === "cricket" ? "–" : game.currentLeg.remaining[i]}</p>
                    <p className="text-[11px] text-muted-foreground uppercase">{t("game.legsSuffix")}: {game.legsWon[i] ?? 0}</p>
                  </div>
                ))}
              </div>
              <p className="text-center text-xs text-muted-foreground">
                {game.players[game.currentPlayerIndex]?.name} · {game.mode === "cricket" ? "Cricket" : game.mode} · {t("stats.firstTo")} {Math.ceil(game.bestOfLegs / 2)}
              </p>
            </div>
          );
        })()}
    </div>
  );
};

export default OnlineWatch;
