import { Crosshair } from "lucide-react";

export interface CameraScoreCard {
  key: number;
  name: string;
  /** Score shown big (for X01 the remaining points, already including darts of the running round). */
  score: number;
  isActive: boolean;
  /** This player/team threw first in the current leg. */
  startedLeg: boolean;
  /** Fewest points left = ahead in this leg (X01 only). */
  isLeading: boolean;
  legsWon: number;
  setsWon?: number;
  /** Average of this leg / of the whole match, already formatted. */
  legAvg: string;
  matchAvg: string;
}

interface CameraScoreStripProps {
  cards: CameraScoreCard[];
  /** "Leg 2 · Round 3 · Robin starts" style line. */
  info: string;
  showLegs: boolean;
  showSets: boolean;
  labels: { legAvg: string; matchAvg: string; leading: string; starts: string; legs: string; sets: string };
}

/**
 * The scoreboard inside the full-screen camera: who is throwing, how many points everybody has left, who is ahead,
 * who started the leg, the match score and the averages. The full scoreboard of the play screen is too tall to sit
 * above a camera picture, but without it the player cannot see their own score while throwing.
 */
const CameraScoreStrip = ({ cards, info, showLegs, showSets, labels }: CameraScoreStripProps) => (
  <div className="shrink-0 border-b border-border/60 bg-background px-2 pb-1.5 pt-2">
    <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${Math.min(cards.length, 4)}, minmax(0, 1fr))` }}>
      {cards.map((card) => (
        <div
          key={card.key}
          className={`relative min-w-0 rounded-xl border px-2.5 py-1.5 text-left ${
            card.isActive ? "border-primary/70 bg-primary/10 shadow-[0_0_18px_-8px_hsl(var(--primary))]" : "border-border/60 bg-card/50 opacity-80"
          }`}
        >
          <div className="flex items-center justify-between gap-1">
            <span className={`flex min-w-0 items-center gap-1 text-xs font-semibold ${card.isActive ? "text-foreground" : "text-muted-foreground"}`}>
              {card.isActive && <span className="inline-block h-2 w-2 shrink-0 animate-pulse-glow rounded-full bg-primary" />}
              <span className="truncate">{card.name}</span>
              {card.startedLeg && (
                <span title={labels.starts} aria-label={labels.starts} className="shrink-0 text-accent">
                  <Crosshair className="h-3 w-3" />
                </span>
              )}
            </span>
            {(showLegs || showSets) && (
              <span className="flex shrink-0 gap-1 text-[11px] font-display font-bold tabular-nums text-primary">
                {showSets && <span title={labels.sets}>{card.setsWon ?? 0}S</span>}
                {showLegs && <span title={labels.legs}>{card.legsWon}L</span>}
              </span>
            )}
          </div>
          <div className="flex items-end justify-between gap-1">
            <span className={`font-display leading-none tabular-nums ${card.isActive ? "text-5xl text-foreground" : "text-3xl text-muted-foreground"}`}>
              {card.score}
            </span>
            <span className="flex flex-col items-end pb-0.5 text-[10px] leading-tight text-muted-foreground">
              {card.isLeading && <span className="font-semibold text-secondary">▲ {labels.leading}</span>}
              <span>{labels.legAvg} {card.legAvg}</span>
              <span>{labels.matchAvg} {card.matchAvg}</span>
            </span>
          </div>
        </div>
      ))}
    </div>
    <p className="mt-1 truncate text-center text-[10px] text-muted-foreground">{info}</p>
  </div>
);

export default CameraScoreStrip;
