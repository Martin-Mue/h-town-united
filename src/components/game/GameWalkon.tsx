import { useLanguage } from "@/contexts/LanguageContext";
import { matchClubPlayer, type ClubPlayer } from "@/lib/repositories/players";
import type { GameState } from "@/types/game";

/**
 * Two extracted "walk-on" beats out of Game.tsx's `phase === "walkon"` and `phase === "stats"`
 * branches (Design-Sprint Phase 3, "Spiel-Screen in eigenständige Teil-Screens aufteilen") — pure
 * JSX relocation, all state stays in Game.tsx and is passed in as props.
 */

interface GameWalkonIntroProps {
  game: GameState;
  walkonHasStats: (g: GameState | null) => boolean;
  onAdvance: (nextPhase: "stats" | "playing") => void;
}

/** Full-screen tap-to-skip name/VS entrance card, right after the setup form is submitted. */
export const GameWalkonIntro = ({ game, walkonHasStats, onAdvance }: GameWalkonIntroProps) => {
  const { t } = useLanguage();
  const names = game.teams ? game.teams.map((tm) => tm.name) : game.players.map((p) => p.name);
  const isDuel = names.length === 2;
  const advance = () => onAdvance(walkonHasStats(game) ? "stats" : "playing");
  return (
    <div
      role="button" tabIndex={0}
      onClick={advance}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); advance(); } }}
      aria-label={t("game.tapToSkip")}
      className="fixed inset-0 z-50 bg-background flex flex-col items-center justify-center px-6 cursor-pointer overflow-hidden"
    >
      <div className="absolute inset-0 gradient-hero" />
      <p className="relative text-[11px] uppercase tracking-[0.4em] text-muted-foreground mb-6 animate-slide-up">
        {t("game.walkonEntranceLabel")}
      </p>
      {isDuel ? (
        <div className="relative flex flex-col items-center gap-3 w-full max-w-md">
          <h2 className="font-display text-4xl sm:text-5xl uppercase text-primary text-center glow-cyan animate-scale-in truncate max-w-full">
            {names[0]}
          </h2>
          <span className="font-display text-lg text-accent animate-scale-in" style={{ animationDelay: "150ms" }}>VS</span>
          <h2
            className="font-display text-4xl sm:text-5xl uppercase text-secondary text-center glow-green animate-scale-in truncate max-w-full"
            style={{ animationDelay: "300ms" }}
          >
            {names[1]}
          </h2>
        </div>
      ) : (
        <div className="relative flex flex-col items-center gap-2 w-full max-w-md">
          <p className="text-xs uppercase tracking-widest text-muted-foreground mb-2">{t("game.playersPlaying")}</p>
          {names.map((name, i) => (
            <h2
              key={i}
              className="font-display text-2xl sm:text-3xl uppercase text-primary text-center glow-cyan animate-scale-in truncate max-w-full"
              style={{ animationDelay: `${i * 120}ms` }}
            >
              {name}
            </h2>
          ))}
        </div>
      )}
      <p className="relative text-[10px] uppercase tracking-widest text-muted-foreground mt-8 animate-slide-up" style={{ animationDelay: "400ms" }}>
        {t("game.tapToSkip")}
      </p>
    </div>
  );
};

interface GameWalkonStatsProps {
  game: GameState;
  dbPlayers: ClubPlayer[];
  walkonH2H: { aWins: number; bWins: number; total: number; aAvg: number; bAvg: number; storyline: string | null; aWinProb: number | null } | null;
  onAdvance: () => void;
}

/** Second walk-on beat, right after the name/VS card — only for a real (non-team) 1v1 where at
 *  least one side has club history to show (see walkonHasStats). Big, high-contrast, explicitly
 *  labeled per player instead of the easy-to-miss caption this replaced (see commit history):
 *  a screen meant to be glanced at from across a table needs numbers you can read at a glance,
 *  not a footnote. */
export const GameWalkonStats = ({ game, dbPlayers, walkonH2H, onAdvance }: GameWalkonStatsProps) => {
  const { t } = useLanguage();
  const names = game.players.map((p) => p.name);
  const a = matchClubPlayer(dbPlayers, names[0]);
  const b = matchClubPlayer(dbPlayers, names[1]);
  const statRow = (label: string, value: string) => (
    <div className="flex flex-col items-center">
      <p className="font-display text-3xl sm:text-4xl">{value}</p>
      <p className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</p>
    </div>
  );
  const playerColumn = (name: string, p: ClubPlayer | undefined, nameClass: string) => (
    <div className="flex-1 flex flex-col items-center gap-5 min-w-0">
      <h3 className={`font-display text-lg sm:text-2xl uppercase text-center truncate max-w-full ${nameClass}`}>{name}</h3>
      {p ? (
        <div className="flex flex-col gap-5 w-full items-center">
          {statRow("Average", p.games_played > 0 ? Number(p.average).toFixed(1) : "–")}
          {statRow(t("game.winsLabel"), `${p.games_won}/${p.games_played}`)}
          {statRow("Elo", String(Math.round(p.elo_rating)))}
          {statRow(t("game.highscoreLabel"), String(p.high_score))}
          {statRow("Checkout", `${Number(p.double_rate).toFixed(0)}%`)}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground uppercase tracking-widest mt-2">{t("game.noProfile")}</p>
      )}
    </div>
  );
  return (
    <div
      role="button" tabIndex={0}
      onClick={onAdvance}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onAdvance(); } }}
      aria-label={t("game.tapToSkip")}
      className="fixed inset-0 z-50 bg-background flex flex-col items-center justify-center px-4 cursor-pointer overflow-hidden"
    >
      <div className="absolute inset-0 gradient-hero" />
      <p className="relative text-[11px] uppercase tracking-[0.4em] text-muted-foreground mb-8 animate-slide-up">
        {t("game.statsComparison")}
      </p>
      <div className="relative flex items-start justify-center gap-4 sm:gap-10 w-full max-w-lg animate-scale-in">
        {playerColumn(names[0], a, "text-primary glow-cyan")}
        <span className="font-display text-xl text-accent pt-1">VS</span>
        {playerColumn(names[1], b, "text-secondary glow-green")}
      </div>
      {walkonH2H && (
        <div className="relative mt-10 text-center animate-slide-up">
          <p className="font-display text-3xl uppercase text-accent">
            {walkonH2H.total > 0 ? `${walkonH2H.aWins} : ${walkonH2H.bWins}` : t("game.firstTime")}
          </p>
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground mt-1">
            {walkonH2H.total > 0 ? `${t("game.headToHeadSoFar")} · ${walkonH2H.total} ${t("stats.games")}` : t("game.firstMeeting")}
          </p>
          {/* Elo-derived, so meaningful even for a first-ever meeting (total === 0) unlike
              everything else in this card, which needs real head-to-head history. */}
          {walkonH2H.aWinProb !== null && (
            <div className="mt-3 max-w-[240px] mx-auto">
              <div className="flex justify-between text-[10px] mb-1">
                <span className="text-primary font-semibold">{Math.round(walkonH2H.aWinProb)}%</span>
                <span className="text-secondary font-semibold">{Math.round(100 - walkonH2H.aWinProb)}%</span>
              </div>
              <div className="h-1.5 rounded-full overflow-hidden flex bg-muted">
                <div className="h-full bg-primary" style={{ width: `${walkonH2H.aWinProb}%` }} />
                <div className="h-full bg-secondary flex-1" />
              </div>
              <p className="text-[9px] uppercase tracking-widest text-muted-foreground mt-1">{t("game.winProbability")}</p>
            </div>
          )}
          {/* Average specifically FROM these head-to-head games — a genuinely different number
              from the lifetime average shown per player above, not a duplicate of it. */}
          {walkonH2H.total > 0 && (
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground mt-1">
              {t("game.duelAverage")}: {walkonH2H.aAvg.toFixed(1)} : {walkonH2H.bAvg.toFixed(1)}
            </p>
          )}
          {/* The one true fact worth highlighting from this H2H history (streak, close
              rivalry, or a revenge framing off the last meeting) — see rivalryStoryline.ts. */}
          {walkonH2H.storyline && (
            <p className="text-xs text-accent font-medium mt-3 max-w-xs mx-auto px-2">
              {walkonH2H.storyline}
            </p>
          )}
        </div>
      )}
      <p className="relative text-[10px] uppercase tracking-widest text-muted-foreground mt-10 animate-slide-up">
        {t("game.tapToStart")}
      </p>
    </div>
  );
};
