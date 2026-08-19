import { supabase } from "@/integrations/supabase/client";

/** The common "club roster" shape needed for player pickers, name→id lookups, career-stat
 *  glances (walk-on screen, quick comparisons), etc. Pages needing the FULL stats picture
 *  (checkout %, per-leg detail, ...) still query game_legs themselves; this only covers what's
 *  cheap to carry on every roster row. */
export interface ClubPlayer {
  id: string;
  name: string;
  emoji: string;
  user_id: string | null;
  games_played: number;
  games_won: number;
  average: number;
  high_score: number;
  elo_rating: number;
  double_rate: number;
}

/** Full club roster, alphabetical — used for player pickers (Game/Training setup) and
 *  name→id resolution (Tournament push notifications, bracket entry). */
export async function fetchClubPlayers(): Promise<ClubPlayer[]> {
  const { data, error } = await supabase.from("players")
    .select("id, name, emoji, user_id, games_played, games_won, average, high_score, elo_rating, double_rate").order("name");
  if (error) throw error;
  return data ?? [];
}

/** Resolve a freely-typed in-game name back to its club roster row, the same
 *  trim/case-insensitive match used when a finished game is saved (see gameSync.ts's
 *  own findDbPlayer) — a name typed with different spacing/casing than the roster record
 *  must not silently miss the match. Guest/bot names with no roster row return undefined. */
export function matchClubPlayer(roster: ClubPlayer[], name: string): ClubPlayer | undefined {
  const normalized = name.trim().toLowerCase();
  return roster.find((p) => p.name.trim().toLowerCase() === normalized);
}
