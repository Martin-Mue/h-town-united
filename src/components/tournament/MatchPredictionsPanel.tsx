import { useState } from "react";
import { Check, X, ChevronDown, ChevronUp } from "lucide-react";
import type { Match } from "@/utils/tournament";
import { isPlayable } from "@/utils/tournament";
import { useLanguage } from "@/contexts/LanguageContext";
import type { PredictionTallies } from "@/hooks/useMatchPredictions";
import { evaluatePredictions } from "@/utils/predictionEvaluation";

interface MatchPredictionsPanelProps {
  matches: Match[];
  tallies: PredictionTallies;
  myVotes: Record<string, string>;
  onVote: (matchId: string, player: string) => Promise<boolean>;
}

/** Spectator "who wins this match?" voting for every currently-open (both players known, not yet
 *  decided) match, plus an evaluation of already-decided matches (how often the crowd and the
 *  viewer were right) and an anonymous tip count per match — a standalone card, not woven into
 *  LiveBracket/BracketList themselves, so it never touches either's already-careful auto-fit/glow/
 *  live-flash logic. KO tournaments only (see useMatchPredictions/the migration's own note on why
 *  round-robin isn't covered yet). Counts are aggregates only — no voter is ever identifiable. */
const MatchPredictionsPanel = ({ matches, tallies, myVotes, onVote }: MatchPredictionsPanelProps) => {
  const { t } = useLanguage();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [failedId, setFailedId] = useState<string | null>(null);
  const [showEvaluation, setShowEvaluation] = useState(false);

  const open = matches.filter((m) => !m.winner && isPlayable(m));
  const evaluation = evaluatePredictions(matches, tallies, myVotes);
  if (open.length === 0 && evaluation.decided.length === 0) return null;

  const handleVote = async (matchId: string, player: string) => {
    setPendingId(matchId);
    setFailedId(null);
    const ok = await onVote(matchId, player);
    if (!ok) setFailedId(matchId);
    setPendingId(null);
  };

  const tipsLabel = (n: number) => (n === 0 ? t("pt.noTipsYet") : `${n} ${n === 1 ? t("pt.tipOne") : t("pt.tipMany")}`);

  return (
    <div className="gradient-card border border-border shadow-elevation-sm rounded-xl p-3 sm:p-4 mb-4">
      <div className="flex items-baseline justify-between gap-2 mb-3">
        <h3 className="font-display uppercase text-sm text-muted-foreground">{t("pt.predictionsHeading")}</h3>
        <span className="text-[11px] text-muted-foreground font-mono shrink-0">{tipsLabel(evaluation.totalTips)}</span>
      </div>

      {open.length > 0 && (
        <div className="space-y-3">
          {open.map((m) => {
            const tally = tallies[m.id] ?? {};
            const votes1 = tally[m.player1!] ?? 0;
            const votes2 = tally[m.player2!] ?? 0;
            const total = votes1 + votes2;
            const pct1 = total > 0 ? Math.round((votes1 / total) * 100) : 0;
            const myVote = myVotes[m.id];
            return (
              <div key={m.id} className="rounded-lg border border-border/60 p-2.5 sm:p-3">
                <div className="grid grid-cols-2 gap-2">
                  {[m.player1!, m.player2!].map((player, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => handleVote(m.id, player)}
                      disabled={pendingId === m.id}
                      className={`rounded-lg px-2 py-2.5 min-h-[44px] text-sm font-semibold transition-all border disabled:opacity-50 ${
                        myVote === player ? "bg-primary/15 border-primary text-primary" : "bg-muted/30 border-border hover:border-primary/40"
                      }`}
                    >
                      <span className="block break-words leading-tight uppercase tracking-wide text-[13px]">{player}</span>
                      {total > 0 && <span className="block text-xs mt-1 font-mono">{idx === 0 ? pct1 : 100 - pct1}%</span>}
                    </button>
                  ))}
                </div>
                {total > 0 && (
                  <div className="h-1.5 rounded-full overflow-hidden flex bg-muted mt-2">
                    <div className="h-full bg-primary" style={{ width: `${pct1}%` }} />
                    <div className="h-full bg-secondary flex-1" />
                  </div>
                )}
                <p className="text-[10px] text-muted-foreground mt-1.5 text-center">{tipsLabel(total)}</p>
                {failedId === m.id && (
                  <p className="text-[10px] text-destructive mt-1 text-center">{t("pt.predictionFailed")}</p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {evaluation.decided.length > 0 && (
        <div className={open.length > 0 ? "mt-4 pt-3 border-t border-border/60" : ""}>
          <button
            type="button"
            onClick={() => setShowEvaluation((v) => !v)}
            className="w-full flex items-center justify-between gap-2 text-left"
            aria-expanded={showEvaluation}
          >
            <span className="font-display uppercase text-xs text-muted-foreground">{t("pt.evaluationHeading")}</span>
            {showEvaluation ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
          </button>

          <div className="grid grid-cols-2 gap-2 mt-2 text-center">
            <div className="rounded-lg bg-muted/30 py-2">
              <div className="text-lg font-display leading-none">
                {evaluation.crowdDecided > 0 ? `${evaluation.crowdCorrect}/${evaluation.crowdDecided}` : "–"}
              </div>
              <div className="text-[10px] text-muted-foreground mt-1">{t("pt.crowdRight")}</div>
            </div>
            <div className="rounded-lg bg-muted/30 py-2">
              <div className="text-lg font-display leading-none">
                {evaluation.myDecided > 0 ? `${evaluation.myCorrect}/${evaluation.myDecided}` : "–"}
              </div>
              <div className="text-[10px] text-muted-foreground mt-1">{t("pt.youRight")}</div>
            </div>
          </div>
          {evaluation.tipAccuracyPct !== null && (
            <p className="text-[11px] text-muted-foreground text-center mt-2">
              {evaluation.tipAccuracyPct}% {t("pt.tipsHit")}
            </p>
          )}

          {showEvaluation && (
            <div className="mt-3 space-y-1.5">
              {evaluation.decided.map((e) => (
                <div key={e.match.id} className="rounded-lg border border-border/60 px-2.5 py-2 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 break-words font-semibold">
                      <span className={e.match.winner === e.match.player1 ? "text-primary" : "text-muted-foreground"}>{e.match.player1}</span>
                      <span className="text-muted-foreground"> – </span>
                      <span className={e.match.winner === e.match.player2 ? "text-primary" : "text-muted-foreground"}>{e.match.player2}</span>
                    </span>
                    <span className="text-[10px] text-muted-foreground font-mono shrink-0">{tipsLabel(e.total)}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1 text-[10px] text-muted-foreground">
                    {e.total > 0 && (
                      <span className="inline-flex items-center gap-1">
                        {e.crowdCorrect === true && <Check className="w-3 h-3 text-primary" />}
                        {e.crowdCorrect === false && <X className="w-3 h-3 text-destructive" />}
                        {e.crowdPick
                          ? `${t("pt.crowdPicked")} ${e.crowdPick} (${Math.round((Math.max(e.votes1, e.votes2) / e.total) * 100)}%)`
                          : t("pt.crowdTied")}
                      </span>
                    )}
                    {e.myPick && (
                      <span className="inline-flex items-center gap-1">
                        {e.myCorrect ? <Check className="w-3 h-3 text-primary" /> : <X className="w-3 h-3 text-destructive" />}
                        {t("pt.youPicked")} {e.myPick}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      <p className="text-[9px] text-muted-foreground/60 mt-3 text-center">{t("pt.predictionsDisclaimer")}</p>
    </div>
  );
};

export default MatchPredictionsPanel;
