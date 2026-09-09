/** Supported game mode identifiers */
export type GameMode = "501" | "301" | "cricket" | "custom";

/** Bot difficulty levels (approximate 3-dart averages) — internal ids only, display names (Lucky
 *  Luke/Robin Hood/The Machine/Dart Vader/The Prodigy) live in translations.ts's game.botLv1-5. */
export type BotLevel = "easy" | "medium" | "hard" | "elite" | "legendary";

/** Single dart throw with full metadata */
export interface DartThrow {
  /** Base score value (0=miss, 1-20, 25=bull, 50=bullseye) */
  baseValue: number;
  /** Multiplier: 1=single, 2=double, 3=triple */
  multiplier: number;
  /** Calculated points (baseValue × multiplier) */
  points: number;
  /** Tip position in board-relative unit coordinates (0,0 = bull, radius ~1 = double edge), camera-scored throws only. Camera-framing-independent, so safe to aggregate across games/devices for a throw heatmap. */
  boardU?: number;
  boardV?: number;
}

/** A single player slot in the match (human or bot) */
export interface PlayerSlot {
  name: string;
  /** Double-out required to finish a leg (X01 only). Default true. */
  doubleOut: boolean;
  /** Double-in required to start scoring in a leg (X01 only). Darts before the opening double don't count. Default false (straight in). */
  doubleIn?: boolean;
  isBot: boolean;
  botLevel?: BotLevel;
  /** Handicap (X01, non-team only): points subtracted from the mode's base starting score, giving a weaker player a head start against stronger opponents. */
  handicap?: number;
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
  /** Per-player: has this player thrown their opening double yet this leg? Always true for players without doubleIn. */
  startedScoring?: boolean[];
}

/** Cricket marks for a single number (15-20, 25=Bull) */
export interface CricketPlayerState {
  marks: Record<number, number>;
  points: number;
}

/** A team of players sharing one score/leg-win record in team mode. */
export interface TeamSlot {
  name: string;
}

/** Complete game state for all modes. Cricket supports 2-8 players. */
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
  /** Optional "Sets" match structure layered on top of legs (X01 only — cricket has no setup UI
   *  for it, see Game.tsx's setup screen). Absent (undefined, the default) means today's plain
   *  best-of-legs match, completely unaffected — every existing reader of `legsWon`/`bestOfLegs`
   *  keeps working unchanged. When present, `bestOfLegs` is reinterpreted as "legs that decide ONE
   *  set" (no separate field needed — it already means exactly that), `legsWon` tracks only the
   *  CURRENT set's legs and resets to all-zero every time a set is decided, and `setsWon` (same
   *  index space as legsWon: team index in team mode, player index otherwise) is the match-level
   *  score across sets. The match itself is decided once a side reaches the majority of
   *  `setsMode.bestOfSets` — see legLogic.ts's applyLegWin/wouldWinMatch, the only two places that
   *  need to know this exists. */
  setsMode?: { bestOfSets: number };
  /** Match-level sets score, index-aligned with legsWon/legsWon's own slot space. Only meaningful
   *  (and only ever set) alongside setsMode; absent or all-zero otherwise. */
  setsWon?: number[];
  /** Cricket-specific state (only for cricket mode, index-aligned with players) */
  cricket?: CricketPlayerState[];
  /** Cricket target numbers actually in play this game. Defaults to CRICKET_NUMBERS; set to a fresh random set when Custom Cricket is enabled. */
  cricketNumbers?: readonly number[];
  /**
   * Team mode: players are grouped into exactly 2 teams, interleaved in `players` as
   * [TeamA-1, TeamB-1, TeamA-2, TeamB-2, ...] so the existing per-player round-robin turn
   * order naturally alternates teams and rotates each team's own members. `legsWon`,
   * `currentLeg.remaining`, `currentLeg.startedScoring` and `cricket` are then indexed by
   * TEAM (playerIndex % teams.length), not by individual player — see teamIndexFor().
   * `currentLeg.throws` stays indexed per individual player so personal stats/average
   * still work per person.
   */
  teams?: TeamSlot[];
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
