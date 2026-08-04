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
 *  - hard rule: never someone who plays in the same slot, in the following slot,
 *    or who still has an unplayed match in the same round (boards run at different
 *    speeds – such a player could be called to the board at any moment)
 *  - preferred: players already eliminated (they cannot be called any more)
 *  - manually locked assignments are always kept
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
  schedule.forEach((e) => {
    const m = byId.get(e.match.id)!;
    const keep = m.scorekeeperLocked || opts.keepExisting;
    if (keep && m.scorekeeper && load[m.scorekeeper] !== undefined) load[m.scorekeeper] += 1;
  });

  const slots = [...new Set(schedule.map((e) => e.slot))].sort((a, b) => a - b);
  const playersInSlot = (slot: number) => {
    const set = new Set<string>();
    schedule.filter((e) => e.slot === slot).forEach((e) => {
      if (e.match.player1) set.add(e.match.player1);
      if (e.match.player2) set.add(e.match.player2);
    });
    return set;
  };

  /** everyone who still has an open (unfinished) match in this round from `fromSlot` on */
  const stillPlayingInRound = (round: number, fromSlot: number) => {
    const set = new Set<string>();
    schedule
      .filter((e) => e.round === round && e.slot >= fromSlot && !e.match.winner)
      .forEach((e) => {
        if (e.match.player1) set.add(e.match.player1);
        if (e.match.player2) set.add(e.match.player2);
      });
    return set;
  };

  /** everyone who can still appear in a later round (i.e. is not eliminated) */
  const stillAlive = (round: number) => {
    const set = new Set<string>();
    matches
      .filter((m) => m.round >= round)
      .forEach((m) => {
        if (isRealPlayer(m.player1)) set.add(m.player1!);
        if (isRealPlayer(m.player2)) set.add(m.player2!);
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
    const prevBusy = playersInSlot(slot - 1);
    const singleBoard = Math.max(1, opts.boards) === 1;
    // loser of the directly preceding match – free and right at the board
    const prevLosers = new Set<string>();
    schedule
      .filter((e) => e.slot === slot - 1 && e.match.winner && e.match.winner !== BYE)
      .forEach((e) => {
        const l = e.match.winner === e.match.player1 ? e.match.player2 : e.match.player1;
        if (isRealPlayer(l)) prevLosers.add(l!);
      });
    const taken = new Set<string>();

    entries.forEach((entry) => {
      const m = byId.get(entry.match.id)!;
      m.board = entry.board;
      m.slot = entry.slot;
      if (m.scorekeeperLocked && m.scorekeeper) {
        taken.add(m.scorekeeper);
        return;
      }
      if (opts.keepExisting && m.scorekeeper && !busy.has(m.scorekeeper) && !taken.has(m.scorekeeper)) {
        taken.add(m.scorekeeper);
        return;
      }
      const losers = losersUpTo(entry.round);
      const openInRound = stillPlayingInRound(entry.round, slot);
      const alive = stillAlive(entry.round);
      // single board: the loser of the match just played keeps score
      if (singleBoard) {
        const direct = [...prevLosers].filter(
          (p) => !busy.has(p) && !nextBusy.has(p) && !taken.has(p) && !openInRound.has(p)
        );
        if (direct.length) {
          const pick = direct.sort((x, y) => (load[x] ?? 0) - (load[y] ?? 0))[0];
          m.scorekeeper = pick;
          load[pick] = (load[pick] ?? 0) + 1;
          taken.add(pick);
          return;
        }
      }
      // hard constraint: not playing now, not in the previous slot (match may run long),
      // not in the next slot, and no open match left in this round
      const base = pool.filter(
        (p) =>
          !busy.has(p) && !nextBusy.has(p) && !prevBusy.has(p) && !taken.has(p) && !openInRound.has(p)
      );
      // fallbacks, from strict to loose
      const relaxed = pool.filter(
        (p) => !busy.has(p) && !nextBusy.has(p) && !taken.has(p) && !openInRound.has(p)
      );
      const relaxed2 = pool.filter((p) => !busy.has(p) && !nextBusy.has(p) && !taken.has(p));
      const loose = pool.filter((p) => !busy.has(p) && !taken.has(p));
      const tiers = [
        // 1. eliminated players (cannot be called to a board any more)
        base.filter((p) => losers.has(p) && !alive.has(p)),
        base.filter((p) => losers.has(p)),
        base.filter((p) => !alive.has(p)),
        base,
        relaxed,
        relaxed2,
        loose,
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
      if (!isPlayable(m)) { m.scorekeeper = undefined; m.scorekeeperLocked = undefined; }
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
