import type { AutodartsLobbyPlayer } from "@/lib/autodartsClient";

/** A fellow player's confirmed Autodarts login for this match, per Dartspot player slot. Bound to
 *  the name in that slot, so a login never silently follows a slot to a different player. */
export interface AutodartsPlayerLogin {
  loginId: string;
  username: string | null;
  playerName: string;
}
export type AutodartsPlayerLogins = Record<number, AutodartsPlayerLogin>;

export interface LegPlayerSlot {
  name: string;
  isBot: boolean;
}

/**
 * The humans who throw at this Autodarts board in the current leg, in throwing order (starting
 * with the leg's starter). Bots, and in online play everyone but this device's own player
 * (onlySlot), are left out: they never throw at this board, and leaving them out keeps Autodarts'
 * own turn order in step with Dartspot's for the players who do.
 */
export function buildAutodartsLegPlayers(
  players: LegPlayerSlot[],
  startingPlayerIndex: number,
  options: { hostSlot: number | null; logins: AutodartsPlayerLogins; onlySlot?: number | null },
): AutodartsLobbyPlayer[] {
  const result: AutodartsLobbyPlayer[] = [];
  const n = players.length;
  for (let step = 0; step < n; step++) {
    const slot = (startingPlayerIndex + step) % n;
    const player = players[slot];
    if (!player || player.isBot) continue;
    if (options.onlySlot != null && slot !== options.onlySlot) continue;
    const login = options.logins[slot];
    if (slot === options.hostSlot) result.push({ kind: "host", name: player.name });
    else if (login && login.playerName === player.name) result.push({ kind: "login", name: player.name, login_id: login.loginId });
    else result.push({ kind: "guest", name: player.name });
  }
  return result;
}
