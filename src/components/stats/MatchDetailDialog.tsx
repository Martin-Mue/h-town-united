import { useState } from "react";
import { ChevronDown, ChevronUp, Trophy, Target } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import ThrowHistoryEditor from "@/components/game/ThrowHistoryEditor";
import { Eyebrow, SectionCard, StatTile } from "@/components/stats/StatPrimitives";
import { useLanguage } from "@/contexts/LanguageContext";
import { LOCALE_BY_LANGUAGE } from "@/i18n/translations";
import { average, first9Average, computeCricketStats, type DartThrow, type StatBundle } from "@/utils/dartStats";

interface MatchDetailGame {
  mode: string;
  player1_name: string;
  player2_name: string;
  played_at: string;
  winner_name: string;
  player1_legs_won: number;
  player2_legs_won: number;
}

interface MatchDetailLegRow {
  leg_number: number;
  player_index: number;
  player_name: string;
  throws: DartThrow[];
  won: boolean;
}

interface MatchDetailDialogProps {
  game: MatchDetailGame;
  legs: MatchDetailLegRow[];
  matchTotals?: { name: string; won: boolean; bundle: StatBundle }[];
  onClose: () => void;
}

/** Rich "what actually happened" view for one finished match — mirrors the style of the winner
 *  overlay shown right after a live game, but for any past match from the history list, and adds
 *  a full round-by-round replay per leg (via ThrowHistoryEditor in read-only mode) that the old
 *  inline accordion never showed, only leg-level averages. Legs start collapsed; only the summary
 *  line is visible until tapped. */
const MatchDetailDialog = ({ game, legs, matchTotals, onClose }: MatchDetailDialogProps) => {
  const { t, language } = useLanguage();
  const [expandedLeg, setExpandedLeg] = useState<number | null>(null);
  const isCricket = game.mode === "cricket";
  const legNumbers = Array.from(new Set(legs.map((l) => l.leg_number))).sort((a, b) => a - b);

  const legSummaryFor = (r: MatchDetailLegRow) => {
    if (isCricket) {
      const c = computeCricketStats(r.throws);
      return `MPR ${c.mpr.toFixed(2)} · ${c.hitRate.toFixed(0)}% ${t("stats.hitRate")}`;
    }
    return `Ø ${average(r.throws).toFixed(1)}${r.throws.length > 0 ? ` · F9 ${first9Average(r.throws).toFixed(1)}` : ""}`;
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-display uppercase text-base">
            <Badge variant="outline" className="font-mono shrink-0">{game.mode}</Badge>
            <span className="truncate">{game.player1_name} vs {game.player2_name}</span>
          </DialogTitle>
        </DialogHeader>

        <div className="text-center -mt-1">
          <p className="text-xs text-muted-foreground">
            {new Date(game.played_at).toLocaleDateString(LOCALE_BY_LANGUAGE[language], { day: "2-digit", month: "long", year: "numeric" })}
          </p>
          <p className="text-4xl font-display mt-1">{game.player1_legs_won} : {game.player2_legs_won}</p>
          <p className="text-sm text-secondary font-medium flex items-center justify-center gap-1 mt-0.5">
            <Trophy className="w-4 h-4" /> {game.winner_name}
          </p>
        </div>

        {matchTotals && matchTotals.length > 0 && (
          <SectionCard>
            <Eyebrow icon={Target}>{t("stats.matchTotal")}</Eyebrow>
            <div className="grid grid-cols-2 gap-3">
              {matchTotals.map((p) => (
                <div key={p.name} className={`rounded-lg border p-3 ${p.won ? "border-secondary/40 bg-secondary/5" : "border-border"}`}>
                  <p className={`text-sm truncate mb-2 ${p.won ? "text-secondary font-semibold" : "text-foreground"}`}>
                    {p.won && "🏆 "}{p.name}
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <StatTile label="Ø" value={p.bundle.average.toFixed(1)} />
                    <StatTile label="First 9" value={p.bundle.first9.toFixed(1)} />
                    <StatTile label="CO %" value={`${p.bundle.checkout.percentage.toFixed(0)}%`} tone="secondary" />
                    <StatTile label={t("game.highscoreLabel")} value={p.bundle.highscore} tone="accent" />
                  </div>
                  {(p.bundle.tonPlus > 0 || p.bundle.s180 > 0) && (
                    <p className="text-[10px] text-muted-foreground text-center mt-2">
                      {p.bundle.tonPlus > 0 && `100+ ×${p.bundle.tonPlus}`}
                      {p.bundle.tonPlus > 0 && p.bundle.s180 > 0 && " · "}
                      {p.bundle.s180 > 0 && `180 ×${p.bundle.s180}`}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </SectionCard>
        )}

        <div>
          <Eyebrow icon={Trophy}>{t("stats.legByLeg")}</Eyebrow>
          {legNumbers.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">{t("stats.noLegDetailsAvailable")}</p>
          ) : (
            <div className="space-y-2">
              {legNumbers.map((legNumber) => {
                const rows = legs.filter((l) => l.leg_number === legNumber).sort((a, b) => a.player_index - b.player_index);
                const isOpen = expandedLeg === legNumber;
                return (
                  <div key={legNumber} className="rounded-lg border border-border bg-muted/20 overflow-hidden">
                    <button
                      onClick={() => setExpandedLeg(isOpen ? null : legNumber)}
                      className="w-full px-3 py-2.5 text-left hover:bg-muted/40 transition-colors"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">{t("game.leg")} {legNumber}</span>
                        {isOpen ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                      </div>
                      <div className="flex items-center gap-x-3 gap-y-0.5 flex-wrap mt-1 text-xs text-muted-foreground">
                        {rows.map((r) => (
                          <span key={r.player_index} className={r.won ? "text-secondary font-semibold" : ""}>
                            {r.won && "🏆 "}{r.player_name} · {legSummaryFor(r)}
                          </span>
                        ))}
                      </div>
                    </button>
                    {isOpen && (
                      <div className="px-2 pb-2 space-y-2 border-t border-border/60 pt-1">
                        {rows.map((r) => (
                          <ThrowHistoryEditor
                            key={r.player_index}
                            throws={r.throws}
                            playerName={r.player_name}
                            editModeOn={false}
                            onToggleEditMode={() => {}}
                            openChipIdx={null}
                            onOpenChipChange={() => {}}
                            onEditThrow={() => {}}
                            onDeleteThrow={() => {}}
                            readOnly
                          />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default MatchDetailDialog;
