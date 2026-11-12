/** Player profile row as the club page (Players.tsx) loads it from the `players` table. */
export interface PlayerProfile {
  id: string;
  user_id?: string | null;
  name: string;
  nickname: string | null;
  emoji: string;
  avatar_url: string | null;
  ai_portrait_url: string | null;
  games_played: number;
  games_won: number;
  high_score: number;
  average: number;
  double_rate: number;
  elo_rating?: number | null;
  bio?: string | null;
  throwing_hand?: string | null;
  dart_weight_g?: number | null;
  favorite_double?: string | null;
  hometown?: string | null;
  joined_year?: number | null;
  motto?: string | null;
  birthday?: string | null;
  /** "PIN pro Spieler" (local-game opponent confirmation, @/lib/playerPin) — a salted hash+salt,
   *  or null/undefined if no PIN is set. Comes along for free via the page's `select("*")`. */
  pin_hash?: string | null;
  pin_salt?: string | null;
}

/** Win rate in whole percent, 0 when no games were played. */
export const playerWinRate = (player: Pick<PlayerProfile, "games_played" | "games_won">) =>
  player.games_played > 0 ? Math.round((player.games_won / player.games_played) * 100) : 0;

/** Average as shown everywhere on the club page: one decimal, "–" before the first game. */
export const formatPlayerAverage = (player: Pick<PlayerProfile, "games_played" | "average">) =>
  player.games_played > 0 ? Number(player.average).toFixed(1) : "–";
