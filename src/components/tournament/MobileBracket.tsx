import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Trophy } from "lucide-react";
import type { Match } from "@/utils/tournament";
import { isPlayable, isRealPlayer, isLiveSnapshotFresh, roundLabelFor, scorekeeperLabel } from "@/utils/tournament";
import { useLanguage } from "@/contexts/LanguageContext";

interface MobileBracketProps {
  matches: Match[];
  totalRounds: number;
  roundConfigs?: { mode: string; bestOf: number }[];
  fallbackMode?: string;
  fallbackBestOf?: number;
}

/**
 * Phone-first bracket: one round at a time as full-width cards instead of a scaled-down tree.
 * The mirrored tree is unreadable below ~768px (fit-to-screen shrinks it to a few pixels), so on
 * small screens a round selector (chips + prev/next) shows only the round you care about — it
 * starts on the round that is actually being played — with names that wrap (team names such as
 * "Anna & Ben" never get cut off), final scores, live leg counts, board and scorekeeper.
 */
const MobileBracket = ({ matches, totalRounds, roundConfigs, fallbackMode, fallbackBestOf }: MobileBracketProps) => {
  const { t } = useLanguage();
  const hasPrelim = matches.some((m) => m.round === 0);
  const rounds = useMemo(
    () => [...(hasPrelim ? [0] : []), ...Array.from({ length: totalRounds }, (_, i) => i + 1)],
    [hasPrelim, totalRounds],
  );

  const activeRound = useMemo(() => {
    const open = matches.filter((m) => !m.winner && isPlayable(m));
    if (open.length > 0) return Math.min(...open.map((m) => m.round));
    // Nothing playable: show the last round that has any result (or the final once finished).
    const decided = matches.filter((m) => m.winner && isRealPlayer(m.player1) && isRealPlayer(m.player2));
    return decided.length > 0 ? Math.max(...decided.map((m) => m.round)) : rounds[0];
  }, [matches, rounds]);

  const [selected, setSelected] = useState<number>(activeRound);
  const [followActive, setFollowActive] = useState(true);
  // Follows the action until the viewer picks a round themselves, then stays put.
  useEffect(() => { if (followActive) setSelected(activeRound); }, [activeRound, followActive]);

  const pick = (round: number) => { setFollowActive(false); setSelected(round); };
  const idx = rounds.indexOf(selected);
  const label = (round: number) => roundLabelFor(round, totalRounds, t);
  const roundHasAction = (round: number) => matches.some((m) => m.round === round && !m.winner && isPlayable(m));
  const roundDone = (round: number) => {
    const list = matches.filter((m) => m.round === round && isRealPlayer(m.player1) && isRealPlayer(m.player2));
    return list.length > 0 && list.every((m) => m.winner);
  };

  const list = matches.filter((m) => m.round === selected).sort((a, b) => a.position - b.position);
  const cfg = (roundConfigs || [])[selected - 1];
  const bestOf = cfg?.bestOf || fallbackBestOf;

  return (
    <div>
      <div className="flex items-center gap-1.5 mb-3">
        <button
          type="button"
          onClick={() => idx > 0 && pick(rounds[idx - 1])}
          disabled={idx <= 0}
          aria-label={t("pt.prevRound")}
          className="shrink-0 h-10 w-10 rounded-lg border border-border bg-card flex items-center justify-center disabled:opacity-30"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
        <div className="flex-1 min-w-0 overflow-x-auto flex gap-1.5 py-0.5 snap-x" style={{ scrollbarWidth: "none" }}>
          {rounds.map((r) => (
            <button
              key={r}
              type="button"
              ref={r === selected ? (el) => el?.scrollIntoView({ block: "nearest", inline: "center" }) : undefined}
              onClick={() => pick(r)}
              className={`snap-center shrink-0 h-10 px-3 rounded-lg border text-xs font-display uppercase tracking-wide flex items-center gap-1.5 transition-colors ${
                r === selected ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-muted-foreground"
              }`}
            >
              {roundHasAction(r) && <span className={`h-1.5 w-1.5 rounded-full animate-pulse ${r === selected ? "bg-primary-foreground" : "bg-primary"}`} />}
              {roundDone(r) && r !== selected && <span aria-hidden>✓</span>}
              {label(r)}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => idx < rounds.length - 1 && pick(rounds[idx + 1])}
          disabled={idx >= rounds.length - 1}
          aria-label={t("pt.nextRound")}
          className="shrink-0 h-10 w-10 rounded-lg border border-border bg-card flex items-center justify-center disabled:opacity-30"
        >
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>

      <div className="flex items-center justify-between mb-2 px-0.5">
        <h3 className="font-display uppercase text-sm flex items-center gap-2">
          {selected === totalRounds && <Trophy className="w-4 h-4 text-accent" />}
          {label(selected)}
        </h3>
        <span className="text-[11px] text-primary/80 font-mono">
          {cfg?.mode || fallbackMode} · FT{Math.ceil((bestOf || 1) / 2)}
        </span>
      </div>

      <div className="space-y-2">
        {list.length === 0 && <p className="text-xs text-muted-foreground px-1">{t("pt.roundNotReachedYet")}</p>}
        {list.map((m) => {
          const playable = !m.winner && isPlayable(m);
          const liveFresh = playable && isLiveSnapshotFresh(m.live);
          const keeper = !m.winner ? scorekeeperLabel(m, matches) : null;
          return (
            <div
              key={m.id}
              className={`rounded-xl border bg-card overflow-hidden ${m.winner ? "border-border" : playable ? "border-primary/60 glow-cyan" : "border-border/50"}`}
            >
              {[m.player1, m.player2].map((player, i) => {
                const real = isRealPlayer(player);
                const won = !!m.winner && m.winner === player;
                const score = liveFresh ? (i === 0 ? m.live!.legs1 : m.live!.legs2) : (i === 0 ? m.score1 ?? 0 : m.score2 ?? 0);
                return (
                  <div
                    key={i}
                    className={`flex items-center justify-between gap-3 px-3 py-2.5 ${i === 0 ? "border-b border-border" : ""} ${
                      won ? "bg-secondary/15 text-secondary font-semibold" : !real ? "text-muted-foreground/40" : m.winner ? "text-muted-foreground" : ""
                    }`}
                  >
                    <span className="min-w-0 break-words leading-tight uppercase tracking-wide text-sm">
                      {player && real ? player : player === "BYE" ? "BYE" : t("tournament.tbdPlaceholder")}
                    </span>
                    <span className={`shrink-0 font-display text-xl tabular-nums ${liveFresh ? "text-accent" : ""}`}>{score}</span>
                  </div>
                );
              })}
              {!m.winner && (liveFresh || m.board || keeper) && (
                <div className="px-3 py-1.5 bg-muted/20 border-t border-border/60 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                  <span className="min-w-0 break-words">{keeper ? `✍️ ${keeper}` : ""}</span>
                  <span className="shrink-0 flex items-center gap-2">
                    {liveFresh && (
                      <span className="flex items-center gap-1 text-accent">
                        <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent animate-pulse" /> {t("tournament.live")}
                      </span>
                    )}
                    {m.board ? <span className="font-mono">{t("camera.board")} {m.board}</span> : null}
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default MobileBracket;
