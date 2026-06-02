import { useEffect, useMemo, useState } from "react";
import { Sparkles, Loader2, Play, TrendingUp, Target, Crosshair, Zap, RotateCw, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

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
  recentAvg: number;
}

interface CoachingPlanProps {
  onStartDrill: (drillId: string) => void;
}

/** Choose drills based on weakest metrics. Order = priority. */
const buildRecommendations = (s: PlayerStats | null): CoachRecommendation[] => {
  const recs: CoachRecommendation[] = [];

  if (!s || s.games === 0) {
    return [
      { drillId: "around-the-clock", title: "Around the Clock", reason: "Solide Basis aufbauen – jede Zahl einmal treffen.", metric: "Einstieg", priority: 1, icon: RotateCw },
      { drillId: "doubles-only", title: "Doubles Only", reason: "Doppelfelder von Anfang an automatisieren.", metric: "Einstieg", priority: 2, icon: Target },
      { drillId: "121-challenge", title: "121 Challenge", reason: "Erstes Checkout-Gefühl unter realistischen Bedingungen.", metric: "Einstieg", priority: 3, icon: Crosshair },
    ];
  }

  // Double rate weakness
  if (s.doubleRate < 0.25) {
    recs.push({
      drillId: "doubles-only",
      title: "Doubles Only",
      reason: `Deine Doppel-Quote liegt bei ${Math.round(s.doubleRate * 100)} %. Gezieltes Doppel-Training bringt dir die meisten Punkte zurück.`,
      metric: `Doppel ${Math.round(s.doubleRate * 100)} %`,
      priority: 1,
      icon: Target,
    });
  } else if (s.doubleRate < 0.4) {
    recs.push({
      drillId: "pressure-training",
      title: "Pressure Training",
      reason: `Mit ${Math.round(s.doubleRate * 100)} % Doppel solltest du Druck-Finishes (32, 40, 16) automatisieren.`,
      metric: `Doppel ${Math.round(s.doubleRate * 100)} %`,
      priority: 1,
      icon: Zap,
    });
  }

  // Average weakness
  if (s.avg < 40) {
    recs.push({
      drillId: "around-the-clock",
      title: "Around the Clock",
      reason: `Schnitt von ${s.avg.toFixed(1)} – Treffsicherheit auf die Zahlenfelder ist der Hebel.`,
      metric: `Ø ${s.avg.toFixed(1)}`,
      priority: 2,
      icon: RotateCw,
    });
  } else if (s.avg < 60) {
    recs.push({
      drillId: "t20-grind",
      title: "T20 Grind",
      reason: `Schnitt von ${s.avg.toFixed(1)} – konstantere Triple-20-Treffer heben dich auf das nächste Level.`,
      metric: `Ø ${s.avg.toFixed(1)}`,
      priority: 2,
      icon: Trophy,
    });
  } else {
    recs.push({
      drillId: "random-finish",
      title: "Random Finish Drill",
      reason: `Starker Schnitt (${s.avg.toFixed(1)}). Zufalls-Checkouts halten dich flexibel.`,
      metric: `Ø ${s.avg.toFixed(1)}`,
      priority: 2,
      icon: Crosshair,
    });
  }

  // Form / recent vs lifetime
  if (s.recentAvg && s.recentAvg < s.avg - 5) {
    recs.push({
      drillId: "pressure-training",
      title: "Pressure Training",
      reason: `Aktuelle Form (Ø ${s.recentAvg.toFixed(1)}) liegt unter deinem Schnitt – Druck-Routine schärft den Fokus.`,
      metric: "Formtief",
      priority: 3,
      icon: Zap,
    });
  } else if (s.highscore < 100) {
    recs.push({
      drillId: "t20-grind",
      title: "T20 Grind",
      reason: `Höchster 3-Dart-Score bisher: ${s.highscore}. Triple-20 ist der direkteste Weg über 100.`,
      metric: `HS ${s.highscore}`,
      priority: 3,
      icon: Trophy,
    });
  } else {
    recs.push({
      drillId: "121-challenge",
      title: "121 Challenge",
      reason: "Klassisches Match-Checkout – hält Routine und Druckfestigkeit oben.",
      metric: "Routine",
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
    { drillId: "around-the-clock", title: "Around the Clock", reason: "Allround-Treffsicherheit.", metric: "Basis", priority: 9, icon: RotateCw },
    { drillId: "doubles-only", title: "Doubles Only", reason: "Doppelfelder festigen.", metric: "Basis", priority: 9, icon: Target },
    { drillId: "t20-grind", title: "T20 Grind", reason: "Maximale Scoring-Power.", metric: "Basis", priority: 9, icon: Trophy },
  ];
  for (const f of fallback) {
    if (unique.length >= 3) break;
    if (!unique.find((u) => u.drillId === f.drillId)) unique.push(f);
  }
  return unique.slice(0, 3);
};

const CoachingPlan = ({ onStartDrill }: CoachingPlanProps) => {
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

        if (!cancelled) {
          setStats({
            name: player.name,
            games: count,
            wins,
            avg: count ? avgSum / count : 0,
            doubleRate: count ? drSum / count : 0,
            highscore: hs,
            recentAvg: recentCount ? recentSum / recentCount : 0,
          });
          setLoading(false);
        }
      } catch {
        if (!cancelled) { setStats(null); setLoading(false); }
      }
    })();
    return () => { cancelled = true; };
  }, [session?.user?.id]);

  const recommendations = useMemo(() => buildRecommendations(stats), [stats]);

  return (
    <div className="bg-card border border-primary/20 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <Sparkles className="w-4 h-4 text-primary" />
        <h3 className="font-display uppercase text-sm text-primary">Coaching · dein Plan</h3>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
          <Loader2 className="w-4 h-4 animate-spin" /> Analyse läuft …
        </div>
      ) : (
        <>
          {stats && stats.games > 0 ? (
            <div className="grid grid-cols-4 gap-2 text-center mb-4">
              <Stat label="Spiele" value={stats.games.toString()} />
              <Stat label="Siege" value={stats.wins.toString()} />
              <Stat label="Ø Score" value={stats.avg.toFixed(1)} />
              <Stat label="Doppel" value={`${Math.round(stats.doubleRate * 100)}%`} />
            </div>
          ) : (
            <p className="text-xs text-muted-foreground mb-3">
              Noch keine Spieldaten – wir starten dich mit einem Einsteiger-Plan. Spiele ein paar Matches und der Plan wird persönlicher.
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
                    <span className="text-[10px] font-display uppercase text-muted-foreground">Schritt {idx + 1}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/15 text-primary">{rec.metric}</span>
                  </div>
                  <p className="font-semibold text-sm truncate">{rec.title}</p>
                  <p className="text-xs text-muted-foreground line-clamp-2">{rec.reason}</p>
                </div>
                <Button size="sm" variant="outline" className="gap-1 shrink-0" onClick={() => onStartDrill(rec.drillId)}>
                  <Play className="w-3 h-3" /> Start
                </Button>
              </div>
            ))}
          </div>

          <div className="mt-3 flex items-center gap-1 text-[11px] text-muted-foreground">
            <TrendingUp className="w-3 h-3" />
            Plan aktualisiert sich automatisch nach jedem Match.
          </div>
        </>
      )}
    </div>
  );
};

const Stat = ({ label, value }: { label: string; value: string }) => (
  <div className="bg-muted/40 rounded-lg py-2">
    <p className="font-display text-lg leading-none">{value}</p>
    <p className="text-[10px] text-muted-foreground mt-1">{label}</p>
  </div>
);

export default CoachingPlan;