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
  /** dynamic rule when no player is guaranteed free yet ("loser of match X writes") */
  scorekeeperRule?: "prev-loser";
  /** match whose loser becomes the scorekeeper when `scorekeeperRule` is set */
  scorekeeperFromMatchId?: string;
  /** board number assigned by the schedule generator */
  board?: number;
  /** global playing slot (round of concurrent matches) */
  slot?: number;
  /**
   * Preliminary-round matches only (round 0): which round-1 match/slot the winner
   * of this match feeds into. Lets a non-power-of-two player count reduce to a
   * clean power-of-two main bracket via a small play-in round instead of padding
   * the whole tree with BYEs up to the next power of two.
   */
  feedsRound1Position?: number;
  feedsRound1Slot?: 1 | 2;
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

  // Preliminary round (round 0): a small play-in stage for non-power-of-two player
  // counts. Resolved like any other round, but feeds its winners into specific
  // round-1 slots instead of a uniform pairwise fold.
  const prelim = work.filter((m) => m.round === 0).sort((a, b) => a.position - b.position);
  if (prelim.length > 0) {
    const round1 = work.filter((m) => m.round === 1).sort((a, b) => a.position - b.position);
    prelim.forEach((m) => {
      if (m.winner && m.winner !== m.player1 && m.winner !== m.player2) {
        m.winner = undefined;
        m.score1 = undefined;
        m.score2 = undefined;
      }
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
      if (m.feedsRound1Position === undefined || !m.feedsRound1Slot) return;
      const target = round1.find((r1) => r1.position === m.feedsRound1Position);
      if (!target) return;
      if (m.feedsRound1Slot === 1) target.player1 = m.winner;
      else target.player2 = m.winner;
    });
  }

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
  const hasPrelim = matches.some((m) => m.round === 0);
  let slotCursor = 0;

  for (let r = hasPrelim ? 0 : 1; r <= totalRounds; r++) {
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

  /**
   * Players who are guaranteed not to be called to a board any more:
   * they lost a finished match and appear in no open match at all.
   */
  const openPlayers = new Set<string>();
  matches
    .filter((m) => !m.winner && (isRealPlayer(m.player1) || isRealPlayer(m.player2)))
    .forEach((m) => {
      if (isRealPlayer(m.player1)) openPlayers.add(m.player1!);
      if (isRealPlayer(m.player2)) openPlayers.add(m.player2!);
    });
  // players who might still enter a later round (their feeder match is undecided)
  const potentialPlayers = new Set<string>();
  matches
    .filter((m) => !m.winner && isRealPlayer(m.player1) && isRealPlayer(m.player2))
    .forEach((m) => {
      potentialPlayers.add(m.player1!);
      potentialPlayers.add(m.player2!);
    });
  const definitelyFree = (p: string) => !openPlayers.has(p) && !potentialPlayers.has(p);

  slots.forEach((slot) => {
    const entries = schedule.filter((e) => e.slot === slot).sort((a, b) => a.board - b.board);
    const busy = playersInSlot(slot);
    const taken = new Set<string>();

    entries.forEach((entry) => {
      const m = byId.get(entry.match.id)!;
      m.board = entry.board;
      m.slot = entry.slot;
      if (m.scorekeeperLocked && m.scorekeeper) {
        taken.add(m.scorekeeper);
        return;
      }
      m.scorekeeperRule = undefined;
      m.scorekeeperFromMatchId = undefined;
      if (
        opts.keepExisting &&
        m.scorekeeper &&
        definitelyFree(m.scorekeeper) &&
        !busy.has(m.scorekeeper) &&
        !taken.has(m.scorekeeper)
      ) {
        taken.add(m.scorekeeper);
        return;
      }
      // only players whose tournament run is already decided can be planned by name
      const candidates = pool.filter((p) => definitelyFree(p) && !busy.has(p) && !taken.has(p));
      if (candidates.length > 0) {
        const minLoad = Math.min(...candidates.map((p) => load[p] ?? 0));
        const best = candidates.filter((p) => (load[p] ?? 0) === minLoad);
        const pick = best[Math.floor(Math.random() * best.length)];
        m.scorekeeper = pick;
        load[pick] = (load[pick] ?? 0) + 1;
        taken.add(pick);
        return;
      }
      // nobody is free yet → dynamic rule: the loser of an earlier, not yet decided match writes.
      // prefer the match on the same board one slot earlier, otherwise any match of the previous slot.
      const prev =
        schedule.find((e) => e.slot === slot - 1 && e.board === entry.board) ||
        schedule
          .filter((e) => e.slot < slot)
          .sort((a, b) => b.slot - a.slot || a.board - b.board)
          .find((e) => !taken.has(`rule:${e.match.id}`));
      m.scorekeeper = undefined;
      if (prev) {
        m.scorekeeperRule = "prev-loser";
        m.scorekeeperFromMatchId = prev.match.id;
        taken.add(`rule:${prev.match.id}`);
        return;
      }
      // very first slot: nobody has played yet → pick a player who is not at a board
      // in this slot (he plays in a later slot) so round 1 has a fixed scorekeeper too.
      const free = pool.filter((p) => !busy.has(p) && !taken.has(p));
      if (free.length > 0) {
        const minLoad = Math.min(...free.map((p) => load[p] ?? 0));
        const best = free.filter((p) => (load[p] ?? 0) === minLoad);
        const pick = best[Math.floor(Math.random() * best.length)];
        m.scorekeeper = pick;
        load[pick] = (load[pick] ?? 0) + 1;
        taken.add(pick);
      }
    });
  });

  // matches that are not playable keep no scorekeeper
  byId.forEach((m) => {
    if (!isPlayable(m) || m.winner) {
      if (!isPlayable(m)) {
        m.scorekeeper = undefined;
        m.scorekeeperLocked = undefined;
        m.scorekeeperRule = undefined;
        m.scorekeeperFromMatchId = undefined;
      }
    }
  });

  return matches.map((m) => byId.get(m.id) || m);
}

/**
 * Resolves the scorekeeper of a match for display:
 * a fixed name, or the (possibly not yet known) loser of a referenced match.
 */
export function scorekeeperLabel(match: Match, all: Match[]): string | null {
  if (match.scorekeeper) return match.scorekeeper;
  if (match.scorekeeperRule === "prev-loser" && match.scorekeeperFromMatchId) {
    const src = all.find((m) => m.id === match.scorekeeperFromMatchId);
    if (!src) return null;
    if (src.winner && src.winner !== BYE) {
      const loser = src.winner === src.player1 ? src.player2 : src.player1;
      if (isRealPlayer(loser)) return loser!;
    }
    const a = isRealPlayer(src.player1) ? src.player1 : "?";
    const b = isRealPlayer(src.player2) ? src.player2 : "?";
    return `Verlierer ${a} / ${b}`;
  }
  return null;
}

export const roundLabelFor = (round: number, total: number) => {
  if (round === 0) return "Preliminary Round";
  if (round === total) return "Final";
  if (round === total - 1) return "Semifinal";
  if (round === total - 2) return "Quarterfinal";
  if (round === total - 3) return "Round of 16";
  if (round === total - 4) return "Round of 32";
  if (round === total - 5) return "Round of 64";
  return `Round ${round}`;
};
