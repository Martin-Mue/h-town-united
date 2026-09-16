import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { Wifi, WifiOff, Keyboard } from "lucide-react";
import { DartLoaderIcon as Loader2 } from "@/components/icons/DartIcons";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { createFreeGameLobby, finishMatch, getMatchState, parseAutodartsState, type AutodartsGameConfig } from "@/lib/autodartsClient";
import type { DetectedDart } from "@/components/game/LiveCamera";

/** Sibling to LiveCamera.tsx for Autodarts-hardware boards: same external contract
 *  (onRoundCommit/onPendingChange/enabled/onClose/dartsRemaining/playerName/onRequestManualEntry/
 *  paused), so Game.tsx can render this in place of LiveCamera without touching its own scoring
 *  logic (submitDetectedRound already only reads baseValue/multiplier from each dart — confirmed
 *  while building this — and never trusts points/confidence, so a source swap is safe by
 *  construction). See the Autodarts-Integration plan for the architecture this implements: cloud
 *  REST polling is always the source of truth (never the WebSocket, whose message shape is
 *  unverified), a local WebSocket is at most an optional "poll now" nudge, and the fallback to
 *  manual entry on repeated failure mirrors LiveCamera's own robustness principle exactly. */

export interface AutodartsLiveScoreHandle {
  /** No video source here (unlike LiveCamera) — always null. Game.tsx's existing
   *  `liveCameraRef.current?.getRecentClip()` call already guards against a null result. */
  getRecentClip(): { url: string; mime: string; blob: Blob } | null;
}

interface AutodartsLiveScoreProps {
  onRoundCommit: (
    darts: DetectedDart[],
    forced?: { kind: "checkout"; finisherIndex: number } | { kind: "bust" },
  ) => void;
  onPendingChange?: (darts: DetectedDart[]) => void;
  enabled: boolean;
  onClose: () => void;
  dartsRemaining?: number;
  playerName?: string;
  onRequestManualEntry?: () => void;
  paused?: boolean;
  /** Which autodarts_boards row (per-club board_number, not the Autodarts-side UUID) to use —
   *  clubId itself is never passed in; the autodarts_connect_board/autodarts_refresh_board RPCs
   *  always derive it server-side (auth.uid() -> user_roles) from the caller's own membership. */
  boardNumber: number;
  gameConfig: AutodartsGameConfig;
  /** Resume an already-open Autodarts match instead of starting a fresh Free Game lobby — set
   *  from Game.tsx's crash-recovery snapshot (see activeGameSnapshot.ts). Without this, a reload
   *  mid-match (the OS reclaiming a backgrounded tab, a pull-to-refresh, ...) would create a
   *  SECOND lobby on the very next connect while the real board/Lens session is still bound to
   *  the first one, and would re-commit whatever turn was already scored before the reload (no
   *  lastCommittedTurnIdRef to compare against on a fresh mount) as a brand new one. Only consulted
   *  on the very first connect after mount -- once a fresh matchId exists in matchIdRef, further
   *  reconnects within the same mount always mean "actually start over" (enabled went false then
   *  true again), never "resume". */
  initialMatchId?: string | null;
  initialLastCommittedTurnId?: string | null;
  /** Mirrors matchIdRef/lastCommittedTurnIdRef out to Game.tsx so its crash-recovery snapshot can
   *  carry initialMatchId/initialLastCommittedTurnId forward across a reload -- these live as
   *  refs in here (no reason to re-render on every poll tick), so the snapshot-owning parent has
   *  no other way to observe their current value. */
  onMatchIdChange?: (matchId: string | null) => void;
  onTurnCommitted?: (turnId: string) => void;
}

const POLL_INTERVAL_MS = 1750;
// ~10s of consecutive failures before surfacing an error state / offering manual entry — generous
// enough to ride out one flaky poll, short enough not to leave a player standing at the board
// wondering if anything registered.
const MAX_CONSECUTIVE_FAILURES = 6;

type Phase = "connecting" | "live" | "error";

const AutodartsLiveScore = forwardRef<AutodartsLiveScoreHandle, AutodartsLiveScoreProps>(function AutodartsLiveScore(
  { onRoundCommit, onPendingChange, enabled, onClose, playerName, onRequestManualEntry, paused, boardNumber, gameConfig, initialMatchId, initialLastCommittedTurnId, onMatchIdChange, onTurnCommitted },
  ref,
) {
  const [phase, setPhase] = useState<Phase>("connecting");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const matchIdRef = useRef<string | null>(null);
  // Guards against overlapping poll ticks: each tick now round-trips through a Postgres RPC that
  // itself calls out to Autodarts (see autodartsClient.ts's header comment on why this can't be a
  // direct client-side call), which is measurably slower than the old direct-fetch design -- a
  // single tick can take longer than POLL_INTERVAL_MS, and setInterval doesn't wait for the
  // previous callback to finish on its own.
  const pollInFlightRef = useRef(false);
  // Which turn (by Autodarts' own stable turns[].id, confirmed live 2026-09-15 -- see
  // autodartsClient.ts) has already been committed via onRoundCommit, so a turn that's still
  // showing as "finished" on the next poll or two (before Autodarts appends the next turn) can't be
  // committed a second time. Keying off the turn's own id rather than throw count/player index
  // avoids the ambiguity either of those would have around edge cases (e.g. two consecutive turns
  // for the same player index in an unusual mode, or a turn ending on fewer than 3 darts).
  const lastCommittedTurnIdRef = useRef<string | null>(null);
  const consecutiveFailuresRef = useRef(0);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const localSocketRef = useRef<WebSocket | null>(null);
  const pausedRef = useRef(paused);
  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);
  // Read from inside the poll loop without re-creating the interval on every render — the loop
  // itself is only set up once per connect (see the `enabled` effect below).
  const callbacksRef = useRef({ onRoundCommit, onPendingChange, onRequestManualEntry, onMatchIdChange, onTurnCommitted });
  useEffect(() => {
    callbacksRef.current = { onRoundCommit, onPendingChange, onRequestManualEntry, onMatchIdChange, onTurnCommitted };
  });

  useImperativeHandle(ref, () => ({ getRecentClip: () => null }));

  const stopPolling = () => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    if (localSocketRef.current) {
      try {
        localSocketRef.current.close();
      } catch {
        // ignore -- best-effort cleanup only
      }
      localSocketRef.current = null;
    }
  };

  const pollTick = async () => {
    if (pausedRef.current || !matchIdRef.current || pollInFlightRef.current) return;
    pollInFlightRef.current = true;
    try {
      const raw = await getMatchState(boardNumber, matchIdRef.current);
      const parsed = parseAutodartsState(raw);
      consecutiveFailuresRef.current = 0;
      setPhase("live");
      setErrorMessage(null);

      // A confirmed-live bust is unambiguous straight from Autodarts (it saw the real throw order,
      // unlike a single after-the-fact camera photo) -- forcing it skips Game.tsx's ambiguous-
      // checkout prompt for exactly this one well-understood case. Checkout is deliberately NOT
      // force-resolved the same way: pinpointing which of up to 3 darts finished the leg still
      // depends on the one still-unconfirmed part of this integration (the populated shape of an
      // individual throws[] entry) -- so checkouts still go through the existing prompt as a safe
      // default rather than risking a wrong forced resolution.
      const forced = parsed.currentTurnBusted ? ({ kind: "bust" } as const) : undefined;

      if (parsed.matchFinished) {
        if (parsed.currentTurnId && parsed.currentTurnId !== lastCommittedTurnIdRef.current && parsed.currentTurnThrows.length > 0) {
          callbacksRef.current.onRoundCommit(parsed.currentTurnThrows, forced);
          lastCommittedTurnIdRef.current = parsed.currentTurnId;
          callbacksRef.current.onTurnCommitted?.(parsed.currentTurnId);
        }
        stopPolling();
        return;
      }

      if (!parsed.currentTurnId) return; // lobby created but no turn under way yet

      if (parsed.currentTurnFinished) {
        // Same guard as the matchFinished branch above: don't commit a turn Autodarts marked
        // "finished" before its throws[] were actually populated in this same poll response --
        // wait for a later tick that carries the real darts instead of forwarding an empty round.
        if (parsed.currentTurnId !== lastCommittedTurnIdRef.current && parsed.currentTurnThrows.length > 0) {
          callbacksRef.current.onRoundCommit(parsed.currentTurnThrows, forced);
          lastCommittedTurnIdRef.current = parsed.currentTurnId;
          if (parsed.currentTurnId) callbacksRef.current.onTurnCommitted?.(parsed.currentTurnId);
        }
        // else: already committed this exact turn, just waiting for Autodarts to append the next
        // one -- no-op rather than re-committing.
      } else {
        callbacksRef.current.onPendingChange?.(parsed.currentTurnThrows);
      }
    } catch (e) {
      consecutiveFailuresRef.current += 1;
      console.warn("AutodartsLiveScore: poll failed", e);
      if (consecutiveFailuresRef.current >= MAX_CONSECUTIVE_FAILURES) {
        setPhase("error");
        setErrorMessage(e instanceof Error ? e.message : "Verbindung zu Autodarts verloren");
        // Deliberately NOT stopping the interval here -- it keeps quietly retrying every tick, and
        // a successful poll flips phase back to "live" on its own (see the top of this function).
        // onRequestManualEntry offers a fallback for the CURRENT turn without giving up on the
        // connection, mirroring LiveCamera's own "never blocks, degrades gracefully" stance.
        callbacksRef.current.onRequestManualEntry?.();
      }
    } finally {
      pollInFlightRef.current = false;
    }
  };

  const connectLocalAccelerator = async () => {
    // Optional, best-effort only -- see the plan's "Offene Punkte" for why this is purely a
    // "go poll now" nudge, never a data source on its own. Native-app only: a plain ws:// call to a
    // LAN IP is blocked as mixed content from an ordinary https:// page (the Capacitor Android
    // shell needs its own cleartext exception -- see capacitor.config.ts / network_security_config.xml).
    if (!Capacitor.isNativePlatform()) return;
    try {
      const { data: boardRow } = await supabase
        .from("autodarts_boards")
        .select("connection_mode, local_ip")
        .eq("board_number", boardNumber)
        .maybeSingle();
      if (boardRow?.connection_mode !== "local" || !boardRow.local_ip) return;
      const { data: creds } = await supabase.rpc("autodarts_refresh_board", { p_board_number: boardNumber });
      const localApiKey = (creds as { local?: { apiKey?: string } } | null)?.local?.apiKey;
      if (!localApiKey) return;
      // Exact local-auth usage (header vs. query param) is unverified against a real board -- see
      // the plan. Sent as a query param for now since that's the simplest thing a raw WebSocket
      // handshake can carry without custom headers; first thing to fix once tested live.
      const socket = new WebSocket(`ws://${boardRow.local_ip}:3180/api/events?apiKey=${encodeURIComponent(localApiKey)}`);
      socket.onmessage = () => {
        void pollTick();
      };
      socket.onerror = () => {
        // Silent -- cloud polling remains the source of truth regardless of whether this connects.
      };
      localSocketRef.current = socket;
    } catch (e) {
      console.warn("AutodartsLiveScore: local accelerator unavailable, continuing on cloud polling only", e);
    }
  };

  useEffect(() => {
    if (!enabled) {
      stopPolling();
      if (matchIdRef.current) {
        void finishMatch(boardNumber, matchIdRef.current);
      }
      matchIdRef.current = null;
      lastCommittedTurnIdRef.current = null;
      consecutiveFailuresRef.current = 0;
      setPhase("connecting");
      setErrorMessage(null);
      callbacksRef.current.onMatchIdChange?.(null);
      return;
    }

    let cancelled = false;
    (async () => {
      setPhase("connecting");
      setErrorMessage(null);
      try {
        // Resume rather than start fresh iff a prior matchId survived (crash-recovery snapshot,
        // see this prop's own doc comment) -- only meaningful on this very first run after mount,
        // since matchIdRef itself is what tracks "already resumed/created this mount".
        if (initialMatchId && !matchIdRef.current) {
          matchIdRef.current = initialMatchId;
          lastCommittedTurnIdRef.current = initialLastCommittedTurnId ?? null;
        } else {
          const { matchId } = await createFreeGameLobby(boardNumber, gameConfig);
          if (cancelled) return;
          matchIdRef.current = matchId;
          lastCommittedTurnIdRef.current = null;
        }
        callbacksRef.current.onMatchIdChange?.(matchIdRef.current);
        consecutiveFailuresRef.current = 0;
        setPhase("live");
        pollTimerRef.current = setInterval(() => {
          void pollTick();
        }, POLL_INTERVAL_MS);
        void connectLocalAccelerator();
      } catch (e) {
        if (cancelled) return;
        const message = e instanceof Error ? e.message : "Autodarts-Verbindung fehlgeschlagen";
        console.error("AutodartsLiveScore: connect failed", message);
        setPhase("error");
        setErrorMessage(message);
        callbacksRef.current.onRequestManualEntry?.();
      }
    })();

    return () => {
      cancelled = true;
      stopPolling();
      // Covers the case the `!enabled` branch above doesn't: the component unmounting outright
      // (navigating away mid-match) while a lobby is still open, rather than `enabled` flipping to
      // false while it stays mounted. Same best-effort courtesy call either way.
      if (matchIdRef.current) {
        void finishMatch(boardNumber, matchIdRef.current);
        matchIdRef.current = null;
      }
    };
    // initialMatchId/initialLastCommittedTurnId deliberately excluded -- they're a one-shot seed
    // for the very first connect after mount (see this effect's own resume branch above), not a
    // signal to reconnect on every value change (Game.tsx updates them via onMatchIdChange as a
    // side effect of THIS component's own state, which would otherwise re-trigger this effect).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, boardNumber]);

  if (!enabled) return null;

  return (
    <div className="gradient-card border border-border shadow-elevation-sm rounded-xl p-4 flex items-center justify-between gap-3">
      <div className="flex items-center gap-2 min-w-0">
        {phase === "live" && <Wifi className="w-5 h-5 text-secondary shrink-0" />}
        {phase === "error" && <WifiOff className="w-5 h-5 text-destructive shrink-0" />}
        {phase === "connecting" && <Loader2 className="w-5 h-5 animate-spin text-primary shrink-0" />}
        <div className="min-w-0">
          <p className="font-semibold text-sm truncate">
            {phase === "live" && `Autodarts verbunden${playerName ? ` — ${playerName}` : ""}`}
            {phase === "connecting" && "Verbinde mit Autodarts…"}
            {phase === "error" && "Autodarts-Verbindung gestört"}
          </p>
          {phase === "error" && errorMessage && <p className="text-xs text-muted-foreground truncate">{errorMessage}</p>}
        </div>
      </div>
      {phase === "error" && (
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5 shrink-0"
          onClick={() => {
            onRequestManualEntry?.();
            onClose();
          }}
        >
          <Keyboard className="w-4 h-4" /> Manuell
        </Button>
      )}
    </div>
  );
});

export default AutodartsLiveScore;
