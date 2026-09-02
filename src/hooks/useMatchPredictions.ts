import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

const VOTER_ID_KEY = "match-prediction-voter-id";
const myVotesKey = (tournamentId: string) => `match-prediction-my-votes:${tournamentId}`;

function getVoterId(): string {
  if (typeof window === "undefined") return crypto.randomUUID();
  try {
    const existing = window.localStorage.getItem(VOTER_ID_KEY);
    if (existing) return existing;
    const fresh = crypto.randomUUID();
    window.localStorage.setItem(VOTER_ID_KEY, fresh);
    return fresh;
  } catch {
    return crypto.randomUUID();
  }
}

function loadMyVotes(tournamentId: string): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(myVotesKey(tournamentId));
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

/** match_id -> { predicted player name -> vote count } */
export type PredictionTallies = Record<string, Record<string, number>>;

/** Spectator "who wins this match?" predictions on the public live view — cast/read entirely
 *  through the 2 SECURITY DEFINER RPCs added in the match_predictions migration, never a direct
 *  table query, since that base table carries no anon/authenticated policies at all by design
 *  (see the migration's own comment). `voter_id` is a random UUID generated once per browser and
 *  kept in localStorage — enough to let a spectator change their own pick before a match closes,
 *  not a real identity; casting a wider net (accounts, one-vote-per-IP) was a deliberate non-goal
 *  for what's a low-stakes casual feature. Polls on the same 8s cadence PublicTournament.tsx's own
 *  `load` already uses rather than opening a second realtime channel — a raw table subscription
 *  would need its own public SELECT policy, exactly what routing this through RPCs avoids. */
export function useMatchPredictions(tournamentId: string | undefined, enabled: boolean) {
  const [tallies, setTallies] = useState<PredictionTallies>({});
  const [myVotes, setMyVotes] = useState<Record<string, string>>({});
  const voterIdRef = useRef<string>("");

  useEffect(() => { voterIdRef.current = getVoterId(); }, []);
  useEffect(() => { setMyVotes(tournamentId ? loadMyVotes(tournamentId) : {}); }, [tournamentId]);

  const refresh = useCallback(async () => {
    if (!tournamentId || !enabled) return;
    const { data } = await supabase.rpc("get_match_predictions", { _tournament_id: tournamentId });
    if (!data) return;
    const next: PredictionTallies = {};
    for (const row of data as { match_id: string; predicted_winner: string; votes: number }[]) {
      const bucket = next[row.match_id] ?? {};
      bucket[row.predicted_winner] = Number(row.votes);
      next[row.match_id] = bucket;
    }
    setTallies(next);
  }, [tournamentId, enabled]);

  useEffect(() => {
    if (!tournamentId || !enabled) return;
    refresh();
    const interval = window.setInterval(refresh, 8000);
    return () => window.clearInterval(interval);
  }, [tournamentId, enabled, refresh]);

  /** Returns false on rejection (e.g. the match got decided between page load and this tap) —
   *  the caller shows a brief inline note rather than a toast, since this page has no visitor
   *  session to attach one to reliably. */
  const castVote = useCallback(async (matchId: string, predictedWinner: string): Promise<boolean> => {
    if (!tournamentId) return false;
    const { error } = await supabase.rpc("cast_match_prediction", {
      _tournament_id: tournamentId,
      _match_id: matchId,
      _voter_id: voterIdRef.current,
      _predicted_winner: predictedWinner,
    });
    if (error) return false;
    setMyVotes((prev) => {
      const next = { ...prev, [matchId]: predictedWinner };
      saveMyVotesSafely(tournamentId, next);
      return next;
    });
    void refresh();
    return true;
  }, [tournamentId, refresh]);

  return { tallies, myVotes, castVote };
}

function saveMyVotesSafely(tournamentId: string, votes: Record<string, string>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(myVotesKey(tournamentId), JSON.stringify(votes));
  } catch {
    // Private-browsing/storage-full — the vote itself already succeeded server-side; only the
    // "you already picked X" reminder on next visit is lost, not the vote.
  }
}
