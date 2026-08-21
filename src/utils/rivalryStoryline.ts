export interface RivalryMeeting {
  /** Did the player referred to as "a" win this particular meeting? */
  aWon: boolean;
  playedAt: string;
}

/**
 * Generates a one-line narrative for the walk-on screen from two players' head-to-head history
 * — picks the single most notable true fact instead of just restating the bare score the screen
 * already shows next to it. Priority, most dramatic first: an active win streak, then a
 * genuinely even rivalry, then a generic "revenge" framing off the most recent meeting (always
 * available once there's been at least one). Returns null only when there's no history at all —
 * the walk-on screen already has its own "Erstes Aufeinandertreffen" copy for that case.
 */
export function buildRivalryStoryline(meetings: RivalryMeeting[], aName: string, bName: string, t: (key: string) => string): string | null {
  if (meetings.length === 0) return null;
  const sorted = [...meetings].sort((x, y) => new Date(x.playedAt).getTime() - new Date(y.playedAt).getTime());

  // Current streak: consecutive same-winner meetings counting back from the most recent one.
  const lastWonByA = sorted[sorted.length - 1].aWon;
  let streak = 0;
  for (let i = sorted.length - 1; i >= 0; i--) {
    if (sorted[i].aWon === lastWonByA) streak++;
    else break;
  }
  const streakWinner = lastWonByA ? aName : bName;
  const streakLoser = lastWonByA ? bName : aName;

  if (streak >= 3) {
    return `🔥 ${streakWinner} ${t("rivalry.streakManyMid")} ${streak} ${t("rivalry.streakManySuffix")} ${streakLoser} ${t("rivalry.streakInARow")}`;
  }
  if (streak === 2) {
    return `${streakWinner} ${t("rivalry.streakTwoMid")} ${streakLoser} ${t("rivalry.streakTwoSuffix")}`;
  }

  const aWins = sorted.filter((m) => m.aWon).length;
  const bWins = sorted.length - aWins;
  if (sorted.length >= 4 && Math.abs(aWins - bWins) <= 1) {
    return aWins === bWins
      ? `${t("rivalry.perfectlyBalanced")} ${aWins}:${bWins} ${t("rivalry.afterNDuels")} ${sorted.length} ${t("rivalry.duels")}.`
      : `${t("rivalry.narrowMargin")} ${sorted.length} ${t("rivalry.duelsOneWinDiff")}`;
  }

  return `${streakWinner} ${t("rivalry.wonLastDuel")} — ${streakLoser} ${t("rivalry.wantsRevenge")}`;
}
