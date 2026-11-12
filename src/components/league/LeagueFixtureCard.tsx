import type { ReactNode } from "react";

interface FixtureSide {
  name: string;
  emoji: string | null;
  isWinner: boolean;
}

interface LeagueFixtureCardProps {
  player1: FixtureSide;
  player2: FixtureSide;
  /** Legs score once the fixture is finished; null while it is still open. */
  score: { player1: number | null; player2: number | null } | null;
  /** Play / online / enter-result buttons for an open fixture. */
  actions?: ReactNode;
}

const nameClass = (side: FixtureSide, finished: boolean) =>
  `truncate ${finished && !side.isWinner ? "text-muted-foreground font-medium" : "font-semibold"}`;

/** One fixture as a card (redesign canvas "Offene Spiele"): pairing on top, the buttons of an open fixture below. */
const LeagueFixtureCard = ({ player1, player2, score, actions }: LeagueFixtureCardProps) => {
  const finished = score !== null;
  return (
    <div className="flex flex-col gap-2.5 rounded-2xl border border-border bg-card p-3">
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 text-[15px]">
        <span className={nameClass(player1, finished)}>
          <span aria-hidden="true">{player1.emoji} </span>{player1.name}
        </span>
        {finished ? (
          <span className="font-display text-xl font-bold tabular-nums leading-none">
            {score.player1}<span className="px-0.5 text-muted-foreground">:</span>{score.player2}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">vs</span>
        )}
        <span className={`text-right ${nameClass(player2, finished)}`}>
          {player2.name}<span aria-hidden="true"> {player2.emoji}</span>
        </span>
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </div>
  );
};

export default LeagueFixtureCard;
