import { getCheckoutSuggestion } from "@/utils/checkoutTable";
import { directDoubleLabel, type CheckoutDoubleBreakdown } from "@/utils/dartStats";
import { useLanguage } from "@/contexts/LanguageContext";

interface CheckoutSuggestionProps {
  /** Current remaining score */
  remaining: number;
  /** Player name for display */
  playerName: string;
  /** Whether this card should be showing at all right now (checkout-suggestion setting on, not
   *  Cricket, current player isn't a bot, no pending double-in, current player plays double-out).
   *  Design-Sprint Runde 5 Rang 4: this used to be the caller's job — Game.tsx wrapped the whole
   *  `<CheckoutSuggestion />` in `{condition && <CheckoutSuggestion .../>}`, which mounts/unmounts
   *  the entire card (including the grid 0fr/1fr trick below) the instant any of those conditions
   *  flip, e.g. the turn passing to a bot or to a single-out player — exactly the same abrupt
   *  "scoreboard jumps" bug the 0fr/1fr trick was built to prevent for the remaining-score case,
   *  just one level up. Taking the gate as a prop instead keeps this component permanently mounted
   *  so every reason the card should hide (no route for this score, OR the caller's own gate off)
   *  collapses through the exact same smooth transition. Defaults true so existing callers that
   *  still conditionally render this component keep working unchanged. */
  active?: boolean;
  /** This player's career checkout conversion rate (0-100), if known — shows how often suggestions like this actually get converted. */
  personalCheckoutRate?: number | null;
  /** Round 3 Rang 16: this player's own career hit rate PER double (e.g. "your D16 rate", not
   *  just your overall checkout rate) — see dartStats.ts's checkoutDoubleBreakdown, the same data
   *  Statistics.tsx's doubles table already computes from game_legs. Only ever has real entries
   *  for "direct" remainders (2-40 even, or 50/Bull — see directDoubleLabel's own doc comment),
   *  the one case where which double a visit was aimed at is actually known from the data rather
   *  than guessed; that happens to be exactly the case this component can show it for, since a
   *  direct remainder's suggested route is always that same single double. Falls back to
   *  `personalCheckoutRate` (the overall rate) whenever the current remaining isn't a direct
   *  double, or this specific double has no recorded attempts yet. */
  personalDoubleBreakdown?: CheckoutDoubleBreakdown[] | null;
}

/**
 * Displays the preferred checkout route for the current remaining score.
 * Content only exists when a valid checkout exists (score 2–170), but the wrapper stays mounted
 * and animates height/opacity via the CSS grid 0fr/1fr row trick instead of mounting/unmounting —
 * remaining crosses in and out of checkout range on nearly every dart near the end of a leg, and
 * an abrupt appear/disappear here was reported as the whole scoreboard "jumping" on every tap.
 */
const CheckoutSuggestion = ({ remaining, playerName, personalCheckoutRate, personalDoubleBreakdown, active = true }: CheckoutSuggestionProps) => {
  const { t } = useLanguage();
  const route = active ? getCheckoutSuggestion(remaining) : null;

  // Round 3 Rang 16: prefer the rate for THIS exact double when we actually have it (a direct
  // remainder with recorded attempts) — falls back to the general overall rate otherwise, so a
  // combination-finish suggestion (e.g. 100 -> T20, D20) still shows something rather than nothing.
  const doubleLabel = directDoubleLabel(remaining);
  const doubleStats = doubleLabel ? personalDoubleBreakdown?.find((b) => b.label === doubleLabel) : undefined;
  const showDoubleSpecific = doubleStats != null && doubleStats.stats.attempts > 0;
  const displayRate = showDoubleSpecific ? doubleStats.stats.percentage : personalCheckoutRate;
  const rateTooltip = showDoubleSpecific ? t("game.checkoutRateTooltipDouble") : t("game.checkoutRateTooltip");

  return (
    <div className={`grid transition-all duration-200 ease-out ${route ? "grid-rows-[1fr] opacity-100 mt-3 mb-3" : "grid-rows-[0fr] opacity-0"}`}>
      <div className="overflow-hidden">
        {route && (
          <div className="bg-muted/50 rounded-lg px-4 py-3 border border-primary/20">
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-xs uppercase tracking-wider text-muted-foreground">
                Checkout · {playerName}
              </p>
              {displayRate != null && (
                <p className="text-xs text-muted-foreground" title={rateTooltip}>
                  {showDoubleSpecific ? doubleLabel : t("game.rateLabel")} <span className="text-foreground font-semibold">{displayRate.toFixed(0)}%</span>
                </p>
              )}
            </div>
            {/* The route itself is the whole point of this card — sized to read from throwing
                distance, not just from up close, same as the scoreboard's own remaining-score
                number. */}
            <div className="flex items-center gap-2">
              {route.map((dart, i) => (
                <span key={i} className="flex items-center gap-2">
                  <span className={`text-2xl font-bold ${
                    dart.startsWith("D") ? "text-secondary" :
                    dart.startsWith("T") ? "text-primary" :
                    dart === "Bull" ? "text-accent" :
                    "text-foreground"
                  }`}>
                    {dart}
                  </span>
                  {i < route.length - 1 && <span className="text-lg text-muted-foreground">→</span>}
                </span>
              ))}
              <span className="text-sm text-muted-foreground ml-auto">{remaining}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default CheckoutSuggestion;
