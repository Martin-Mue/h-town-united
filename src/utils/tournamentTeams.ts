/**
 * Doppelturniere: a team is just a tournament participant whose name is "Anna & Ben". Everything
 * name-keyed (players[], bracket, attendance, standings) therefore keeps working unchanged — only
 * the game launch (splits the name into two throwers) and the pairing step in setup know about it.
 */
export const TEAM_SEPARATOR = " & ";

export const isTeamName = (name?: string): boolean => !!name && name.includes(TEAM_SEPARATOR);

export const makeTeamName = (a: string, b: string): string => `${a.trim()}${TEAM_SEPARATOR}${b.trim()}`;

/** "Anna & Ben" -> ["Anna","Ben"]; a plain single name -> [name]. */
export const splitTeamName = (name: string): string[] =>
  name.split(TEAM_SEPARATOR).map((s) => s.trim()).filter(Boolean);

export type PairingStrategy = "order" | "random" | "balanced";

/**
 * Turns individuals into two-person teams. "order": 1+2, 3+4, … (manual control via the list
 * order); "random": shuffled with the given rng; "balanced": strongest with weakest by rating so
 * teams are evenly matched. An odd leftover player is returned in `leftover` (no team).
 */
export function pairIntoTeams(
  names: string[],
  strategy: PairingStrategy,
  opts: { rating?: (name: string) => number; random?: () => number } = {},
): { teams: string[]; leftover: string | null } {
  let pool = [...names];
  const leftover = pool.length % 2 === 1 ? pool[pool.length - 1] : null;
  if (leftover !== null) pool = pool.slice(0, -1);

  if (strategy === "random") {
    const rnd = opts.random ?? Math.random;
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
  } else if (strategy === "balanced") {
    const rating = opts.rating ?? (() => 0);
    pool.sort((a, b) => rating(b) - rating(a));
    const teams: string[] = [];
    for (let i = 0; i < pool.length / 2; i++) teams.push(makeTeamName(pool[i], pool[pool.length - 1 - i]));
    return { teams, leftover };
  }
  const teams: string[] = [];
  for (let i = 0; i < pool.length; i += 2) teams.push(makeTeamName(pool[i], pool[i + 1]));
  return { teams, leftover };
}

/** Dissolves teams back into individual names (keeps order). */
export const dissolveTeams = (participants: string[]): string[] =>
  participants.flatMap((p) => (isTeamName(p) ? splitTeamName(p) : [p]));
