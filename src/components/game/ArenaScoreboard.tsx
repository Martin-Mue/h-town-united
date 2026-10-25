import type { CSSProperties, ReactNode } from "react";
import { Bot, Crosshair } from "lucide-react";
import AnimatedScore from "@/components/AnimatedScore";

export interface ArenaScoreCard {
  key: number;
  name: string;
  /** Team roster under the name, when it differs from the name. */
  subLabel?: string;
  isBot: boolean;
  isActive: boolean;
  /** This player/team threw first in the current leg. */
  startedLeg: boolean;
  /** The big number: remaining points (X01) or points (Cricket). */
  score: number;
  /** Small line under the score, e.g. "(501 − 60 live)". */
  scoreNote?: string;
  legsWon: number;
  setsWon?: number;
  legAvg: string;
  matchAvg: string;
  lastVisit: string;
  p180: number;
  /** Legs won in a row (2 or more), for the fire badge. */
  streak?: number;
  /** A bot is currently throwing. */
  throwing?: boolean;
  /** The score is flashing after a change. */
  flashing?: boolean;
  /** The score is a live preview from the camera/Autodarts, not yet committed. */
  preview?: boolean;
  /** Fewest points left in a multi-sided match: shown as a small ▲ next to the name. */
  leading?: boolean;
}

interface ArenaScoreboardProps {
  cards: ArenaScoreCard[];
  showLegs: boolean;
  showSets: boolean;
  isCricket: boolean;
  /** Smaller cards (the camera view, where the picture needs the height). */
  compact?: boolean;
  labels: { leg: string; set: string; lastVisit: string; legAvg: string; matchAvg: string; starts: string; throwing: string; inARow: string; leading?: string };
  /** Extra lines for the active card (single-out note, ghost pace). */
  activeExtra?: ReactNode;
}

// The panel has its own fixed dark surface whatever the app theme is (same approach as the classic scoreboard):
// the semantic classes inside resolve against these dark values.
const DARK_VARS = {
  "--background": "222 30% 5%", "--foreground": "210 15% 92%",
  "--card": "222 25% 9%", "--card-foreground": "210 15% 92%",
  "--primary": "185 85% 48%", "--primary-foreground": "222 30% 5%",
  "--secondary": "155 65% 42%", "--secondary-foreground": "0 0% 100%",
  "--muted": "222 20% 14%", "--muted-foreground": "222 12% 50%",
  "--accent": "45 100% 58%", "--accent-foreground": "222 30% 5%",
  "--border": "222 18% 14%",
} as CSSProperties;

const ACTIVE_HSL = "hsl(185 85% 48%)";
/** Width of the diagonal cut between two cards, px. */
const SLANT = 16;
/** Gap between the two diagonal edges, px. */
const SLANT_GAP = 5;

const clipFor = (side: "left" | "right" | "none"): CSSProperties =>
  side === "left"
    ? { clipPath: `polygon(0 0, 100% 0, calc(100% - ${SLANT}px) 100%, 0 100%)` }
    : side === "right"
      ? { clipPath: `polygon(${SLANT}px 0, 100% 0, 100% 100%, 0 100%)`, marginLeft: `${SLANT_GAP - SLANT}px` }
      : {};

const scoreColor = (card: ArenaScoreCard) =>
  card.flashing || card.preview ? "hsl(45 100% 58%)" : card.isActive ? "hsl(210 15% 96%)" : "hsl(210 15% 58%)";

const Chips = ({ card, showLegs, showSets, labels }: { card: ArenaScoreCard } & Pick<ArenaScoreboardProps, "showLegs" | "showSets" | "labels">) =>
  showLegs || showSets ? (
    <span className="flex shrink-0 items-center gap-1 font-display text-[11px] font-bold tabular-nums">
      {showSets && (
        <span className="rounded px-1.5 py-0.5" style={{ background: "hsl(155 65% 42% / 0.22)", color: "hsl(155 65% 62%)" }} title={labels.set}>
          {card.setsWon ?? 0} {labels.set}
        </span>
      )}
      {showLegs && (
        <span className="rounded px-1.5 py-0.5" style={{ background: "hsl(185 85% 48% / 0.2)", color: "hsl(185 85% 64%)" }} title={labels.leg}>
          {card.legsWon} {labels.leg}
        </span>
      )}
    </span>
  ) : null;

const NameLine = ({ card, labels, big }: { card: ArenaScoreCard; labels: ArenaScoreboardProps["labels"]; big: boolean }) => (
  <span className="flex min-w-0 items-center gap-1.5">
    {card.isActive && <span className="inline-block h-2 w-2 shrink-0 animate-pulse-glow rounded-full" style={{ background: ACTIVE_HSL }} />}
    {card.isBot && <Bot className="h-3.5 w-3.5 shrink-0" style={{ color: "hsl(155 65% 58%)" }} />}
    <span className={`truncate font-display font-semibold ${big ? "text-base tablet:text-2xl" : "text-sm tablet:text-lg"}`} style={{ color: card.isActive ? "hsl(210 15% 97%)" : "hsl(210 15% 72%)" }}>
      {card.name}
    </span>
    {card.leading && <span title={labels.leading} aria-label={labels.leading} className="shrink-0 text-[10px]" style={{ color: "hsl(155 65% 58%)" }}>▲</span>}
    {card.startedLeg && (
      <span title={labels.starts} aria-label={labels.starts} className="shrink-0" style={{ color: "hsl(45 100% 58%)" }}>
        <Crosshair className="h-3 w-3" />
      </span>
    )}
  </span>
);

const ActiveBlock = ({ card, side, showLegs, showSets, isCricket, compact, labels, activeExtra }: { card: ArenaScoreCard; side: "left" | "none" } & Omit<ArenaScoreboardProps, "cards">) => (
  <div
    className={`relative min-w-0 text-left ${compact ? "px-2.5 pb-1 pt-2" : "px-3 pb-2 pt-2.5 portrait:short:pb-1 portrait:short:pt-1.5 tablet:px-5 tablet:pb-3 tablet:pt-4"}`}
    style={{
      ...clipFor(side),
      color: "hsl(210 15% 92%)",
      background: "linear-gradient(120deg, hsl(185 70% 26% / 0.85), hsl(222 30% 9%) 78%)",
      paddingRight: side === "left" ? `${SLANT + 10}px` : undefined,
    }}
  >
    <span aria-hidden className="absolute inset-x-0 top-0 h-[3px]" style={{ background: ACTIVE_HSL }} />
    <div className="flex items-center justify-between gap-2">
      <NameLine card={card} labels={labels} big />
      <Chips card={card} showLegs={showLegs} showSets={showSets} labels={labels} />
    </div>
    {card.subLabel && <p className="truncate text-[10px]" style={{ color: "hsl(185 60% 72%)" }}>{card.subLabel}</p>}
    {card.throwing ? (
      <p className="mt-3 flex w-fit items-center gap-2 rounded-full px-3 py-1.5 text-sm font-display animate-pulse" style={{ color: "hsl(155 65% 62%)", background: "hsl(155 65% 42% / 0.16)" }}>
        <Bot className="h-4 w-4" /> {labels.throwing}…
      </p>
    ) : (
      <div className="mt-1 flex items-end justify-between gap-2">
        <div className="flex shrink-0 flex-col gap-0.5 pb-1 text-[11px] tablet:text-sm tablet:gap-1 leading-tight" style={{ color: "hsl(210 15% 68%)" }}>
          {!isCricket && !compact && (
            <>
              <span className="whitespace-nowrap portrait:tiny:hidden">{labels.lastVisit} <b className="font-semibold tabular-nums" style={{ color: "hsl(210 15% 94%)" }}>{card.lastVisit}</b></span>
              <span className="whitespace-nowrap">{labels.legAvg} <b className="font-semibold tabular-nums" style={{ color: "hsl(210 15% 94%)" }}>{card.legAvg}</b></span>
              <span className="whitespace-nowrap">{labels.matchAvg} <b className="font-semibold tabular-nums" style={{ color: "hsl(210 15% 94%)" }}>{card.matchAvg}</b></span>
            </>
          )}
          {compact && (
            <>
              <span className="whitespace-nowrap">{labels.legAvg} <b className="font-semibold tabular-nums" style={{ color: "hsl(210 15% 94%)" }}>{card.legAvg}</b></span>
              <span className="whitespace-nowrap">{labels.matchAvg} <b className="font-semibold tabular-nums" style={{ color: "hsl(210 15% 94%)" }}>{card.matchAvg}</b></span>
            </>
          )}
          {card.p180 > 0 && <span className="font-bold" style={{ color: "hsl(45 100% 62%)" }}>🎯 {card.p180}×180</span>}
          {card.streak ? <span className="font-bold" style={{ color: "hsl(25 95% 62%)" }}>🔥 {card.streak} {labels.inARow}</span> : null}
        </div>
        <p
          className={`font-display leading-[0.95] tabular-nums transition-colors ${compact ? "text-[3.1rem]" : "text-[4.25rem] portrait:short:text-[3rem] portrait:tablet:!text-[5.5rem]"} ${card.flashing ? "animate-pulse-glow" : ""}`}
          style={{ color: scoreColor(card), textShadow: `0 0 24px ${scoreColor(card)}66` }}
        >
          <AnimatedScore value={card.score} />
        </p>
      </div>
    )}
    {(!compact || card.scoreNote) && <p className="min-h-[14px] portrait:short:min-h-[2px] text-right text-[10px]" style={{ color: "hsl(210 15% 55%)" }}>{card.scoreNote}</p>}
    {activeExtra}
  </div>
);

const WaitingBlock = ({ card, side, showLegs, showSets, isCricket, compact, labels }: { card: ArenaScoreCard; side: "right" | "none" } & Omit<ArenaScoreboardProps, "cards" | "activeExtra">) => (
  <div
    className={`relative min-w-0 text-left ${compact ? "px-2.5 pb-1 pt-2" : "px-3 pb-2 pt-2.5 portrait:short:pb-1 portrait:short:pt-1.5 tablet:px-5 tablet:pb-3 tablet:pt-4"}`}
    style={{ ...clipFor(side), color: "hsl(210 15% 70%)", background: "hsl(222 28% 8.5%)", paddingLeft: side === "right" ? `${SLANT + 8}px` : undefined }}
  >
    <div className="flex items-center justify-between gap-1.5">
      <NameLine card={card} labels={labels} big={false} />
    </div>
    <div className="mt-0.5 flex justify-end"><Chips card={card} showLegs={showLegs} showSets={showSets} labels={labels} /></div>
    <p className={`mt-1 text-right font-display leading-none tabular-nums ${compact ? "text-3xl" : "text-4xl portrait:short:text-3xl tablet:text-6xl"}`} style={{ color: scoreColor(card) }}>
      <AnimatedScore value={card.score} />
    </p>
    {!isCricket && !compact && <p className="mt-1 text-right text-[10px]" style={{ color: "hsl(210 15% 52%)" }}>{labels.legAvg} {card.legAvg}</p>}
  </div>
);

/**
 * The play screen's scoreboard in "arena" form: whoever is on the oche gets the large, diagonally cut card with
 * the big number, the other side sits next to it as a darker, smaller one. Two sides share a row and swap their
 * widths when the turn changes; three or more get the active card on top and the rest as a row of small cards.
 */
const ArenaScoreboard = ({ cards, showLegs, showSets, isCricket, compact, labels, activeExtra }: ArenaScoreboardProps) => {
  const shared = { showLegs, showSets, isCricket, compact, labels };
  if (compact && cards.length > 2) {
    // three or more sides in the camera view: one row of small cards, the one on the oche lit up
    return (
      <div className="overflow-hidden rounded-xl border" style={{ ...DARK_VARS, borderColor: "hsl(222 18% 16%)", background: "hsl(222 18% 16%)" }}>
        <div className="grid gap-px" style={{ gridTemplateColumns: `repeat(${Math.min(cards.length, 4)}, minmax(0, 1fr))` }}>
          {cards.map((card) => (
            <div key={card.key} className="relative min-w-0 px-2 pb-1 pt-1.5 text-left" style={{ background: card.isActive ? "linear-gradient(120deg, hsl(185 70% 26% / 0.85), hsl(222 30% 9%) 85%)" : "hsl(222 28% 8.5%)" }}>
              {card.isActive && <span aria-hidden className="absolute inset-x-0 top-0 h-[3px]" style={{ background: ACTIVE_HSL }} />}
              <NameLine card={card} labels={labels} big={false} />
              <p className={`mt-0.5 font-display leading-none tabular-nums ${card.isActive ? "text-4xl" : "text-3xl"}`} style={{ color: scoreColor(card) }}>
                <AnimatedScore value={card.score} />
              </p>
              <p className="mt-0.5 flex items-center justify-between text-[10px]" style={{ color: "hsl(210 15% 58%)" }}>
                <span>{card.legAvg}</span>
                {(showLegs || showSets) && <span className="font-bold" style={{ color: "hsl(185 85% 64%)" }}>{showSets ? `${card.setsWon ?? 0}S ` : ""}{showLegs ? `${card.legsWon}L` : ""}</span>}
              </p>
            </div>
          ))}
        </div>
      </div>
    );
  }
  if (cards.length === 2) {
    const activeFirst = cards[0].isActive;
    return (
      <div className="overflow-hidden rounded-xl border" style={{ ...DARK_VARS, borderColor: "hsl(222 18% 16%)", background: "hsl(222 30% 5%)" }}>
        <div className="grid transition-[grid-template-columns] duration-300" style={{ gridTemplateColumns: activeFirst ? "1.9fr 1fr" : "1fr 1.9fr" }}>
          {cards.map((card, i) =>
            card.isActive ? (
              <ActiveBlock key={card.key} card={card} side={i === 0 ? "left" : "none"} {...shared} activeExtra={activeExtra} />
            ) : (
              <WaitingBlock key={card.key} card={card} side={i === 1 ? "right" : "none"} {...shared} />
            ),
          )}
        </div>
      </div>
    );
  }
  const active = cards.find((c) => c.isActive) ?? cards[0];
  const others = cards.filter((c) => c !== active);
  return (
    <div className="overflow-hidden rounded-xl border" style={{ ...DARK_VARS, borderColor: "hsl(222 18% 16%)", background: "hsl(222 30% 5%)" }}>
      <ActiveBlock card={active} side="none" {...shared} activeExtra={activeExtra} />
      {others.length > 0 && (
        <div className="grid gap-px" style={{ gridTemplateColumns: `repeat(${Math.min(others.length, 4)}, minmax(0, 1fr))`, background: "hsl(222 18% 16%)" }}>
          {others.map((card) => (
            <WaitingBlock key={card.key} card={card} side="none" {...shared} />
          ))}
        </div>
      )}
    </div>
  );
};

export default ArenaScoreboard;
