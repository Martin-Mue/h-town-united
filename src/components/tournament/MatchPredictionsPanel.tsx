import { useState } from "react";
import type { Match } from "@/utils/tournament";
import { isPlayable } from "@/utils/tournament";
import { useLanguage } from "@/contexts/LanguageContext";
import type { PredictionTallies } from "@/hooks/useMatchPredictions";

interface MatchPredictionsPanelProps {
  matches: Match[];
  tallies: PredictionTallies;
  myVotes: Record<string, string>;
  onVote: (matchId: string, player: string) => Promise<boolean>;
}

/** Spectator "who wins this match?" voting for every currently-open (both players known, not yet
 *  decided) match — a standalone card, not woven into LiveBracket/BracketList themselves, so it
 *  never touches either's already-careful auto-fit/glow/live-flash logic. KO tournaments only
 *  (see useMatchPredictions/the migration's own note on why round-robin isn't covered yet). */
const MatchPredictionsPanel = ({ matches, tallies, myVotes, onVote }: MatchPredictionsPanelProps) => {
  const { t } = useLanguage();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [failedId, setFailedId] = useState<string | null>(null);

  const open = matches.filter((m) => !m.winner && isPlayable(m));
  if (open.length === 0) return null;

  const handleVote = async (matchId: string, player: string) => {
    setPendingId(matchId);
    setFailedId(null);
    const ok = await onVote(matchId, player);
    if (!ok) setFailedId(matchId);
    setPendingId(null);
  };

  return (
    <div className="bg-card border border-border rounded-xl p-4 mb-4">
      <h3 className="font-display uppercase text-sm text-muted-foreground mb-3">{t("pt.predictionsHeading")}</h3>
      <div className="space-y-3">
        {open.map((m) => {
          const tally = tallies[m.id] ?? {};
          const votes1 = tally[m.player1!] ?? 0;
          const votes2 = tally[m.player2!] ?? 0;
          const total = votes1 + votes2;
          const pct1 = total > 0 ? Math.round((votes1 / total) * 100) : 0;
          const myVote = myVotes[m.id];
          return (
            <div key={m.id} className="rounded-lg border border-border/60 p-3">
              <div className="grid grid-cols-2 gap-2">
                {[m.player1!, m.player2!].map((player, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => handleVote(m.id, player)}
                    disabled={pendingId === m.id}
                    className={`rounded-lg px-3 py-2.5 text-sm font-semibold transition-all border disabled:opacity-50 ${
                      myVote === player ? "bg-primary/15 border-primary text-primary" : "bg-muted/30 border-border hover:border-primary/40"
                    }`}
                  >
                    <span className="block truncate uppercase tracking-wide">{player}</span>
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
              {failedId === m.id && (
                <p className="text-[10px] text-destructive mt-1.5 text-center">{t("pt.predictionFailed")}</p>
              )}
            </div>
          );
        })}
      </div>
      <p className="text-[9px] text-muted-foreground/60 mt-3 text-center">{t("pt.predictionsDisclaimer")}</p>
    </div>
  );
};

export default MatchPredictionsPanel;
