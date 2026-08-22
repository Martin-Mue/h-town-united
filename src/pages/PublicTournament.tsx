import { useEffect, useState, useRef, useMemo, useCallback } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Trophy, Users, Loader2, Radio, Zap, ListOrdered, Monitor, ZoomIn, ZoomOut, Maximize2, Minimize2, Network, Rows3, PenLine, RefreshCcw, Target, Settings2, Check } from "lucide-react";
import { computeTournamentHighlights, computeTournamentAverages, type TournamentHighlights, type TournamentAverages, type TournamentStatsLegRow, type TournamentStatsGameRow } from "@/utils/tournamentStats";
import TournamentHighlightsPanel from "@/components/tournament/TournamentHighlightsPanel";
import {
  roundLabelFor,
  currentBoardSchedule,
  calcStandings,
  isLiveSnapshotFresh,
  scorekeeperLabel as keeperLabel,
  isRealPlayer,
  isPlayable,
  totalRoundsOf,
  type Match,
  type RoundRobinMatch,
  type RoundRobinStanding,
  type LiveSnapshot,
} from "@/utils/tournament";
import AnimatedScore from "@/components/AnimatedScore";
import { useLanguage } from "@/contexts/LanguageContext";
import { getCheckoutSuggestion } from "@/utils/checkoutTable";
import htuLogo from "@/assets/htu-logo.jpg";
import htuEmblem from "@/assets/club-emblem.png";

interface TournamentRow {
  id: string; name: string; mode: string; status: string;
  champion: string | null; players: string[]; bracket: Match[];
  game_mode?: string; best_of_legs?: number; boards?: number;
  round_configs?: { mode: string; bestOf: number }[];
}

/** Read-only round-robin standings + match list — mirrors the admin Tabelle view. */
const RoundRobinLive = ({ matches }: { matches: RoundRobinMatch[] }) => {
  const { t } = useLanguage();
  const standings = calcStandings(matches);
  const unplayed = matches.filter((m) => !m.played);
  const played = matches.filter((m) => m.played);

  return (
    <div className="space-y-4">
      <div className="bg-card rounded-xl border border-border p-4">
        <h3 className="font-display text-sm uppercase text-muted-foreground mb-3">{t("tournament.standingsTable")}</h3>
        <div className="grid grid-cols-[auto_1fr_repeat(4,40px)] gap-x-2 gap-y-1 text-xs">
          <span className="text-muted-foreground">#</span>
          <span className="text-muted-foreground">{t("stats.player")}</span>
          <span className="text-muted-foreground text-center">{t("tournament.playedAbbrev")}</span>
          <span className="text-muted-foreground text-center">{t("tournament.wonAbbrev")}</span>
          <span className="text-muted-foreground text-center">{t("tournament.lostAbbrev")}</span>
          <span className="text-muted-foreground text-center">{t("tournament.pointsAbbrev")}</span>
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
          <h3 className="font-display text-sm uppercase text-muted-foreground mb-3">{t("tournament.upcomingMatches")} ({unplayed.length})</h3>
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
          <h3 className="font-display text-sm uppercase text-muted-foreground mb-3">{t("tournament.playedMatches")} ({played.length})</h3>
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

/** Mirrored, auto-fitting bracket — identical layout to the admin view, read-only. */
const LiveBracket = ({ matches, totalRounds, roundConfigs, fallbackMode, fallbackBestOf }: {
  matches: Match[];
  totalRounds: number;
  roundConfigs?: { mode: string; bestOf: number }[];
  fallbackMode?: string;
  fallbackBestOf?: number;
}) => {
  const { t } = useLanguage();
  const roundLabel = (round: number, total: number) => roundLabelFor(round, total, t);
  // v2 — no continuous auto-measurement. The old version re-measured the tree on every
  // resize/orientation change and multiplied a computed "fit" scale into the zoom, which
  // depended on layout having fully settled at exactly the right moment; when it hadn't
  // (slow font load, a mid-animation resize, a stale ResizeObserver tick), the tree would
  // render at the wrong scale — the "gets worse sometimes" bug. Now: fixed, always-legible
  // scale by default (compact mode already shrinks cards for big trees), native scroll in
  // both directions for anything that overflows, and manual zoom for when someone wants it —
  // predictable everywhere instead of "usually right".
  const wrapRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [userZoom, setUserZoom] = useState(1);

  // Large trees (Achtelfinale and earlier) get tighter cards so more fits at a readable scale.
  const compact = totalRounds >= 5;
  const liveColRef = useRef<HTMLDivElement>(null);

  // Earliest round that still has an undecided, playable match — used to auto-scroll
  // the tree to the action instead of dropping the viewer on round 1.
  const currentRound = useMemo(() => {
    const open = matches.filter(m => !m.winner && isPlayable(m));
    if (open.length === 0) return null;
    return Math.min(...open.map(m => m.round));
  }, [matches]);

  // On-demand only (not a background process): computes a zoom level that fits the whole
  // tree in the visible area right now, once, when the button is tapped.
  const fitToScreen = () => {
    const wrap = wrapRef.current?.getBoundingClientRect();
    const inner = innerRef.current?.getBoundingClientRect();
    if (!wrap?.width || !wrap.height || !inner?.width || !inner.height) return;
    const trueW = inner.width / userZoom;
    const trueH = inner.height / userZoom;
    if (!trueW || !trueH) return;
    setUserZoom(+Math.max(0.4, Math.min(wrap.width / trueW, wrap.height / trueH, 2.5)).toFixed(2));
  };

  // Bring the live round into view instead of dropping the viewer on round 1 —
  // especially important for large trees where most of the early rounds are done.
  useEffect(() => {
    if (!liveColRef.current) return;
    const t = window.setTimeout(() => {
      liveColRef.current?.scrollIntoView({ block: "nearest", inline: "center" });
    }, 60);
    return () => window.clearTimeout(t);
  }, [currentRound]);

  // Auto-fit once, the first time there's real content to measure — deliberately NOT the old
  // v1 behaviour (see the comment atop this component) of re-measuring on every resize and
  // multiplying a computed scale into the existing zoom, which is what made the tree render at
  // the wrong scale unpredictably. This is a single absolute computation (same fitToScreen the
  // manual button uses), gated by autoFittedRef so it never fights a zoom a viewer has since set
  // themselves. Waits for web fonts — card text width depends on them, and a fit measured
  // against the fallback font before they load lands slightly wrong. Spectators open this link
  // cold on whatever device they have (phone in portrait, tablet, desktop) with no chance to
  // discover the manual zoom controls first, so getting the first paint right matters most here.
  const autoFittedRef = useRef(false);
  useEffect(() => {
    if (autoFittedRef.current || matches.length === 0) return;
    autoFittedRef.current = true;
    let cancelled = false;
    const runFit = () => {
      if (cancelled) return;
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (!cancelled) fitToScreen();
      }));
    };
    if (typeof document !== "undefined" && document.fonts?.ready) {
      document.fonts.ready.then(runFit);
    } else {
      runFit();
    }
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matches.length]);

  // Re-fit once after an orientation change (not a generic `resize` listener — that fires
  // continuously on mobile from address-bar show/hide while scrolling, exactly the flakiness
  // the v1 approach ran into). A rotation genuinely changes which scale fits, so this
  // deliberately overrides any zoom the viewer had set for the old orientation.
  useEffect(() => {
    const onOrientation = () => { window.setTimeout(fitToScreen, 200); };
    window.addEventListener("orientationchange", onOrientation);
    return () => window.removeEventListener("orientationchange", onOrientation);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const renderMatch = (m: Match, side: "left" | "right" | "center", isLast: boolean) => {
    // `playable` (both players known, no winner yet) used to be the ONLY signal driving both
    // the glow AND the label "live" — meaning a match nobody had actually started yet, just
    // waiting for a free board, glowed exactly the same as one being played right now. Playable
    // still earns the glow (it's genuinely "ready to go" and worth a glance), but the real
    // in-progress state now gets its own distinct accent pulse + live leg count, same as
    // Tournament.tsx's own bracket already does for the organizer.
    const playable = !m.winner && isPlayable(m);
    const liveFresh = playable && isLiveSnapshotFresh(m.live);
    return (
      <div key={m.id} className={`bg-card border rounded-xl overflow-hidden relative ${m.winner ? "border-border" : playable ? "border-primary/60 glow-cyan" : "border-border/50"}`}>
        {!isLast && side === "left" && <span aria-hidden className="absolute top-1/2 -right-4 w-4 h-px bg-border" />}
        {!isLast && side === "right" && <span aria-hidden className="absolute top-1/2 -left-4 w-4 h-px bg-border" />}
        {[m.player1, m.player2].map((player, idx) => (
          <div key={idx} className={`${compact ? "px-2 py-1.5 text-xs" : "px-3 py-2 text-sm"} flex items-center justify-between gap-2 ${idx === 0 ? "border-b border-border" : ""} ${m.winner === player ? "bg-secondary/15 text-secondary font-semibold" : !isRealPlayer(player) ? "text-muted-foreground/40" : ""}`}>
            <span className="truncate uppercase tracking-wide">{player || "TBD"}</span>
            <span className={`font-display ${compact ? "text-sm" : "text-base"} ${liveFresh ? "text-accent" : ""}`}>
              {liveFresh ? (idx === 0 ? m.live!.legs1 : m.live!.legs2) : (idx === 0 ? m.score1 ?? 0 : m.score2 ?? 0)}
            </span>
          </div>
        ))}
        {!m.winner && (m.scorekeeper || m.scorekeeperRule || m.board || liveFresh) && (
          <div className={`px-2 py-0.5 border-t border-border/60 bg-muted/20 flex items-center justify-between text-[9px] text-muted-foreground ${compact ? "" : "px-3 py-1 text-[10px]"}`}>
            <span className="truncate">✍️ {keeperLabel(m, matches) || "–"}</span>
            <span className="flex items-center gap-2 shrink-0">
              {liveFresh && (
                <span className="flex items-center gap-1 text-accent">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent animate-pulse" /> {t("tournament.live")}
                </span>
              )}
              {m.board ? <span className="font-mono">{t("camera.board")} {m.board}</span> : null}
            </span>
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
            {t("tournament.preliminaryRound")}
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
        <button onClick={() => setUserZoom(z => Math.max(0.4, +(z - 0.15).toFixed(2)))} title={t("tournament.zoomOut")} aria-label={t("tournament.zoomOut")} className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground">
          <ZoomOut className="w-3.5 h-3.5" />
        </button>
        <button onClick={fitToScreen} title={t("tournament.fitToScreen")} aria-label={t("tournament.fitToScreen")} className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground">
          <Maximize2 className="w-3.5 h-3.5" />
        </button>
        <button onClick={() => setUserZoom(z => Math.min(2.5, +(z + 0.15).toFixed(2)))} title={t("tournament.zoomIn")} aria-label={t("tournament.zoomIn")} className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground">
          <ZoomIn className="w-3.5 h-3.5" />
        </button>
      </div>
      {/* Always scrollable in both directions (native scroll, not a computed "should it
          scroll" guess) — the reliable fallback for anything zoom doesn't fit on screen. */}
      <div ref={wrapRef} className="w-full relative overflow-auto" style={{ height: "min(72dvh, 900px)", touchAction: "pan-x pan-y pinch-zoom" }}>
        <div
          ref={innerRef}
          className="relative"
          style={{ transform: `scale(${userZoom})`, transformOrigin: "top left", width: "max-content" }}
        >
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
  const { t } = useLanguage();
  const roundLabel = (round: number, total: number) => roundLabelFor(round, total, t);
  const hasPrelim = matches.some(m => m.round === 0);
  const rounds = [...(hasPrelim ? [0] : []), ...Array.from({ length: totalRounds }, (_, i) => i + 1)];

  return (
    <div className="space-y-2">
      {rounds.map(round => {
        const cfg = (roundConfigs || [])[round - 1];
        const list = matches.filter(m => m.round === round).sort((a, b) => a.position - b.position);
        // Splits PER MATCH, not per round — with up to 64 players (32 first-round matches) the
        // old always-everything-at-full-size layout couldn't fit on screen during the live-view
        // rotation's ~15s per view, forcing a scroll nobody has time for. A match actually worth
        // watching right now (undecided + playable — the same `live` check each row already
        // computed) keeps the full one-row treatment; everything else (already decided, or still
        // waiting on an earlier round to feed it players) collapses to a dense grid — so a huge
        // first round visibly shrinks match-by-match as it's actually played, not just once the
        // entire round happens to finish.
        const liveList = list.filter(m => !m.winner && isPlayable(m));
        const otherList = list.filter(m => m.winner || !isPlayable(m));
        return (
          <div key={round} className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="px-4 py-2 bg-muted/30 border-b border-border flex items-center justify-between">
              <h3 className="font-display uppercase text-sm">{roundLabel(round, totalRounds)}</h3>
              <span className="text-[10px] text-primary/80 font-mono">{cfg?.mode || fallbackMode} · BO{cfg?.bestOf || fallbackBestOf}</span>
            </div>
            {liveList.length > 0 && (
              <div className="divide-y divide-border">
                {liveList.map(m => {
                  // Same distinction as LiveBracket's renderMatch — "playable" (this row's own
                  // membership test) just means ready to go, not actually being played right
                  // now. Show the real leg count once a live snapshot is actually fresh, the
                  // static 0:0 placeholder otherwise, so a match still waiting for a board
                  // doesn't look like it's already underway.
                  const liveFresh = isLiveSnapshotFresh(m.live);
                  return (
                    <div key={m.id} className="px-4 py-2.5 flex items-center gap-3 text-sm bg-primary/5">
                      {[m.player1, m.player2].map((player, idx) => (
                        <span key={idx} className={`flex-1 min-w-0 truncate uppercase tracking-wide ${m.winner === player ? "text-secondary font-semibold" : !isRealPlayer(player) ? "text-muted-foreground/40" : ""}`}>
                          {player || "TBD"}
                        </span>
                      ))}
                      <span className={`shrink-0 font-display text-base tabular-nums ${liveFresh ? "text-accent" : ""}`}>
                        {liveFresh ? `${m.live!.legs1}:${m.live!.legs2}` : `${m.score1 ?? 0}:${m.score2 ?? 0}`}
                      </span>
                      {liveFresh && (
                        <span className="shrink-0 flex items-center gap-1 text-[10px] text-accent">
                          <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent animate-pulse" /> {t("tournament.live")}
                        </span>
                      )}
                      {m.board ? (
                        <span className="shrink-0 font-mono text-[10px] bg-primary/10 text-primary rounded px-1.5 py-0.5">{t("camera.board")} {m.board}</span>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
            {otherList.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-1 p-1.5">
                {otherList.map(m => (
                  <div key={m.id} className="rounded-lg bg-muted/20 px-2 py-1 text-xs min-w-0">
                    {[m.player1, m.player2].map((player, idx) => (
                      <p key={idx} className={`truncate uppercase tracking-wide leading-tight ${m.winner === player ? "text-secondary font-semibold" : !isRealPlayer(player) ? "text-muted-foreground/40" : "text-muted-foreground"}`}>
                        {player || "TBD"}
                      </p>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

/** Normalized shape both KO matches and round-robin matches get mapped into before
 *  reaching `BoardOverview` — keeps that component free of KO-vs-round-robin branching. */
interface BoardCard {
  id: string;
  board: number;
  player1: string;
  player2: string;
  score1: number;
  score2: number;
  /** KO only — round-robin has no round concept. */
  round?: number;
  /** KO only — round-robin has no scorekeeper assignment. */
  scorekeeper?: string | null;
  /** Present + fresh while someone's playing this match live via "Spiel starten". */
  live?: LiveSnapshot;
}

const koToBoardCards = (entries: { board: number; match: Match }[], allMatches: Match[]): BoardCard[] =>
  entries.map(({ board, match: m }) => ({
    id: m.id, board, player1: m.player1 || "?", player2: m.player2 || "?",
    score1: m.score1 ?? 0, score2: m.score2 ?? 0, round: m.round,
    scorekeeper: keeperLabel(m, allMatches), live: m.live,
  }));

/** Round-robin has no persisted board/slot scheduling (unlike KO matches) — this just
 *  fills the configured board count with the next pending matches in list order, purely
 *  for display. Good enough for "what's roughly playing where" without a real scheduler. */
function roundRobinBoardCards(matches: RoundRobinMatch[], boards: number): { now: BoardCard[]; onDeck: BoardCard[]; queuedCount: number } {
  const pending = matches.filter((m) => !m.played);
  const toCards = (list: RoundRobinMatch[]) => list.map((m, i): BoardCard => ({ id: m.id, board: i + 1, player1: m.player1, player2: m.player2, score1: 0, score2: 0, live: m.live }));
  const now = toCards(pending.slice(0, boards));
  const onDeck = toCards(pending.slice(boards, boards * 2));
  const queuedCount = Math.max(0, pending.length - now.length - onDeck.length);
  return { now, onDeck, queuedCount };
}

/** Live checkout-route callout for the board-overview cards — the same "what do they need"
 *  suggestion the in-game CheckoutSuggestion component shows the player themselves, surfaced to
 *  spectators too. Only ever a suggestion (there are usually several valid routes); shows
 *  nothing once a player's remaining score can't be finished in 3 darts under double-out. */
const CheckoutBadges = ({ player1, player2, live }: { player1: string; player2: string; live?: LiveSnapshot }) => {
  const badges: { name: string; route: string[] }[] = [];
  if (typeof live?.remaining1 === "number") {
    const route = getCheckoutSuggestion(live.remaining1);
    if (route) badges.push({ name: player1, route });
  }
  if (typeof live?.remaining2 === "number") {
    const route = getCheckoutSuggestion(live.remaining2);
    if (route) badges.push({ name: player2, route });
  }
  if (badges.length === 0) return null;
  return (
    <div className="mt-1.5 space-y-1">
      {badges.map((b) => (
        <p key={b.name} className="text-[clamp(0.6rem,0.95vw,0.75rem)] text-accent flex items-center gap-1.5">
          <span className="shrink-0">🎯 {b.name}:</span>
          <span className="font-mono">{b.route.join(" ")}</span>
        </p>
      ))}
    </div>
  );
};

/**
 * Full-bleed, large-type board grid for TV/projector mirroring at club nights — shows
 * every board's current pairing + last known leg score at a glance from across the room,
 * alongside tablets showing the same view up close. Sizes fluidly via CSS clamp() instead
 * of fixed breakpoints so it stays legible whether mirrored to a 10" tablet or a 65" TV.
 */
const BoardOverview = ({
  now, onDeck, queuedCount, totalRounds,
}: {
  now: BoardCard[];
  onDeck: BoardCard[];
  queuedCount: number;
  totalRounds: number;
}) => {
  const { t } = useLanguage();

  return (
    <div className="p-4 sm:p-6 bg-background min-h-[60vh]">
      <div className="flex items-center justify-between mb-4">
        <p className="text-[clamp(0.7rem,1.2vw,0.9rem)] uppercase tracking-[0.3em] text-primary flex items-center gap-2">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-primary animate-pulse" /> {t("pt.boardOverview")} · {t("tournament.live")}
        </p>
      </div>

      {now.length === 0 ? (
        <p className="text-[clamp(1rem,2vw,1.5rem)] text-muted-foreground text-center py-12">
          {t("pt.noOngoingMatches")}
        </p>
      ) : (
        <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, 320px), 1fr))` }}>
          {now.map((c) => (
            <div key={c.id} className="rounded-2xl border-2 border-primary/50 bg-gradient-to-br from-primary/10 via-card to-accent/5 p-4 sm:p-6 glow-cyan">
              <div className="flex items-center justify-between mb-3">
                <span className="font-display text-[clamp(1.1rem,2vw,1.6rem)] text-primary">{t("camera.board")} {c.board}</span>
                {c.round !== undefined && <span className="text-[clamp(0.65rem,1vw,0.8rem)] uppercase tracking-widest text-muted-foreground">{roundLabelFor(c.round, totalRounds, t)}</span>}
              </div>
              <p className="font-display uppercase leading-tight text-[clamp(1.3rem,3.2vw,2.4rem)]">
                {c.player1}
                <span className="block text-muted-foreground text-[clamp(0.8rem,1.6vw,1.1rem)] normal-case my-0.5">vs</span>
                {c.player2}
              </p>
              <div className="flex items-center justify-between mt-3 pt-3 border-t border-border/60">
                <span className="font-display text-[clamp(1.4rem,2.6vw,2rem)] text-secondary">
                  <AnimatedScore value={c.score1} /> : <AnimatedScore value={c.score2} />
                </span>
                {c.scorekeeper !== undefined && (
                  <span className="text-[clamp(0.7rem,1.1vw,0.9rem)] text-muted-foreground flex items-center gap-1">
                    <PenLine className="w-3.5 h-3.5" /> {c.scorekeeper || "–"}
                  </span>
                )}
              </div>
              {isLiveSnapshotFresh(c.live) && (
                <div className="mt-2 rounded-lg bg-destructive/10 border border-destructive/30 px-2.5 py-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[clamp(0.65rem,1vw,0.8rem)] uppercase tracking-widest text-destructive flex items-center gap-1.5">
                      <span className="inline-block h-1.5 w-1.5 rounded-full bg-destructive animate-pulse" /> {t("tournament.live")}
                    </span>
                    <span className="font-display text-[clamp(1rem,1.8vw,1.4rem)]">
                      <AnimatedScore value={c.live!.remaining1 ?? 0} /> : <AnimatedScore value={c.live!.remaining2 ?? 0} />
                    </span>
                  </div>
                  <CheckoutBadges player1={c.player1} player2={c.player2} live={c.live} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {onDeck.length > 0 && (
        <div className="mt-6">
          <p className="text-[clamp(0.7rem,1.1vw,0.85rem)] uppercase tracking-widest text-muted-foreground mb-2">{t("pt.upNext")}</p>
          <div className="flex flex-wrap gap-2">
            {onDeck.map((c) => (
              <div key={c.id} className="rounded-xl border border-border bg-card/60 px-3 py-2 flex items-center gap-2">
                <span className="font-mono text-[clamp(0.65rem,1vw,0.8rem)] bg-primary/10 text-primary rounded px-1.5 py-0.5 shrink-0">{t("camera.board")} {c.board}</span>
                <span className="text-[clamp(0.85rem,1.4vw,1.05rem)] uppercase tracking-wide">
                  {c.player1} <span className="text-muted-foreground normal-case">vs</span> {c.player2}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
      {queuedCount > 0 && (
        <p className="mt-3 text-[clamp(0.65rem,1vw,0.8rem)] uppercase tracking-widest text-muted-foreground">
          +{queuedCount} {t("pt.moreMatchesQueued")}
        </p>
      )}
    </div>
  );
};

// A device showing this page (a TV, a tablet propped up at the entrance) often never
// gets touched again after setup, so the chosen view/rotation has to survive a reload on
// its own — persisted per-device in localStorage, with the URL's `?view=` taking priority
// so one link/QR code can pin a specific screen to a specific view regardless of history.
const VIEW_PREF_KEY = "dart-live-view-pref";
const AUTO_ROTATE_PREF_KEY = "dart-live-autorotate-pref";
const AUTO_ROTATE_MS = 15000;
/** Which of the 4 rotation-eligible slots ("bracket" covers both tree and list — they're two
 *  presentations of the same data, never both in the rotation at once) auto-rotate should cycle
 *  through. Persisted per-device like the view/autorotate prefs above; defaults to everything on
 *  so an existing device's behavior doesn't change until someone deliberately narrows it down. */
type RotationSlot = "boards" | "bracket" | "participants" | "highlights";
const ROTATION_ORDER: RotationSlot[] = ["boards", "bracket", "participants", "highlights"];
const ROTATION_SLOTS_PREF_KEY = "dart-live-rotation-slots";
const DEFAULT_ROTATION_SLOTS: Record<RotationSlot, boolean> = { boards: true, bracket: true, participants: true, highlights: true };

const PublicTournamentPage = () => {
  const { slug } = useParams<{ slug: string }>();
  // Aliased to `tr` (not the usual `t`) — this component already uses `t` for the tournament
  // record itself (a name from long before this page had any translations, too widely
  // referenced below to rename instead).
  const { t: tr } = useLanguage();
  const [t, setT] = useState<TournamentRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [flash, setFlash] = useState<Match | null>(null);
  const seenResults = useRef<Set<string> | null>(null);
  const flashTimer = useRef<number | null>(null);
  // One shared fullscreen wrapper around the toolbar + whichever view is active, instead of
  // each view (tree/list/participants/highlights) reimplementing its own Fullscreen API glue —
  // BoardOverview used to be the only one with this, now every rotation slot gets it uniformly
  // for free from a single toggle. Excludes the page <header> (logo/title) on purpose, so
  // fullscreen spends its space on the actual content, not branding chrome.
  const viewWrapRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  useEffect(() => {
    const onChange = () => setIsFullscreen(document.fullscreenElement === viewWrapRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);
  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined);
    else viewWrapRef.current?.requestFullscreen().catch(() => undefined);
  };
  // A QR code can deep-link straight to a specific view (?view=boards|tree|list|auto) —
  // handy for a TV/projector screen's own corner QR, or one printed specifically for a
  // board. Falls back to this device's last manually-picked view, then the usual default.
  const urlView = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("view") : null;
  const hadExplicitViewPref =
    urlView === "boards" || urlView === "tree" || urlView === "list" || urlView === "participants" || urlView === "highlights" || urlView === "auto" ||
    (typeof window !== "undefined" && !!window.localStorage.getItem(VIEW_PREF_KEY));
  const [view, setViewRaw] = useState<"tree" | "list" | "boards" | "participants" | "highlights">(() => {
    if (typeof window === "undefined") return "tree";
    if (urlView === "boards" || urlView === "tree" || urlView === "list" || urlView === "participants" || urlView === "highlights") return urlView;
    const stored = window.localStorage.getItem(VIEW_PREF_KEY);
    if (stored === "boards" || stored === "tree" || stored === "list" || stored === "participants" || stored === "highlights") return stored;
    return window.innerWidth < 900 ? "list" : "tree";
  });
  const [rotationSlots, setRotationSlots] = useState<Record<RotationSlot, boolean>>(() => {
    if (typeof window === "undefined") return DEFAULT_ROTATION_SLOTS;
    try {
      const stored = window.localStorage.getItem(ROTATION_SLOTS_PREF_KEY);
      if (!stored) return DEFAULT_ROTATION_SLOTS;
      const parsed = JSON.parse(stored);
      return { ...DEFAULT_ROTATION_SLOTS, ...parsed };
    } catch { return DEFAULT_ROTATION_SLOTS; }
  });
  const [showRotationSettings, setShowRotationSettings] = useState(false);
  const toggleRotationSlot = (slot: RotationSlot) => {
    setRotationSlots((prev) => {
      const next = { ...prev, [slot]: !prev[slot] };
      if (typeof window !== "undefined") window.localStorage.setItem(ROTATION_SLOTS_PREF_KEY, JSON.stringify(next));
      return next;
    });
  };
  const [tournamentHighlights, setTournamentHighlights] = useState<TournamentHighlights | null>(null);
  const [tournamentAverages, setTournamentAverages] = useState<TournamentAverages | null>(null);
  const [autoRotate, setAutoRotateRaw] = useState(() => {
    if (typeof window === "undefined") return false;
    if (urlView === "auto") return true;
    if (urlView) return false; // an explicit non-auto view param always wins over a stored rotation preference
    return window.localStorage.getItem(AUTO_ROTATE_PREF_KEY) === "1";
  });
  // Remembers which bracket view (tree/list) to rotate back to — auto-rotation alternates
  // between "the bracket" and "boards" rather than cycling tree→list→boards→tree, so each
  // screen stays up long enough to actually read.
  const bracketViewRef = useRef<"tree" | "list">(view === "list" ? "list" : "tree");
  const autoViewSetRef = useRef(false);

  /** User-driven view change — persists the pick and turns off auto-rotate (picking a
   *  view by hand means "show me this now", not "keep rotating"). */
  const selectView = (next: "tree" | "list" | "boards" | "participants" | "highlights") => {
    if (next === "tree" || next === "list") bracketViewRef.current = next;
    setViewRaw(next);
    setAutoRotateRaw(false);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(VIEW_PREF_KEY, next);
      window.localStorage.setItem(AUTO_ROTATE_PREF_KEY, "0");
    }
  };

  const toggleAutoRotate = () => {
    const next = !autoRotate;
    setAutoRotateRaw(next);
    if (typeof window !== "undefined") window.localStorage.setItem(AUTO_ROTATE_PREF_KEY, next ? "1" : "0");
  };

  /** Anonymous spectators can't read games/game_legs directly (authenticated-only RLS) — this
   *  goes through the public_tournament_highlights RPC instead, which is gated on the same
   *  public_view flag tournaments_public already uses (see its migration for the full reasoning).
   *  The RPC piggybacks each game's average columns onto every one of its leg rows (one RPC, not
   *  two) — de-duplicate by game_id before handing them to computeTournamentAverages, which
   *  expects one row per game. Shared by the Highlights panel and the participants rotation view
   *  — there's no cheaper "averages only" endpoint for anonymous spectators, so both draw on the
   *  same one-time fetch instead of hitting the RPC twice. */
  const loadHighlightsAndAverages = useCallback(async (tournamentId: string) => {
    const { data } = await supabase.rpc("public_tournament_highlights", { _tournament_id: tournamentId });
    const rows = (data || []) as unknown as (TournamentStatsLegRow & {
      game_id: string; player1_id: string | null; player1_name: string; player1_average: number;
      player2_id: string | null; player2_name: string; player2_average: number;
    })[];
    setTournamentHighlights(computeTournamentHighlights(rows));
    const gamesByGameId = new Map<string, TournamentStatsGameRow>();
    rows.forEach((r) => {
      if (!gamesByGameId.has(r.game_id)) {
        gamesByGameId.set(r.game_id, {
          id: r.game_id,
          player1_id: r.player1_id, player1_name: r.player1_name, player1_average: r.player1_average,
          player2_id: r.player2_id, player2_name: r.player2_name, player2_average: r.player2_average,
        });
      }
    });
    setTournamentAverages(computeTournamentAverages([...gamesByGameId.values()]));
  }, []);

  // Only when the participants or highlights view is actually (or about to be, via rotation) on
  // screen — most spectators just watch the board/bracket view and never touch either of the
  // stats surfaces, so firing this RPC unconditionally for every page load would be a lot of
  // wasted per-dart throw data fetched for nothing on what's often a multi-viewer live-event page.
  useEffect(() => {
    if (!t || tournamentAverages) return;
    const willShowStats = view === "participants" || view === "highlights" || (autoRotate && (rotationSlots.participants || rotationSlots.highlights));
    if (!willShowStats) return;
    loadHighlightsAndAverages(t.id);
  }, [t, tournamentAverages, view, autoRotate, rotationSlots, loadHighlightsAndAverages]);

  /** The slot a given `view` value belongs to — tree/list both count as "bracket" since they're
   *  two presentations of the same data, never independently rotation-eligible. */
  const slotOf = (v: "tree" | "list" | "boards" | "participants" | "highlights"): RotationSlot =>
    v === "boards" ? "boards" : v === "participants" ? "participants" : v === "highlights" ? "highlights" : "bracket";
  const viewForSlot = (slot: RotationSlot): "tree" | "list" | "boards" | "participants" | "highlights" =>
    slot === "boards" ? "boards" : slot === "participants" ? "participants" : slot === "highlights" ? "highlights" : bracketViewRef.current;

  useEffect(() => {
    if (!autoRotate) return;
    const enabledSlots = ROTATION_ORDER.filter((s) => rotationSlots[s]);
    if (enabledSlots.length === 0) return;
    const id = window.setInterval(() => {
      setViewRaw((v) => {
        const curIdx = enabledSlots.indexOf(slotOf(v));
        const nextSlot = enabledSlots[(curIdx + 1) % enabledSlots.length];
        return viewForSlot(nextSlot);
      });
    }, AUTO_ROTATE_MS);
    return () => window.clearInterval(id);
  }, [autoRotate, rotationSlots]);

  // If the currently-shown view's slot gets unchecked while auto-rotating, jump to the next
  // enabled one immediately instead of waiting out the rest of the interval on a now-excluded view.
  useEffect(() => {
    if (!autoRotate) return;
    if (rotationSlots[slotOf(view)]) return;
    const enabledSlots = ROTATION_ORDER.filter((s) => rotationSlots[s]);
    if (enabledSlots.length > 0) setViewRaw(viewForSlot(enabledSlots[0]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rotationSlots, autoRotate]);

  // A 32+ player mirrored tree can't stay legible at any scale that also fits a
  // screen — default those straight to the always-readable round list. Only applies when
  // nothing already chose a view explicitly (URL param or a remembered device preference),
  // and runs once so it never overrides a view picked by hand afterwards.
  useEffect(() => {
    if (autoViewSetRef.current || !t || hadExplicitViewPref) return;
    autoViewSetRef.current = true;
    const isKoNow = t.mode !== "round-robin";
    const ms = (t.bracket as Match[]) || [];
    const rounds = isKoNow && ms.length > 0 ? Math.max(...ms.map(m => m.round)) : 0;
    if (rounds >= 5) { setViewRaw("list"); bracketViewRef.current = "list"; }
  }, [t, hadExplicitViewPref]);

  useEffect(() => {
    if (!t) return;
    const done = (t.bracket || []).filter(m => isRealPlayer(m.winner) && isPlayable(m));
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
      const { data } = await supabase
        .from("tournaments_public")
        .select("*")
        .eq("public_slug", slug)
        .maybeSingle();
      if (cancelled) return;
      if (!data) { setNotFound(true); setLoading(false); return; }
      setT({
        ...(data as unknown as TournamentRow),
        players: (data.players as unknown as string[]) || [],
        bracket: (data.bracket as unknown as Match[]) || [],
      });
      setLoading(false);
    };
    load();

    const interval = window.setInterval(load, 8000);
    const channel = supabase
      .channel(`public-tournament-${slug}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "tournaments", filter: `public_slug=eq.${slug}` }, load)
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
        <h1 className="font-display text-2xl uppercase mb-1">{tr("pt.noLiveTournament")}</h1>
        <p className="text-sm text-muted-foreground">{tr("pt.invalidOrDeactivatedLink")}</p>
      </div>
    );
  }

  const isKo = t.mode !== "round-robin";
  const matches = t.bracket as Match[];
  const totalRounds = isKo ? totalRoundsOf(matches) : 0;
  const completed = matches.filter(m => m.winner && isPlayable(m)).slice(-8).reverse();

  // Elimination status per participant, for the Teilnehmer view's colored still-in/out signal.
  // KO only — round-robin has no elimination concept (everyone plays every scheduled match
  // regardless of outcome), so this stays null there and that view just shows no status dot.
  // A player can only lose once in single elimination, so "eliminated" never needs re-checking
  // once set; the champion is applied last so it wins over the (never-true-for-them) default.
  // Plain const, not useMemo — this sits after the loading/notFound early returns above (like
  // every other derived value in this component), and a hook can't live there without breaking
  // React's rules-of-hooks ordering guarantee across the loading/notFound/loaded renders.
  const eliminationStatus: Record<string, "active" | "eliminated" | "champion"> | null = isKo
    ? (() => {
        const status: Record<string, "active" | "eliminated" | "champion"> = {};
        for (const name of t.players) status[name] = "active";
        for (const m of matches) {
          if (!isPlayable(m) || !m.winner) continue;
          const loser = m.winner === m.player1 ? m.player2 : m.player1;
          if (loser && loser in status) status[loser] = "eliminated";
        }
        if (t.champion && t.champion in status) status[t.champion] = "champion";
        return status;
      })()
    : null;
  const boardsCount = t.boards ?? 2;
  const roundLabel = (round: number, total: number) => roundLabelFor(round, total, tr);

  // Board-aware look-ahead — single source of truth shared by the "Jetzt am Board"
  // banner, the "Als Nächstes" sidebar card, and the full-screen board overview.
  const boardSchedule = isKo ? currentBoardSchedule(matches, boardsCount) : null;
  const nowBoards = boardSchedule?.now ?? [];
  const onDeck = boardSchedule?.onDeck ?? [];
  const queuedCount = boardSchedule?.queuedCount ?? 0;

  // Same look-ahead, normalized into BoardOverview's KO-agnostic BoardCard shape.
  const rrBoards = !isKo ? roundRobinBoardCards(t.bracket as unknown as RoundRobinMatch[], boardsCount) : null;
  const boardCardsNow = isKo ? koToBoardCards(nowBoards, matches) : rrBoards!.now;
  const boardCardsOnDeck = isKo ? koToBoardCards(onDeck, matches) : rrBoards!.onDeck;
  const boardCardsQueued = isKo ? queuedCount : rrBoards!.queuedCount;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border px-4 sm:px-6 py-4 flex flex-wrap items-center justify-between gap-3 bg-gradient-to-r from-primary/10 via-transparent to-accent/10">
        <div className="flex items-center gap-3 min-w-0">
          <img src={htuLogo} alt="Logo" className="w-12 h-12 rounded-xl object-cover border border-primary/30 shrink-0" />
          <div className="min-w-0">
            <h1 className="font-display text-[clamp(1.1rem,2.4vw,2rem)] uppercase tracking-widest truncate">{t.name}</h1>
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="inline-flex items-center gap-2 shrink-0">
                {t.champion ? (
                  <>
                    <span className="inline-block h-2 w-2 rounded-full bg-muted-foreground" /> {tr("pt.finished")}
                  </>
                ) : (
                  <>
                    <span className="inline-block h-2 w-2 rounded-full bg-secondary animate-pulse" /> {tr("tournament.live")}
                  </>
                )}
              </span>
              <span>{t.players.length} {tr("game.playersSuffix")} · {t.game_mode} BO{t.best_of_legs} · {boardsCount} {tr("camera.board")}{boardsCount > 1 ? "s" : ""}</span>
            </p>
          </div>
        </div>
        {t.champion && (
          <div className="text-right shrink-0">
            <p className="text-[10px] uppercase tracking-widest text-accent">{tr("pt.champion")}</p>
            <p className="font-display text-xl text-accent">🏆 {t.champion}</p>
          </div>
        )}
      </header>

      {/* Always visible regardless of which view is active — previously this only rendered
          inside the tree/list branch, so landing on (or switching to) Board-Übersicht had no
          way back to the bracket at all. Also the shared fullscreen target — wrapping the
          toolbar in it too (not just the content below) means switching views, adjusting
          rotation, or exiting fullscreen never requires leaving fullscreen first. */}
      <div ref={viewWrapRef} className="px-4 pt-4 bg-background">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-border overflow-hidden">
            <button onClick={() => selectView("boards")} className={`px-3 py-1.5 text-xs flex items-center gap-1 ${view === "boards" && !autoRotate ? "bg-primary text-primary-foreground" : "hover:bg-muted text-muted-foreground"}`}>
              <Monitor className="w-3.5 h-3.5" /> {tr("pt.boardOverview")}
            </button>
            {isKo && (
              <>
                <button onClick={() => selectView("tree")} className={`px-3 py-1.5 text-xs flex items-center gap-1 border-l border-border ${view === "tree" && !autoRotate ? "bg-primary text-primary-foreground" : "hover:bg-muted text-muted-foreground"}`}>
                  <Network className="w-3.5 h-3.5" /> {tr("tournament.bracketTreeTab")}
                </button>
                <button onClick={() => selectView("list")} className={`px-3 py-1.5 text-xs flex items-center gap-1 border-l border-border ${view === "list" && !autoRotate ? "bg-primary text-primary-foreground" : "hover:bg-muted text-muted-foreground"}`}>
                  <Rows3 className="w-3.5 h-3.5" /> {tr("pt.roundList")}
                </button>
              </>
            )}
            <button onClick={() => selectView("participants")} className={`px-3 py-1.5 text-xs flex items-center gap-1 border-l border-border ${view === "participants" && !autoRotate ? "bg-primary text-primary-foreground" : "hover:bg-muted text-muted-foreground"}`}>
              <Users className="w-3.5 h-3.5" /> {tr("pt.participantsView")}
            </button>
            <button onClick={() => selectView("highlights")} className={`px-3 py-1.5 text-xs flex items-center gap-1 border-l border-border ${view === "highlights" && !autoRotate ? "bg-primary text-primary-foreground" : "hover:bg-muted text-muted-foreground"}`}>
              <Target className="w-3.5 h-3.5" /> {tr("pt.highlightsLabel")}
            </button>
          </div>
          <button
            onClick={toggleAutoRotate}
            className={`px-3 py-1.5 rounded-lg border text-xs flex items-center gap-1.5 ${autoRotate ? "border-secondary bg-secondary/15 text-secondary" : "border-border hover:bg-muted text-muted-foreground"}`}
            title={tr("pt.autoRotateTooltip")}
          >
            <RefreshCcw className={`w-3.5 h-3.5 ${autoRotate ? "animate-pulse" : ""}`} /> {tr("pt.autoSwitch")}
          </button>
          <button
            onClick={() => setShowRotationSettings((v) => !v)}
            className={`px-2.5 py-1.5 rounded-lg border text-xs flex items-center gap-1 ${showRotationSettings ? "border-secondary bg-secondary/15 text-secondary" : "border-border hover:bg-muted text-muted-foreground"}`}
            title={tr("pt.rotationSettingsTooltip")}
            aria-label={tr("pt.rotationSettingsTooltip")}
          >
            <Settings2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={toggleFullscreen}
            className="px-2.5 py-1.5 rounded-lg border border-border text-xs flex items-center gap-1.5 hover:bg-muted text-muted-foreground ml-auto"
            title={isFullscreen ? tr("pt.exitFullscreen") : tr("pt.enterFullscreenTv")}
          >
            {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            {isFullscreen ? tr("pt.exitFullscreen") : tr("pt.fullscreenShort")}
          </button>
        </div>
        {showRotationSettings && (
          <div className="mb-2 rounded-xl border border-border bg-card p-3 max-w-xl">
            <p className="text-[11px] text-muted-foreground mb-2">{tr("pt.rotationSettingsDesc")}</p>
            <div className="flex flex-wrap gap-2">
              {([
                { slot: "boards" as const, label: tr("pt.boardOverview") },
                { slot: "bracket" as const, label: isKo ? tr("tournament.bracketTreeTab") : tr("pt.standings") },
                { slot: "participants" as const, label: tr("pt.participantsView") },
                { slot: "highlights" as const, label: tr("pt.highlightsLabel") },
              ]).map((opt) => (
                <button
                  key={opt.slot}
                  onClick={() => toggleRotationSlot(opt.slot)}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs ${rotationSlots[opt.slot] ? "border-secondary bg-secondary/15 text-secondary" : "border-border text-muted-foreground"}`}
                >
                  <span className={`w-4 h-4 rounded border flex items-center justify-center ${rotationSlots[opt.slot] ? "bg-secondary border-secondary" : "border-muted-foreground/40"}`}>
                    {rotationSlots[opt.slot] && <Check className="w-3 h-3 text-secondary-foreground" />}
                  </span>
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        )}

      {view === "highlights" ? (
        <div className="px-4 pb-6">
          {/* No max-w here (used to cap at max-w-2xl) — a TV/tablet propped up for the live
              rotation has the width to spare, and the highlight table only grows as the
              tournament goes on, so it should use that width rather than stay narrow and squeeze
              a growing row/column count into a fixed small box. */}
          <div className="rounded-xl border border-border bg-card p-4">
            <h3 className="font-display uppercase text-sm mb-3 text-muted-foreground flex items-center gap-2"><Target className="w-4 h-4" /> {tr("pt.highlightsLabel")}</h3>
            {!tournamentHighlights || !tournamentAverages ? (
              <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
            ) : (
              <TournamentHighlightsPanel highlights={tournamentHighlights} averages={tournamentAverages} liveView />
            )}
          </div>
        </div>
      ) : view === "participants" ? (
        <div className="px-4 pb-6">
          <div className="rounded-xl border border-border bg-card p-3">
            <h3 className="font-display uppercase text-sm mb-2 text-muted-foreground flex items-center gap-2"><Users className="w-4 h-4" /> {tr("pt.participantsView")}</h3>
            {/* No longer gated on tournamentAverages — names + elimination-status coloring need
                no network data at all (eliminationStatus is derived straight from the bracket
                already in hand), so blocking the whole grid behind that RPC used to show a
                spinner instead of the one thing that was actually ready immediately. Each card's
                own Ø average just reads "–" until averages load in, same as before. */}
            <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-1.5">
              {t.players.map((p) => {
                const avgRow = tournamentAverages?.participants.find((pa) => pa.key === p || pa.name === p);
                const status = eliminationStatus?.[p];
                // Green border = still in, grayed out = eliminated, no label text to parse from
                // across a room. Champion keeps its own gold tint (a positive end-state, not
                // part of the still-in/out binary).
                const borderColor =
                  status === "champion" ? "border-l-accent" :
                  status === "eliminated" ? "border-l-muted-foreground/30" :
                  status === "active" ? "border-l-secondary" : "border-l-transparent";
                return (
                  <div key={p} className={`rounded-lg bg-muted/30 border-l-4 ${borderColor} px-2 py-1.5 min-w-0 ${status === "eliminated" ? "opacity-60" : ""}`}>
                    <p className="truncate text-xs font-medium">{status === "champion" && "🏆 "}{p}</p>
                    <p className="font-display text-sm text-primary leading-tight">
                      {avgRow && avgRow.tournamentAverage > 0 ? `Ø ${avgRow.tournamentAverage.toFixed(1)}` : "–"}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : view === "boards" ? (
        <BoardOverview now={boardCardsNow} onDeck={boardCardsOnDeck} queuedCount={boardCardsQueued} totalRounds={totalRounds} />
      ) : (
      <div className={`grid gap-4 p-4 ${view === "tree" ? "" : "lg:grid-cols-[1fr_320px]"}`}>
        <div className="min-w-0">
          {/* "Jetzt am Board" used to duplicate here too — removed, the dedicated Board-Übersicht
              view (see view === "boards" above) is the one place for that now, so switching to
              tree/list/round-robin isn't showing the same live-match cards twice. */}
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

        {view !== "tree" && (
        <aside className="flex flex-col gap-4 lg:sticky lg:top-4 self-start">
          {isKo && (
            <div className="bg-card border border-border rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <ListOrdered className="w-4 h-4 text-primary" />
                  <h3 className="font-display uppercase text-sm">{tr("pt.upNext")}</h3>
                </div>
                <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                  <Monitor className="w-3 h-3" /> {boardsCount}
                </span>
              </div>
              {onDeck.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  {nowBoards.length === 0 ? tr("pt.noPairingsYet") : tr("pt.allKnownPairingsRunning")}
                </p>
              ) : (
                <>
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5">
                    {roundLabel(onDeck[0].match.round, totalRounds)}
                  </p>
                  <ul className="space-y-1.5">
                    {onDeck.map(({ board, match: m }) => (
                      <li key={m.id} className="flex items-center gap-2 text-xs bg-muted/30 rounded-lg px-2.5 py-1.5">
                        <span className="font-mono text-[10px] bg-primary/10 text-primary rounded px-1.5 py-0.5 shrink-0">
                          {tr("camera.board")} {board}
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
                  +{queuedCount} {tr("pt.moreMatchesQueued")}
                </p>
              )}
            </div>
          )}

          <div className="bg-card border border-border rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <Zap className="w-4 h-4 text-accent" />
              <h3 className="font-display uppercase text-sm">{tr("pt.liveTicker")}</h3>
            </div>
            {completed.length === 0 ? (
              <p className="text-xs text-muted-foreground">{tr("pt.noCompletedMatches")}</p>
            ) : (
              <ol className="space-y-2">
                {completed.map(m => (
                  <li key={m.id} className="text-xs border-l-2 border-primary/40 pl-2">
                    <p className="font-display text-sm uppercase">
                      <span className="text-secondary">{m.winner}</span>
                      <span className="text-muted-foreground normal-case"> {tr("tournament.beats")} </span>
                      {m.winner === m.player1 ? m.player2 : m.player1}
                    </p>
                    <p className="text-muted-foreground">{roundLabel(m.round, totalRounds)} · {m.score1 ?? 0}:{m.score2 ?? 0}</p>
                  </li>
                ))}
              </ol>
            )}
            <div className="mt-4 pt-3 border-t border-border text-[10px] uppercase tracking-widest text-muted-foreground flex items-center gap-1">
              <Users className="w-3 h-3" /> {t.players.length} {tr("tournament.participants")}
            </div>
          </div>
        </aside>
        )}
      </div>
      )}

      {/* Inside viewWrapRef (not a sibling after it) so it still shows up while fullscreened —
          the Fullscreen API only paints descendants of the fullscreened element, and this used
          to sit just outside that wrapper, meaning "X beats Y" would go on firing but never be
          seen by anyone who'd fullscreened any of the other views. position:fixed keeps its
          normal viewport-relative placement regardless of DOM nesting either way. */}
      {flash && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-slide-up">
          <div className="rounded-2xl border-2 border-accent bg-card/95 backdrop-blur px-8 py-5 text-center glow-gold shadow-2xl">
            <p className="text-[11px] uppercase tracking-[0.3em] text-accent mb-1">{tr("pt.resultLabel")} · {roundLabel(flash.round, totalRounds)}</p>
            <p className="font-display text-3xl uppercase">
              <span className="text-secondary">{flash.winner}</span>
              <span className="text-muted-foreground text-lg"> {tr("tournament.beats")} </span>
              {flash.winner === flash.player1 ? flash.player2 : flash.player1}
            </p>
            <p className="font-display text-xl text-primary mt-1">{flash.score1 ?? 0} : {flash.score2 ?? 0}</p>
          </div>
        </div>
      )}
      </div>
    </div>
  );
};

export default PublicTournamentPage;