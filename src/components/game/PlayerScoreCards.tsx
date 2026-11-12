import type { ReactNode } from "react";
import { Bot, Crosshair } from "lucide-react";
import AnimatedScore from "@/components/AnimatedScore";
import type { ArenaScoreCard } from "@/components/game/ArenaScoreboard";

export interface PlayerScoreCardLabels {
  set: string;
  lastVisit: string;
  legAvg: string;
  matchAvg: string;
  starts: string;
  throwing: string;
  inARow: string;
  /** "{won} of {total} legs", read out for the leg dots. */
  legsWonOf: string;
}

interface PlayerScoreCardsProps {
  cards: ArenaScoreCard[];
  /** Legs needed to win the match (or the set) — draws that many dots; 0 hides them. */
  legsToWin: number;
  showSets: boolean;
  isCricket: boolean;
  labels: PlayerScoreCardLabels;
  /** Extra lines under the active card (single-out note, ghost pace). */
  activeExtra?: ReactNode;
}

/** Above this many legs to win, dots stop being readable — a "2/6" count is shown instead. */
const MAX_LEG_DOTS = 5;

const scoreTone = (card: ArenaScoreCard) =>
  card.flashing || card.preview ? "text-accent" : card.isActive ? "text-foreground" : "text-muted-foreground";

/** Legs won so far as filled dots (gold) out of the legs needed, plus a set count in set play. */
const LegProgress = ({ card, legsToWin, showSets, labels }: { card: ArenaScoreCard; legsToWin: number; showSets: boolean; labels: PlayerScoreCardLabels }) => {
  if (legsToWin <= 1 && !showSets) return null;
  const legsLabel = labels.legsWonOf.replace("{won}", String(card.legsWon)).replace("{total}", String(legsToWin));
  return (
    <span className="flex shrink-0 items-center gap-1.5">
      {showSets && (
        <span className="rounded-md bg-secondary/15 px-1.5 py-0.5 font-display text-[11px] font-bold tabular-nums text-secondary" title={labels.set}>
          {card.setsWon ?? 0} {labels.set}
        </span>
      )}
      {legsToWin > 1 && (legsToWin <= MAX_LEG_DOTS ? (
        <span role="img" aria-label={legsLabel} title={legsLabel} className="flex gap-1">
          {Array.from({ length: legsToWin }, (_, i) => (
            <span key={i} className={`h-2.5 w-2.5 rounded-full ${i < card.legsWon ? "bg-accent" : "bg-border"}`} />
          ))}
        </span>
      ) : (
        <span aria-label={legsLabel} title={legsLabel} className="font-display text-xs font-bold tabular-nums text-accent">
          {card.legsWon}/{legsToWin}
        </span>
      ))}
    </span>
  );
};

const NameRow = ({ card, labels }: { card: ArenaScoreCard; labels: PlayerScoreCardLabels }) => (
  <span className="flex min-w-0 items-center gap-1.5">
    {card.isBot && <Bot className="h-3.5 w-3.5 shrink-0 text-secondary" />}
    <span className={`truncate text-sm font-semibold tablet:text-lg ${card.isActive ? "text-primary" : "text-muted-foreground"}`}>{card.name}</span>
    {card.startedLeg && (
      <span title={labels.starts} aria-label={labels.starts} className="shrink-0 text-accent">
        <Crosshair className="h-3 w-3" />
      </span>
    )}
  </span>
);

/** Ø line, last visit and the little badges (180s, legs in a row) at the foot of a card. */
const StatLines = ({ card, labels, isCricket }: { card: ArenaScoreCard; labels: PlayerScoreCardLabels; isCricket: boolean }) => {
  if (card.throwing) {
    return (
      <p className="flex w-fit items-center gap-1.5 rounded-full bg-secondary/15 px-2 py-0.5 text-xs text-secondary animate-pulse">
        <Bot className="h-3.5 w-3.5" /> {labels.throwing}…
      </p>
    );
  }
  const badges = (
    <>
      {card.p180 > 0 && <span className="shrink-0 font-semibold text-accent">🎯 {card.p180}×180</span>}
      {card.streak ? <span className="shrink-0 font-semibold text-accent">🔥 {card.streak} {labels.inARow}</span> : null}
    </>
  );
  if (isCricket) {
    return <p className="flex min-h-[1rem] gap-2 text-xs">{badges}</p>;
  }
  return (
    <div className="min-w-0 text-xs leading-snug text-muted-foreground tablet:text-sm">
      <p className="flex min-w-0 gap-2">
        <span className="truncate">
          {labels.legAvg} <span className="tabular-nums text-foreground">{card.legAvg}</span>
          <span className="compactland:hidden portrait:short:hidden"> · {labels.matchAvg} <span className="tabular-nums text-foreground">{card.matchAvg}</span></span>
        </span>
        {badges}
      </p>
      {/* Low screens drop this line so the number pad keeps finger-sized keys. */}
      <p className="truncate portrait:short:hidden">{labels.lastVisit} <span className="tabular-nums text-foreground">{card.lastVisit}</span></p>
    </div>
  );
};

/** One side of the scoreboard: name + leg dots, the big remaining score, stats at the foot. */
const PlayerScoreCard = ({ card, legsToWin, showSets, isCricket, labels, activeExtra, size }: Omit<PlayerScoreCardsProps, "cards"> & { card: ArenaScoreCard; size: "large" | "small" }) => (
  <div
    aria-current={card.isActive ? "true" : undefined}
    className={`flex min-w-0 flex-col rounded-2xl border-2 px-3 py-2 transition-colors portrait:short:py-1.5 tablet:px-4 tablet:py-3 ${
      card.isActive ? "border-primary bg-card" : "border-muted bg-card/40"
    }`}
  >
    <div className="flex items-center justify-between gap-2">
      <NameRow card={card} labels={labels} />
      <LegProgress card={card} legsToWin={legsToWin} showSets={showSets} labels={labels} />
    </div>
    {card.subLabel && <p className="truncate text-[10px] text-muted-foreground">{card.subLabel}</p>}
    <p
      className={`overflow-hidden font-display font-bold leading-[0.95] tabular-nums transition-colors ${scoreTone(card)} ${card.flashing ? "animate-pulse-glow" : ""} ${
        size === "large"
          ? "text-[min(5.25rem,calc(27vw_-_1.5rem))] portrait:short:text-[3.5rem] portrait:tiny:text-[3rem] compactland:text-[3.5rem] portrait:tablet:!text-[7rem]"
          : "text-4xl portrait:short:text-3xl portrait:tablet:text-5xl"
      }`}
    >
      {/* Sized for three digits; a four-digit score (custom start, Cricket points) steps down so it still fits. */}
      <span style={card.score >= 1000 ? { fontSize: "0.75em" } : undefined}>
        <AnimatedScore value={card.score} />
      </span>
    </p>
    {card.scoreNote && <p className="text-[10px] text-muted-foreground">{card.scoreNote}</p>}
    {size === "large" && (
      <div className="mt-auto pt-0.5">
        <StatLines card={card} labels={labels} isCricket={isCricket} />
        {card.isActive && activeExtra}
      </div>
    )}
  </div>
);

/**
 * The manual play screen's scoreboard: one card per side with the remaining score as the biggest thing on the
 * screen, the side on the oche outlined in the accent colour. Two sides share a row as equal halves; three or more
 * get the side on the oche as a full-width card with the others as small cards below it, so the height stays
 * bounded however many play.
 */
const PlayerScoreCards = ({ cards, ...shared }: PlayerScoreCardsProps) => {
  if (cards.length <= 2) {
    return (
      <div className={`grid gap-2 tablet:gap-3 ${cards.length === 2 ? "grid-cols-2" : "grid-cols-1"}`}>
        {cards.map((card) => <PlayerScoreCard key={card.key} card={card} size="large" {...shared} />)}
      </div>
    );
  }
  const active = cards.find((c) => c.isActive) ?? cards[0];
  const others = cards.filter((c) => c !== active);
  return (
    <>
      <div className="space-y-2 compactland:hidden">
        <PlayerScoreCard card={active} size="large" {...shared} />
        <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${Math.min(others.length, 4)}, minmax(0, 1fr))` }}>
          {others.map((card) => <PlayerScoreCard key={card.key} card={card} size="small" {...shared} />)}
        </div>
      </div>
      {/* A phone held sideways has no height for a big card on top: every side as a small card in one row,
          the one on the oche outlined. */}
      <div className="hidden gap-2 compactland:grid" style={{ gridTemplateColumns: `repeat(${Math.min(cards.length, 4)}, minmax(0, 1fr))` }}>
        {cards.map((card) => <PlayerScoreCard key={card.key} card={card} size="small" {...shared} />)}
      </div>
    </>
  );
};

export default PlayerScoreCards;
