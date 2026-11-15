import { useState } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/contexts/LanguageContext";
import { dartLabel, pointsFor } from "@/utils/x01Rules";
import type { DetectedDart } from "@/components/game/LiveCamera";

interface AutodartsVisitReviewProps {
  darts: DetectedDart[];
  busted: boolean;
  onChange: (darts: DetectedDart[]) => void;
  onConfirm: () => void;
}

const NUMBERS = Array.from({ length: 20 }, (_, i) => i + 1);

const makeDart = (baseValue: number, multiplier: 1 | 2 | 3): DetectedDart => ({ baseValue, multiplier, points: pointsFor(baseValue, multiplier), confidence: 1 });

/**
 * A finished Autodarts visit waiting for its takeout: the darts as chips (tap one to correct it, a missing
 * dart can be added), the total or BUST, and "Übernehmen" to take it over right away. Without a tap it
 * goes into the game by itself once the darts are pulled (see AutodartsLiveScore / shouldReleaseHeldVisit).
 */
const AutodartsVisitReview = ({ darts, busted, onChange, onConfirm }: AutodartsVisitReviewProps) => {
  const { t } = useLanguage();
  const [editing, setEditing] = useState<number | null>(null);
  const [multiplier, setMultiplier] = useState<1 | 2 | 3>(1);
  const total = darts.reduce((s, d) => s + pointsFor(d.baseValue, d.multiplier), 0);

  const startEdit = (i: number) => {
    setEditing(editing === i ? null : i);
    const m = darts[i]?.multiplier ?? 1;
    setMultiplier(m === 2 || m === 3 ? m : 1);
  };
  const pick = (baseValue: number, m: 1 | 2 | 3) => {
    if (editing === null) return;
    const next = [...darts];
    next[editing] = makeDart(baseValue, baseValue === 0 ? 1 : m);
    onChange(next);
    setEditing(null);
  };

  return (
    <div className="space-y-2 pt-3">
      <div className="flex items-center gap-2">
        {[0, 1, 2].map((i) => {
          const d = darts[i];
          if (!d && i > darts.length) return <span key={i} className="h-11 flex-1" />;
          return (
            <button
              key={i}
              type="button"
              onClick={() => (d ? startEdit(i) : (onChange([...darts, makeDart(0, 1)]), setEditing(i)))}
              className={`flex h-11 flex-1 items-center justify-center rounded-xl border text-[15px] font-semibold ${editing === i ? "border-primary bg-primary/15 text-primary" : d ? "border-border bg-background" : "border-dashed border-border text-muted-foreground"}`}
              aria-label={d ? `${t("autodarts.editDart")} ${i + 1}: ${dartLabel(d)}` : t("autodarts.addDart")}
            >
              {d ? dartLabel(d) : "+"}
            </button>
          );
        })}
        <span className={`w-14 shrink-0 text-right font-display text-lg font-bold ${busted ? "text-destructive" : ""}`}>{busted ? "BUST" : total}</span>
      </div>

      {editing !== null && (
        <div className="space-y-1.5 rounded-xl border border-border bg-background p-2">
          <div className="grid grid-cols-3 gap-1.5">
            {([1, 2, 3] as const).map((m) => (
              <button key={m} type="button" onClick={() => setMultiplier(m)}
                className={`h-10 rounded-lg text-sm font-semibold ${multiplier === m ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                {m === 1 ? "Single" : m === 2 ? "Double" : "Triple"}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-5 gap-1.5">
            {NUMBERS.map((n) => (
              <button key={n} type="button" onClick={() => pick(n, multiplier)} className="h-10 rounded-lg bg-muted text-sm font-semibold">{n}</button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <button type="button" onClick={() => pick(25, multiplier === 3 ? 1 : multiplier)} className="h-10 rounded-lg bg-muted text-sm font-semibold">
              {multiplier === 2 ? "Bull (50)" : "25"}
            </button>
            <button type="button" onClick={() => pick(0, 1)} className="h-10 rounded-lg bg-muted text-sm font-semibold">{t("autodarts.miss")}</button>
          </div>
        </div>
      )}

      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 text-xs text-muted-foreground">{t("autodarts.pullToConfirm")}</p>
        <Button size="sm" className="h-11 shrink-0 gap-1.5 rounded-xl" onClick={() => { setEditing(null); onConfirm(); }}>
          <Check className="h-4 w-4" /> {t("autodarts.confirmVisit")}
        </Button>
      </div>
    </div>
  );
};

export default AutodartsVisitReview;
