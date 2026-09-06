import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import type { GameMode } from "@/types/game";

export interface LeagueLink {
  leagueId: string;
  fixtureId: string;
  player1Id: string;
  player2Id: string;
  // True when player1Id (the fixture's OWN stored player1_id) is GameState.players[0] — always
  // true for a local game (this hook always sets playerNames in fixture order below), but an
  // online-played fixture can have it the other way around: whoever taps "Online" first becomes
  // GameState slot 0, which is not necessarily the fixture's own designated player1. The
  // league_fixtures write-back (Game.tsx's saveGame) needs this to attribute legsWon/winner_id to
  // the right fixture column instead of assuming slot 0 always means "player1".
  player1IsGameSlot0: boolean;
}

interface UseLeagueLinkParams {
  searchParams: URLSearchParams;
  setPlayerNames: Dispatch<SetStateAction<string[]>>;
  setTeamMode: Dispatch<SetStateAction<boolean>>;
  setNumPlayers: Dispatch<SetStateAction<number>>;
  setMode: Dispatch<SetStateAction<GameMode>>;
  setBestOfLegs: Dispatch<SetStateAction<number>>;
}

/**
 * Owns the league-fixture link for a Game.tsx session — same query-string launch pattern as
 * useTournamentLink (p1/p2/mode/bestOf), kept as its own separate hook rather than folded into
 * that one so the tournament path stays untouched by this addition.
 *
 * Deliberately NOT restored from the crash-recovery snapshot: a league fixture is lower-stakes
 * casual scheduling, not a live broadcasted event, so a reload losing just the fixture linkage
 * (the game itself still always saves safely either way, and the ref only ever drives the
 * write-back below, not gameplay) is an acceptable trade for not doubling this file's already-
 * large tournament-link surface with a second snapshot-restore path.
 *
 * The write-back itself IS now queued for offline retry, same as the tournament link (Round 3
 * backend audit KORREKTUR — see offlineQueue.ts's doc comment) -- losing a completed fixture
 * result outright, rather than just its convenience linkage on a reload, is exactly the kind of
 * silent data loss the tournament path was already built to avoid, and queuing it turned out to
 * be a small, additive change (Game.tsx's saveGame block, offlineQueue.ts, a shared
 * leagueFixtureSync.ts helper) rather than the larger restructuring this comment originally
 * weighed against.
 */
export function useLeagueLink({ searchParams, setPlayerNames, setTeamMode, setNumPlayers, setMode, setBestOfLegs }: UseLeagueLinkParams) {
  const leagueLinkRef = useRef<LeagueLink | null>(null);

  useEffect(() => {
    const lid = searchParams.get("lid");
    const fid = searchParams.get("fid");
    const p1id = searchParams.get("p1id");
    const p2id = searchParams.get("p2id");
    if (!lid || !fid || !p1id || !p2id) return;
    leagueLinkRef.current = { leagueId: lid, fixtureId: fid, player1Id: p1id, player2Id: p2id, player1IsGameSlot0: true };

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { leagueLinkRef };
}
