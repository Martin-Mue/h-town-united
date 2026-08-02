import { useEffect, useState, useRef, useCallback, useLayoutEffect } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Trophy, Users, Loader2, Radio, Zap } from "lucide-react";
import htuLogo from "@/assets/htu-logo.jpg";

interface Match {
  id: string; round: number; position: number;
  player1?: string; player2?: string; winner?: string;
  score1?: number; score2?: number; scorekeeper?: string; board?: number; slot?: number;
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

/** Mirrored, auto-fitting bracket — identical layout to the admin view, read-only. */
const LiveBracket = ({ matches, totalRounds, roundConfigs, fallbackMode, fallbackBestOf }: {
  matches: Match[];
  totalRounds: number;
  roundConfigs?: { mode: string; bestOf: number }[];
  fallbackMode?: string;
  fallbackBestOf?: number;
}) => {
  const wrapRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  const measure = useCallback(() => {
    if (!wrapRef.current || !innerRef.current) return;
    const wrap = wrapRef.current.getBoundingClientRect();
    const prev = innerRef.current.style.transform;
    innerRef.current.style.transform = "none";
    const inner = innerRef.current.getBoundingClientRect();
    innerRef.current.style.transform = prev;
    if (!inner.width || !inner.height) return;
    setScale(Math.max(0.18, Math.min(wrap.width / inner.width, wrap.height / inner.height, 1)));
  }, []);

  useLayoutEffect(() => { measure(); }, [measure, totalRounds, matches.length]);
  useEffect(() => {
    const ro = new ResizeObserver(() => measure());
    if (wrapRef.current) ro.observe(wrapRef.current);
    window.addEventListener("resize", measure);
    window.addEventListener("orientationchange", measure);
    const t = window.setTimeout(measure, 150);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("orientationchange", measure);
      window.clearTimeout(t);
    };
  }, [measure]);

  const renderMatch = (m: Match, side: "left" | "right" | "center", isLast: boolean) => {
    const live = !m.winner && m.player1 && m.player2 && m.player1 !== "BYE" && m.player2 !== "BYE";
    return (
      <div key={m.id} className={`bg-card border rounded-xl overflow-hidden relative ${m.winner ? "border-border" : live ? "border-primary/60 glow-cyan" : "border-border/50"}`}>
        {!isLast && side === "left" && <span aria-hidden className="absolute top-1/2 -right-4 w-4 h-px bg-border" />}
        {!isLast && side === "right" && <span aria-hidden className="absolute top-1/2 -left-4 w-4 h-px bg-border" />}
        {[m.player1, m.player2].map((player, idx) => (
          <div key={idx} className={`px-3 py-2 text-sm flex items-center justify-between gap-2 ${idx === 0 ? "border-b border-border" : ""} ${m.winner === player ? "bg-secondary/15 text-secondary font-semibold" : player === "BYE" ? "text-muted-foreground/40" : !player ? "text-muted-foreground/40" : ""}`}>
            <span className="truncate">{player || "TBD"}</span>
            <span className="font-display text-base">{idx === 0 ? m.score1 ?? 0 : m.score2 ?? 0}</span>
          </div>
        ))}
        {!m.winner && (m.scorekeeper || m.board) && (
          <div className="px-3 py-1 border-t border-border/60 bg-muted/20 flex items-center justify-between text-[10px] text-muted-foreground">
            <span className="truncate">✍️ {m.scorekeeper || "–"}</span>
            {m.board ? <span className="font-mono">Board {m.board}</span> : null}
          </div>
        )}
      </div>
    );
  };

  const roundHeader = (round: number, align: "left" | "center" | "right") => {
    const cfg = (roundConfigs || [])[round - 1];
    return (
      <div className={`mb-1 ${align === "center" ? "text-center" : align === "right" ? "text-right" : "text-left"}`}>
        <h3 className="text-xs font-display uppercase text-muted-foreground">{roundLabel(round, totalRounds)}</h3>
        <p className="text-[10px] text-primary/80 font-mono">{cfg?.mode || fallbackMode} · BO{cfg?.bestOf || fallbackBestOf}</p>
      </div>
    );
  };

  const column = (round: number, side: "left" | "right", isLast: boolean) => {
    const all = matches.filter(m => m.round === round).sort((a, b) => a.position - b.position);
    const half = Math.ceil(all.length / 2);
    const slice = side === "left" ? all.slice(0, half) : all.slice(half);
    return (
      <div key={`${side}-${round}`} className="flex flex-col gap-3 min-w-[220px]">
        {roundHeader(round, side === "left" ? "left" : "right")}
        <div className="flex flex-col justify-around flex-1 gap-3 relative">
          {slice.map(m => renderMatch(m, side, isLast))}
        </div>
      </div>
    );
  };

  const body = () => {
    if (totalRounds < 2) return column(1, "left", true);
    const leftCols = [];
    const rightCols = [];
    for (let r = 1; r < totalRounds; r++) leftCols.push(column(r, "left", false));
    for (let r = totalRounds - 1; r >= 1; r--) rightCols.push(column(r, "right", false));
    const finals = matches.filter(m => m.round === totalRounds).sort((a, b) => a.position - b.position);
    return (
      <>
        {leftCols}
        <div key="final" className="flex flex-col gap-3 min-w-[250px] justify-center">
          {roundHeader(totalRounds, "center")}
          <div className="flex flex-col justify-center flex-1 gap-3">
            {finals.map(m => (
              <div key={m.id} className="relative">
                <Trophy aria-hidden className="absolute -top-6 left-1/2 -translate-x-1/2 w-5 h-5 text-accent" />
                {renderMatch(m, "center", true)}
              </div>
            ))}
          </div>
        </div>
        {rightCols}
      </>
    );
  };

  return (
    <div ref={wrapRef} className="overflow-hidden w-full" style={{ height: "min(72dvh, 900px)" }}>
      <div
        ref={innerRef}
        className="flex items-stretch gap-4 p-4"
        style={{ transform: `scale(${scale})`, transformOrigin: "top left", width: "max-content" }}
      >
        {body()}
      </div>
    </div>
  );
};

const PublicTournamentPage = () => {
  const { slug } = useParams<{ slug: string }>();
  const [t, setT] = useState<TournamentRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [flash, setFlash] = useState<Match | null>(null);
  const seenResults = useRef<Set<string> | null>(null);
  const flashTimer = useRef<number | null>(null);

  useEffect(() => {
    if (!t) return;
    const done = (t.bracket || []).filter(m => m.winner && m.winner !== "BYE" && m.player1 && m.player2 && m.player1 !== "BYE" && m.player2 !== "BYE");
    const ids = new Set(done.map(m => `${m.id}:${m.winner}:${m.score1 ?? 0}:${m.score2 ?? 0}`));
    if (seenResults.current === null) { seenResults.current = ids; return; }
    const fresh = done.find(m => !seenResults.current!.has(`${m.id}:${m.winner}:${m.score1 ?? 0}:${m.score2 ?? 0}`));
    seenResults.current = ids;
    if (fresh) {
      setFlash(fresh);
      if (flashTimer.current) window.clearTimeout(flashTimer.current);
      flashTimer.current = window.setTimeout(() => setFlash(null), 12000);
    }
  }, [t]);

  useEffect(() => {
    if (!slug) return;
    let cancelled = false;

    const load = async () => {
      const { data } = await (supabase as any)
        .from("tournaments_public")
        .select("*")
        .eq("public_slug", slug)
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
        <div className="min-w-0">
          {isKo ? (
            <LiveBracket
              matches={matches}
              totalRounds={totalRounds}
              roundConfigs={t.round_configs}
              fallbackMode={t.game_mode}
              fallbackBestOf={t.best_of_legs}
            />
          ) : (
            <div className="bg-card border border-border rounded-xl p-4 text-sm text-muted-foreground">
              Round-Robin-Ansicht folgt live über die App.
            </div>
          )}
        </div>

        <aside className="bg-card border border-border rounded-xl p-4 lg:sticky lg:top-4 self-start">
          <div className="flex items-center gap-2 mb-3">
            <Zap className="w-4 h-4 text-accent" />
            <h3 className="font-display uppercase text-sm">Live-Ticker</h3>
          </div>
          {completed.length === 0 ? (
            <p className="text-xs text-muted-foreground">Noch keine abgeschlossenen Matches.</p>
          ) : (
            <ol className="space-y-2">
              {completed.map(m => (
                <li key={m.id} className="text-xs border-l-2 border-primary/40 pl-2">
                  <p className="font-display text-sm">
                    <span className="text-secondary">{m.winner}</span>
                    <span className="text-muted-foreground"> schlägt </span>
                    {m.winner === m.player1 ? m.player2 : m.player1}
                  </p>
                  <p className="text-muted-foreground">{roundLabel(m.round, totalRounds)} · {m.score1 ?? 0}:{m.score2 ?? 0}</p>
                </li>
              ))}
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