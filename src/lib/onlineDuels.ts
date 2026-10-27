import { supabase } from "@/integrations/supabase/client";

export interface OnlineDuel {
  id: string;
  challenger_user_id: string;
  opponent_user_id: string;
  mode: "501" | "301" | "custom";
  custom_start_score: number | null;
  double_in: boolean;
  double_out: boolean;
  status: "pending" | "active" | "finished" | "declined" | "canceled";
  decline_reason: string | null;
  expires_at: string;
  my_darts: number | null;
  my_average: number | null;
  my_finished: boolean;
  their_darts: number | null;
  their_average: number | null;
  their_finished: boolean;
  winner_user_id: string | null;
  expired: boolean;
  created_at: string;
}

export const duelStartScore = (d: Pick<OnlineDuel, "mode" | "custom_start_score">) =>
  d.mode === "custom" ? (d.custom_start_score ?? 501) : Number(d.mode);

/** Only the caller's own duels, with the opponent's result withheld server-side until the caller
 *  has finished their own (see my_online_duels). */
export async function loadMyDuels(): Promise<OnlineDuel[]> {
  const { data } = await supabase.rpc("my_online_duels");
  return (data ?? []) as OnlineDuel[];
}

/** Outcome of a duel from the caller's point of view. "forfeit" = the deadline passed and only
 *  one side had played: whoever finished wins. */
export function duelOutcome(d: OnlineDuel, myId: string): "won" | "lost" | "draw" | "forfeit-won" | "forfeit-lost" | null {
  if (d.status === "finished") return d.winner_user_id === null ? "draw" : d.winner_user_id === myId ? "won" : "lost";
  if (d.expired && d.status === "active") {
    if (d.my_finished && !d.their_finished) return "forfeit-won";
    if (!d.my_finished && d.their_finished) return "forfeit-lost";
  }
  return null;
}

