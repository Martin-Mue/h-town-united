import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { Wifi, WifiOff, Keyboard } from "lucide-react";
import { DartLoaderIcon as Loader2 } from "@/components/icons/DartIcons";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { describeFunctionError } from "@/lib/functionErrors";
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
   *  clubId itself is never passed in; autodarts-auth always derives it server-side from the
   *  caller's own membership. */
  boardNumber: number;
  gameConfig: AutodartsGameConfig;
}

const POLL_INTERVAL_MS = 1750;
// ~10s of consecutive failures before surfacing an error state / offering manual entry — generous
// enough to ride out one flaky poll, short enough not to leave a player standing at the board
// wondering if anything registered.
const MAX_CONSECUTIVE_FAILURES = 6;

type Phase = "connecting" | "live" | "error";

const AutodartsLiveScore = forwardRef<AutodartsLiveScoreHandle, AutodartsLiveScoreProps>(function AutodartsLiveScore(
  { onRoundCommit, onPendingChange, enabled, onClose, playerName, onRequestManualEntry, paused, boardNumber, gameConfig },
  ref,
) {
  const [phase, setPhase] = useState<Phase>("connecting");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const accessTokenRef = useRef<{ token: string; expiresAt: number } | null>(null);
  const matchIdRef = useRef<string | null>(null);
  // The in-progress visit's darts as last reported by Autodarts. A completed visit is detected
  // purely by this array's length growing to 3 or dropping back down between polls — not by
  // guessing a "current player index" field name, which is far less certain to exist under any
  // particular name in the (unofficial, unverified) state response. See autodartsClient.ts.
  const lastThrowsSeenRef = useRef<DetectedDart[]>([]);
  // Set right after committing a full 3-dart visit, so a state response that still briefly shows
  // those same 3 throws on the next tick or two (before Autodarts' own turn rollover lands) can't
  // be committed a second time. Cleared once a poll confirms the throw count actually dropped.
  const awaitingRolloverRef = useRef(false);
  const consecutiveFailuresRef = useRef(0);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const localSocketRef = useRef<WebSocket | null>(null);
  const pausedRef = useRef(paused);
  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);
  // Read from inside the poll loop without re-creating the interval on every render — the loop
  // itself is only set up once per connect (see the `enabled` effect below).
  const callbacksRef = useRef({ onRoundCommit, onPendingChange, onRequestManualEntry });
  useEffect(() => {
    callbacksRef.current = { onRoundCommit, onPendingChange, onRequestManualEntry };
  });

  useImperativeHandle(ref, () => ({ getRecentClip: () => null }));

  const ensureAccessToken = async (): Promise<string> => {
    const cached = accessTokenRef.current;
    if (cached && cached.expiresAt > Date.now() + 30_000) return cached.token;
    const { data, error } = await supabase.functions.invoke("autodarts-auth", { body: { action: "refresh", boardNumber } });
    if (error) throw new Error(await describeFunctionError(error));
    if (!data?.cloud?.accessToken) throw new Error("Kein Autodarts-Zugriffstoken erhalten — ist die Cloud-Anmeldung für dieses Board eingerichtet?");
    accessTokenRef.current = { token: data.cloud.accessToken, expiresAt: Date.now() + (Number(data.cloud.expiresIn) || 60) * 1000 };
    return accessTokenRef.current.token;
  };

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
    if (pausedRef.current || !matchIdRef.current) return;
    try {
      const token = await ensureAccessToken();
      const raw = await getMatchState(token, matchIdRef.current);
      const parsed = parseAutodartsState(raw);
      consecutiveFailuresRef.current = 0;
      setPhase("live");
      setErrorMessage(null);

      if (parsed.isFinished) {
        if (parsed.throwsThisTurn.length > 0) callbacksRef.current.onRoundCommit(parsed.throwsThisTurn);
        stopPolling();
        return;
      }

      if (awaitingRolloverRef.current) {
        if (parsed.throwsThisTurn.length < 3) {
          awaitingRolloverRef.current = false;
          lastThrowsSeenRef.current = parsed.throwsThisTurn;
          if (parsed.throwsThisTurn.length > 0) callbacksRef.current.onPendingChange?.(parsed.throwsThisTurn);
        }
        return;
      }

      const prev = lastThrowsSeenRef.current;
      const curr = parsed.throwsThisTurn;

      if (curr.length < prev.length) {
        // Turn rolled over without us ever seeing a length-3 tick (e.g. a very fast poll cadence
        // relative to the checkout) -- the last complete picture we had (`prev`) IS the finished visit.
        if (prev.length > 0) callbacksRef.current.onRoundCommit(prev);
        lastThrowsSeenRef.current = curr;
        if (curr.length > 0) callbacksRef.current.onPendingChange?.(curr);
        return;
      }
      if (curr.length > prev.length) {
        lastThrowsSeenRef.current = curr;
        callbacksRef.current.onPendingChange?.(curr);
      }
      if (curr.length >= 3) {
        callbacksRef.current.onRoundCommit(curr);
        awaitingRolloverRef.current = true;
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
      const { data: creds } = await supabase.functions.invoke("autodarts-auth", { body: { action: "refresh", boardNumber } });
      const localApiKey = creds?.local?.apiKey as string | undefined;
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
        const token = accessTokenRef.current?.token;
        const matchId = matchIdRef.current;
        if (token) void finishMatch(token, matchId);
      }
      matchIdRef.current = null;
      lastThrowsSeenRef.current = [];
      awaitingRolloverRef.current = false;
      consecutiveFailuresRef.current = 0;
      setPhase("connecting");
      setErrorMessage(null);
      return;
    }

    let cancelled = false;
    (async () => {
      setPhase("connecting");
      setErrorMessage(null);
      try {
        const token = await ensureAccessToken();
        const { matchId } = await createFreeGameLobby(token, gameConfig);
        if (cancelled) return;
        matchIdRef.current = matchId;
        lastThrowsSeenRef.current = [];
        awaitingRolloverRef.current = false;
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
    };
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
