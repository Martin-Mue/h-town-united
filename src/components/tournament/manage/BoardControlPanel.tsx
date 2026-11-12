import { useState } from "react";
import { Pause, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import QuickResultDialog from "@/components/tournament/QuickResultDialog";
import { useLanguage } from "@/contexts/LanguageContext";
import { isLiveSnapshotFresh, type Match } from "@/utils/tournament";
import { boardControlOverview, type BoardStatus } from "@/utils/tournamentBoardControl";

interface BoardControlPanelProps {
  matches: Match[];
  boards: number;
  totalRounds: number;
  roundLabel: (round: number, totalRounds: number) => string;
  /** Legs (or sets) needed to win a match of this round. */
  firstToForRound: (round: number) => number;
  /** May enter results, pause and call matches (owner, admin, editor). Everyone else only watches. */
  canControl: boolean;
  onFinishMatch: (matchId: string, winner: string, score1: number, score2: number) => Promise<void>;
  onAssignToBoard: (matchId: string, board: number) => Promise<void>;
  onSetPaused: (matchId: string, paused: boolean) => Promise<void>;
}

/** Leg score to show on a board card: the live game's tally while one is running, else what was entered by hand. */
const legScoreOf = (m: Match): [number, number] =>
  isLiveSnapshotFresh(m.live) ? [m.live!.legs1, m.live!.legs2] : [m.score1 ?? 0, m.score2 ?? 0];

/**
 * Tournament-day control for a running KO tournament: the boards on top (what is played where right now,
 * with "Spiel beenden" to enter the result) and the open, ready matches below. Any ready match can be
 * called to a free board, and any ready match can be paused so the automatic order skips it until it's
 * resumed. Neither ever changes the bracket's pairings or order (see tournamentBoardControl.ts).
 */
const BoardControlPanel = ({
  matches,
  boards,
  totalRounds,
  roundLabel,
  firstToForRound,
  canControl,
  onFinishMatch,
  onAssignToBoard,
  onSetPaused,
}: BoardControlPanelProps) => {
  const { t } = useLanguage();
  const [busyMatchId, setBusyMatchId] = useState<string | null>(null);
  const overview = boardControlOverview(matches, boards);

  const runFor = async (matchId: string, action: () => Promise<void>) => {
    setBusyMatchId(matchId);
    try { await action(); } finally { setBusyMatchId(null); }
  };

  const boardCard = ({ board, match, calledByOrganizer }: BoardStatus) => {
    if (!match) {
      return (
        <div key={board} className="flex min-h-[168px] flex-col gap-1.5 rounded-2xl border border-primary bg-card p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="font-display text-lg font-bold">{t("camera.board")} {board}</span>
            <span className="text-xs font-semibold text-primary">{t("tournament.boardFree")}</span>
          </div>
          <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-border p-2 text-center text-sm text-muted-foreground">
            {canControl && overview.readyCount > 0 ? t("tournament.boardPickNextBelow") : t("tournament.boardNothingReady")}
          </div>
        </div>
      );
    }
    const live = isLiveSnapshotFresh(match.live);
    const [legs1, legs2] = legScoreOf(match);
    const busy = busyMatchId === match.id;
    return (
      <div key={board} className="flex min-h-[168px] flex-col gap-1.5 rounded-2xl border border-border bg-card p-3">
        <div className="flex min-h-[44px] items-start justify-between gap-2">
          <div className="min-w-0">
            <span className="block font-display text-lg font-bold leading-tight">{t("camera.board")} {board}</span>
            <span className={`flex items-center gap-1 text-xs font-semibold ${live ? "text-secondary" : "text-muted-foreground"}`}>
              {live && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-secondary animate-pulse" aria-hidden="true" />}
              <span className="truncate">
                {live ? t("tournament.boardRunning") : calledByOrganizer ? t("tournament.boardCalled") : t("tournament.boardUp")}
              </span>
            </span>
          </div>
          {canControl && (
            <Button
              variant="outline"
              size="icon"
              className="-mr-1 -mt-1 h-11 w-11 shrink-0"
              disabled={busy}
              onClick={() => runFor(match.id, () => onSetPaused(match.id, true))}
              title={t("tournament.pauseMatch")}
              aria-label={`${t("tournament.pauseMatch")}: ${match.player1} – ${match.player2}`}
            >
              <Pause className="h-4 w-4" />
            </Button>
          )}
        </div>
        <p className="truncate text-xs text-muted-foreground">{roundLabel(match.round, totalRounds)}</p>
        <div className="flex flex-1 flex-col gap-0.5">
          {[[match.player1, legs1], [match.player2, legs2]].map(([name, legs], i) => (
            <div key={i} className="flex items-baseline justify-between gap-2">
              <span className="min-w-0 truncate text-[15px] font-semibold">{name}</span>
              <span className="font-display text-2xl font-bold tabular-nums">{legs}</span>
            </div>
          ))}
        </div>
        {canControl && (
          <QuickResultDialog
            player1={match.player1!}
            player2={match.player2!}
            firstTo={firstToForRound(match.round)}
            onSubmit={(w, s1, s2) => onFinishMatch(match.id, w, s1, s2)}
            trigger={
              <Button variant="outline" className="mt-auto h-11 w-full min-w-0 bg-muted px-2 text-sm font-semibold">
                <span className="truncate">{t("tournament.finishMatch")}</span>
              </Button>
            }
          />
        )}
      </div>
    );
  };

  const openMatchRow = (match: Match) => {
    const paused = !!match.paused;
    const freeBoard = overview.firstFreeBoard;
    const canAssign = !paused && freeBoard !== null;
    const busy = busyMatchId === match.id;
    return (
      <li key={match.id} className="flex flex-col gap-2.5 rounded-2xl border border-border bg-card p-3">
        <div className="min-w-0">
          <p className={`flex items-center gap-1 text-xs ${paused ? "text-accent" : "text-muted-foreground"}`}>
            {paused && <Pause className="h-3 w-3 shrink-0" aria-hidden="true" />}
            <span className="truncate">
              {roundLabel(match.round, totalRounds)}
              {paused && ` · ${t("tournament.matchPausedLabel")}`}
            </span>
          </p>
          <p className={`break-words text-[17px] font-semibold ${paused ? "text-muted-foreground" : "text-foreground"}`}>
            {match.player1} <span className="font-normal text-muted-foreground">{t("tournament.versus")}</span> {match.player2}
          </p>
        </div>
        {canControl && (
          <div className="flex gap-2">
            <Button
              className="h-11 min-w-0 flex-1 text-[15px] font-semibold"
              variant={canAssign ? "default" : "outline"}
              disabled={!canAssign || busy}
              onClick={() => freeBoard !== null && runFor(match.id, () => onAssignToBoard(match.id, freeBoard))}
            >
              <span className="truncate">
                {paused
                  ? t("tournament.matchPausedLabel")
                  : freeBoard !== null
                    ? t("tournament.toBoard").replace("{board}", String(freeBoard))
                    : t("tournament.noBoardFree")}
              </span>
            </Button>
            <Button
              variant="outline"
              className="h-11 shrink-0 gap-1.5 px-3.5 text-sm"
              aria-pressed={paused}
              disabled={busy}
              onClick={() => runFor(match.id, () => onSetPaused(match.id, !paused))}
            >
              {paused ? <Play className="h-4 w-4" aria-hidden="true" /> : <Pause className="h-4 w-4" aria-hidden="true" />}
              {paused ? t("tournament.resumeMatch") : t("tournament.pauseMatch")}
            </Button>
          </div>
        )}
      </li>
    );
  };

  return (
    <div className="space-y-4">
      <section className="space-y-2" aria-labelledby="board-control-boards">
        <h3 id="board-control-boards" className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
          {t("tournament.boardsHeading")}
        </h3>
        <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3 xl:grid-cols-4">
          {overview.boards.map(boardCard)}
        </div>
      </section>

      <section className="space-y-2" aria-labelledby="board-control-open">
        <div className="flex items-baseline justify-between gap-2">
          <h3 id="board-control-open" className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
            {t("tournament.openMatchesHeading")}
          </h3>
          <span className="text-[13px] text-muted-foreground">
            {t("tournament.readyCount").replace("{count}", String(overview.readyCount))}
          </span>
        </div>
        {overview.openMatches.length > 0 ? (
          <ul className="grid gap-2 md:grid-cols-2">{overview.openMatches.map(openMatchRow)}</ul>
        ) : (
          <p className="rounded-2xl border border-dashed border-border p-5 text-center text-sm text-muted-foreground">
            {t("tournament.allReadyMatchesOnBoards")}
          </p>
        )}
      </section>
    </div>
  );
};

export default BoardControlPanel;
