/** Supported game mode identifiers */
export type GameMode = "501" | "301" | "cricket" | "custom";

/** Single dart throw with full metadata */
export interface DartThrow {
  /** Base score value (0=miss, 1-20, 25=bull, 50=bullseye) */
  baseValue: number;
  /** Multiplier: 1=single, 2=double, 3=triple */
  multiplier: number;
  /** Calculated points (baseValue × multiplier) */
  points: number;
}

/** State tracking for a single leg within a match */
export interface LegState {
  legNumber: number;
  startingPlayerId: 1 | 2;
  player1Remaining: number;
  player2Remaining: number;
  player1Throws: DartThrow[];
  player2Throws: DartThrow[];
  winner?: 1 | 2;
}

/** Cricket marks for a single number (15-20, 25=Bull) */
export interface CricketPlayerState {
  marks: Record<number, number>;
  points: number;
}

/** Complete game state for all modes */
export interface GameState {
  mode: GameMode;
  startScore: number;
  bestOfLegs: number;
  player1Name: string;
  player2Name: string;
  player1LegsWon: number;
  player2LegsWon: number;
  currentLeg: LegState;
  completedLegs: LegState[];
  currentPlayerId: 1 | 2;
  isFinished: boolean;
  winnerName?: string;
  /** Cricket-specific state (only for cricket mode) */
  player1Cricket?: CricketPlayerState;
  player2Cricket?: CricketPlayerState;
}

/** Post-game statistics summary */
export interface PostGameStats {
  player1Name: string;
  player2Name: string;
  player1Average: number;
  player2Average: number;
  player1Highscore: number;
  player2Highscore: number;
  player1DoubleRate: number;
  player2DoubleRate: number;
  totalLegs: number;
  player1LegsWon: number;
  player2LegsWon: number;
  winnerName: string;
}

/** Cricket target numbers */
export const CRICKET_NUMBERS = [20, 19, 18, 17, 16, 15, 25] as const;
