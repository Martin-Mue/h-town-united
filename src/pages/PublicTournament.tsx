import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Trophy, Users, Loader2, Radio, Zap } from "lucide-react";
import htuLogo from "@/assets/htu-logo.jpg";

interface Match {
  id: string; round: number; position: number;
  player1?: string; player2?: string; winner?: string;
  score1?: number; score2?: number;
}

interface TournamentRow {
  id: string; name: string; mode: string; status: string;
  champion: string | null; players: string[]; bracket: Match[];
  game_mode?: string; best_of_legs?: number;
  round_configs?: { mode: string; bestOf: number }[];
}

const roundLabel = (round: number, total: number) => {
  if (round === total) return "Finale";
  if (round === total - 1) return "Halbfinale";
  if (round === total - 2) return "Viertelfinale";
  return `Runde ${round}`;
};

const PublicTournamentPage = () => {
  const { slug } = useParams<{ slug: string }>();
  const [t, setT] = useState<TournamentRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!slug) return;
    let cancelled = false;

    const load = async () => {
      const { data } = await supabase
        .from("tournaments")
        .select("*")
        .eq("public_slug" as any, slug)
        .eq("public_view" as any, true)
        .maybeSingle();
      if (cancelled) return;
      if (!data) { setNotFound(true); setLoading(false); return; }
      setT({
        ...(data as any),
        players: (data as any).players || [],
        bracket: (data as any).bracket || [],
      });
      setLoading(false);
    };
    load();

    // Poll every 8s + realtime subscription
    const interval = window.setInterval(load, 8000);
    const channel = supabase
      .channel(`public-tournament-${slug}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "tournaments" }, load)
      .subscribe();

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      supabase.removeChannel(channel);
    };
  }, [slug]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }
  if (notFound || !t) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center text-center p-6">
        <Radio className="w-10 h-10 text-muted-foreground mb-3" />
        <h1 className="font-display text-2xl uppercase mb-1">Kein Live-Turnier</h1>
        <p className="text-sm text-muted-foreground">Dieser Link ist ungültig oder wurde deaktiviert.</p>
      </div>
    );
  }

  const isKo = t.mode !== "round-robin";
  const matches = t.bracket as Match[];
  const totalRounds = isKo && matches.length > 0 ? Math.max(...matches.map(m => m.round)) : 0;

  // Live ticker: completed matches in reverse order, plus highlights
  const completed = matches.filter(m => m.winner && m.player1 && m.player2 && m.player1 !== "BYE" && m.player2 !== "BYE").slice(-8).reverse();

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border px-6 py-4 flex items-center justify-between bg-gradient-to-r from-primary/10 via-transparent to-accent/10">
        <div className="flex items-center gap-3">
          <img src={htuLogo} alt="Logo" className="w-12 h-12 rounded-xl object-cover border border-primary/30" />
          <div>
            <h1 className="font-display text-2xl uppercase tracking-widest">{t.name}</h1>
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground flex items-center gap-2">
              <span className="inline-block h-2 w-2 rounded-full bg-secondary animate-pulse" />
              Live · {t.players.length} Spieler · {t.game_mode} BO{t.best_of_legs}
            </p>
          </div>
        </div>
        {t.champion && (
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-widest text-accent">Champion</p>
            <p className="font-display text-xl text-accent">🏆 {t.champion}</p>
          </div>
        )}
      </header>

      <div className="grid lg:grid-cols-[1fr_320px] gap-4 p-4">
        {/* Bracket */}
        <div className="overflow-x-auto pb-4">
          {isKo ? (
            <div className="flex gap-6 min-w-max">
              {Array.from({ length: totalRounds }, (_, r) => r + 1).map(round => {
                const rm = matches.filter(m => m.round === round);
                const cfg = (t.round_configs || [])[round - 1];
                return (
                  <div key={round} className="flex flex-col gap-4 min-w-[220px]">
                    <div className="text-center mb-1">
                      <h3 className="text-xs font-display uppercase text-muted-foreground">{roundLabel(round, totalRounds)}</h3>
                      {cfg && <p className="text-[10px] text-primary/80 font-mono">{cfg.mode} · BO{cfg.bestOf}</p>}
                    </div>
                    <div className="flex flex-col justify-around flex-1 gap-3">
                      {rm.map(m => (
                        <div key={m.id} className={`bg-card border rounded-xl overflow-hidden ${m.winner ? "border-border" : m.player1 && m.player2 && m.player1 !== "BYE" && m.player2 !== "BYE" ? "border-primary/60 glow-cyan" : "border-border/50"}`}>
                          {[m.player1, m.player2].map((player, idx) => (
                            <div key={idx} className={`px-3 py-2 text-sm flex items-center justify-between gap-2 ${idx === 0 ? "border-b border-border" : ""} ${m.winner === player ? "bg-secondary/15 text-secondary font-semibold" : player === "BYE" ? "text-muted-foreground/40" : ""}`}>
                              <span className="truncate">{player || "TBD"}</span>
                              <span className="font-display text-base">{idx === 0 ? m.score1 ?? 0 : m.score2 ?? 0}</span>
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="bg-card border border-border rounded-xl p-4 text-sm text-muted-foreground">
              Round-Robin-Ansicht folgt live über die App.
            </div>
          )}
        </div>

        {/* Live ticker */}
        <aside className="bg-card border border-border rounded-xl p-4 lg:sticky lg:top-4 self-start">
          <div className="flex items-center gap-2 mb-3">
            <Zap className="w-4 h-4 text-accent" />
            <h3 className="font-display uppercase text-sm">Live-Ticker</h3>
          </div>
          {completed.length === 0 ? (
            <p className="text-xs text-muted-foreground">Noch keine abgeschlossenen Matches.</p>
          ) : (
            <ol className="space-y-2">
              {completed.map(m => {
                const upset = m.winner && m.player1 && m.player2;
                return (
                  <li key={m.id} className="text-xs border-l-2 border-primary/40 pl-2">
                    <p className="font-display text-sm">
                      <span className="text-secondary">{m.winner}</span>
                      <span className="text-muted-foreground"> schlägt </span>
                      {m.winner === m.player1 ? m.player2 : m.player1}
                    </p>
                    <p className="text-muted-foreground">Runde {m.round} · {m.score1 ?? 0}:{m.score2 ?? 0}</p>
                  </li>
                );
              })}
            </ol>
          )}
          <div className="mt-4 pt-3 border-t border-border text-[10px] uppercase tracking-widest text-muted-foreground flex items-center gap-1">
            <Users className="w-3 h-3" /> {t.players.length} Teilnehmer
          </div>
        </aside>
      </div>
    </div>
  );
};

export default PublicTournamentPage;