import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Wifi, WifiOff, Keyboard } from "lucide-react";
import { DartLoaderIcon as Loader2 } from "@/components/icons/DartIcons";
import { Button } from "@/components/ui/button";
import {
  finishAutodartsSession,
  parseAutodartsState,
  pollAutodartsSession,
  startAutodartsSession,
  type AutodartsLegConfig,
  type AutodartsLobbyPlayer,
  type AutodartsSessionRef,
  type AutodartsSource,
} from "@/lib/autodartsClient";
import type { DetectedDart } from "@/components/game/LiveCamera";
import { decideAutodartsTurn, type SeenAutodartsTurn } from "@/lib/autodartsTurnTracker";

/** Sibling to LiveCamera.tsx for Autodarts boards: same external contract
 *  (onRoundCommit/onPendingChange/enabled/onClose/playerName/onRequestManualEntry/paused), so
 *  Game.tsx renders this in place of LiveCamera without touching its own scoring logic
 *  (submitDetectedRound only reads baseValue/multiplier from each dart).
 *
 *  One Autodarts lobby per Dartspot leg (legKey): a new leg finishes the old Autodarts match and
 *  starts a fresh one with that leg's throwing order. That keeps Autodarts' own remaining score and
 *  starter in line with Dartspot even when a bot or a remote online opponent -- who never throws at
 *  this board -- wins a leg. Dartspot stays the source of truth; Autodarts only delivers the darts. */

export interface AutodartsLiveScoreHandle {
  /** No video source here (unlike LiveCamera) — always null. */
  getRecentClip(): { url: string; mime: string; blob: Blob } | null;
}

export type { AutodartsSessionRef };

interface AutodartsLiveScoreProps {
  onRoundCommit: (
    darts: DetectedDart[],
    forced?: { kind: "checkout"; finisherIndex: number } | { kind: "bust" },
  ) => void;
  onPendingChange?: (darts: DetectedDart[]) => void;
  enabled: boolean;
  onClose: () => void;
  playerName?: string;
  onRequestManualEntry?: () => void;
  /** Stops polling (checkout prompt open, a bot's or the remote opponent's turn). */
  paused?: boolean;
  source: AutodartsSource;
  /** Changes whenever a new Dartspot leg starts -> a new Autodarts lobby. */
  legKey: string;
  /** The humans who throw at THIS board this leg, in throwing order (read when the leg starts). */
  legPlayers: AutodartsLobbyPlayer[];
  legConfig: AutodartsLegConfig;
  /** Resume the leg's open Autodarts session after a reload (crash-recovery snapshot) instead of
   *  opening a second lobby and re-committing an already scored turn. Used only when its legKey
   *  still matches. */
  initialSession?: AutodartsSessionRef | null;
  initialLastCommittedTurnId?: string | null;
  onSessionChange?: (session: AutodartsSessionRef | null) => void;
  onTurnCommitted?: (turnId: string) => void;
}

const POLL_INTERVAL_MS = 1750;
// ~10s of consecutive failures before surfacing an error state / offering manual entry.
const MAX_CONSECUTIVE_FAILURES = 6;

type Phase = "connecting" | "live" | "error";

const sourceKey = (source: AutodartsSource) => (source.kind === "board" ? `board:${source.boardNumber}` : "account");

const AutodartsLiveScore = forwardRef<AutodartsLiveScoreHandle, AutodartsLiveScoreProps>(function AutodartsLiveScore(
  { onRoundCommit, onPendingChange, enabled, onClose, playerName, onRequestManualEntry, paused, source, legKey, legPlayers, legConfig,
    initialSession, initialLastCommittedTurnId, onSessionChange, onTurnCommitted },
  ref,
) {
  const [phase, setPhase] = useState<Phase>("connecting");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [boardName, setBoardName] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  const sessionIdRef = useRef<string | null>(null);
  const resumeCheckedRef = useRef(false);
  // Each tick round-trips through a Postgres RPC that itself calls Autodarts, so a tick can take
  // longer than POLL_INTERVAL_MS -- never run two at once.
  const pollInFlightRef = useRef(false);
  // Autodarts' own stable turns[].id of the turn already committed, so a turn still showing as
  // finished on the next poll or two is never committed twice.
  const lastCommittedTurnIdRef = useRef<string | null>(null);
  // The current Autodarts turn as of the previous poll (see decideAutodartsTurn).
  const lastSeenTurnRef = useRef<SeenAutodartsTurn | null>(null);
  const consecutiveFailuresRef = useRef(0);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pausedRef = useRef(paused);
  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);
  const callbacksRef = useRef({ onRoundCommit, onPendingChange, onRequestManualEntry, onSessionChange, onTurnCommitted });
  useEffect(() => {
    callbacksRef.current = { onRoundCommit, onPendingChange, onRequestManualEntry, onSessionChange, onTurnCommitted };
  });
  // Read when a leg starts, not a reason to restart it.
  const legSetupRef = useRef({ source, legPlayers, legConfig, initialSession, initialLastCommittedTurnId });
  useEffect(() => {
    legSetupRef.current = { source, legPlayers, legConfig, initialSession, initialLastCommittedTurnId };
  });

  useImperativeHandle(ref, () => ({ getRecentClip: () => null }));

  const stopPolling = () => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  };

  const pollTick = async () => {
    const sessionId = sessionIdRef.current;
    // Every tick is a database call (and an Autodarts request), so none while the app is in the background.
    if (pausedRef.current || !sessionId || pollInFlightRef.current || document.hidden) return;
    pollInFlightRef.current = true;
    try {
      const raw = await pollAutodartsSession(sessionId);
      if (sessionIdRef.current !== sessionId) return; // a new leg started meanwhile
      const parsed = parseAutodartsState(raw);
      consecutiveFailuresRef.current = 0;
      setPhase("live");
      setErrorMessage(null);

      const decision = decideAutodartsTurn(parsed, lastSeenTurnRef.current, lastCommittedTurnIdRef.current);
      lastSeenTurnRef.current = decision.seen;
      for (const visit of decision.commits) {
        // A bust reported by Autodarts is unambiguous (it saw the real throw order). Checkouts still
        // go through Game.tsx's own prompt as the safe default.
        callbacksRef.current.onRoundCommit(visit.throws, visit.busted ? { kind: "bust" } : undefined);
        lastCommittedTurnIdRef.current = visit.turnId;
        callbacksRef.current.onTurnCommitted?.(visit.turnId);
      }
      callbacksRef.current.onPendingChange?.(decision.pending);
      // Leg/match won: Dartspot moves to the next leg -> legKey changes -> new lobby.
    } catch (e) {
      consecutiveFailuresRef.current += 1;
      console.warn("AutodartsLiveScore: poll failed", e);
      if (consecutiveFailuresRef.current >= MAX_CONSECUTIVE_FAILURES) {
        setPhase("error");
        setErrorMessage(e instanceof Error ? e.message : "Verbindung zu Autodarts verloren");
        // Keep the interval running: a successful poll flips back to "live" on its own.
        callbacksRef.current.onRequestManualEntry?.();
      }
    } finally {
      pollInFlightRef.current = false;
    }
  };

  const currentSourceKey = sourceKey(source);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    (async () => {
      setPhase("connecting");
      setErrorMessage(null);
      setWarning(null);
      const setup = legSetupRef.current;
      try {
        const resume = !resumeCheckedRef.current && setup.initialSession?.legKey === legKey ? setup.initialSession : null;
        resumeCheckedRef.current = true;
        if (resume) {
          sessionIdRef.current = resume.sessionId;
          lastSeenTurnRef.current = null;
          lastCommittedTurnIdRef.current = setup.initialLastCommittedTurnId ?? null;
        } else {
          const info = await startAutodartsSession(setup.source, setup.legConfig, setup.legPlayers, () => cancelled);
          if (cancelled) {
            void finishAutodartsSession(info.sessionId);
            return;
          }
          sessionIdRef.current = info.sessionId;
          lastSeenTurnRef.current = null;
          lastCommittedTurnIdRef.current = null;
          setBoardName(info.boardName);
          setWarning(info.warnings[0] ?? null);
          callbacksRef.current.onSessionChange?.({ sessionId: info.sessionId, legKey });
        }
        consecutiveFailuresRef.current = 0;
        setPhase("live");
        stopPolling();
        pollTimerRef.current = setInterval(() => {
          void pollTick();
        }, POLL_INTERVAL_MS);
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
      // Leg over, game over, Autodarts switched off or the screen left: close this leg's match.
      if (sessionIdRef.current) {
        void finishAutodartsSession(sessionIdRef.current);
        sessionIdRef.current = null;
        callbacksRef.current.onSessionChange?.(null);
      }
      callbacksRef.current.onPendingChange?.([]);
    };
    // Only a new leg, a new source or enabled toggling starts a new Autodarts lobby (setup is read via legSetupRef).
  }, [enabled, legKey, currentSourceKey]);

  if (!enabled) return null;

  return (
    <div className="bg-card border border-border rounded-2xl p-4 flex items-center justify-between gap-3">
      <div className="flex items-center gap-2 min-w-0">
        {phase === "live" && <Wifi className="w-5 h-5 text-secondary shrink-0" />}
        {phase === "error" && <WifiOff className="w-5 h-5 text-destructive shrink-0" />}
        {phase === "connecting" && <Loader2 className="w-5 h-5 animate-spin text-primary shrink-0" />}
        <div className="min-w-0">
          <p className="font-semibold text-sm truncate">
            {phase === "live" && `Autodarts${boardName ? ` · ${boardName}` : ""}${playerName ? ` — ${playerName}` : ""}`}
            {phase === "connecting" && "Verbinde mit Autodarts…"}
            {phase === "error" && "Autodarts-Verbindung gestört"}
          </p>
          {phase === "error" && errorMessage && <p className="text-xs text-muted-foreground line-clamp-2">{errorMessage}</p>}
          {phase === "live" && warning && <p className="text-xs text-muted-foreground truncate">{warning}</p>}
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
