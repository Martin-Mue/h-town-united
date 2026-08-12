import { useEffect, useState, useRef, useCallback, useLayoutEffect, useMemo } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Trophy, Users, Loader2, Radio, Zap, ListOrdered, Monitor, ZoomIn, ZoomOut, Maximize2, Network, Rows3 } from "lucide-react";
import { roundLabelFor } from "@/utils/tournament";
import htuLogo from "@/assets/htu-logo.jpg";
import htuEmblem from "@/assets/club-emblem.png";

interface Match {
  id: string; round: number; position: number;
  player1?: string; player2?: string; winner?: string;
  score1?: number; score2?: number; scorekeeper?: string; board?: number; slot?: number;
  scorekeeperRule?: "prev-loser"; scorekeeperFromMatchId?: string;
}

/** name of the scorekeeper – or the rule "loser of match X" while it is not decided yet */
const keeperLabel = (m: Match, all: Match[]): string | null => {
  if (m.scorekeeper) return m.scorekeeper;
  if (m.scorekeeperRule === "prev-loser" && m.scorekeeperFromMatchId) {
    const src = all.find((x) => x.id === m.scorekeeperFromMatchId);
    if (!src) return null;
    if (src.winner && src.winner !== "BYE") {
      const loser = src.winner === src.player1 ? src.player2 : src.player1;
      if (loser && loser !== "BYE") return loser;
    }
    return `Verlierer ${src.player1 || "?"} / ${src.player2 || "?"}`;
  }
  return null;
};

interface TournamentRow {
  id: string; name: string; mode: string; status: string;
  champion: string | null; players: string[]; bracket: Match[];
  game_mode?: string; best_of_legs?: number; boards?: number;
  round_configs?: { mode: string; bestOf: number }[];
}

interface RoundRobinMatch {
  id: string; player1: string; player2: string; winner?: string; played: boolean;
}

interface RoundRobinStanding {
  name: string; played: number; won: number; lost: number; points: number;
}

const calcStandings = (matches: RoundRobinMatch[]): RoundRobinStanding[] => {
  const map: Record<string, RoundRobinStanding> = {};
  matches.forEach((m) => {
    [m.player1, m.player2].forEach((p) => {
      if (!map[p]) map[p] = { name: p, played: 0, won: 0, lost: 0, points: 0 };
    });
    if (m.played && m.winner) {
      map[m.player1].played++;
      map[m.player2].played++;
      map[m.winner].won++;
      map[m.winner].points += 2;
      const loser = m.winner === m.player1 ? m.player2 : m.player1;
      map[loser].lost++;
    }
  });
  return Object.values(map).sort((a, b) => b.points - a.points || b.won - a.won);
};

/** Read-only round-robin standings + match list — mirrors the admin Tabelle view. */
const RoundRobinLive = ({ matches }: { matches: RoundRobinMatch[] }) => {
  const standings = calcStandings(matches);
  const unplayed = matches.filter((m) => !m.played);
  const played = matches.filter((m) => m.played);

  return (
    <div className="space-y-4">
      <div className="bg-card rounded-xl border border-border p-4">
        <h3 className="font-display text-sm uppercase text-muted-foreground mb-3">Tabelle</h3>
        <div className="grid grid-cols-[auto_1fr_repeat(4,40px)] gap-x-2 gap-y-1 text-xs">
          <span className="text-muted-foreground">#</span>
          <span className="text-muted-foreground">Spieler</span>
          <span className="text-muted-foreground text-center">Sp</span>
          <span className="text-muted-foreground text-center">S</span>
          <span className="text-muted-foreground text-center">N</span>
          <span className="text-muted-foreground text-center">Pkt</span>
          {standings.map((s, i) => (
            <div className="contents" key={s.name}>
              <span className={`font-display ${i === 0 ? "text-accent" : ""}`}>
                {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`}
              </span>
              <span className="font-semibold truncate">{s.name}</span>
              <span className="text-center">{s.played}</span>
              <span className="text-center text-secondary">{s.won}</span>
              <span className="text-center text-destructive">{s.lost}</span>
              <span className="text-center font-display text-primary">{s.points}</span>
            </div>
          ))}
        </div>
      </div>

      {unplayed.length > 0 && (
        <div className="bg-card rounded-xl border border-border p-4">
          <h3 className="font-display text-sm uppercase text-muted-foreground mb-3">Ausstehende Spiele ({unplayed.length})</h3>
          <div className="space-y-1.5">
            {unplayed.map((m) => (
              <div key={m.id} className="flex items-center justify-between bg-muted/30 rounded-lg px-3 py-2 text-sm">
                <span className="truncate uppercase tracking-wide">{m.player1} <span className="text-muted-foreground normal-case">vs</span> {m.player2}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {played.length > 0 && (
        <div className="bg-card rounded-xl border border-border p-4">
          <h3 className="font-display text-sm uppercase text-muted-foreground mb-3">Gespielte Partien ({played.length})</h3>
          <div className="space-y-1">
            {played.map((m) => (
              <div key={m.id} className="flex items-center justify-between px-3 py-1.5 text-sm">
                <span className="truncate uppercase tracking-wide">{m.player1} <span className="text-muted-foreground normal-case">vs</span> {m.player2}</span>
                <span className="text-xs text-secondary font-medium shrink-0 ml-2">{m.winner} ✓</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

const roundLabel = roundLabelFor;

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
  const [sizes, setSizes] = useState({ wrapW: 0, wrapH: 0, innerW: 0, innerH: 0 });
  const [userZoom, setUserZoom] = useState(1);

  // Large trees (Achtelfinale and earlier) get tighter cards so more fits at a readable scale.
  const compact = totalRounds >= 5;
  const liveColRef = useRef<HTMLDivElement>(null);

  // Earliest round that still has an undecided, playable match — used to auto-scroll
  // the tree to the action instead of dropping the viewer on round 1.
  const currentRound = useMemo(() => {
    const open = matches.filter(m => !m.winner && m.player1 && m.player2 && m.player1 !== "BYE" && m.player2 !== "BYE");
    if (open.length === 0) return null;
    return Math.min(...open.map(m => m.round));
  }, [matches]);

  const measure = useCallback(() => {
    if (!wrapRef.current || !innerRef.current) return;
    const wrap = wrapRef.current.getBoundingClientRect();
    const prev = innerRef.current.style.transform;
    innerRef.current.style.transform = "none";
    const inner = innerRef.current.getBoundingClientRect();
    innerRef.current.style.transform = prev;
    if (!wrap.width || !wrap.height || !inner.width || !inner.height) return;
    setSizes({ wrapW: wrap.width, wrapH: wrap.height, innerW: inner.width, innerH: inner.height });
  }, []);

  useLayoutEffect(() => { measure(); }, [measure, totalRounds, matches.length, compact]);
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

  // Fit the whole tree when it reasonably can; below a legible floor, stop shrinking
  // and let it scroll/pan instead (the "Rundenliste" toggle is the always-legible
  // fallback and is the default for big brackets, so this only affects the tree
  // when someone opts into it for a large bracket).
  const fitScale = sizes.wrapW && sizes.innerW
    ? Math.max(0.55, Math.min(sizes.wrapW / sizes.innerW, sizes.wrapH / sizes.innerH, 1))
    : 1;
  const scale = fitScale * userZoom;
  const scaledW = sizes.innerW * scale;
  const scaledH = sizes.innerH * scale;
  // Center the tree in the viewport when it fits; anchor at the origin (scrollable) when it doesn't,
  // so the watermark logo behind it is always visually centered on the actual bracket.
  const offsetX = sizes.wrapW && scaledW <= sizes.wrapW ? (sizes.wrapW - scaledW) / 2 : 0;
  const offsetY = sizes.wrapH && scaledH <= sizes.wrapH ? (sizes.wrapH - scaledH) / 2 : 0;
  // CSS transforms don't shrink an element's scrollable area — a scaled-down box that
  // visually fits would still report a giant unscaled scrollWidth/Height and trigger a
  // (redundant, nested-feeling) scrollbar. So only allow scrolling once the content
  // genuinely overflows the box (i.e. the user zoomed in past the auto-fit).
  const overflowing = sizes.wrapW > 0 && (scaledW > sizes.wrapW + 0.5 || scaledH > sizes.wrapH + 0.5);

  // Bring the live round into view instead of dropping the viewer on round 1 —
  // especially important for large trees where most of the early rounds are done.
  useEffect(() => {
    if (!liveColRef.current) return;
    const t = window.setTimeout(() => {
      liveColRef.current?.scrollIntoView({ block: "nearest", inline: "center" });
    }, 60);
    return () => window.clearTimeout(t);
  }, [currentRound, scale]);

  const renderMatch = (m: Match, side: "left" | "right" | "center", isLast: boolean) => {
    const live = !m.winner && m.player1 && m.player2 && m.player1 !== "BYE" && m.player2 !== "BYE";
    return (
      <div key={m.id} className={`bg-card border rounded-xl overflow-hidden relative ${m.winner ? "border-border" : live ? "border-primary/60 glow-cyan" : "border-border/50"}`}>
        {!isLast && side === "left" && <span aria-hidden className="absolute top-1/2 -right-4 w-4 h-px bg-border" />}
        {!isLast && side === "right" && <span aria-hidden className="absolute top-1/2 -left-4 w-4 h-px bg-border" />}
        {[m.player1, m.player2].map((player, idx) => (
          <div key={idx} className={`${compact ? "px-2 py-1.5 text-xs" : "px-3 py-2 text-sm"} flex items-center justify-between gap-2 ${idx === 0 ? "border-b border-border" : ""} ${m.winner === player ? "bg-secondary/15 text-secondary font-semibold" : player === "BYE" ? "text-muted-foreground/40" : !player ? "text-muted-foreground/40" : ""}`}>
            <span className="truncate uppercase tracking-wide">{player || "TBD"}</span>
            <span className={`font-display ${compact ? "text-sm" : "text-base"}`}>{idx === 0 ? m.score1 ?? 0 : m.score2 ?? 0}</span>
          </div>
        ))}
        {!m.winner && (m.scorekeeper || m.scorekeeperRule || m.board) && (
          <div className={`px-2 py-0.5 border-t border-border/60 bg-muted/20 flex items-center justify-between text-[9px] text-muted-foreground ${compact ? "" : "px-3 py-1 text-[10px]"}`}>
            <span className="truncate">✍️ {keeperLabel(m, matches) || "–"}</span>
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
      <div
        key={`${side}-${round}`}
        ref={side === "left" && round === currentRound ? liveColRef : undefined}
        className={`flex flex-col gap-3 ${compact ? "min-w-[170px]" : "min-w-[220px]"}`}
      >
        {roundHeader(round, side === "left" ? "left" : "right")}
        <div className={`flex flex-col justify-around flex-1 relative ${compact ? "gap-1.5" : "gap-3"}`}>
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
        <div key="final" className={`flex flex-col gap-3 justify-center ${compact ? "min-w-[190px]" : "min-w-[250px]"}`}>
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

  const prelimMatches = matches.filter(m => m.round === 0).sort((a, b) => a.position - b.position);

  return (
    <div>
      {prelimMatches.length > 0 && (
        <div className="mb-3 rounded-xl border border-border bg-card/60 p-3">
          <p className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground mb-2">
            Preliminary Round · winners advance to the main bracket
          </p>
          <div className="flex flex-wrap gap-2">
            {prelimMatches.map(m => (
              <div key={m.id} className="min-w-[180px] flex-1">{renderMatch(m, "center", true)}</div>
            ))}
          </div>
        </div>
      )}
      <div className="relative">
      <div className="absolute top-2 right-2 z-20 flex items-center gap-1 bg-card/90 backdrop-blur border border-border rounded-lg p-1">
        <button onClick={() => setUserZoom(z => Math.max(0.4, +(z - 0.15).toFixed(2)))} title="Verkleinern" aria-label="Verkleinern" className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground">
          <ZoomOut className="w-3.5 h-3.5" />
        </button>
        <button onClick={() => setUserZoom(1)} title="Auf Bildschirm einpassen" aria-label="Auf Bildschirm einpassen" className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground">
          <Maximize2 className="w-3.5 h-3.5" />
        </button>
        <button onClick={() => setUserZoom(z => Math.min(2.5, +(z + 0.15).toFixed(2)))} title="Vergrößern" aria-label="Vergrößern" className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground">
          <ZoomIn className="w-3.5 h-3.5" />
        </button>
      </div>
      <div ref={wrapRef} className={`w-full relative ${overflowing ? "overflow-auto" : "overflow-hidden"}`} style={{ height: "min(72dvh, 900px)" }}>
        <div
          ref={innerRef}
          className="relative"
          style={{ transform: `translate(${offsetX}px, ${offsetY}px) scale(${scale})`, transformOrigin: "top left", width: "max-content" }}
        >
          {/* Scales and scrolls together with the tree, so it stays centered on the bracket itself. */}
          <div aria-hidden className="pointer-events-none absolute inset-0 z-0 flex items-center justify-center overflow-hidden">
            <img src={htuEmblem} alt="" className="w-[65%] max-w-[900px] object-contain opacity-[0.07]" />
          </div>
          <div className="relative z-10 flex items-stretch gap-4 p-4">
            {body()}
          </div>
        </div>
      </div>
      </div>
    </div>
  );
};

/**
 * Round-grouped, vertically stacked match list — no scaling, no shrinking.
 * The robust fallback for phones and very large trees (e.g. 64 players):
 * always fully legible, just scroll. Covers every round, not only open matches.
 */
const BracketList = ({ matches, totalRounds, roundConfigs, fallbackMode, fallbackBestOf }: {
  matches: Match[];
  totalRounds: number;
  roundConfigs?: { mode: string; bestOf: number }[];
  fallbackMode?: string;
  fallbackBestOf?: number;
}) => {
  const hasPrelim = matches.some(m => m.round === 0);
  const rounds = [...(hasPrelim ? [0] : []), ...Array.from({ length: totalRounds }, (_, i) => i + 1)];
  return (
    <div className="space-y-3">
      {rounds.map(round => {
        const cfg = (roundConfigs || [])[round - 1];
        const list = matches.filter(m => m.round === round).sort((a, b) => a.position - b.position);
        return (
          <div key={round} className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="px-4 py-2 bg-muted/30 border-b border-border flex items-center justify-between">
              <h3 className="font-display uppercase text-sm">{roundLabel(round, totalRounds)}</h3>
              <span className="text-[10px] text-primary/80 font-mono">{cfg?.mode || fallbackMode} · BO{cfg?.bestOf || fallbackBestOf}</span>
            </div>
            <div className="divide-y divide-border">
              {list.map(m => {
                const live = !m.winner && m.player1 && m.player2 && m.player1 !== "BYE" && m.player2 !== "BYE";
                return (
                  <div key={m.id} className={`px-4 py-2.5 flex items-center gap-3 text-sm ${live ? "bg-primary/5" : ""}`}>
                    {[m.player1, m.player2].map((player, idx) => (
                      <span key={idx} className={`flex-1 min-w-0 truncate uppercase tracking-wide ${m.winner === player ? "text-secondary font-semibold" : player === "BYE" || !player ? "text-muted-foreground/40" : ""}`}>
                        {player || "TBD"}
                      </span>
                    ))}
                    <span className="shrink-0 font-display text-base tabular-nums">
                      {m.score1 ?? 0}:{m.score2 ?? 0}
                    </span>
                    {live && m.board ? (
                      <span className="shrink-0 font-mono text-[10px] bg-primary/10 text-primary rounded px-1.5 py-0.5">Board {m.board}</span>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
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
  const [view, setView] = useState<"tree" | "list">(() => (typeof window !== "undefined" && window.innerWidth < 900 ? "list" : "tree"));
  const autoViewSetRef = useRef(false);

  // A 32+ player mirrored tree can't stay legible at any scale that also fits a
  // screen — default those straight to the always-readable round list. Runs once,
  // so it never overrides a view the user picked by hand afterwards.
  useEffect(() => {
    if (autoViewSetRef.current || !t) return;
    autoViewSetRef.current = true;
    const isKoNow = t.mode !== "round-robin";
    const ms = (t.bracket as Match[]) || [];
    const rounds = isKoNow && ms.length > 0 ? Math.max(...ms.map(m => m.round)) : 0;
    if (rounds >= 5) setView("list");
  }, [t]);

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
  const boardsCount = t.boards ?? 2;

  // Board-aware look-ahead: every match already paired but not yet decided,
  // grouped by playing slot – the same "slot" the admin scheduler assigns live.
  const pending = matches
    .filter(m => !m.winner && m.player1 && m.player2 && m.player1 !== "BYE" && m.player2 !== "BYE" && m.slot !== undefined)
    .sort((a, b) => (a.slot! - b.slot!) || ((a.board ?? 0) - (b.board ?? 0)));
  const pendingSlots = [...new Set(pending.map(m => m.slot))] as number[];
  const nextSlot = pendingSlots[1]; // index 0 is "Jetzt am Board", already shown above
  const onDeck = nextSlot !== undefined ? pending.filter(m => m.slot === nextSlot) : [];
  const queuedCount = pendingSlots.length > 2 ? pending.filter(m => m.slot !== pendingSlots[0] && m.slot !== nextSlot).length : 0;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border px-4 sm:px-6 py-4 flex flex-wrap items-center justify-between gap-3 bg-gradient-to-r from-primary/10 via-transparent to-accent/10">
        <div className="flex items-center gap-3 min-w-0">
          <img src={htuLogo} alt="Logo" className="w-12 h-12 rounded-xl object-cover border border-primary/30 shrink-0" />
          <div className="min-w-0">
            <h1 className="font-display text-xl sm:text-2xl uppercase tracking-widest truncate">{t.name}</h1>
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="inline-flex items-center gap-2 shrink-0">
                <span className="inline-block h-2 w-2 rounded-full bg-secondary animate-pulse" /> Live
              </span>
              <span>{t.players.length} Spieler · {t.game_mode} BO{t.best_of_legs} · {boardsCount} Board{boardsCount > 1 ? "s" : ""}</span>
            </p>
          </div>
        </div>
        {t.champion && (
          <div className="text-right shrink-0">
            <p className="text-[10px] uppercase tracking-widest text-accent">Champion</p>
            <p className="font-display text-xl text-accent">🏆 {t.champion}</p>
          </div>
        )}
      </header>

      <div className="grid lg:grid-cols-[1fr_320px] gap-4 p-4">
        <div className="min-w-0">
          {(() => {
            const openSlots = matches.filter(m => !m.winner && m.player1 && m.player2 && m.player1 !== "BYE" && m.player2 !== "BYE" && m.slot !== undefined);
            if (openSlots.length === 0) return null;
            const minSlot = Math.min(...openSlots.map(m => m.slot!));
            const now = openSlots.filter(m => m.slot === minSlot).sort((a, b) => (a.board ?? 0) - (b.board ?? 0));
            return (
              <div className="mb-3 rounded-2xl border-2 border-primary/50 bg-gradient-to-r from-primary/15 via-card to-accent/10 p-4 glow-cyan">
                <p className="text-[11px] uppercase tracking-[0.3em] text-primary mb-2 flex items-center gap-2">
                  <span className="inline-block h-2 w-2 rounded-full bg-primary animate-pulse" /> Jetzt am Board
                </p>
                <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-2">
                  {now.map(m => (
                    <div key={m.id} className="rounded-xl bg-background/60 border border-border px-3 py-2">
                      <p className="font-display text-lg uppercase truncate">{m.player1} <span className="text-muted-foreground text-sm normal-case">vs</span> {m.player2}</p>
                      <p className="text-xs text-muted-foreground flex items-center gap-2">
                        <span className="font-mono text-primary">Board {m.board ?? "?"}</span>
                        <span>✍️ {keeperLabel(m, matches) || "–"}</span>
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}
          {isKo && (
            <div className="mb-2 inline-flex rounded-lg border border-border overflow-hidden">
              <button onClick={() => setView("tree")} className={`px-3 py-1.5 text-xs flex items-center gap-1 ${view === "tree" ? "bg-primary text-primary-foreground" : "hover:bg-muted text-muted-foreground"}`}>
                <Network className="w-3.5 h-3.5" /> Turnierbaum
              </button>
              <button onClick={() => setView("list")} className={`px-3 py-1.5 text-xs flex items-center gap-1 ${view === "list" ? "bg-primary text-primary-foreground" : "hover:bg-muted text-muted-foreground"}`}>
                <Rows3 className="w-3.5 h-3.5" /> Rundenliste
              </button>
            </div>
          )}
          {isKo ? (
            view === "tree" ? (
              <LiveBracket
                matches={matches}
                totalRounds={totalRounds}
                roundConfigs={t.round_configs}
                fallbackMode={t.game_mode}
                fallbackBestOf={t.best_of_legs}
              />
            ) : (
              <BracketList
                matches={matches}
                totalRounds={totalRounds}
                roundConfigs={t.round_configs}
                fallbackMode={t.game_mode}
                fallbackBestOf={t.best_of_legs}
              />
            )
          ) : (
            <RoundRobinLive matches={t.bracket as unknown as RoundRobinMatch[]} />
          )}
        </div>

        <aside className="flex flex-col gap-4 lg:sticky lg:top-4 self-start">
          {isKo && (
            <div className="bg-card border border-border rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <ListOrdered className="w-4 h-4 text-primary" />
                  <h3 className="font-display uppercase text-sm">Als Nächstes</h3>
                </div>
                <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                  <Monitor className="w-3 h-3" /> {boardsCount}
                </span>
              </div>
              {onDeck.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  {pendingSlots.length === 0 ? "Noch keine Paarungen feststehend." : "Alle bekannten Paarungen laufen bereits."}
                </p>
              ) : (
                <>
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5">
                    {roundLabel(onDeck[0].round, totalRounds)}
                  </p>
                  <ul className="space-y-1.5">
                    {onDeck.map(m => (
                      <li key={m.id} className="flex items-center gap-2 text-xs bg-muted/30 rounded-lg px-2.5 py-1.5">
                        <span className="font-mono text-[10px] bg-primary/10 text-primary rounded px-1.5 py-0.5 shrink-0">
                          Board {m.board ?? "?"}
                        </span>
                        <span className="truncate uppercase tracking-wide">
                          {m.player1} <span className="text-muted-foreground normal-case">vs</span> {m.player2}
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {queuedCount > 0 && (
                <p className="mt-2.5 pt-2 border-t border-border/60 text-[10px] uppercase tracking-widest text-muted-foreground">
                  +{queuedCount} weitere Partie{queuedCount > 1 ? "n" : ""} in der Warteschlange
                </p>
              )}
            </div>
          )}

          <div className="bg-card border border-border rounded-xl p-4">
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
                    <p className="font-display text-sm uppercase">
                      <span className="text-secondary">{m.winner}</span>
                      <span className="text-muted-foreground normal-case"> schlägt </span>
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
          </div>
        </aside>
      </div>

      {flash && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-slide-up">
          <div className="rounded-2xl border-2 border-accent bg-card/95 backdrop-blur px-8 py-5 text-center glow-gold shadow-2xl">
            <p className="text-[11px] uppercase tracking-[0.3em] text-accent mb-1">Ergebnis · {roundLabel(flash.round, totalRounds)}</p>
            <p className="font-display text-3xl uppercase">
              <span className="text-secondary">{flash.winner}</span>
              <span className="text-muted-foreground text-lg"> schlägt </span>
              {flash.winner === flash.player1 ? flash.player2 : flash.player1}
            </p>
            <p className="font-display text-xl text-primary mt-1">{flash.score1 ?? 0} : {flash.score2 ?? 0}</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default PublicTournamentPage;