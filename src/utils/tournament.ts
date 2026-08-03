export interface Match {
  id: string;
  round: number;
  position: number;
  player1?: string;
  player2?: string;
  winner?: string;
  score1?: number;
  score2?: number;
  table?: number;
  /** assigned scorekeeper ("Schreiber") for this match */
  scorekeeper?: string;
  /** manually fixed scorekeeper – never overwritten by the auto-assignment */
  scorekeeperLocked?: boolean;
  /** board number assigned by the schedule generator */
  board?: number;
  /** global playing slot (round of concurrent matches) */
  slot?: number;
}

export const BYE = "BYE";

export const isRealPlayer = (name?: string) => !!name && name !== BYE;

/**
 * Fully recomputes a KO bracket:
 *  - resolves BYE matches automatically (also BYE vs BYE → BYE advances)
 *  - propagates winners into every later round
 *  - cascades resets: a downstream winner that is no longer a participant is cleared
 */
export function recomputeBracket(input: Match[]): Match[] {
  const work = input.map((m) => ({ ...m }));
  if (work.length === 0) return work;
  const totalRounds = Math.max(...work.map((m) => m.round));

  for (let r = 1; r <= totalRounds; r++) {
    const rm = work.filter((m) => m.round === r).sort((a, b) => a.position - b.position);

    rm.forEach((m) => {
      // invalidate stale results
      if (m.winner && m.winner !== m.player1 && m.winner !== m.player2) {
        m.winner = undefined;
        m.score1 = undefined;
        m.score2 = undefined;
      }
      if (!m.player1 && !m.player2) {
        m.score1 = undefined;
        m.score2 = undefined;
        m.scorekeeper = undefined;
      }
      // auto-resolve byes once both slots are decided
      if (!m.winner && m.player1 && m.player2) {
        const bye1 = m.player1 === BYE;
        const bye2 = m.player2 === BYE;
        if (bye1 && bye2) m.winner = BYE;
        else if (bye2) m.winner = m.player1;
        else if (bye1) m.winner = m.player2;
      }
      if (m.winner === BYE) {
        m.score1 = undefined;
        m.score2 = undefined;
      }
    });

    if (r < totalRounds) {
      const nr = work.filter((m) => m.round === r + 1).sort((a, b) => a.position - b.position);
      rm.forEach((m, idx) => {
        const next = nr[Math.floor(idx / 2)];
        if (!next) return;
        if (idx % 2 === 0) next.player1 = m.winner;
        else next.player2 = m.winner;
      });
    }
  }

  return work;
}

export function bracketChampion(matches: Match[]): string | null {
  if (matches.length === 0) return null;
  const totalRounds = Math.max(...matches.map((m) => m.round));
  const final = matches.find((m) => m.round === totalRounds);
  return final?.winner && final.winner !== BYE ? final.winner : null;
}

export interface ScheduleEntry {
  match: Match;
  round: number;
  slot: number;
  board: number;
}

/** Playable = both slots known, both real players, no winner yet. */
export const isPlayable = (m: Match) => isRealPlayer(m.player1) && isRealPlayer(m.player2);

/**
 * Builds a board-aware playing order. Matches of a round are distributed over
 * the available boards; every "slot" is a set of concurrently played matches.
 */
export function buildSchedule(matches: Match[], boards: number): ScheduleEntry[] {
  const b = Math.max(1, boards);
  const entries: ScheduleEntry[] = [];
  const totalRounds = matches.length ? Math.max(...matches.map((m) => m.round)) : 0;
  let slotCursor = 0;

  for (let r = 1; r <= totalRounds; r++) {
    const list = matches
      .filter((m) => m.round === r && isPlayable(m))
      .sort((a, b2) => a.position - b2.position);
    list.forEach((m, idx) => {
      entries.push({ match: m, round: r, slot: slotCursor + Math.floor(idx / b), board: (idx % b) + 1 });
    });
    if (list.length) slotCursor += Math.ceil(list.length / b);
  }
  return entries;
}

/**
 * Assigns scorekeepers ("Schreiber").
 *  - never someone playing in the same slot (or the directly following slot if avoidable)
 *  - from round 2 on, losers of the previous round are preferred
 *  - workload is balanced so the same people are not picked over and over
 */
export function assignScorekeepers(
  matches: Match[],
  participants: string[],
  opts: { boards: number; keepExisting?: boolean } = { boards: 2 }
): Match[] {
  const schedule = buildSchedule(matches, opts.boards);
  const byId = new Map(matches.map((m) => [m.id, { ...m }]));
  const pool = participants.filter(isRealPlayer);
  const load: Record<string, number> = {};
  pool.forEach((p) => (load[p] = 0));

  // preserve manual/previous assignments when asked
  if (opts.keepExisting) {
    schedule.forEach((e) => {
      const m = byId.get(e.match.id)!;
      if (m.scorekeeper && load[m.scorekeeper] !== undefined) load[m.scorekeeper] += 1;
    });
  }

  const slots = [...new Set(schedule.map((e) => e.slot))].sort((a, b) => a - b);
  const playersInSlot = (slot: number) => {
    const set = new Set<string>();
    schedule.filter((e) => e.slot === slot).forEach((e) => {
      if (e.match.player1) set.add(e.match.player1);
      if (e.match.player2) set.add(e.match.player2);
    });
    return set;
  };

  // losers per round (available as scorekeepers from the next round on)
  const losersUpTo = (round: number) => {
    const set = new Set<string>();
    matches
      .filter((m) => m.round < round && m.winner && m.winner !== BYE)
      .forEach((m) => {
        const loser = m.winner === m.player1 ? m.player2 : m.player1;
        if (isRealPlayer(loser)) set.add(loser!);
      });
    return set;
  };

  slots.forEach((slot) => {
    const entries = schedule.filter((e) => e.slot === slot).sort((a, b) => a.board - b.board);
    const busy = playersInSlot(slot);
    const nextBusy = playersInSlot(slot + 1);
    const taken = new Set<string>();

    entries.forEach((entry) => {
      const m = byId.get(entry.match.id)!;
      m.board = entry.board;
      m.slot = entry.slot;
      if (opts.keepExisting && m.scorekeeper && !busy.has(m.scorekeeper) && !taken.has(m.scorekeeper)) {
        taken.add(m.scorekeeper);
        return;
      }
      const losers = losersUpTo(entry.round);
      const base = pool.filter((p) => !busy.has(p) && !taken.has(p));
      const tiers = [
        base.filter((p) => losers.has(p) && !nextBusy.has(p)),
        base.filter((p) => !nextBusy.has(p)),
        base,
      ];
      const candidates = tiers.find((t) => t.length > 0) || [];
      if (candidates.length === 0) {
        m.scorekeeper = undefined;
        return;
      }
      const minLoad = Math.min(...candidates.map((p) => load[p] ?? 0));
      const best = candidates.filter((p) => (load[p] ?? 0) === minLoad);
      const pick = best[Math.floor(Math.random() * best.length)];
      m.scorekeeper = pick;
      load[pick] = (load[pick] ?? 0) + 1;
      taken.add(pick);
    });
  });

  // matches that are not playable keep no scorekeeper
  byId.forEach((m) => {
    if (!isPlayable(m) || m.winner) {
      if (!isPlayable(m)) m.scorekeeper = undefined;
    }
  });

  return matches.map((m) => byId.get(m.id) || m);
}

export const roundLabelFor = (round: number, total: number) => {
  if (round === total) return "Finale";
  if (round === total - 1) return "Halbfinale";
  if (round === total - 2) return "Viertelfinale";
  if (round === total - 3) return "Achtelfinale";
  return `Runde ${round}`;
};
