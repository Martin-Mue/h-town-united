import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { GameState } from "@/types/game";
import type { Json } from "@/integrations/supabase/types";

export type OnlineMatchStatus = "pending" | "active" | "finished" | "declined" | "canceled";

/** Realtime connection health for the match channel — surfaced so the UI can tell a player their
 *  view might be stale instead of leaving them to unknowingly keep playing on an out-of-date
 *  board. "reconnecting" covers both an actual drop (TIMED_OUT/CHANNEL_ERROR) and the same-tab
 *  gap while the tab was backgrounded (visibilitychange re-sync below) — either way, the caller
 *  should treat state as provisional until this flips back to "connected". */
export type OnlineConnectionStatus = "connected" | "reconnecting" | "disconnected";

/** The stored game_state JSONB carries dartsThisRound/turnStartRemaining merged in alongside the
 *  plain GameState fields (see the submit_online_throw/accept_online_match RPCs) — they're normal
 *  sibling useState in local/bot play (src/types/game.ts doesn't include them), but a reconnect
 *  can't reconstruct them from GameState alone, so the online-match row carries all three. */
/** An ephemeral emoji/phrase reaction — broadcast only, never persisted. */
export interface OnlineReaction { from: string; emoji: string; at?: number }

export type OnlineGameState = GameState & { dartsThisRound: number; turnStartRemaining: number };

export interface OnlineMatchRow {
  id: string;
  club_id: string;
  status: OnlineMatchStatus;
  mode: "501" | "301" | "cricket" | "custom";
  best_of_legs: number;
  player1_user_id: string;
  player2_user_id: string;
  game_state: OnlineGameState | null;
  source_type: "casual" | "league" | "tournament";
  source_id: string | null;
  /** true = 2-gegen-2 with four accounts (see online_match_players); players[i] belongs to slot i. */
  is_doubles?: boolean;
  created_by?: string;
  updated_at?: string;
  best_of_sets?: number | null;
  custom_start_score?: number | null;
  double_in?: boolean;
  double_out?: boolean;
  starter?: "challenger" | "opponent" | "random";
}

/** Drives Game.tsx's online-play branch — loads an `online_matches` row, keeps it live via a
 *  postgres_changes UPDATE subscription (durable reconnect path) layered under a broadcast
 *  channel (low-latency path for the opponent's device to see a throw immediately, without
 *  waiting for the DB round-trip). Broadcast is a latency shortcut only: `submit_online_throw`
 *  (the actual persisted write, with server-side turn validation) is the real source of truth,
 *  and the next postgres_changes UPDATE naturally reconciles anything broadcast alone missed. */
export function useOnlineMatch(matchId: string | undefined, userId: string | undefined) {
  const [row, setRow] = useState<OnlineMatchRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [connectionStatus, setConnectionStatus] = useState<OnlineConnectionStatus>("connected");
  const channelRef = useRef<RealtimeChannel | null>(null);
  // Seat of this account in a doubles match (== index into GameState.players); null for 1:1.
  const [mySlot, setMySlot] = useState<number | null>(null);
  const [reaction, setReaction] = useState<(OnlineReaction & { at: number }) | null>(null);
  // Re-evaluated every 5 s so the idle-based substitute/abort offers appear without any new event.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 5000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!matchId) {
      setRow(null);
      setLoading(false);
      setConnectionStatus("connected");
      return;
    }
    let cancelled = false;
    setLoading(true);
    setConnectionStatus("connected");

    const load = async () => {
      const { data } = await supabase.from("online_matches").select("*").eq("id", matchId).maybeSingle();
      if (cancelled) return;
      setRow((data as unknown as OnlineMatchRow) ?? null);
      setLoading(false);
    };
    load();

    const channel = supabase
      .channel(`online-match-${matchId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "online_matches", filter: `id=eq.${matchId}` },
        (payload) => { if (!cancelled) setRow(payload.new as unknown as OnlineMatchRow); }
      )
      .on("broadcast", { event: "throw" }, (payload) => {
        if (cancelled) return;
        const nextState = (payload.payload as { game_state: OnlineGameState })?.game_state;
        // updated_at is bumped locally too: the DB row's own value only arrives with the
        // postgres_changes UPDATE a moment later, and the idle clock below must not read a stale one.
        if (nextState) setRow((prev) => (prev ? { ...prev, game_state: nextState, updated_at: new Date().toISOString() } : prev));
      })
      .on("broadcast", { event: "reaction" }, (payload) => {
        if (cancelled) return;
        const r = payload.payload as OnlineReaction;
        if (r?.emoji) setReaction({ ...r, at: Date.now() });
      })
      .subscribe((status) => {
        if (cancelled) return;
        if (status === "SUBSCRIBED") {
          setConnectionStatus("connected");
          // A (re)subscribe can follow a real drop, during which a postgres_changes UPDATE could
          // have been missed entirely (no channel to deliver it on) — re-fetch the row directly
          // rather than trusting whatever local state happened to survive the gap. Cheap and
          // idempotent when nothing was actually missed.
          load();
        } else if (status === "TIMED_OUT" || status === "CHANNEL_ERROR") {
          setConnectionStatus("reconnecting");
        } else if (status === "CLOSED") {
          setConnectionStatus("disconnected");
        }
      });
    channelRef.current = channel;

    // The realtime socket can be silently suspended while the tab is backgrounded (common on
    // mobile) with no CHANNEL_ERROR/CLOSED ever firing to say so — from the channel's own point of
    // view nothing looked wrong, it just stopped receiving. Coming back to the foreground is
    // exactly the moment a player could unknowingly resume tapping on a stale board, so treat it
    // as "reconnecting" until a fresh fetch confirms the row is current.
    const onVisibilityChange = () => {
      if (cancelled || document.visibilityState !== "visible") return;
      setConnectionStatus("reconnecting");
      load().then(() => { if (!cancelled) setConnectionStatus("connected"); });
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [matchId]);

  const isDoubles = !!row?.is_doubles;
  useEffect(() => {
    if (!isDoubles || !matchId || !userId) { setMySlot(null); return; }
    let cancelled = false;
    supabase.from("online_match_players").select("slot").eq("match_id", matchId).eq("user_id", userId).maybeSingle()
      .then(({ data }) => { if (!cancelled) setMySlot(data?.slot ?? null); });
    return () => { cancelled = true; };
  }, [isDoubles, matchId, userId]);

  /** Whose turn it is. 1:1: GameState.currentPlayerIndex 0/1 mapped to the two accounts on the row.
   *  Doubles: currentPlayerIndex IS the seat (players are interleaved [A1, B1, A2, B2]), so it is my
   *  turn exactly when it equals my own seat. */
  const currentIdx = row?.game_state?.currentPlayerIndex ?? -1;
  const idleSeconds = row?.updated_at ? Math.max(0, Math.floor((now - new Date(row.updated_at).getTime()) / 1000)) : 0;
  /** Doubles: my partner is on the clock but hasn't played for 60 s — the server lets me throw for them. */
  const substituting = isDoubles && row?.status === "active" && mySlot !== null && currentIdx !== mySlot
    && currentIdx % 2 === mySlot % 2 && idleSeconds > 60;
  const isMyTurn = !!row?.game_state && !!userId && (
    substituting || (
      isDoubles
        ? mySlot !== null && currentIdx === mySlot
        : (currentIdx === 0 && row.player1_user_id === userId) || (currentIdx === 1 && row.player2_user_id === userId)
    )
  );
  /** Someone on the OTHER side has been idle 5 min: this player may end the match without a result. */
  const canAbortIdle = row?.status === "active" && idleSeconds > 300 && !isMyTurn && !(isDoubles && mySlot !== null && currentIdx % 2 === mySlot % 2);

  const sendThrow = useCallback(async (newGameState: GameState, dartsThisRound: number, turnStartRemaining: number) => {
    if (!matchId) return;
    const merged: OnlineGameState = { ...newGameState, dartsThisRound, turnStartRemaining };
    // Broadcast first — pure latency shortcut, best-effort, never awaited/blocking.
    void channelRef.current?.send({ type: "broadcast", event: "throw", payload: { game_state: merged } });
    // The actual persisted write. Server-side rejects this if it wasn't really the caller's turn
    // in the PREVIOUS stored state — see the RPC's own doc comment for why that's the one thing
    // this can't just trust the client on.
    const { error } = await supabase.rpc("submit_online_throw", {
      _match_id: matchId,
      _new_game_state: newGameState as unknown as Json,
      _new_darts_this_round: dartsThisRound,
      _new_turn_start_remaining: turnStartRemaining,
    });
    if (error) throw error;
  }, [matchId]);

  const sendReaction = useCallback((emoji: string, from: string) => {
    const payload: OnlineReaction = { emoji, from };
    void channelRef.current?.send({ type: "broadcast", event: "reaction", payload });
    setReaction({ ...payload, at: Date.now() });
  }, []);

  const abortIdle = useCallback(async () => {
    if (!matchId) return false;
    const { data } = await supabase.rpc("abort_idle_online_match", { _match_id: matchId });
    return !!data;
  }, [matchId]);

  return { row, loading, isMyTurn, mySlot, substituting, idleSeconds, canAbortIdle, abortIdle, reaction, sendReaction, sendThrow, connectionStatus };
}
