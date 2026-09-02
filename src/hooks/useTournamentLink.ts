import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { GameMode } from "@/types/game";
import type { TournamentLink } from "@/lib/activeGameSnapshot";

interface UseTournamentLinkParams {
  searchParams: URLSearchParams;
  initialTournamentLink: TournamentLink | null;
  setPlayerNames: Dispatch<SetStateAction<string[]>>;
  setTeamMode: Dispatch<SetStateAction<boolean>>;
  setNumPlayers: Dispatch<SetStateAction<number>>;
  setMode: Dispatch<SetStateAction<GameMode>>;
  setBestOfLegs: Dispatch<SetStateAction<number>>;
  setCheckoutSuggestionEnabled: Dispatch<SetStateAction<boolean>>;
}

/**
 * Owns the tournament-bracket-match link for a Game.tsx session: the ref set once on mount when
 * this game was launched via "Spiel starten" on a tournament bracket match, and the one-time
 * prefill effect that reads the launch query string (tid/mid/tname/board/p1/p2/mode/bestOf).
 * Everything the prefill sets stays a normal, editable setup value on the caller's own state —
 * only the tournament/match id link itself (the ref) is fixed.
 *
 * Deliberately does NOT own the board-mode auto-start machinery (boardStartGate,
 * autoStartCanceled, the gate-check/live-snapshot-push/auto-start effects) even though those also
 * only apply to a tournament-linked game — that system is tightly coupled to core game-start
 * orchestration (phase, startGame) and was already hardened through several real board-mode bug
 * fixes; moving it carries more regression risk than benefit without a way to live-test it here,
 * so it stays in Game.tsx itself, reading tournamentLinkRef.current the same way it always has.
 */
export function useTournamentLink({
  searchParams,
  initialTournamentLink,
  setPlayerNames,
  setTeamMode,
  setNumPlayers,
  setMode,
  setBestOfLegs,
  setCheckoutSuggestionEnabled,
}: UseTournamentLinkParams) {
  const tournamentLinkRef = useRef<TournamentLink | null>(initialTournamentLink);
  const [tournamentLinkName, setTournamentLinkName] = useState<string | null>(() =>
    initialTournamentLink ? (initialTournamentLink.tournamentName || "Turnier") : null
  );

  useEffect(() => {
    const tid = searchParams.get("tid");
    const mid = searchParams.get("mid");
    if (!tid || !mid) return;
    const tname = searchParams.get("tname") || undefined;
    // Routes "Zurück zum Turnier" straight back to a board's next-match view instead of the flat
    // bracket, closing the loop board-mode exists for — set either from an explicit board-mode
    // "Los geht's" tap (Tournament.tsx's startFromBoard appends ?board=N), OR, when this match was
    // reached some other way (a QR-code scan, a manual bracket tap), falling back to whichever
    // board THIS device last bound to for THIS tournament — the whole point of board-mode is that
    // one device only ever plays one board, so any match for that tournament on this device almost
    // certainly belongs there too, not just the ones launched through the board-mode button itself.
    const boardParam = parseInt(searchParams.get("board") || "", 10);
    let board = Number.isFinite(boardParam) && boardParam > 0 ? boardParam : undefined;
    if (board === undefined && typeof window !== "undefined") {
      const savedBoard = parseInt(window.localStorage.getItem(`dart-tournament-board-${tid}`) || "", 10);
      if (Number.isFinite(savedBoard) && savedBoard > 0) board = savedBoard;
    }
    tournamentLinkRef.current = { tournamentId: tid, matchId: mid, tournamentName: tname, board };
    setTournamentLinkName(tname || "Turnier");
    setCheckoutSuggestionEnabled(false);

    const p1 = searchParams.get("p1");
    const p2 = searchParams.get("p2");
    if (p1 || p2) {
      setPlayerNames((prev) => {
        const next = [...prev];
        if (p1) next[0] = p1;
        if (p2) next[1] = p2;
        return next;
      });
    }
    setTeamMode(false);
    setNumPlayers(2);

    const qMode = searchParams.get("mode");
    if (qMode === "501" || qMode === "301" || qMode === "cricket") setMode(qMode);

    const qBestOf = parseInt(searchParams.get("bestOf") || "", 10);
    if (Number.isFinite(qBestOf) && qBestOf > 0) setBestOfLegs(qBestOf);
    // Only ever read once, right after mount — re-running on every searchParams identity
    // change would clobber the scorekeeper's own edits to the setup form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { tournamentLinkRef, tournamentLinkName, setTournamentLinkName };
}
