import { useEffect, useMemo, useState } from "react";
import { Sparkles, Loader2, Play, TrendingUp, Target, Crosshair, Zap, RotateCw, Trophy, Compass } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { computeAimBias, describeAimTip, type AimBiasResult, type CoordDart } from "@/utils/aimBias";

/** Public shape so the parent (Training page) can map ids back to drills. */
export interface CoachRecommendation {
  drillId: string;
  title: string;
  reason: string;
  metric: string;
  priority: number;
  icon: typeof Target;
}

interface PlayerStats {
  name: string;
  games: number;
  wins: number;
  avg: number;
  doubleRate: number;
  highscore: number;
  /** null = no recent games to average at all — distinct from a genuine 0, which (rare, but
   *  real for a badly-logged game row) is actually the most severe possible form dip and must
   *  not be treated the same as "nothing to compare yet". */
  recentAvg: number | null;
  /** null = not enough camera-scored darts yet for a reliable reading — see aimBias.ts. */
  aimBias: AimBiasResult | null;
}

/** Same negligible-offset threshold aimBias.ts's own describeAimTip uses, so this recommendation
 *  and that card's own advice can never disagree about whether there's something worth fixing. */
const AIM_BIAS_NEGLIGIBLE_MM = 0.5;

interface CoachingPlanProps {
  onStartDrill: (drillId: string) => void;
}

/** Choose drills based on weakest metrics. Order = priority. */
const buildRecommendations = (s: PlayerStats | null, t: (key: string) => string): CoachRecommendation[] => {
  const recs: CoachRecommendation[] = [];

  if (!s || s.games === 0) {
    return [
      { drillId: "around-the-clock", title: "Around the Clock", reason: t("coach.introBasics"), metric: t("coach.entryLevel"), priority: 1, icon: RotateCw },
      { drillId: "doubles-only", title: "Doubles Only", reason: t("coach.introDoubles"), metric: t("coach.entryLevel"), priority: 2, icon: Target },
      { drillId: "121-challenge", title: "121 Challenge", reason: t("coach.introCheckout"), metric: t("coach.entryLevel"), priority: 3, icon: Crosshair },
    ];
  }

  // Double rate weakness (doubleRate is already a 0-100 percentage)
  if (s.doubleRate < 25) {
    recs.push({
      drillId: "doubles-only",
      title: "Doubles Only",
      reason: `${t("coach.doubleRateLowPrefix")} ${Math.round(s.doubleRate)} ${t("coach.doubleRateLowSuffix")}`,
      metric: `${t("training.categoryDoubles")} ${Math.round(s.doubleRate)} %`,
      priority: 1,
      icon: Target,
    });
  } else if (s.doubleRate < 40) {
    recs.push({
      drillId: "pressure-training",
      title: "Pressure Training",
      reason: `${t("coach.doubleRateMidPrefix")} ${Math.round(s.doubleRate)} ${t("coach.doubleRateMidSuffix")}`,
      metric: `${t("training.categoryDoubles")} ${Math.round(s.doubleRate)} %`,
      priority: 1,
      icon: Zap,
    });
  }

  // Aim-bias correction — the one recommendation actually informed by WHERE darts land, not
  // just what they scored (needs camera-tracked tip positions; see aimBias.ts). Only fires once
  // there's a real, non-negligible reading to act on — same threshold describeAimTip itself uses,
  // so this card and the Statistics aim-bias card are always telling the same story.
  if (s.aimBias && (Math.abs(s.aimBias.radialOffsetMm) > AIM_BIAS_NEGLIGIBLE_MM || Math.abs(s.aimBias.tangentialOffsetMm) > AIM_BIAS_NEGLIGIBLE_MM)) {
    recs.push({
      drillId: "around-the-clock",
      title: "Around the Clock",
      reason: `${t("coach.aimBiasReasonPrefix")} ${describeAimTip(s.aimBias, t)} ${t("coach.aimBiasReasonSuffix")}`,
      metric: t("coach.aimTendencyMetric"),
      priority: 2,
      icon: Compass,
    });
  }

  // Average weakness
  if (s.avg < 40) {
    recs.push({
      drillId: "around-the-clock",
      title: "Around the Clock",
      reason: `${t("coach.avgLowPrefix")} ${s.avg.toFixed(1)} ${t("coach.avgLowSuffix")}`,
      metric: `Ø ${s.avg.toFixed(1)}`,
      priority: 2,
      icon: RotateCw,
    });
  } else if (s.avg < 60) {
    recs.push({
      drillId: "target-grind",
      title: "Target Grind",
      reason: `${t("coach.avgLowPrefix")} ${s.avg.toFixed(1)} ${t("coach.avgMidSuffix")}`,
      metric: `Ø ${s.avg.toFixed(1)}`,
      priority: 2,
      icon: Trophy,
    });
  } else {
    recs.push({
      drillId: "random-finish",
      title: "Random Finish Drill",
      reason: `${t("coach.avgHighPrefix")} (${s.avg.toFixed(1)}). ${t("coach.avgHighSuffix")}`,
      metric: `Ø ${s.avg.toFixed(1)}`,
      priority: 2,
      icon: Crosshair,
    });
  }

  // Form / recent vs lifetime
  if (s.recentAvg !== null && s.recentAvg < s.avg - 5) {
    recs.push({
      drillId: "pressure-training",
      title: "Pressure Training",
      reason: `${t("coach.formDipPrefix")} ${s.recentAvg.toFixed(1)}${t("coach.formDipSuffix")}`,
      metric: t("coach.formDipMetric"),
      priority: 3,
      icon: Zap,
    });
  } else if (s.highscore < 100) {
    recs.push({
      drillId: "target-grind",
      title: "Target Grind",
      reason: `${t("coach.highscorePrefix")} ${s.highscore}${t("coach.highscoreSuffix")}`,
      metric: `${t("coach.hsMetric")} ${s.highscore}`,
      priority: 3,
      icon: Trophy,
    });
  } else {
    recs.push({
      drillId: "121-challenge",
      title: "121 Challenge",
      reason: t("coach.routineReason"),
      metric: t("coach.routineMetric"),
      priority: 3,
      icon: Crosshair,
    });
  }

  // Dedupe by drillId, keep highest priority entry (lowest number).
  const byId = new Map<string, CoachRecommendation>();
  recs.forEach((r) => {
    const prev = byId.get(r.drillId);
    if (!prev || prev.priority > r.priority) byId.set(r.drillId, r);
  });
  const unique = Array.from(byId.values()).sort((a, b) => a.priority - b.priority).slice(0, 3);

  // Top up to 3 if needed.
  const fallback: CoachRecommendation[] = [
    { drillId: "around-the-clock", title: "Around the Clock", reason: t("coach.fallbackAllround"), metric: t("coach.basisMetric"), priority: 9, icon: RotateCw },
    { drillId: "doubles-only", title: "Doubles Only", reason: t("coach.fallbackDoubles"), metric: t("coach.basisMetric"), priority: 9, icon: Target },
    { drillId: "target-grind", title: "Target Grind", reason: t("coach.fallbackScoring"), metric: t("coach.basisMetric"), priority: 9, icon: Trophy },
  ];
  for (const f of fallback) {
    if (unique.length >= 3) break;
    if (!unique.find((u) => u.drillId === f.drillId)) unique.push(f);
  }
  return unique.slice(0, 3);
};

const CoachingPlan = ({ onStartDrill }: CoachingPlanProps) => {
  const { t } = useLanguage();
  const { session } = useAuth();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<PlayerStats | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const userId = session?.user?.id;
        if (!userId) {
          if (!cancelled) { setStats(null); setLoading(false); }
          return;
        }
        const { data: player } = await supabase
          .from("players")
          .select("id, name")
          .eq("user_id", userId)
          .maybeSingle();
        if (!player) {
          if (!cancelled) { setStats(null); setLoading(false); }
          return;
        }
        const { data: games } = await supabase
          .from("games")
          .select("player1_id, player2_id, player1_average, player2_average, player1_double_rate, player2_double_rate, player1_highscore, player2_highscore, winner_id, played_at")
          .or(`player1_id.eq.${player.id},player2_id.eq.${player.id}`)
          .order("played_at", { ascending: false });

        let avgSum = 0, drSum = 0, hs = 0, count = 0, wins = 0;
        let recentSum = 0, recentCount = 0;
        (games || []).forEach((g, idx) => {
          const isP1 = g.player1_id === player.id;
          const avg = Number(isP1 ? g.player1_average : g.player2_average) || 0;
          const dr = Number(isP1 ? g.player1_double_rate : g.player2_double_rate) || 0;
          const high = Number(isP1 ? g.player1_highscore : g.player2_highscore) || 0;
          avgSum += avg; drSum += dr; if (high > hs) hs = high; count += 1;
          if (g.winner_id === player.id) wins += 1;
          if (idx < 5) { recentSum += avg; recentCount += 1; }
        });

        // Aim-bias needs actual tip coordinates, only available from camera-scored legs — a
        // separate query since `games` (above) never carried dart-by-dart detail.
        const { data: legs } = await supabase
          .from("game_legs")
          .select("throws")
          .eq("player_id", player.id);
        const darts: CoordDart[] = (legs ?? []).flatMap((l) => (l.throws as unknown as CoordDart[]) ?? []);
        const aimBias = computeAimBias(darts);

        if (!cancelled) {
          setStats({
            name: player.name,
            games: count,
            wins,
            avg: count ? avgSum / count : 0,
            doubleRate: count ? drSum / count : 0,
            highscore: hs,
            recentAvg: recentCount ? recentSum / recentCount : null,
            aimBias,
          });
          setLoading(false);
        }
      } catch {
        if (!cancelled) { setStats(null); setLoading(false); }
      }
    })();
    return () => { cancelled = true; };
  }, [session?.user?.id]);

  const recommendations = useMemo(() => buildRecommendations(stats, t), [stats, t]);

  return (
    <div className="bg-card border border-primary/20 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <Sparkles className="w-4 h-4 text-primary" />
        <h3 className="font-display uppercase text-sm text-primary">{t("coach.title")}</h3>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
          <Loader2 className="w-4 h-4 animate-spin" /> {t("coach.analyzing")}
        </div>
      ) : (
        <>
          {stats && stats.games > 0 ? (
            <div className="grid grid-cols-4 gap-2 text-center mb-4">
              <Stat label={t("stats.games")} value={stats.games.toString()} />
              <Stat label={t("game.winsLabel")} value={stats.wins.toString()} />
              <Stat label={t("stats.average")} value={stats.avg.toFixed(1)} />
              <Stat label={t("training.categoryDoubles")} value={`${Math.round(stats.doubleRate)}%`} />
            </div>
          ) : (
            <p className="text-xs text-muted-foreground mb-3">
              {t("coach.noDataYet")}
            </p>
          )}

          <div className="space-y-2">
            {recommendations.map((rec, idx) => (
              <div key={rec.drillId} className="flex items-center gap-3 bg-muted/40 rounded-lg p-3">
                <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
                  <rec.icon className="w-4 h-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-display uppercase text-muted-foreground">{t("coach.step")} {idx + 1}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/15 text-primary">{rec.metric}</span>
                  </div>
                  <p className="font-semibold text-sm truncate">{rec.title}</p>
                  <p className="text-xs text-muted-foreground line-clamp-2">{rec.reason}</p>
                </div>
                <Button size="sm" variant="outline" className="gap-1 shrink-0" onClick={() => onStartDrill(rec.drillId)}>
                  <Play className="w-3 h-3" /> {t("coach.start")}
                </Button>
              </div>
            ))}
          </div>

          <div className="mt-3 flex items-center gap-1 text-[11px] text-muted-foreground">
            <TrendingUp className="w-3 h-3" />
            {t("coach.autoUpdateNote")}
          </div>
        </>
      )}
    </div>
  );
};

const Stat = ({ label, value }: { label: string; value: string }) => (
  <div className="bg-muted/40 border border-border/60 rounded-lg py-2">
    <p className="font-display text-lg leading-none">{value}</p>
    <p className="text-[10px] text-muted-foreground mt-1">{label}</p>
  </div>
);

export default CoachingPlan;