import { count180s, computeCheckoutStats, type DartThrow } from "@/utils/dartStats";

export interface ActivityGameRow {
  id: string;
  mode: string;
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
  /** Distinguishes this player's multiple legs within the same game (best-of-3+) — without it, a
   *  180 or a new best checkout in leg 3 shared an id with the same event from leg 1, a React key
   *  collision that could make one of the two silently fail to render. */
  leg_number: number;
  player_id: string | null;
  player_name: string;
  throws: DartThrow[];
  starting_score: number;
  won: boolean;
}

export interface ActivityEvent {
  id: string;
  type: "180" | "pb_average" | "pb_checkout" | "win_streak" | "match_result";
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
  /** opponentName is the player who LOST -- the event's own playerName is always the winner, so
   *  the rendered line reads "<playerName> · <matchResult(opponentName)>". */
  matchResult: (opponentName: string) => string;
  /** Same "<playerName> · <...>" slot as matchResult, for a free-for-all (3+ real participants)
   *  win — there's no single named loser to point at the way a 1v1 has one, so this names the
   *  field size instead of a specific opponent. */
  matchResultMultiplayer: (participantCount: number) => string;
}

const DEFAULT_TRANSLATOR: ActivityTranslator = {
  oneEighty: (count) => (count > 1 ? `${count}× 180!` : "180!"),
  newAverageRecord: (avg) => `Neue Bestmarke: Ø ${avg}`,
  newBestFinish: (checkout) => `Neues bestes Finish: ${checkout}`,
  winStreak: (streak) => `${streak} Siege in Folge!`,
  matchResult: (opponentName) => `hat gegen ${opponentName} gewonnen`,
  matchResultMultiplayer: (participantCount) => `hat eine Mehrspieler-Runde gewonnen (${participantCount} Spieler)`,
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

  // How many REAL participants a game actually had — player1_id/player2_id only ever cover the
  // top-2 finishers (see gameSync.ts's `ranking`), so they can't tell a 1v1 apart from a
  // free-for-all on their own. Derived from the legs themselves (present for every player
  // regardless of final placement), keyed by player_id where linked and by name otherwise so an
  // unmatched guest/bot still counts as one participant instead of collapsing into nothing.
  const participantsByGame = new Map<string, Set<string>>();
  legs.forEach((l) => {
    if (!participantsByGame.has(l.game_id)) participantsByGame.set(l.game_id, new Set());
    participantsByGame.get(l.game_id)!.add(l.player_id ?? `name:${l.player_name}`);
  });

  const bestAvg = new Map<string, number>();
  const bestCheckout = new Map<string, number>();
  const gamesPlayed = new Map<string, number>();
  const currentStreak = new Map<string, number>();

  for (const g of sortedGames) {
    const isRecent = new Date(g.played_at).getTime() >= cutoff;

    // Plain "X beat Y" result -- the actual "the club is alive today" signal the feed was missing
    // before this: 180s/PBs/streaks are all rare-highlight events, so on an ordinary evening with
    // solid-but-unremarkable games the whole feed used to stay empty.
    if (isRecent) {
      const participantCount = participantsByGame.get(g.id)?.size ?? 0;
      if (participantCount >= 3) {
        // Free-for-all: player2_id only ever covers the RUNNER-UP (see the ranking note above),
        // so requiring them to also be a linked member — the 1v1 gate just below — meant a
        // free-for-all win vanished from the feed the moment 2nd place was a bot or an unmatched
        // guest name, even though the winner themselves is a fully real, linked member. Only the
        // winner needs to be identifiable here; there's no single "loser" to name in a 3+-way
        // game anyway, so matchResultMultiplayer doesn't try to (Community Rangliste #12).
        if (g.player1_id && g.winner_id === g.player1_id) {
          events.push({ id: `result-${g.id}`, type: "match_result", playerName: g.player1_name, playedAt: g.played_at, detail: translator.matchResultMultiplayer(participantCount) });
        }
      } else if (g.player1_id && g.player2_id && (g.winner_id === g.player1_id || g.winner_id === g.player2_id)) {
        // Restricted to games between two players who BOTH have a linked club profile (real
        // member vs. real member) -- a bot or guest opponent has no player_id.
        const winnerIsP1 = g.winner_id === g.player1_id;
        const winnerName = winnerIsP1 ? g.player1_name : g.player2_name;
        const loserName = winnerIsP1 ? g.player2_name : g.player1_name;
        events.push({ id: `result-${g.id}`, type: "match_result", playerName: winnerName, playedAt: g.played_at, detail: translator.matchResult(loserName) });
      }
    }

    const sides: { id: string | null; name: string; avg: number }[] = [
      { id: g.player1_id, name: g.player1_name, avg: Number(g.player1_average) },
      { id: g.player2_id, name: g.player2_name, avg: Number(g.player2_average) },
    ];

    for (const side of sides) {
      if (!side.id) continue; // guests/bots don't get personal records
      const gp = (gamesPlayed.get(side.id) ?? 0) + 1;
      gamesPlayed.set(side.id, gp);

      // Cricket's "average" is raw points-per-3-darts, not a checkout-race score — it's stored in
      // the same player1_average/player2_average column as every other mode (see gameSync.ts) but
      // isn't comparable to one at all (clustering on T20/Bull alone easily beats a genuinely
      // excellent 501 average). Mixing it into the same running "personal best" would let one
      // strong Cricket score permanently block real X01 PBs from ever registering again.
      if (g.mode !== "cricket") {
        const prevBest = bestAvg.get(side.id);
        const isNewBestAvg = prevBest === undefined || side.avg > prevBest;
        if (isNewBestAvg) {
          if (isRecent && prevBest !== undefined && gp > MIN_GAMES_FOR_PB) {
            events.push({ id: `pb-avg-${g.id}-${side.id}`, type: "pb_average", playerName: side.name, playedAt: g.played_at, detail: translator.newAverageRecord(side.avg.toFixed(1)) });
          }
          bestAvg.set(side.id, side.avg);
        }
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
          id: `180-${g.id}-${leg.leg_number}-${leg.player_id ?? leg.player_name}`,
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
            events.push({ id: `pb-co-${g.id}-${leg.leg_number}-${leg.player_id}`, type: "pb_checkout", playerName: leg.player_name, playedAt: g.played_at, detail: translator.newBestFinish(checkout) });
          }
          bestCheckout.set(leg.player_id, checkout);
        }
      }
    }
  }

  return events.sort((a, b) => new Date(b.playedAt).getTime() - new Date(a.playedAt).getTime());
}
