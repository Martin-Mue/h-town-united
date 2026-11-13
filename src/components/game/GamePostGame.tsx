import type { Dispatch, SetStateAction, MutableRefObject } from "react";
import type { NavigateFunction } from "react-router-dom";
import { Trophy, Share2, RotateCcw, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import AiMatchReport from "@/components/game/AiMatchReport";
import { useLanguage } from "@/contexts/LanguageContext";
import type { GameState } from "@/types/game";
import type { computePostGameStats } from "@/utils/postGameStats";
import { segmentCount, type StatBundle } from "@/utils/dartStats";
import MatchStatComparison from "@/components/stats/MatchStatComparison";
import { averageToCheckoutRange } from "@/utils/averageToCheckoutRange";
import type { TournamentLink } from "@/lib/activeGameSnapshot";
import type { LeagueLink } from "@/hooks/useLeagueLink";

type PostGameStats = ReturnType<typeof computePostGameStats>;

interface GamePostGameProps {
  game: GameState;
  postGameStats: PostGameStats;
  statFor: (p: NonNullable<PostGameStats>[number]) => StatBundle;
  selectedLegTab: number | "all";
  setSelectedLegTab: Dispatch<SetStateAction<number | "all">>;
  showDetailedStats: boolean;
  setShowDetailedStats: Dispatch<SetStateAction<boolean>>;
  visibleSegmentRows: number[];
  gameSaved: boolean;
  queuedOffline: boolean;
  pendingGameIdRef: MutableRefObject<string>;
  sharingResult: boolean;
  shareResult: () => Promise<void>;
  tournamentLinkName: string | null;
  tournamentLinkRef: MutableRefObject<TournamentLink | null>;
  leagueLinkRef: MutableRefObject<LeagueLink | null>;
  startRematch: () => void;
  resetGame: () => void;
  navigate: NavigateFunction;
  /** Saves the game if that is still pending, then runs the action that leaves this screen. */
  saveThenLeave: (next: () => void) => Promise<void>;
  /** Set for the first seconds after the last dart: takes it back and returns to the game. */
  onTakeBackLastDart?: () => void;
}

/**
 * The "Auswertung" winner overlay, extracted verbatim out of Game.tsx's `{game.isFinished && (…)}`
 * block inside the playing-phase return (Design-Sprint Phase 3, "Spiel-Screen in eigenständige
 * Teil-Screens aufteilen") — pure JSX relocation, all state stays in Game.tsx and is passed in as
 * props. The caller still owns the `game.isFinished` check and the surrounding
 * `fixed inset-0 bg-background/85 backdrop-blur-sm …` positioning wrapper (kept there since that
 * wrapper is part of the playing-phase shell, not this overlay's own content).
 */
const GamePostGame = ({
  game, postGameStats, statFor, selectedLegTab, setSelectedLegTab, showDetailedStats, setShowDetailedStats,
  visibleSegmentRows, gameSaved, queuedOffline, pendingGameIdRef, sharingResult, shareResult,
  tournamentLinkName, tournamentLinkRef, leagueLinkRef, startRematch, resetGame, navigate, saveThenLeave, onTakeBackLastDart,
}: GamePostGameProps) => {
  const { t } = useLanguage();
  return (
    <div className="bg-card border border-border rounded-2xl p-6 text-center animate-scale-in max-w-md mx-4 my-auto h-fit">
      <span aria-hidden="true" className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/15 text-accent">
        <Trophy className="h-8 w-8" />
      </span>
      <h2 className="text-[32px] leading-tight font-display font-bold break-words">{game.winnerName}</h2>
      <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground mt-1 mb-3">{t("game.wins")}</p>
      {onTakeBackLastDart && (
        <Button variant="outline" size="sm" onClick={onTakeBackLastDart} className="mb-3 gap-1.5">
          <Undo2 className="h-4 w-4" /> {t("game.takeBackLastDart")}
        </Button>
      )}
      {/* Sets-Modus: the match was actually decided by sets, not by the final set's leg
          score alone — leading with setsWon (and naming the final set's own leg score
          underneath, in parentheses, for anyone who wants the detail) avoids the final
          score reading like "3:1" when the real story was e.g. "2 Sätze : 1, im letzten
          Satz 3:2". */}
      {game.setsMode && game.setsWon && (
        <p className="text-sm text-muted-foreground mb-4">
          {game.setsWon.join(" : ")} {t("game.setsSuffix")}
          <span className="text-xs text-muted-foreground/70"> ({game.legsWon.join(" : ")} {t("game.legsSuffix")} {t("game.inFinalSet")})</span>
        </p>
      )}
      {game.bestOfLegs > 1 && !game.setsMode && <p className="mb-4 text-sm text-muted-foreground"><span className="font-display text-2xl font-bold tabular-nums text-foreground">{game.legsWon.join(" : ")}</span> {t("game.legsSuffix")}</p>}

      {/* Round 3 Rang 8: a small supportive line for whoever didn't win — this screen used
          to be entirely one-sided (trophy + winner name only), with nothing acknowledging
          the other player at all. Only shown for a genuine 1-on-1 (or 2-team) match, where
          "the loser" is unambiguous — a 3+-player free-for-all has no single obvious
          runner-up to address here without a fuller placement breakdown this screen
          doesn't have. */}
      {(() => {
        const participants = game.teams ?? game.players;
        if (participants.length !== 2 || game.winnerIndex === undefined) return null;
        const loserName = participants[game.winnerIndex === 0 ? 1 : 0].name;
        return (
          <p className="text-sm text-muted-foreground mb-4">
            {t("game.consolationMessage").replace("{name}", loserName)}
          </p>
        );
      })()}

      {/* Leg filter — every stat block below (cards, distribution, detailed table, field
          breakdown) reads through statFor(p), which reacts to this tab. Only shown once
          there's more than one leg to actually distinguish. */}
      {postGameStats && postGameStats[0].perLeg.length > 1 && (
        <div className="flex flex-wrap justify-center gap-1.5 mb-4">
          <button onClick={() => setSelectedLegTab("all")}
            aria-pressed={selectedLegTab === "all"} className={`min-h-11 px-3.5 rounded-xl border text-sm font-semibold transition-colors ${selectedLegTab === "all" ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground hover:text-foreground"}`}>
            {t("game.overallTab")}
          </button>
          {postGameStats[0].perLeg.map((_, li) => (
            <button key={li} onClick={() => setSelectedLegTab(li)}
              aria-pressed={selectedLegTab === li} className={`min-h-11 px-3.5 rounded-xl border text-sm font-semibold transition-colors ${selectedLegTab === li ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground hover:text-foreground"}`}>
              {t("game.leg")} {li + 1}
            </button>
          ))}
        </div>
      )}

      {postGameStats && postGameStats.length === 2 && game.mode !== "cricket" && (
        <div className="rounded-xl border border-border p-3 mb-4 text-left">
          <MatchStatComparison
            players={[
              { name: postGameStats[0].name, won: postGameStats[0].name === game.winnerName, bundle: statFor(postGameStats[0]) },
              { name: postGameStats[1].name, won: postGameStats[1].name === game.winnerName, bundle: statFor(postGameStats[1]) },
            ]}
            labels={{ averageTo170: t("stats.averageTo170"), highscore: t("game.highscoreLabel") }}
          />
        </div>
      )}

      {postGameStats && !(postGameStats.length === 2 && game.mode !== "cricket") && (
        <div className="grid grid-cols-2 gap-3 mb-4 text-left">
          {postGameStats.map((p) => {
            const s = statFor(p);
            return (
              <div key={p.name} className="rounded-xl border border-border p-3 text-xs space-y-1">
                <p className="font-semibold text-sm truncate">{p.name}</p>
                <p className="text-muted-foreground">Ø <span className="text-foreground font-bold">{s.average.toFixed(1)}</span></p>
                <p className="text-muted-foreground">High <span className="text-foreground font-bold">{s.highscore}</span></p>
                <p className="text-muted-foreground">First 9 <span className="text-foreground font-bold">{s.first9.toFixed(1)}</span></p>
                {averageToCheckoutRange(s.scoringPhase) !== null && (
                  <p className="text-muted-foreground">{t("stats.averageTo170")} <span className="text-foreground font-bold">{averageToCheckoutRange(s.scoringPhase)!.toFixed(1)}</span></p>
                )}
                {s.s180 > 0 && <p className="text-foreground font-bold">🎯 {s.s180}× 180!</p>}
              </div>
            );
          })}
        </div>
      )}

      {/* Round-score distribution (40+ through 180) — always visible, not gated behind
          "detaillierte Statistiken", since seeing HOW an average was built up (a run of
          steady 60s vs. one lucky 180) is exactly what a post-match glance is for. */}
      {postGameStats && postGameStats.some((p) => statFor(p).tierBreakdown.some((tier) => tier.count > 0)) && (
        <div className="rounded-xl border border-border p-3 mb-4 text-xs overflow-x-auto">
          <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground mb-2 text-left">{t("game.scoreDistribution")}</p>
          <div className="grid gap-y-1" style={{ gridTemplateColumns: `1fr repeat(${postGameStats.length}, 1fr)` }}>
            <span />
            {postGameStats.map((p) => <span key={p.name} className="font-semibold text-primary text-center truncate">{p.name}</span>)}
            {statFor(postGameStats[0]).tierBreakdown.map((tier, ti) => (
              <span key={tier.label} className="contents">
                <span className="text-left text-muted-foreground">{tier.label}</span>
                {postGameStats.map((p) => {
                  const count = statFor(p).tierBreakdown[ti].count;
                  return (
                    <span key={p.name} className={`text-center font-display tabular-nums ${tier.label === "180" && count > 0 ? "text-primary font-bold" : ""}`}>
                      {count || "–"}
                    </span>
                  );
                })}
              </span>
            ))}
          </div>
        </div>
      )}

      {postGameStats && (
        <button onClick={() => setShowDetailedStats(!showDetailedStats)} className="min-h-11 px-2 text-sm font-semibold text-primary mb-2 block mx-auto">
          {showDetailedStats ? t("game.lessStats") : t("game.detailedStats")}
        </button>
      )}

      {/* Detailed stats deliberately does NOT repeat Ø/First9/Highscore/100+/180! — those
          are already visible above (the cards and the distribution table), so this only
          adds numbers that aren't shown anywhere else yet. */}
      {showDetailedStats && postGameStats && (
        <div className="rounded-xl border border-border p-4 mb-4 text-xs overflow-x-auto">
          <div className="grid gap-y-2" style={{ gridTemplateColumns: `1fr repeat(${postGameStats.length}, 1fr)` }}>
            <span className="text-muted-foreground text-left">{t("game.statistic")}</span>
            {postGameStats.map(p => <span key={p.name} className="font-semibold text-primary text-center truncate">{p.name}</span>)}

            {[
              { l: t("game.throwsCount"), v: (p: typeof postGameStats[number]) => statFor(p).totalThrows },
              { l: t("game.rounds"), v: (p: typeof postGameStats[number]) => Math.ceil(statFor(p).totalThrows / 3) },
              { l: t("game.checkoutRate"), v: (p: typeof postGameStats[number]) => {
                  const c = statFor(p).checkout;
                  return c.attempts > 0 ? `${c.hits}/${c.attempts} (${c.percentage.toFixed(0)}%)` : "–";
                } },
              { l: t("game.triplesLabel"), v: (p: typeof postGameStats[number]) => statFor(p).triples },
              { l: t("game.points"), v: (p: typeof postGameStats[number]) => statFor(p).totalPoints },
            ].map(row => (
              <span key={row.l} className="contents">
                <span className="text-left text-muted-foreground">{row.l}</span>
                {postGameStats.map(p => <span key={p.name} className="text-center font-display tabular-nums">{row.v(p)}</span>)}
              </span>
            ))}
          </div>

          {/* Individual-field breakdown — exactly which segments (Triple 20, Single 1, ...)
              were hit and how often. Only the numbers that actually got hit by anyone get a
              row, since most matches leave most of the board untouched. */}
          {visibleSegmentRows.length > 0 && (
            <div className="mt-4 pt-3 border-t border-border/40">
              <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground mb-2 text-left">{t("game.fieldBreakdown")}</p>
              <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${postGameStats.length}, 1fr)` }}>
                {postGameStats.map((p) => {
                  const segments = statFor(p).segments;
                  return (
                    <div key={p.name}>
                      <p className="text-[10px] font-semibold text-primary text-center truncate mb-1">{p.name}</p>
                      <table className="w-full text-[10px]">
                        <thead>
                          <tr className="text-muted-foreground">
                            <th className="text-left font-normal"> </th>
                            <th className="font-normal">S</th>
                            <th className="font-normal">D</th>
                            <th className="font-normal">T</th>
                          </tr>
                        </thead>
                        <tbody>
                          {visibleSegmentRows.map((n) => (
                            <tr key={n}>
                              <td className="text-left text-muted-foreground">{n === 25 ? "Bull" : n}</td>
                              <td className="text-center font-display">{segmentCount(segments, n, 1) || "·"}</td>
                              <td className="text-center font-display">{segmentCount(segments, n, 2) || "·"}</td>
                              <td className="text-center font-display">{n === 25 ? <span className="text-muted-foreground/40">–</span> : (segmentCount(segments, n, 3) || "·")}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {segments.misses > 0 && (
                        <p className="text-[9px] text-muted-foreground text-center mt-1">Miss ×{segments.misses}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* KI-Spielbericht (2026-09-09) — only once the game is actually persisted server-side,
          since gameId is a foreign key into `games` (the private post-match reflection that
          used to sit here too was removed 2026-09-10 — see MatchReflection.tsx, now unused). */}
      {gameSaved && !queuedOffline && <AiMatchReport gameId={pendingGameIdRef.current} />}

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={shareResult} disabled={sharingResult} className="h-[52px] rounded-[14px] gap-1.5 shrink-0">
          <Share2 className="w-4 h-4" /> {sharingResult ? "…" : t("game.share")}
        </Button>
        {/* Rematch only for a plain, freely-configured game — a tournament/league match
            comes from a fixed bracket/fixture, not a setup a rematch could just re-run. */}
        {!tournamentLinkName && !leagueLinkRef.current && (
          <Button variant="outline" onClick={startRematch} className="h-[52px] rounded-[14px] gap-1.5 shrink-0">
            <RotateCcw className="w-4 h-4" /> {t("game.rematch")}
          </Button>
        )}
        {tournamentLinkName ? (
          <Button
            onClick={() => {
              const link = tournamentLinkRef.current;
              void saveThenLeave(() => {
                if (!link) { navigate("/tournament"); return; }
                navigate(link.board ? `/tournament/${link.tournamentId}?board=${link.board}` : `/tournament/${link.tournamentId}`);
              });
            }}
            className="h-[52px] flex-1 rounded-[14px] text-base font-semibold"
          >
            {t("game.backToTournament")}
          </Button>
        ) : leagueLinkRef.current ? (
          <Button onClick={() => void saveThenLeave(() => navigate(`/leagues/${leagueLinkRef.current!.leagueId}`))} className="h-[52px] flex-1 rounded-[14px] text-base font-semibold">
            {t("game.backToLeague")}
          </Button>
        ) : (
          <Button onClick={() => void saveThenLeave(() => { resetGame(); navigate("/game"); })} className="h-[52px] flex-1 rounded-[14px] text-base font-semibold">{t("home.newGame")}</Button>
        )}
      </div>
      {gameSaved && (
        <p className="text-xs text-muted-foreground mt-2">
          {queuedOffline ? t("game.savedOffline") : t("game.gameSaved")}
        </p>
      )}
    </div>
  );
};

export default GamePostGame;
