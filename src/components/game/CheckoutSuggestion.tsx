import { getCheckoutSuggestion } from "@/utils/checkoutTable";

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
 * Only renders when a valid checkout exists (score 2–170).
 */
const CheckoutSuggestion = ({ remaining, playerName, personalCheckoutRate }: CheckoutSuggestionProps) => {
  const route = getCheckoutSuggestion(remaining);
  if (!route) return null;

  return (
    <div className="bg-muted/50 rounded-lg px-3 py-2 border border-primary/20">
      <div className="flex items-center justify-between mb-1">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Checkout · {playerName}
        </p>
        {personalCheckoutRate != null && (
          <p className="text-[10px] text-muted-foreground" title="Deine bisherige Checkout-Quote in diesem Score-Bereich">
            Quote: <span className="text-foreground font-semibold">{personalCheckoutRate.toFixed(0)}%</span>
          </p>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        {route.map((dart, i) => (
          <span key={i}>
            <span className={`text-sm font-bold ${
              dart.startsWith("D") ? "text-secondary" :
              dart.startsWith("T") ? "text-destructive" :
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
  );
};

export default CheckoutSuggestion;
