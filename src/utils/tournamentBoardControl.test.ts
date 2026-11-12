import { describe, it, expect } from "vitest";
import { buildSchedule, currentBoardSchedule, recomputeBracket, assignScorekeepers, type Match } from "./tournament";
import { assignMatchToBoard, boardControlOverview, setMatchPaused, displayBoardOf } from "./tournamentBoardControl";
import { applyActionToKoBracket } from "@/lib/tournamentMatchSync";

// 8-player KO, 2 boards: planned board 1 = qf0, qf2; board 2 = qf1, qf3.
const quarterFinals = (): Match[] => [
  { id: "qf0", round: 1, position: 0, player1: "A", player2: "B" },
  { id: "qf1", round: 1, position: 1, player1: "C", player2: "D" },
  { id: "qf2", round: 1, position: 2, player1: "E", player2: "F" },
  { id: "qf3", round: 1, position: 3, player1: "G", player2: "H" },
  { id: "sf0", round: 2, position: 0 },
  { id: "sf1", round: 2, position: 1 },
  { id: "f0", round: 3, position: 0 },
];

const decide = (matches: Match[], id: string, winner: string) =>
  recomputeBracket(matches.map((m) => (m.id === id ? { ...m, winner } : m)));

const boardOf = (matches: Match[], board: number) =>
  currentBoardSchedule(matches, 2).now.find((e) => e.board === board)?.match.id;

/** Everything that defines the bracket itself: who plays whom, where in the tree, and the planned order. */
const bracketShape = (matches: Match[]) => ({
  pairings: matches.map((m) => ({ id: m.id, round: m.round, position: m.position, player1: m.player1, player2: m.player2, winner: m.winner })),
  plannedOrder: buildSchedule(matches, 2).map((e) => ({ id: e.match.id, slot: e.slot, board: e.board })),
});

describe("boardControlOverview", () => {
  it("puts the first planned match of each board on it and lists the rest as open", () => {
    const overview = boardControlOverview(quarterFinals(), 2);
    expect(overview.boards.map((b) => b.match?.id)).toEqual(["qf0", "qf1"]);
    expect(overview.openMatches.map((m) => m.id)).toEqual(["qf2", "qf3"]);
    expect(overview.readyCount).toBe(2);
    expect(overview.firstFreeBoard).toBeNull();
  });

  it("frees a board once it has no own planned match left", () => {
    // 3 boards: board 1 = qf0, qf3; board 2 = qf1; board 3 = qf2. sf0 waits for qf0.
    const matches = decide(quarterFinals(), "qf1", "C");
    const overview = boardControlOverview(matches, 3);
    expect(overview.boards.map((b) => b.match?.id ?? null)).toEqual(["qf0", null, "qf2"]);
    expect(overview.firstFreeBoard).toBe(2);
    expect(overview.openMatches.map((m) => m.id)).toEqual(["qf3"]);
  });
});

describe("pausing a match", () => {
  it("is skipped by the automatic order and the board moves on to its next match", () => {
    const paused = setMatchPaused(quarterFinals(), "qf0", true)!;
    expect(boardOf(paused, 1)).toBe("qf2");
    const overview = boardControlOverview(paused, 2);
    expect(overview.openMatches.map((m) => m.id)).toEqual(["qf0", "qf3"]);
    expect(overview.readyCount).toBe(1);
  });

  it("leaves a board free when its only remaining match is paused", () => {
    const matches = decide(quarterFinals(), "qf0", "A");
    const paused = setMatchPaused(matches, "qf2", true)!;
    expect(boardOf(paused, 1)).toBeUndefined();
    expect(boardControlOverview(paused, 2).firstFreeBoard).toBe(1);
  });

  it("resuming puts the match back into its planned place", () => {
    const paused = setMatchPaused(quarterFinals(), "qf0", true)!;
    const resumed = setMatchPaused(paused, "qf0", false)!;
    expect(resumed.find((m) => m.id === "qf0")!.paused).toBeUndefined();
    expect(boardOf(resumed, 1)).toBe("qf0");
  });

  it("is a no-op for decided, unplayable, unknown or already-paused matches", () => {
    const matches = decide(quarterFinals(), "qf0", "A");
    expect(setMatchPaused(matches, "qf0", true)).toBeNull();
    expect(setMatchPaused(matches, "f0", true)).toBeNull();
    expect(setMatchPaused(matches, "nope", true)).toBeNull();
    const paused = setMatchPaused(matches, "qf1", true)!;
    expect(setMatchPaused(paused, "qf1", true)).toBeNull();
    expect(setMatchPaused(matches, "qf1", false)).toBeNull();
  });

  it("drops a board call when the match gets paused", () => {
    const matches = boardOneFree();
    const called = assignMatchToBoard(matches, "qf3", 1, 2)!;
    const paused = setMatchPaused(called, "qf3", true)!;
    expect(paused.find((m) => m.id === "qf3")!.assignedBoard).toBeUndefined();
    expect(boardOf(paused, 1)).toBeUndefined();
  });
});

/** qf0 decided and qf2 paused: board 1 has nothing it may play automatically, so it is free. */
const boardOneFree = () => setMatchPaused(decide(quarterFinals(), "qf0", "A"), "qf2", true)!;

describe("calling a chosen match to a board", () => {
  it("puts any ready match on a free board instead of only the automatic next one", () => {
    const matches = boardOneFree();
    expect(boardControlOverview(matches, 2).firstFreeBoard).toBe(1);
    // qf3 is planned for board 2 after qf1 — call it to the free board 1 instead.
    const called = assignMatchToBoard(matches, "qf3", 1, 2)!;
    expect(boardOf(called, 1)).toBe("qf3");
    expect(boardOf(called, 2)).toBe("qf1");
    const overview = boardControlOverview(called, 2);
    expect(overview.boards[0].calledByOrganizer).toBe(true);
    expect(overview.openMatches.map((m) => m.id)).toEqual(["qf2"]);
    // its planned board is no longer offered it
    expect(currentBoardSchedule(called, 2).onDeck.find((e) => e.board === 2)?.match.id).not.toBe("qf3");
  });

  it("refuses a busy board, an invalid board, and decided or unplayable matches", () => {
    const matches = quarterFinals();
    expect(assignMatchToBoard(matches, "qf2", 1, 2)).toBeNull(); // board 1 runs qf0
    expect(assignMatchToBoard(matches, "qf2", 3, 2)).toBeNull();
    expect(assignMatchToBoard(matches, "qf2", 0, 2)).toBeNull();
    expect(assignMatchToBoard(matches, "f0", 1, 2)).toBeNull();
    const done = boardOneFree();
    expect(assignMatchToBoard(done, "qf0", 1, 2)).toBeNull(); // decided
  });

  it("resumes a paused match it calls to a board", () => {
    let matches = decide(quarterFinals(), "qf0", "A");
    matches = setMatchPaused(matches, "qf2", true)!; // board 1 now free
    const called = assignMatchToBoard(matches, "qf2", 1, 2)!;
    const qf2 = called.find((m) => m.id === "qf2")!;
    expect(qf2.paused).toBeUndefined();
    expect(qf2.assignedBoard).toBe(1);
    expect(displayBoardOf(qf2)).toBe(1);
  });

  it("frees the board again once the called match is decided, and the flag is dropped", () => {
    let matches = boardOneFree();
    matches = assignMatchToBoard(matches, "qf3", 1, 2)!;
    matches = decide(matches, "qf3", "G");
    expect(matches.find((m) => m.id === "qf3")!.assignedBoard).toBeUndefined();
    expect(boardOf(matches, 1)).toBeUndefined();
  });
});

describe("board control never reshuffles the bracket", () => {
  it("keeps pairings, tree positions and planned order identical through assign/pause/resume", () => {
    const players = ["A", "B", "C", "D", "E", "F", "G", "H"];
    let matches = assignScorekeepers(recomputeBracket(quarterFinals()), players, { boards: 2 });
    matches = decide(matches, "qf0", "A");
    const before = bracketShape(matches);

    let after = setMatchPaused(matches, "qf2", true)!; // board 1 free
    after = assignMatchToBoard(after, "qf3", 1, 2)!;
    after = setMatchPaused(after, "qf1", true)!; // board 2 free
    after = assignMatchToBoard(after, "qf2", 2, 2)!; // resumes qf2 there
    after = setMatchPaused(after, "qf1", false)!;
    after = assignScorekeepers(recomputeBracket(after, players), players, { boards: 2, keepExisting: true });

    expect(bracketShape(after)).toEqual(before);
    expect(after.map((m) => m.board)).toEqual(matches.map((m) => m.board));
    expect(after.map((m) => m.slot)).toEqual(matches.map((m) => m.slot));
  });

  it("routes through the shared bracket-action path (online apply and offline replay) the same way", () => {
    const ctx = { defaultBestOf: 3, boards: 2 };
    const matches = decide(quarterFinals(), "qf0", "A");
    const before = bracketShape(matches);
    const paused = applyActionToKoBracket(matches, { type: "setKoPaused", matchId: "qf2", paused: true }, ctx)!;
    expect(paused.find((m) => m.id === "qf2")!.paused).toBe(true);
    const called = applyActionToKoBracket(paused, { type: "assignKoBoard", matchId: "qf3", board: 1 }, ctx)!;
    expect(boardOf(called, 1)).toBe("qf3");
    // a stale replay (board meanwhile busy) is a no-op instead of double-booking it
    expect(applyActionToKoBracket(called, { type: "assignKoBoard", matchId: "qf2", board: 1 }, ctx)).toBeNull();
    expect(bracketShape(called)).toEqual(before);
  });
});
