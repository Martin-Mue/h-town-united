import { getCheckoutSuggestion } from "@/utils/checkoutTable";
import { useLanguage } from "@/contexts/LanguageContext";

interface CheckoutSuggestionProps {
  /** Current remaining score */
  remaining: number;
  /** Player name for display */
  playerName: string;
  /** This player's career checkout conversion rate (0-100), if known — shows how often suggestions like this actually get converted. */
  personalCheckoutRate?: number | null;
}

/**
 * Displays the preferred checkout route for the current remaining score.
 * Content only exists when a valid checkout exists (score 2–170), but the wrapper stays mounted
 * and animates height/opacity via the CSS grid 0fr/1fr row trick instead of mounting/unmounting —
 * remaining crosses in and out of checkout range on nearly every dart near the end of a leg, and
 * an abrupt appear/disappear here was reported as the whole scoreboard "jumping" on every tap.
 */
const CheckoutSuggestion = ({ remaining, playerName, personalCheckoutRate }: CheckoutSuggestionProps) => {
  const { t } = useLanguage();
  const route = getCheckoutSuggestion(remaining);

  return (
    <div className={`grid transition-all duration-200 ease-out ${route ? "grid-rows-[1fr] opacity-100 mt-3 mb-3" : "grid-rows-[0fr] opacity-0"}`}>
      <div className="overflow-hidden">
        {route && (
          <div className="bg-muted/50 rounded-lg px-3 py-2 border border-primary/20">
            <div className="flex items-center justify-between mb-1">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Checkout · {playerName}
              </p>
              {personalCheckoutRate != null && (
                <p className="text-[10px] text-muted-foreground" title={t("game.checkoutRateTooltip")}>
                  {t("game.rateLabel")} <span className="text-foreground font-semibold">{personalCheckoutRate.toFixed(0)}%</span>
                </p>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              {route.map((dart, i) => (
                <span key={i}>
                  <span className={`text-sm font-bold ${
                    dart.startsWith("D") ? "text-secondary" :
                    dart.startsWith("T") ? "text-primary" :
                    dart === "Bull" ? "text-accent" :
                    "text-foreground"
                  }`}>
                    {dart}
                  </span>
                  {i < route.length - 1 && <span className="text-muted-foreground mx-0.5">→</span>}
                </span>
              ))}
              <span className="text-xs text-muted-foreground ml-auto">{remaining}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default CheckoutSuggestion;
