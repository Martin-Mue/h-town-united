import { buildSchedule, currentBoardSchedule, isPlayable, type Match } from "./tournament";

/**
 * Organizer board control for a running KO tournament: which match is on which board right now,
 * which ready matches are still waiting, and the two organizer actions on top of the automatic
 * per-board order — call a chosen match to a free board, and pause/resume a match.
 *
 * Both actions only set per-match flags (Match.assignedBoard / Match.paused) that
 * currentBoardSchedule reads. They never touch players, round, position, winner or the planned
 * schedule (buildSchedule), so the bracket's pairings and order can't be reshuffled by them.
 */

export interface BoardStatus {
  board: number;
  /** The match on this board right now, or null when the board is free. */
  match: Match | null;
  /** True when the organizer called this match here (instead of the automatic order). */
  calledByOrganizer: boolean;
}

export interface BoardControlOverview {
  boards: BoardStatus[];
  /** Ready (playable, undecided) matches that are on no board right now, in planned order —
   *  paused ones included (flagged via `paused`). */
  openMatches: Match[];
  /** Number of `openMatches` that are not paused. */
  readyCount: number;
  /** Lowest-numbered free board, or null when every board is busy. */
  firstFreeBoard: number | null;
}

const boardCountOf = (boards: number) => Math.max(1, Math.floor(boards) || 1);

export function boardControlOverview(matches: Match[], boards: number): BoardControlOverview {
  const count = boardCountOf(boards);
  const { now } = currentBoardSchedule(matches, count);
  const boardStatuses: BoardStatus[] = Array.from({ length: count }, (_, i) => {
    const board = i + 1;
    const entry = now.find((e) => e.board === board);
    return { board, match: entry?.match ?? null, calledByOrganizer: !!entry && entry.match.assignedBoard === board };
  });
  const onBoard = new Set(now.map((e) => e.match.id));
  const openMatches = buildSchedule(matches, count)
    .filter((e) => !e.match.winner && !onBoard.has(e.match.id))
    .sort((a, c) => a.slot - c.slot || a.board - c.board)
    .map((e) => e.match);
  const free = boardStatuses.find((s) => !s.match);
  return {
    boards: boardStatuses,
    openMatches,
    readyCount: openMatches.filter((m) => !m.paused).length,
    firstFreeBoard: free ? free.board : null,
  };
}

const isReady = (m: Match | undefined): m is Match => !!m && isPlayable(m) && !m.winner;

const withoutQueueFlags = (m: Match): Match => {
  const copy = { ...m };
  delete copy.paused;
  delete copy.assignedBoard;
  return copy;
};

/**
 * Calls a ready match to a board. Only allowed onto a FREE board (nothing running there right
 * now) so an organizer tap can never push a match that's already being played off its board.
 * Also resumes the match if it was paused. Returns null when nothing should change (unknown or
 * decided match, invalid board, board busy, or the match is already on that board).
 */
export function assignMatchToBoard(matches: Match[], matchId: string, board: number, boards: number): Match[] | null {
  const count = boardCountOf(boards);
  if (!Number.isInteger(board) || board < 1 || board > count) return null;
  if (!isReady(matches.find((m) => m.id === matchId))) return null;
  const occupant = currentBoardSchedule(matches, count).now.find((e) => e.board === board);
  if (occupant) return null;
  return matches.map((m) => (m.id === matchId ? { ...withoutQueueFlags(m), assignedBoard: board } : { ...m }));
}

/**
 * Pauses or resumes a ready match. A paused match leaves whatever board it was on (its board
 * call is dropped) and is skipped by the automatic order until resumed; resuming puts it back
 * into its normal planned place. Returns null when nothing should change.
 */
export function setMatchPaused(matches: Match[], matchId: string, paused: boolean): Match[] | null {
  const target = matches.find((m) => m.id === matchId);
  if (!isReady(target) || !!target.paused === paused) return null;
  return matches.map((m) => {
    if (m.id !== matchId) return { ...m };
    return paused ? { ...withoutQueueFlags(m), paused: true } : withoutQueueFlags(m);
  });
}

/** Board to show on a match badge: where the organizer called it, else its planned board. */
export const displayBoardOf = (m: Match): number | undefined => m.assignedBoard ?? m.board;
