import { useState, useEffect, useCallback, useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { Layers, Plus, Trash2, Loader2, Trophy, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

interface Scoring {
  champion: number;
  runnerUp: number;
  semi: number;
  quarter: number;
  participation: number;
}

interface Series {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  scoring: Scoring;
  status: string;
  created_at: string;
}

interface TournamentLite {
  id: string;
  name: string;
  status: string;
  champion: string | null;
  players: string[];
  bracket: any;
  mode: string;
  created_at: string;
  series_id: string | null;
}

const DEFAULT_SCORING: Scoring = { champion: 100, runnerUp: 70, semi: 50, quarter: 30, participation: 10 };

const TournamentSeriesPage = () => {
  const { id } = useParams();
  const { session } = useAuth();
  const { toast } = useToast();
  const [series, setSeries] = useState<Series[]>([]);
  const [tournaments, setTournaments] = useState<TournamentLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [scoring, setScoring] = useState<Scoring>(DEFAULT_SCORING);

  const fetchAll = useCallback(async () => {
    const [s, t] = await Promise.all([
      supabase.from("tournament_series" as any).select("*").order("created_at", { ascending: false }),
      supabase.from("tournaments").select("id, name, status, champion, players, bracket, mode, created_at, series_id").order("created_at", { ascending: false }),
    ]);
    if (s.data) setSeries((s.data as any[]).map((r) => ({ ...r, scoring: r.scoring || DEFAULT_SCORING })));
    if (t.data) setTournaments(t.data.map((x: any) => ({ ...x, players: x.players || [], bracket: x.bracket || [], series_id: x.series_id || null })));
    setLoading(false);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const createSeries = async () => {
    if (!name.trim() || !session?.user?.id) return;
    const { error } = await supabase.from("tournament_series" as any).insert({
      user_id: session.user.id, name: name.trim(), description: desc.trim() || null, scoring: scoring as any,
    });
    if (error) { toast({ title: "Fehler", description: error.message, variant: "destructive" }); return; }
    setName(""); setDesc(""); setScoring(DEFAULT_SCORING); setCreating(false);
    fetchAll();
  };

  const deleteSeries = async (sid: string) => {
    await supabase.from("tournament_series" as any).delete().eq("id", sid);
    fetchAll();
  };

  const activeSeries = id ? series.find((s) => s.id === id) : null;

  // ─── SINGLE SERIES DETAIL ────────────────────────
  if (id && activeSeries) {
    const seriesTourneys = tournaments.filter((t) => t.series_id === id);
    const standings = computeStandings(seriesTourneys, activeSeries.scoring);

    return (
      <div className="container py-6 animate-slide-up max-w-4xl mx-auto">
        <Link to="/tournaments/series" className="inline-flex items-center gap-1 text-sm text-muted-foreground mb-4 hover:text-foreground">
          <ArrowLeft className="w-4 h-4" /> Alle Serien
        </Link>

        <div className="mb-6">
          <div className="flex items-center gap-3 mb-1">
            <Layers className="w-6 h-6 text-accent" />
            <h2 className="text-2xl font-display uppercase">{activeSeries.name}</h2>
          </div>
          {activeSeries.description && <p className="text-sm text-muted-foreground">{activeSeries.description}</p>}
        </div>

        <div className="bg-card border border-border rounded-xl p-4 mb-4">
          <h3 className="font-display text-sm uppercase text-muted-foreground mb-3">Gesamtwertung</h3>
          {standings.length === 0 ? (
            <p className="text-sm text-muted-foreground">Noch keine Turniere in dieser Serie abgeschlossen.</p>
          ) : (
            <div className="space-y-1">
              {standings.map((s, i) => (
                <div key={s.name} className="flex items-center justify-between px-3 py-2 rounded-lg bg-muted/40">
                  <div className="flex items-center gap-3">
                    <span className={`font-display w-8 ${i === 0 ? "text-accent" : ""}`}>
                      {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`}
                    </span>
                    <span className="font-semibold text-sm">{s.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {s.champions > 0 && `${s.champions}× 🏆 · `}{s.tournaments} Turniere
                    </span>
                  </div>
                  <span className="font-display text-primary text-lg">{s.points} Pkt</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-card border border-border rounded-xl p-4">
          <h3 className="font-display text-sm uppercase text-muted-foreground mb-3">Turniere ({seriesTourneys.length})</h3>
          {seriesTourneys.length === 0 ? (
            <p className="text-sm text-muted-foreground">Noch keine Turniere zugeordnet. Wähle bei der Turniererstellung diese Serie aus.</p>
          ) : (
            <div className="space-y-2">
              {seriesTourneys.map((t) => (
                <Link key={t.id} to="/tournament" className="flex items-center justify-between px-3 py-2 rounded-lg bg-muted/30 hover:bg-muted transition-colors">
                  <span className="text-sm font-medium">{t.name}</span>
                  {t.champion && <span className="text-xs text-accent">🏆 {t.champion}</span>}
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ─── LIST + CREATE ───────────────────────────────
  return (
    <div className="container py-6 animate-slide-up max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Layers className="w-6 h-6 text-accent" />
          <h2 className="text-2xl font-display uppercase">Turnierserien</h2>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/tournament" className="text-xs text-muted-foreground hover:text-foreground">← Turniere</Link>
          <Button size="sm" onClick={() => setCreating((v) => !v)} className="gap-1">
            <Plus className="w-4 h-4" /> {creating ? "Abbrechen" : "Neue Serie"}
          </Button>
        </div>
      </div>

      {creating && (
        <div className="bg-card border border-primary/30 rounded-xl p-4 mb-4 space-y-3">
          <div>
            <label className="text-sm text-muted-foreground mb-1 block">Name</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="z.B. Winter Series 2026" />
          </div>
          <div>
            <label className="text-sm text-muted-foreground mb-1 block">Beschreibung</label>
            <Textarea value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Optional" rows={2} />
          </div>
          <div>
            <label className="text-sm text-muted-foreground mb-2 block">Punkteverteilung</label>
            <div className="grid grid-cols-5 gap-2">
              {(["champion", "runnerUp", "semi", "quarter", "participation"] as const).map((k) => (
                <div key={k}>
                  <label className="text-[10px] uppercase text-muted-foreground">{k === "champion" ? "1." : k === "runnerUp" ? "2." : k === "semi" ? "SF" : k === "quarter" ? "VF" : "Teiln."}</label>
                  <Input type="number" value={scoring[k]} onChange={(e) => setScoring({ ...scoring, [k]: parseInt(e.target.value) || 0 })} className="h-8 text-sm" />
                </div>
              ))}
            </div>
          </div>
          <Button onClick={createSeries} className="w-full">Serie anlegen</Button>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
      ) : series.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Layers className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="text-sm">Noch keine Serien. Erstelle eine, um mehrere Turniere zu einer Gesamtwertung zu verbinden.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {series.map((s) => {
            const count = tournaments.filter((t) => t.series_id === s.id).length;
            return (
              <div key={s.id} className="bg-card border border-border rounded-xl p-4 flex items-center justify-between">
                <Link to={`/tournaments/series/${s.id}`} className="flex-1">
                  <p className="font-semibold text-sm">{s.name}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{count} Turniere · {new Date(s.created_at).toLocaleDateString("de-DE")}</p>
                </Link>
                {s.user_id === session?.user?.id && (
                  <Button variant="ghost" size="icon" onClick={() => deleteSeries(s.id)}>
                    <Trash2 className="w-4 h-4 text-muted-foreground hover:text-destructive" />
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

// ─── Standings calculation ─────────────────────────
interface Standing { name: string; points: number; champions: number; tournaments: number; }

function computeStandings(tourneys: TournamentLite[], scoring: Scoring): Standing[] {
  const map: Record<string, Standing> = {};
  const add = (name: string, pts: number, isChamp = false) => {
    if (!name || name === "BYE") return;
    if (!map[name]) map[name] = { name, points: 0, champions: 0, tournaments: 0 };
    map[name].points += pts;
    if (isChamp) map[name].champions++;
  };

  for (const t of tourneys) {
    if (t.status !== "finished") continue;
    const played = new Set<string>();
    (t.players || []).forEach((p) => { if (p && p !== "BYE") { played.add(p); add(p, scoring.participation); } });

    if (t.mode !== "round-robin" && Array.isArray(t.bracket)) {
      const matches = t.bracket as Match[];
      if (matches.length > 0) {
        const totalRounds = Math.max(...matches.map((m) => m.round));
        const finalM = matches.find((m) => m.round === totalRounds);
        if (finalM?.winner) add(finalM.winner, scoring.champion - scoring.participation, true);
        const runnerUp = finalM && finalM.winner ? (finalM.winner === finalM.player1 ? finalM.player2 : finalM.player1) : undefined;
        if (runnerUp && runnerUp !== "BYE") add(runnerUp, scoring.runnerUp - scoring.participation);
        // Semifinal losers
        if (totalRounds >= 2) {
          matches.filter((m) => m.round === totalRounds - 1 && m.winner).forEach((m) => {
            const loser = m.winner === m.player1 ? m.player2 : m.player1;
            if (loser && loser !== "BYE" && loser !== finalM?.winner && loser !== runnerUp) add(loser, scoring.semi - scoring.participation);
          });
        }
        if (totalRounds >= 3) {
          matches.filter((m) => m.round === totalRounds - 2 && m.winner).forEach((m) => {
            const loser = m.winner === m.player1 ? m.player2 : m.player1;
            if (loser && loser !== "BYE") add(loser, scoring.quarter - scoring.participation);
          });
        }
      }
    } else if (t.champion) {
      add(t.champion, scoring.champion - scoring.participation, true);
    }
  }

  return Object.values(map).sort((a, b) => b.points - a.points);
}

interface Match { round: number; winner?: string; player1?: string; player2?: string; }

export default TournamentSeriesPage;