/**
 * Rules of the party games: Around the Clock, Shanghai, Halve-It and Killer, for any number of players.
 *
 * Everything here is plain data in, plain data out. A game is a PartyState; every dart goes through
 * applyPartyDart, which returns the next state and leaves the old one untouched, so the screen can keep earlier
 * states for undo.
 */

export type PartyMode = "clock" | "shanghai" | "halveIt" | "killer";
export const PARTY_MODES: PartyMode[] = ["killer", "shanghai", "halveIt", "clock"];

export const DARTS_PER_TURN = 3;
export const SHANGHAI_ROUNDS = 7;
export const HALVE_IT_START = 40;

/** What a Halve-It round is thrown at. */
export type HalveItTarget = { kind: "number"; value: number } | { kind: "double" } | { kind: "triple" } | { kind: "bull" };
/** Same order as the solo training drill, so the game feels the same in both places. */
export const HALVE_IT_TARGETS: HalveItTarget[] = [
  { kind: "number", value: 20 }, { kind: "double" }, { kind: "number", value: 19 }, { kind: "number", value: 18 }, { kind: "bull" },
  { kind: "number", value: 17 }, { kind: "triple" }, { kind: "number", value: 16 }, { kind: "number", value: 15 }, { kind: "double" },
];

/** Around the Clock: 1 to 20 in order, then the bull. */
export const CLOCK_TARGETS: number[] = [...Array.from({ length: 20 }, (_, i) => i + 1), 25];

export interface PartyOptions {
  /** Killer: lives per player. */
  lives: number;
  /** Killer: what counts as a hit on a number. "double" is the classic rule, "any" the easy one. */
  killerZone: "double" | "any";
}
export const DEFAULT_PARTY_OPTIONS: PartyOptions = { lives: 3, killerZone: "double" };

export interface PartyDart {
  /** The number hit: 1-20, 25 for the bull, 0 for a miss. */
  number: number;
  multiplier: 1 | 2 | 3;
  points: number;
}

export interface PartyPlayer {
  name: string;
  /** Shanghai, Halve-It: points. */
  score: number;
  /** Around the Clock: how many targets are done (index into CLOCK_TARGETS). */
  progress: number;
  /** Killer: the player's own number, lives left, and whether they may take lives. */
  number: number;
  lives: number;
  isKiller: boolean;
  /** Killer: out of the game. */
  out: boolean;
  /** The darts of the turn in progress (or of the last finished one, until the next turn begins). */
  turnDarts: PartyDart[];
}

export interface PartyState {
  mode: PartyMode;
  options: PartyOptions;
  players: PartyPlayer[];
  /** Whose turn it is. */
  current: number;
  /** Darts thrown in the current turn. */
  dartsThisTurn: number;
  /** Shanghai, Halve-It: the round being played, from 0. */
  round: number;
  finished: boolean;
  /** Indexes of the winners; more than one when a points game ends level. */
  winners: number[];
  /** Halve-It: the last finished turn hit nothing and the score was halved (for the screen to say so). */
  lastTurnHalved: boolean;
  /** Shanghai: the game ended by a Shanghai (single, double and treble of the number in one turn). */
  wonByShanghai: boolean;
}

/** Turns what the score pad reports (bullseye as 50 x 1) into a dart with a number and a multiplier. */
export function toPartyDart(baseValue: number, multiplier: number): PartyDart {
  if (baseValue === 50) return { number: 25, multiplier: 2, points: 50 };
  const mul = (multiplier === 2 || multiplier === 3 ? multiplier : 1) as 1 | 2 | 3;
  if (baseValue === 25) return { number: 25, multiplier: mul === 3 ? 1 : mul, points: 25 * (mul === 3 ? 1 : mul) };
  if (baseValue < 1 || baseValue > 20) return { number: 0, multiplier: 1, points: 0 };
  return { number: baseValue, multiplier: mul, points: baseValue * mul };
}

/** `count` different numbers from 1 to 20, in random order. */
export function drawKillerNumbers(count: number, random: () => number = Math.random): number[] {
  const pool = Array.from({ length: 20 }, (_, i) => i + 1);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count);
}

export function createPartyGame(mode: PartyMode, names: string[], options: PartyOptions = DEFAULT_PARTY_OPTIONS, random: () => number = Math.random): PartyState {
  const numbers = mode === "killer" ? drawKillerNumbers(names.length, random) : names.map(() => 0);
  return {
    mode,
    options,
    players: names.map((name, i) => ({
      name,
      score: mode === "halveIt" ? HALVE_IT_START : 0,
      progress: 0,
      number: numbers[i],
      lives: mode === "killer" ? options.lives : 0,
      isKiller: false,
      out: false,
      turnDarts: [],
    })),
    current: 0,
    dartsThisTurn: 0,
    round: 0,
    finished: false,
    winners: [],
    lastTurnHalved: false,
    wonByShanghai: false,
  };
}

/** How many rounds a points game has; null for games that end when someone reaches the goal. */
export function totalRounds(mode: PartyMode): number | null {
  return mode === "shanghai" ? SHANGHAI_ROUNDS : mode === "halveIt" ? HALVE_IT_TARGETS.length : null;
}

const halveItHit = (target: HalveItTarget, dart: PartyDart): boolean =>
  dart.number !== 0 && (
    target.kind === "number" ? dart.number === target.value :
    target.kind === "double" ? dart.multiplier === 2 :
    target.kind === "triple" ? dart.multiplier === 3 :
    dart.number === 25
  );

const highestScorers = (players: PartyPlayer[]): number[] => {
  const best = Math.max(...players.map((p) => p.score));
  return players.map((p, i) => (p.score === best ? i : -1)).filter((i) => i >= 0);
};

/** Ends the current turn: hands over to the next player still in the game and closes the round or the game. */
function endTurn(state: PartyState): void {
  const n = state.players.length;
  if (state.mode === "halveIt") {
    const player = state.players[state.current];
    const target = HALVE_IT_TARGETS[state.round];
    const hitSomething = player.turnDarts.some((d) => halveItHit(target, d));
    state.lastTurnHalved = !hitSomething;
    if (!hitSomething) player.score = Math.ceil(player.score / 2);
  }
  let next = state.current;
  for (let step = 0; step < n; step++) {
    next = (next + 1) % n;
    if (next === 0) state.round += 1;
    if (!state.players[next].out) break;
  }
  const rounds = totalRounds(state.mode);
  if (rounds !== null && state.round >= rounds) {
    state.finished = true;
    state.winners = highestScorers(state.players);
    return;
  }
  state.current = next;
  state.dartsThisTurn = 0;
}

/**
 * Applies one dart of the player whose turn it is and returns the new state.
 * The turn passes on by itself after three darts; a finished game is returned unchanged.
 */
export function applyPartyDart(previous: PartyState, baseValue: number, multiplier: number): PartyState {
  if (previous.finished) return previous;
  const state: PartyState = { ...previous, players: previous.players.map((p) => ({ ...p, turnDarts: [...p.turnDarts] })), lastTurnHalved: false };
  const dart = toPartyDart(baseValue, multiplier);
  const player = state.players[state.current];
  if (state.dartsThisTurn === 0) player.turnDarts = [];
  player.turnDarts.push(dart);
  state.dartsThisTurn += 1;

  if (state.mode === "clock") {
    if (dart.number !== 0 && dart.number === CLOCK_TARGETS[player.progress]) player.progress += 1;
    if (player.progress >= CLOCK_TARGETS.length) {
      state.finished = true;
      state.winners = [state.current];
      return state;
    }
  } else if (state.mode === "shanghai") {
    const target = state.round + 1;
    if (dart.number === target) player.score += dart.points;
    const onTarget = player.turnDarts.filter((d) => d.number === target).map((d) => d.multiplier);
    if ([1, 2, 3].every((m) => onTarget.includes(m as 1 | 2 | 3))) {
      state.finished = true;
      state.winners = [state.current];
      state.wonByShanghai = true;
      return state;
    }
  } else if (state.mode === "halveIt") {
    if (halveItHit(HALVE_IT_TARGETS[state.round], dart)) player.score += dart.points;
  } else {
    const counts = dart.number >= 1 && dart.number <= 20 && (state.options.killerZone === "any" || dart.multiplier === 2);
    if (counts) {
      if (!player.isKiller) {
        if (dart.number === player.number) player.isKiller = true;
      } else {
        // A killer's hit takes a life from whoever owns the number, the killer included.
        const victim = state.players.find((p) => !p.out && p.number === dart.number);
        if (victim) {
          victim.lives -= 1;
          if (victim.lives <= 0) { victim.lives = 0; victim.out = true; }
        }
      }
    }
    const alive = state.players.map((p, i) => (p.out ? -1 : i)).filter((i) => i >= 0);
    if (alive.length <= 1) {
      state.finished = true;
      state.winners = alive;
      return state;
    }
    // A killer who took their own last life is out: the turn ends right there.
    if (player.out) {
      endTurn(state);
      return state;
    }
  }

  if (state.dartsThisTurn >= DARTS_PER_TURN) endTurn(state);
  return state;
}

/** Ends the turn early, counting the darts not thrown as misses (the "next player" button). */
export function passPartyTurn(previous: PartyState): PartyState {
  let state = previous;
  const thrower = previous.current;
  const round = previous.round;
  for (let i = previous.dartsThisTurn; i < DARTS_PER_TURN; i++) {
    if (state.finished || state.current !== thrower || state.round !== round) break;
    state = applyPartyDart(state, 0, 1);
  }
  return state;
}

/** What the player at the board is aiming at, as data for the screen to put into words. */
export type PartyTarget =
  | { kind: "number"; value: number }
  | { kind: "bull" }
  | { kind: "double" }
  | { kind: "triple" }
  | { kind: "ownNumber"; value: number }
  | { kind: "others" };

export function currentPartyTarget(state: PartyState): PartyTarget {
  const player = state.players[state.current];
  if (state.mode === "clock") {
    const target = CLOCK_TARGETS[Math.min(player.progress, CLOCK_TARGETS.length - 1)];
    return target === 25 ? { kind: "bull" } : { kind: "number", value: target };
  }
  if (state.mode === "shanghai") return { kind: "number", value: Math.min(state.round, SHANGHAI_ROUNDS - 1) + 1 };
  if (state.mode === "halveIt") return HALVE_IT_TARGETS[Math.min(state.round, HALVE_IT_TARGETS.length - 1)];
  return player.isKiller ? { kind: "others" } : { kind: "ownNumber", value: player.number };
}
