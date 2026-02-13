import { getCheckoutSuggestion } from "@/utils/checkoutTable";

interface CheckoutSuggestionProps {
  /** Current remaining score */
  remaining: number;
  /** Player name for display */
  playerName: string;
}

/**
 * Displays the preferred checkout route for the current remaining score.
 * Only renders when a valid checkout exists (score 2–170).
 */
const CheckoutSuggestion = ({ remaining, playerName }: CheckoutSuggestionProps) => {
  const route = getCheckoutSuggestion(remaining);
  if (!route) return null;

  return (
    <div className="bg-muted/50 rounded-lg px-3 py-2 border border-primary/20">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
        Checkout · {playerName}
      </p>
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
