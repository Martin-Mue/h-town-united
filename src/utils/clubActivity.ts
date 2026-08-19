import { count180s, computeCheckoutStats, type DartThrow } from "@/utils/dartStats";

export interface ActivityGameRow {
  id: string;
  player1_id: string | null;
  player2_id: string | null;
  player1_name: string;
  player2_name: string;
  player1_average: number;
  player2_average: number;
  winner_id: string | null;
  played_at: string;
}

export interface ActivityLegRow {
  game_id: string;
  player_id: string | null;
  player_name: string;
  throws: DartThrow[];
  starting_score: number;
  won: boolean;
}

export interface ActivityEvent {
  id: string;
  type: "180" | "pb_average" | "pb_checkout" | "win_streak";
  playerName: string;
  playedAt: string;
  detail: string;
}

/** Don't crown someone's first couple of recorded games as "records" — a personal best only
 *  means something once there's an actual personal history to beat. */
const MIN_GAMES_FOR_PB = 3;
const STREAK_MILESTONES = [3, 5, 7, 10, 15, 20];

/** Builds the fixed wording of each event's `detail` string — defaults to the original German
 *  text (kept as the default so existing callers/tests don't need to pass anything), but
 *  Index.tsx passes one built from useLanguage()'s t() so the feed matches the active language.
 *  Numbers stay interpolated the same way regardless of which translator is used. */
export interface ActivityTranslator {
  oneEighty: (count: number) => string;
  newAverageRecord: (avg: string) => string;
  newBestFinish: (checkout: number) => string;
  winStreak: (streak: number) => string;
}

const DEFAULT_TRANSLATOR: ActivityTranslator = {
  oneEighty: (count) => (count > 1 ? `${count}× 180!` : "180!"),
  newAverageRecord: (avg) => `Neue Bestmarke: Ø ${avg}`,
  newBestFinish: (checkout) => `Neues bestes Finish: ${checkout}`,
  winStreak: (streak) => `${streak} Siege in Folge!`,
};

/**
 * Derives a recency-ordered feed of club-wide notable moments (180s, new personal-best average
 * or checkout, win-streak milestones) purely from data that already exists — no new table, no
 * camera dependency, works identically for every member. Processes ALL games chronologically
 * (to track each player's running personal bests correctly) but only EMITS events that fall
 * within `windowDays` of now, so a player's very first-ever "personal best" (there being no prior
 * game to compare against) never shows up as a fake milestone.
 */
export function computeClubActivity(
  games: ActivityGameRow[],
  legs: ActivityLegRow[],
  windowDays = 14,
  translator: ActivityTranslator = DEFAULT_TRANSLATOR,
): ActivityEvent[] {
  const events: ActivityEvent[] = [];
  const sortedGames = [...games].sort((a, b) => new Date(a.played_at).getTime() - new Date(b.played_at).getTime());
  const cutoff = Date.now() - windowDays * 86_400_000;

  const legsByGame = new Map<string, ActivityLegRow[]>();
  legs.forEach((l) => {
    if (!legsByGame.has(l.game_id)) legsByGame.set(l.game_id, []);
    legsByGame.get(l.game_id)!.push(l);
  });

  const bestAvg = new Map<string, number>();
  const bestCheckout = new Map<string, number>();
  const gamesPlayed = new Map<string, number>();
  const currentStreak = new Map<string, number>();

  for (const g of sortedGames) {
    const isRecent = new Date(g.played_at).getTime() >= cutoff;
    const sides: { id: string | null; name: string; avg: number }[] = [
      { id: g.player1_id, name: g.player1_name, avg: Number(g.player1_average) },
      { id: g.player2_id, name: g.player2_name, avg: Number(g.player2_average) },
    ];

    for (const side of sides) {
      if (!side.id) continue; // guests/bots don't get personal records
      const gp = (gamesPlayed.get(side.id) ?? 0) + 1;
      gamesPlayed.set(side.id, gp);

      const prevBest = bestAvg.get(side.id);
      const isNewBestAvg = prevBest === undefined || side.avg > prevBest;
      if (isNewBestAvg) {
        if (isRecent && prevBest !== undefined && gp > MIN_GAMES_FOR_PB) {
          events.push({ id: `pb-avg-${g.id}-${side.id}`, type: "pb_average", playerName: side.name, playedAt: g.played_at, detail: translator.newAverageRecord(side.avg.toFixed(1)) });
        }
        bestAvg.set(side.id, side.avg);
      }

      const won = g.winner_id === side.id;
      const streak = won ? (currentStreak.get(side.id) ?? 0) + 1 : 0;
      currentStreak.set(side.id, streak);
      if (isRecent && won && STREAK_MILESTONES.includes(streak)) {
        events.push({ id: `streak-${g.id}-${side.id}`, type: "win_streak", playerName: side.name, playedAt: g.played_at, detail: translator.winStreak(streak) });
      }
    }

    for (const leg of legsByGame.get(g.id) ?? []) {
      if (!Array.isArray(leg.throws) || leg.throws.length === 0) continue;

      // A 180 is exciting regardless of whether the thrower has a linked club profile — unlike
      // the personal-best tracking below, this doesn't need a stable player_id to make sense.
      const n180 = count180s(leg.throws);
      if (isRecent && n180 > 0) {
        events.push({
          id: `180-${g.id}-${leg.player_id ?? leg.player_name}`,
          type: "180",
          playerName: leg.player_name,
          playedAt: g.played_at,
          detail: translator.oneEighty(n180),
        });
      }

      if (leg.won && leg.player_id) {
        const checkout = computeCheckoutStats(leg.throws, leg.starting_score).highestCheckout;
        const prevBestCo = bestCheckout.get(leg.player_id);
        const isNewBestCo = checkout > 0 && (prevBestCo === undefined || checkout > prevBestCo);
        if (isNewBestCo) {
          if (isRecent && prevBestCo !== undefined && prevBestCo > 0) {
            events.push({ id: `pb-co-${g.id}-${leg.player_id}`, type: "pb_checkout", playerName: leg.player_name, playedAt: g.played_at, detail: translator.newBestFinish(checkout) });
          }
          bestCheckout.set(leg.player_id, checkout);
        }
      }
    }
  }

  return events.sort((a, b) => new Date(b.playedAt).getTime() - new Date(a.playedAt).getTime());
}
