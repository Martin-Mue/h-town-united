import { Flame } from "lucide-react";
import { MIN_CLUTCH_ATTEMPTS, describeClutchTakeaway, type ClutchResult } from "@/utils/clutchStats";

interface ClutchCardProps {
  stats: ClutchResult;
}

/** Shows a player's checkout rate in match-deciding legs ("clutch") against their normal rate —
 *  a comparison no existing stat makes, since every other checkout figure pools all legs alike
 *  regardless of what was actually at stake when the dart left the hand. */
const ClutchCard = ({ stats }: ClutchCardProps) => {
  const { clutch, normal } = stats;

  if (clutch.attempts < MIN_CLUTCH_ATTEMPTS) {
    return (
      <div className="bg-card rounded-xl border border-border p-4 mb-4">
        <h3 className="font-display text-sm uppercase mb-1 text-muted-foreground flex items-center gap-2">
          <Flame className="w-4 h-4" /> Clutch-Faktor
        </h3>
        <p className="text-xs text-muted-foreground">
          Noch nicht genug enge Spiele gesammelt (mind. {MIN_CLUTCH_ATTEMPTS} Checkout-Versuche in
          Legs, die das Match sofort hätten entscheiden können — bisher {clutch.attempts}).
        </p>
      </div>
    );
  }

  return (
    <div className="bg-card rounded-xl border border-border p-4 mb-4">
      <h3 className="font-display text-sm uppercase mb-1 text-muted-foreground flex items-center gap-2">
        <Flame className="w-4 h-4" /> Clutch-Faktor
      </h3>
      <p className="text-[10px] text-muted-foreground mb-3">
        Checkout-Quote in Legs, die das Match sofort hätten entscheiden können, gegen deine normale Quote
      </p>
      <div className="flex items-center gap-3">
        <div className="flex-1 text-center bg-muted/40 rounded-lg py-3">
          <p className="font-display text-2xl">{normal.percentage.toFixed(0)}%</p>
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground mt-1">Normal</p>
          <p className="text-[10px] text-muted-foreground">{normal.hits}/{normal.attempts}</p>
        </div>
        <div className="flex-1 text-center bg-accent/10 rounded-lg py-3 border border-accent/30">
          <p className="font-display text-2xl text-accent">{clutch.percentage.toFixed(0)}%</p>
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground mt-1">Unter Druck</p>
          <p className="text-[10px] text-muted-foreground">{clutch.hits}/{clutch.attempts}</p>
        </div>
      </div>
      <div className="mt-3 pt-3 border-t border-border/60 flex items-start gap-2">
        <Flame className="w-3.5 h-3.5 text-accent shrink-0 mt-0.5" />
        <p className="text-xs text-accent">{describeClutchTakeaway(stats)}</p>
      </div>
    </div>
  );
};

export default ClutchCard;
