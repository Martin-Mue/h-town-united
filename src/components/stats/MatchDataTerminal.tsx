import { dartLabel } from "@/utils/x01Rules";
import type { DartThrow, StatBundle } from "@/utils/dartStats";
import { useLanguage } from "@/contexts/LanguageContext";
import { LOCALE_BY_LANGUAGE } from "@/i18n/translations";

interface MatchDataTerminalGame {
  mode: string;
  player1_name: string;
  player2_name: string;
  played_at: string;
  winner_name: string;
  player1_legs_won: number;
  player2_legs_won: number;
}

interface MatchDataTerminalLegRow {
  leg_number: number;
  player_index: number;
  player_name: string;
  throws: DartThrow[];
  won: boolean;
}

interface MatchDataTerminalProps {
  game: MatchDataTerminalGame;
  legs: MatchDataTerminalLegRow[];
  matchTotals?: { name: string; won: boolean; bundle: StatBundle }[];
}

/** Chunks a player's raw throws into up-to-3-dart visits — same convention as dartStats.ts's own
 *  private `visits()` helper and legLogic.ts's cricket replay, kept local here rather than
 *  exported/shared since this is purely a display concern (raw dart-by-dart log), not a scoring
 *  computation anything else needs to import. */
const visits = (throws: DartThrow[]): DartThrow[][] => {
  const out: DartThrow[][] = [];
  for (let i = 0; i < throws.length; i += 3) out.push(throws.slice(i, i + 3));
  return out;
};

/**
 * "Match Data Terminal" — one of Round 3's three unscheduled design directions (design-only,
 * no ranked audit finding behind it). The rest of the app deliberately reads as a warm, glowing
 * sports-club product (gradient-hero washes, font-display headers, rounded cards) — this is the
 * opposite register on purpose: the exact same match data MatchDetailDialog already shows as
 * cards, re-rendered as a stark green-on-black scoring-terminal readout, raw dart-by-dart log
 * included. A toggle, not a replacement (see MatchDetailDialog.tsx) — a novelty view for anyone
 * who wants to see their match as a wall of monospace numbers, not the app's only way to review a
 * match. Pure presentational component: takes the same already-fetched props MatchDetailDialog
 * has in hand, computes nothing itself beyond formatting, and touches no game/scoring logic.
 */
const MatchDataTerminal = ({ game, legs, matchTotals }: MatchDataTerminalProps) => {
  const { language } = useLanguage();
  const legNumbers = Array.from(new Set(legs.map((l) => l.leg_number))).sort((a, b) => a - b);
  const dateStr = new Date(game.played_at).toLocaleDateString(LOCALE_BY_LANGUAGE[language], {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  const rule = "─".repeat(40);

  return (
    <div
      role="log"
      aria-label="Match data terminal"
      className="rounded-lg border border-[#1a3a1a] bg-black font-mono text-[11px] leading-relaxed text-[#39ff6a] p-4 overflow-x-auto shadow-[inset_0_0_30px_rgba(57,255,106,0.12)]"
    >
      <p className="text-[#39ff6a]/60">$ match --load {game.mode} {dateStr}</p>
      <p className="mt-1">
        {game.player1_name} <span className="text-[#39ff6a]/50">vs</span> {game.player2_name}
      </p>
      <p>
        {game.player1_legs_won}:{game.player2_legs_won} <span className="text-[#39ff6a]/50">·</span> WINNER:{" "}
        {game.winner_name.toUpperCase()}
      </p>
      <p className="text-[#39ff6a]/30 my-2 select-none">{rule}</p>

      {matchTotals?.map((p) => (
        <div key={p.name} className="mb-2">
          <p>
            {p.won ? "> " : "  "}
            {p.name.toUpperCase()}
            {p.won && " [WIN]"}
          </p>
          <p className="text-[#39ff6a]/80 pl-2 whitespace-pre-wrap">
            AVG {p.bundle.average.toFixed(1)}  F9 {p.bundle.first9.toFixed(1)}  CO% {p.bundle.checkout.percentage.toFixed(0)}
            {"  "}HI {p.bundle.highscore}  100+×{p.bundle.tonPlus}  180×{p.bundle.s180}
          </p>
        </div>
      ))}

      <p className="text-[#39ff6a]/30 my-2 select-none">{rule}</p>

      {legNumbers.map((legNumber) => {
        const rows = legs.filter((l) => l.leg_number === legNumber).sort((a, b) => a.player_index - b.player_index);
        return (
          <div key={legNumber} className="mb-2">
            <p className="text-[#39ff6a]/60">LEG {legNumber}</p>
            {rows.map((r) => (
              <p key={r.player_index} className="pl-2 break-all">
                {r.won ? "> " : "  "}
                {r.player_name}:{" "}
                {visits(r.throws)
                  .map((v) => v.map(dartLabel).join(" "))
                  .join(" | ")}
              </p>
            ))}
          </div>
        );
      })}

      <p className="mt-2">
        <span className="text-[#39ff6a]/50">$</span>{" "}
        <span aria-hidden className="inline-block w-2 h-3.5 bg-[#39ff6a] align-middle animate-pulse" />
      </p>
    </div>
  );
};

export default MatchDataTerminal;
