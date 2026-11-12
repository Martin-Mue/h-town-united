import { Button } from "@/components/ui/button";
import { useLanguage } from "@/contexts/LanguageContext";
import type { GameMode } from "@/types/game";

interface BoardModeStartCardProps {
  tournamentName: string;
  playerNames: string[];
  mode: GameMode;
  bestOfLegs: number;
  gate: "checking" | "clear" | "blocked-mode" | "blocked-collision";
  secondsLeft: number;
  onEdit: () => void;
  onStart: () => void;
}

/**
 * Board mode: instead of the full form, "here's the match, starting in Xs" — mode/players/best-of are already right
 * from the bracket. Blocked outcomes never count down: "blocked-mode" (Extern / live play off) offers no start at all,
 * "blocked-collision" needs an explicit tap.
 */
const BoardModeStartCard = ({ tournamentName, playerNames, mode, bestOfLegs, gate, secondsLeft, onEdit, onStart }: BoardModeStartCardProps) => {
  const { t } = useLanguage();
  const blocked = gate === "blocked-mode" || gate === "blocked-collision";
  return (
    <div className="container mx-auto max-w-sm animate-slide-up py-10 text-center">
      <div className="mb-6 rounded-xl border border-primary/40 bg-primary/10 px-3 py-2">
        <p className="text-xs font-medium text-primary">🏆 {t("game.tournamentMatch")} · {tournamentName}</p>
      </div>
      <p className="mb-1 truncate font-display text-lg">{playerNames[0]}</p>
      <p className="mb-1 text-xs text-muted-foreground">vs.</p>
      <p className="mb-4 truncate font-display text-lg">{playerNames[1]}</p>
      {blocked ? (
        <p className="mb-6 rounded-xl border border-border bg-muted/30 px-3 py-3 text-sm text-muted-foreground">
          {gate === "blocked-collision"
            ? `${playerNames[0]} vs. ${playerNames[1]} ${t("tournament.matchAlreadyRunningConfirm")}`
            : t("game.boardStartBlocked")}
        </p>
      ) : (
        <>
          <p className="mb-8 text-xs text-muted-foreground">{mode} · {t("stats.firstTo")} {Math.ceil(bestOfLegs / 2)}</p>
          <div className="mb-2 font-display text-5xl tabular-nums text-primary">{gate === "clear" ? secondsLeft : "…"}</div>
          <p className="mb-6 text-[10px] uppercase tracking-widest text-muted-foreground">{t("game.autoStartingIn")}</p>
        </>
      )}
      <div className="flex gap-2">
        <Button variant="outline" className="h-12 flex-1" onClick={onEdit}>{t("common.edit")}</Button>
        {gate !== "blocked-mode" && (
          <Button className="h-12 flex-1 font-display uppercase" onClick={onStart}>{t("game.startGame")}</Button>
        )}
      </div>
    </div>
  );
};

export default BoardModeStartCard;
