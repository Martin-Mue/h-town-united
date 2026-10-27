import { supabase } from "@/integrations/supabase/client";
import { createLegState, createCricketState } from "@/utils/gameStateFactory";
import type { GameState, PlayerSlot, TeamSlot } from "@/types/game";
import type { Json } from "@/integrations/supabase/types";

/** One seat of an online doubles match. `slot` is the index into GameState.players: the team-mode
 *  interleaving [A1, B1, A2, B2] means slot 0 = challenger (team A), 1 = first opponent (team B),
 *  2 = partner (team A), 3 = second opponent (team B); the team is always `slot % 2`. */
export interface DoublesSeat {
  slot: number;
  userId: string;
  status: "invited" | "accepted" | "declined";
  declineReason: string | null;
  name: string;
  emoji: string;
}

export const teamOfSlot = (slot: number) => slot % 2;

export interface DoublesMatchSettings {
  mode: "501" | "301" | "cricket" | "custom";
  bestOfLegs: number;
  bestOfSets?: number | null;
  customStartScore?: number | null;
  doubleIn: boolean;
  doubleOut: boolean;
  starter: "challenger" | "opponent" | "random";
}

/** Default team label: both members' first names, e.g. "Anna & Ben". */
export const defaultTeamName = (a: string, b: string) => `${a.split(" ")[0]} & ${b.split(" ")[0]}`;

/** The very first GameState of a doubles match, built by whichever device sends the last
 *  acceptance (see respond_online_doubles). `names` is indexed by slot. Same shape a local team
 *  game produces in Game.tsx's startGameWithStarter, so every team-mode rule applies unchanged. */
export function buildDoublesInitialState(names: string[], settings: DoublesMatchSettings, teamNames?: [string, string] | null): GameState {
  const startScore = settings.mode === "cricket" ? 0 : settings.mode === "custom" ? (settings.customStartScore ?? 501) : Number(settings.mode);
  const players: PlayerSlot[] = names.slice(0, 4).map((name) => ({
    name,
    doubleOut: settings.doubleOut,
    doubleIn: settings.doubleIn,
    isBot: false,
  }));
  const teams: TeamSlot[] = [
    { name: teamNames?.[0] || defaultTeamName(names[0], names[2]) },
    { name: teamNames?.[1] || defaultTeamName(names[1], names[3]) },
  ];
  // Who starts leg 1 — a team's first member (slot 0 or 1), same convention as the local team setup.
  const starter = settings.starter === "opponent" ? 1 : settings.starter === "random" ? (Math.random() < 0.5 ? 0 : 1) : 0;
  const game: GameState = {
    mode: settings.mode,
    startScore,
    bestOfLegs: settings.bestOfLegs,
    players,
    legsWon: [0, 0],
    currentLeg: createLegState(1, startScore, starter, players, teams),
    completedLegs: [],
    currentPlayerIndex: starter,
    isFinished: false,
    teams,
    ...(settings.mode !== "cricket" && settings.bestOfSets ? { setsMode: { bestOfSets: settings.bestOfSets }, setsWon: [0, 0] } : {}),
  };
  if (settings.mode === "cricket") {
    game.cricket = [createCricketState(), createCricketState()];
  }
  return game;
}

/** Loads the four seats of a doubles match, joined with name/emoji from the club roster. */
export async function loadDoublesSeats(matchId: string): Promise<DoublesSeat[]> {
  const { data: seats } = await supabase
    .from("online_match_players")
    .select("slot, user_id, status, decline_reason")
    .eq("match_id", matchId)
    .order("slot");
  const ids = (seats ?? []).map((s) => s.user_id);
  const { data: people } = ids.length ? await supabase.from("players").select("user_id, name, emoji").in("user_id", ids) : { data: [] };
  const byUser = new Map((people ?? []).map((p) => [p.user_id, p]));
  return (seats ?? []).map((s) => ({
    slot: s.slot,
    userId: s.user_id,
    status: s.status as DoublesSeat["status"],
    declineReason: s.decline_reason,
    name: byUser.get(s.user_id)?.name ?? "?",
    emoji: byUser.get(s.user_id)?.emoji ?? "🎯",
  }));
}

/** Accept or decline a doubles invitation. When this acceptance completes the lobby, the initial
 *  game state (built from the final seat names) is sent along and the match goes live; the
 *  returned status says which happened ('pending' = still waiting for others). */
export async function respondToDoubles(
  matchId: string,
  accept: boolean,
  opts: { reason?: string; settings?: DoublesMatchSettings; teamNames?: [string, string] | null } = {},
): Promise<{ status: string; error?: string }> {
  let initial: Json | null = null;
  if (accept && opts.settings) {
    const seats = await loadDoublesSeats(matchId);
    // Everyone else already accepted -> I am the one completing the lobby. (Two last acceptances
    // landing at the same moment can each think the other is still open; the lobby screen then
    // calls this again with accept=true, which is idempotent and starts the match.)
    const myId = (await supabase.auth.getUser()).data.user?.id;
    const waiting = seats.filter((s) => s.userId !== myId && s.status !== "accepted");
    if (seats.length === 4 && waiting.length === 0) {
      initial = {
        ...buildDoublesInitialState(seats.map((s) => s.name), opts.settings, opts.teamNames),
        dartsThisRound: 0,
        turnStartRemaining: opts.settings.mode === "cricket" ? 0 : opts.settings.mode === "custom" ? (opts.settings.customStartScore ?? 501) : Number(opts.settings.mode),
      } as unknown as Json;
    }
  }
  const { data, error } = await supabase.rpc("respond_online_doubles", {
    _match_id: matchId,
    _accept: accept,
    _reason: opts.reason,
    _initial_game_state: initial ?? undefined,
  });
  return error ? { status: "error", error: error.message } : { status: String(data) };
}
