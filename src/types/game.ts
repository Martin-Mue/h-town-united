/** Supported game mode identifiers */
export type GameMode = "501" | "301" | "cricket" | "custom";

/** Bot difficulty levels (approximate 3-dart averages) */
export type BotLevel = "easy" | "medium" | "hard";

/** Single dart throw with full metadata */
export interface DartThrow {
  /** Base score value (0=miss, 1-20, 25=bull, 50=bullseye) */
  baseValue: number;
  /** Multiplier: 1=single, 2=double, 3=triple */
  multiplier: number;
  /** Calculated points (baseValue × multiplier) */
  points: number;
}

/** A single player slot in the match (human or bot) */
export interface PlayerSlot {
  name: string;
  /** Double-out required to finish a leg (X01 only). Default true. */
  doubleOut: boolean;
  isBot: boolean;
  botLevel?: BotLevel;
}

/** State tracking for a single leg within a match (N players, X01) */
export interface LegState {
  legNumber: number;
  startingPlayerIndex: number;
  /** Remaining score per player index (X01 only) */
  remaining: number[];
  /** Throws per player index */
  throws: DartThrow[][];
  winnerIndex?: number;
}

/** Cricket marks for a single number (15-20, 25=Bull) */
export interface CricketPlayerState {
  marks: Record<number, number>;
  points: number;
}

/** Complete game state for all modes. Cricket is restricted to exactly 2 players. */
export interface GameState {
  mode: GameMode;
  startScore: number;
  bestOfLegs: number;
  players: PlayerSlot[];
  legsWon: number[];
  currentLeg: LegState;
  completedLegs: LegState[];
  currentPlayerIndex: number;
  isFinished: boolean;
  winnerName?: string;
  winnerIndex?: number;
  /** Optional cap on rounds per leg for X01 modes. When all players have played this many rounds and nobody has checked out, the leg ends by remaining score. */
  maxRoundsX01?: number;
  /** Cricket-specific state (only for cricket mode, index-aligned with players) */
  cricket?: CricketPlayerState[];
}

/** Post-game statistics summary, index-aligned with players */
export interface PostGameStats {
  names: string[];
  averages: number[];
  highscores: number[];
  doubleRates: number[];
  totalLegs: number;
  legsWon: number[];
  winnerName: string;
}

/** Cricket target numbers */
export const CRICKET_NUMBERS = [20, 19, 18, 17, 16, 15, 25] as const;
