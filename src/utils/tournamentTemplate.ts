/** A saved tournament setup: everything about the format, none of the participants. */
export interface TournamentTemplate {
  tournamentMode: string;
  gameMode: string;
  bestOfLegs: number;
  setsEnabled: boolean;
  bestOfSets: number;
  targetSize: string;
  boards: number;
  drawMode: "random" | "manual" | "fair";
  livePlayEnabled: boolean;
  doublesEnabled: boolean;
}

const num = (v: unknown, fallback: number, min: number, max: number): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : fallback;

/** Reads a stored template defensively (it comes out of a JSON column and may be from an older app version). */
export function normalizeTournamentTemplate(raw: unknown): TournamentTemplate {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    tournamentMode: r.tournamentMode === "round-robin" ? "round-robin" : "ko",
    gameMode: ["501", "301", "Cricket", "Extern"].includes(r.gameMode as string) ? (r.gameMode as string) : "501",
    bestOfLegs: num(r.bestOfLegs, 3, 1, 99),
    setsEnabled: r.setsEnabled === true,
    bestOfSets: num(r.bestOfSets, 3, 1, 99),
    targetSize: typeof r.targetSize === "string" && /^(auto|\d{1,3})$/.test(r.targetSize) ? r.targetSize : "auto",
    boards: num(r.boards, 2, 1, 16),
    drawMode: r.drawMode === "manual" || r.drawMode === "fair" ? r.drawMode : "random",
    livePlayEnabled: r.livePlayEnabled !== false,
    doublesEnabled: r.doublesEnabled === true,
  };
}
