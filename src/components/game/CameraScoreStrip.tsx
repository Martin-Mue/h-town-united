import ArenaScoreboard, { type ArenaScoreCard } from "@/components/game/ArenaScoreboard";

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
 * The scoreboard inside the full-screen camera: the play screen's own scoreboard (diagonal cards, big number for
 * whoever is on the oche) in its compact size, so the picture keeps its height. The full play screen is hidden
 * behind the camera, and a player must not have to close it to see their own score while throwing.
 */
const CameraScoreStrip = ({ cards, info, showLegs, showSets, labels }: CameraScoreStripProps) => {
  const arenaCards: ArenaScoreCard[] = cards.map((c) => ({
    key: c.key, name: c.name, isBot: false, isActive: c.isActive, startedLeg: c.startedLeg, score: c.score,
    legsWon: c.legsWon, setsWon: c.setsWon, legAvg: c.legAvg, matchAvg: c.matchAvg, lastVisit: "–", p180: 0, leading: c.isLeading,
  }));
  return (
    <div className="shrink-0 border-b border-border/60 bg-background px-2 pb-1.5 pt-2">
      <ArenaScoreboard
        compact
        cards={arenaCards}
        showLegs={showLegs}
        showSets={showSets}
        isCricket={false}
        labels={{ leg: labels.legs, set: labels.sets, lastVisit: "", legAvg: labels.legAvg, matchAvg: labels.matchAvg, starts: labels.starts, throwing: "", inARow: "", leading: labels.leading }}
      />
      <p className="mt-1 truncate text-center text-[10px] text-muted-foreground">{info}</p>
    </div>
  );
};

export default CameraScoreStrip;
