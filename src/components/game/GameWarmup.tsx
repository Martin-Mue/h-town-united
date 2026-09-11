import type { Dispatch, SetStateAction } from "react";
import { Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import DartScoreInput from "@/components/game/DartScoreInput";
import { useLanguage } from "@/contexts/LanguageContext";

interface GameWarmupProps {
  warmupRemaining: number;
  warmupDarts: number;
  warmupTotal: number;
  setWarmupRemaining: Dispatch<SetStateAction<number>>;
  submitWarmupDart: (value: number, multiplier: number) => void;
  enterMatch: () => void;
}

/**
 * Free-throw warm-up timer, shown before the actual match starts when the setup screen's
 * "Aufwärmen" toggle is on — extracted verbatim out of Game.tsx's `phase === "warmup"` branch
 * (Design-Sprint Phase 3, "Spiel-Screen in eigenständige Teil-Screens aufteilen"). Purely
 * presentational: every piece of state it touches still lives in Game.tsx and is passed in as
 * props, so this is a file-organization change only, not a behavior change.
 */
const GameWarmup = ({ warmupRemaining, warmupDarts, warmupTotal, setWarmupRemaining, submitWarmupDart, enterMatch }: GameWarmupProps) => {
  const { t } = useLanguage();
  const mm = Math.floor(warmupRemaining / 60);
  const ss = warmupRemaining % 60;
  return (
    <div className="container py-6 animate-slide-up max-w-lg mx-auto">
      <div className="text-center mb-4">
        <h2 className="text-2xl font-display uppercase text-primary">{t("game.warmup")}</h2>
        <p className="text-xs text-muted-foreground mt-1">{t("game.warmupDesc")}</p>
      </div>

      <div className="bg-card rounded-2xl border border-primary/30 glow-cyan p-6 mb-4 text-center">
        <div className="font-display text-6xl tabular-nums text-primary">
          {mm}:{String(ss).padStart(2, "0")}
        </div>
        <div className="flex items-center justify-center gap-4 mt-3 text-xs text-muted-foreground">
          <span>{warmupDarts} {t("game.dartsSuffix")}</span>
          <span>·</span>
          <span>{warmupTotal} {t("game.points")}</span>
        </div>
        <div className="flex items-center justify-center gap-2 mt-3">
          <Button size="sm" variant="outline" onClick={() => setWarmupRemaining((s) => s + 30)}>+30s</Button>
          <Button size="sm" variant="outline" onClick={() => setWarmupRemaining(0)}>{t("game.endTimer")}</Button>
        </div>
      </div>

      <DartScoreInput isDisabled={false} onThrow={submitWarmupDart} />

      <Button onClick={enterMatch} className="w-full mt-4 font-display uppercase text-lg py-6">
        <Target className="w-5 h-5 mr-2" /> {t("game.letsGo")}
      </Button>
    </div>
  );
};

export default GameWarmup;
