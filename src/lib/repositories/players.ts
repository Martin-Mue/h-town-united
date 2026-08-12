import { supabase } from "@/integrations/supabase/client";

/** The common "club roster" shape needed for player pickers, name→id lookups, etc. —
 *  pages needing career stats (average, games_played, ...) still query those columns
 *  themselves; this only covers the identity fields duplicated verbatim across pages. */
export interface ClubPlayer {
  id: string;
  name: string;
  emoji: string;
  user_id: string | null;
}

/** Full club roster, alphabetical — used for player pickers (Game/Training setup) and
 *  name→id resolution (Tournament push notifications, bracket entry). */
export async function fetchClubPlayers(): Promise<ClubPlayer[]> {
  const { data, error } = await supabase.from("players").select("id, name, emoji, user_id").order("name");
  if (error) throw error;
  return data ?? [];
}
