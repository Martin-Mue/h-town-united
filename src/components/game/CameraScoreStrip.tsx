import { useLanguage } from "@/contexts/LanguageContext";
import { getCheckoutSuggestion } from "@/utils/checkoutTable";
import { finishRoute } from "@/utils/checkoutRoute";
import type { OutRule } from "@/utils/x01Rules";

export interface CameraScoreCard {
  key: number;
  name: string;
  /** Score shown big (for X01 the remaining points, already including darts of the running round). */
  score: number;
  isActive: boolean;
  /** This player/team threw first in the current leg. */
  startedLeg: boolean;
  /** Fewest points left = ahead in this leg (X01 only). */
  isLeading: boolean;
  legsWon: number;
  setsWon?: number;
  /** Average of this leg / of the whole match, already formatted. */
  legAvg: string;
  matchAvg: string;
}

interface CameraScoreStripProps {
  cards: CameraScoreCard[];
  /** "Leg 2 · Round 3 · Robin starts" style line (shown in the camera header, not here). */
  info: string;
  showLegs: boolean;
  showSets: boolean;
  labels: { legAvg: string; matchAvg: string; leading: string; starts: string; legs: string; sets: string };
  /** Darts still to throw in this visit, for the checkout strip. Absent = no checkout strip (Cricket, training). */
  checkoutDartsLeft?: number;
  /** Out rule of the player on the oche. "master" shows a route that may end on a treble. */
  checkoutOutRule?: OutRule;
}

/**
 * The scoreboard inside the full-screen camera: one small card per player/team (the one on the oche outlined in the
 * accent colour) plus, in X01, the checkout route for the score left — kept short so the picture keeps its height.
 * The full play screen is hidden behind the camera, and a player must not have to close it to see their own score.
 */
const CameraScoreStrip = ({ cards, showLegs, showSets, labels, checkoutDartsLeft, checkoutOutRule }: CameraScoreStripProps) => {
  const { t } = useLanguage();
  const many = cards.length > 2;
  const active = cards.find((c) => c.isActive);
  const route = checkoutDartsLeft === undefined || !active ? null
    : checkoutOutRule === "master" ? finishRoute(active.score, "master", Math.max(1, checkoutDartsLeft)) : getCheckoutSuggestion(active.score);
  const finish = route && route.length <= (checkoutDartsLeft ?? 0) ? route : null;
  return (
    <div className="shrink-0 space-y-2 bg-background px-3 pb-2">
      <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${Math.min(Math.max(cards.length, 1), 4)}, minmax(0, 1fr))` }}>
        {cards.map((c) => (
          <div
            key={c.key}
            className={`flex h-[4.5rem] min-w-0 items-center gap-1.5 rounded-2xl border-2 px-2.5 ${c.isActive ? "border-primary bg-card" : "border-muted bg-card/60"}`}
          >
            <div className="min-w-0 flex-1">
              <p className={`truncate text-sm font-semibold ${c.isActive ? "text-primary" : "text-muted-foreground"}`}>{c.name}</p>
              {!many && <p className="truncate text-xs leading-tight text-muted-foreground">Ø {c.legAvg}</p>}
              {!many && (showLegs || showSets) && (
                <p className="truncate text-xs leading-tight text-muted-foreground">
                  {[showSets && c.setsWon !== undefined ? `${c.setsWon} ${labels.sets}` : null, showLegs ? `${c.legsWon} ${labels.legs}` : null].filter(Boolean).join(" · ")}
                </p>
              )}
            </div>
            <p className={`shrink-0 font-display font-bold leading-none tabular-nums ${many ? "text-3xl" : "text-[2.5rem]"} ${c.isActive ? "text-foreground" : "text-muted-foreground"}`}>
              {c.score}
            </p>
          </div>
        ))}
      </div>
      {checkoutDartsLeft !== undefined && (
        <div
          aria-live="polite"
          className={`flex h-10 items-center gap-2 rounded-xl border px-3 ${finish ? "border-primary/40 bg-primary/10" : "border-border bg-card"}`}
        >
          <span className={`text-xs font-semibold uppercase tracking-widest ${finish ? "text-primary" : "text-muted-foreground"}`}>{t("camera.checkoutLabel")}</span>
          {finish ? (
            <div className="ml-auto flex gap-1.5">
              {finish.map((dart, i) => (
                <span key={i} className="flex h-7 min-w-[2.75rem] items-center justify-center rounded-lg bg-background px-2 font-display text-lg font-bold text-foreground">
                  {dart}
                </span>
              ))}
            </div>
          ) : (
            <span className="ml-auto truncate text-sm text-foreground">{t("camera.noFinishYet")}</span>
          )}
        </div>
      )}
    </div>
  );
};

export default CameraScoreStrip;
