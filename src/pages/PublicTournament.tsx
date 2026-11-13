import { useEffect, useState, useRef, useMemo, useCallback } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Trophy, Users, Radio, Zap, ListOrdered, Monitor, ZoomIn, ZoomOut, Maximize2, Minimize2, Network, Rows3, PenLine, RefreshCcw, Target, Settings2, Check, QrCode, Hourglass, Lock, UserRound, EyeOff } from "lucide-react";
import { DartLoaderIcon as Loader2 } from "@/components/icons/DartIcons";
import { computeTournamentHighlights, computeTournamentAverages, computeLegAveragesByGame, sortParticipants, type TournamentHighlights, type TournamentAverages, type TournamentStatsLegRow, type TournamentStatsGameRow, type ParticipantSortMode } from "@/utils/tournamentStats";
import TournamentHighlightsPanel from "@/components/tournament/TournamentHighlightsPanel";
import MatchPredictionsPanel from "@/components/tournament/MatchPredictionsPanel";
import MobileBracket from "@/components/tournament/MobileBracket";
import LivePanel from "@/components/live/LivePanel";
import LiveSectionLabel from "@/components/live/LiveSectionLabel";
import LiveDot from "@/components/live/LiveDot";
import VenueDarkSurface from "@/components/live/VenueDarkSurface";
import { useIsMobile } from "@/hooks/use-mobile";
import { splitTeamName } from "@/utils/tournamentTeams";
import { useMatchPredictions } from "@/hooks/useMatchPredictions";
import { Badge } from "@/components/ui/badge";
import {
  roundLabelFor,
  currentBoardSchedule,
  calcStandings,
  isLiveSnapshotFresh,
  scorekeeperLabel as keeperLabel,
  isRealPlayer,
  isPlayable,
  totalRoundsOf,
  hasStarted,
  DEFAULT_PRESTART_VIEWS,
  type Match,
  type RoundRobinMatch,
  type RoundRobinStanding,
  type LiveSnapshot,
  type RotationSlot,
} from "@/utils/tournament";
import AnimatedScore from "@/components/AnimatedScore";
import { playWalkonSound } from "@/utils/sounds";
import { useLanguage } from "@/contexts/LanguageContext";
import { getCheckoutSuggestion } from "@/utils/checkoutTable";
import { generateQrDataUrl } from "@/lib/qrcode";
import htuLogo from "@/assets/htu-logo.jpg";
import htuEmblem from "@/assets/club-emblem.png";
import { useClubBranding } from "@/contexts/ClubBrandingContext";

interface TournamentRow {
  id: string; name: string; mode: string; status: string;
  champion: string | null; players: string[]; bracket: Match[];
  game_mode?: string; best_of_legs?: number; best_of_sets?: number | null; boards?: number;
  round_configs?: { mode: string; bestOf: number }[];
  attendance?: Record<string, boolean> | null;
  prestart_views?: string[];
  manual_release?: boolean;
}

/** All 8 selectable live-view pages — the 5 original ones plus the 3 added for the waiting
 *  period (waiting/logo splash, format/status, QR invite). Kept as one union (not split by
 *  purpose) since the toolbar/rotation/gating logic all switch on it uniformly. */
type ViewKey = "tree" | "list" | "boards" | "participants" | "highlights" | "waiting" | "format" | "qr";
const ALL_VIEW_KEYS: ViewKey[] = ["tree", "list", "boards", "participants", "highlights", "waiting", "format", "qr"];

/** Read-only round-robin standings + match list — mirrors the admin Tabelle view. */
const RoundRobinLive = ({ matches }: { matches: RoundRobinMatch[] }) => {
  const { t } = useLanguage();
  const standings = calcStandings(matches);
  const hasLegData = standings.some((s) => s.legsFor + s.legsAgainst > 0);
  const unplayed = matches.filter((m) => !m.played);
  const played = matches.filter((m) => m.played);

  return (
    <div className="space-y-4">
      <LivePanel>
        <LiveSectionLabel className="mb-3">{t("tournament.standingsTable")}</LiveSectionLabel>
        <div className={`grid ${hasLegData ? "grid-cols-[auto_minmax(0,1fr)_repeat(3,28px)_46px_34px_30px]" : "grid-cols-[auto_minmax(0,1fr)_repeat(4,32px)]"} gap-x-2 gap-y-1 text-xs`}>
          <span className="text-muted-foreground">#</span>
          <span className="text-muted-foreground">{t("stats.player")}</span>
          <span className="text-muted-foreground text-center">{t("tournament.playedAbbrev")}</span>
          <span className="text-muted-foreground text-center">{t("tournament.wonAbbrev")}</span>
          <span className="text-muted-foreground text-center">{t("tournament.lostAbbrev")}</span>
          {hasLegData && (
            <>
              <span className="text-muted-foreground text-center">{t("tournament.legsAbbrev")}</span>
              <span className="text-muted-foreground text-center">{t("tournament.legDiffAbbrev")}</span>
            </>
          )}
          <span className="text-muted-foreground text-center">{t("tournament.pointsAbbrev")}</span>
          {standings.map((s, i) => (
            <div className="contents" key={s.name}>
              <span className={`font-display ${i === 0 ? "text-accent" : ""}`}>
                {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`}
              </span>
              <span className="font-semibold break-words leading-tight min-w-0">{s.name}</span>
              <span className="text-center">{s.played}</span>
              <span className="text-center text-secondary">{s.won}</span>
              <span className="text-center text-destructive">{s.lost}</span>
              {hasLegData && <span className="text-center tabular-nums text-muted-foreground">{s.legsFor}:{s.legsAgainst}</span>}
              {hasLegData && (
                <span className={`text-center tabular-nums ${s.legsFor - s.legsAgainst > 0 ? "text-secondary" : s.legsFor - s.legsAgainst < 0 ? "text-destructive" : "text-muted-foreground"}`}>
                  {s.legsFor - s.legsAgainst > 0 ? "+" : ""}{s.legsFor - s.legsAgainst}
                </span>
              )}
              <span className="text-center font-display font-bold tabular-nums text-primary">{s.points}</span>
            </div>
          ))}
        </div>
      </LivePanel>

      {unplayed.length > 0 && (
        <LivePanel>
          <LiveSectionLabel className="mb-3">{t("tournament.upcomingMatches")} ({unplayed.length})</LiveSectionLabel>
          <div className="space-y-1.5">
            {unplayed.map((m) => (
              <div key={m.id} className="flex items-center justify-between bg-muted rounded-xl px-3 py-2 text-sm font-semibold">
                <span className="min-w-0 break-words">{m.player1} <span className="text-muted-foreground font-normal">{t("common.vs")}</span> {m.player2}</span>
              </div>
            ))}
          </div>
        </LivePanel>
      )}

      {played.length > 0 && (
        <LivePanel>
          <LiveSectionLabel className="mb-3">{t("tournament.playedMatches")} ({played.length})</LiveSectionLabel>
          <div className="divide-y divide-border">
            {played.map((m) => (
              <div key={m.id} className="flex items-center justify-between px-1 py-2 text-sm">
                <span className="min-w-0 break-words">{m.player1} <span className="text-muted-foreground">{t("common.vs")}</span> {m.player2}</span>
                <span className="text-xs text-secondary font-semibold shrink-0 ml-2">{m.winner} ✓</span>
              </div>
            ))}
          </div>
        </LivePanel>
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
  const { club, logoUrl } = useClubBranding();
  const watermarkSrc = club?.logo_path ? logoUrl : htuEmblem;
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
    // `playable` (both players known, no winner yet) = ready to go: outlined in the club's
    // action color. Actually being played right now (a fresh live snapshot) is a separate state
    // with a green live dot + live leg count, same distinction Tournament.tsx's own bracket makes
    // for the organizer.
    const playable = !m.winner && isPlayable(m);
    const liveFresh = playable && isLiveSnapshotFresh(m.live);
    return (
      <div key={m.id} className={`bg-card border rounded-2xl overflow-hidden relative ${m.winner ? "border-border" : playable ? "border-primary" : "border-border/60"}`}>
        {!isLast && side === "left" && <span aria-hidden className="absolute top-1/2 -right-4 w-4 h-px bg-border" />}
        {!isLast && side === "right" && <span aria-hidden className="absolute top-1/2 -left-4 w-4 h-px bg-border" />}
        {[m.player1, m.player2].map((player, idx) => (
          <div key={idx} className={`${compact ? "px-2.5 py-1.5 text-xs" : "px-3 py-2 text-sm"} flex items-center justify-between gap-2 font-semibold ${idx === 0 ? "border-b border-border" : ""} ${m.winner === player ? "bg-secondary/15 text-secondary" : !isRealPlayer(player) ? "text-muted-foreground/40 font-normal" : m.winner ? "text-muted-foreground" : ""}`}>
            <span className="truncate">{player || t("tournament.tbdPlaceholder")}</span>
            <span className={`font-display font-bold tabular-nums ${compact ? "text-base" : "text-lg"} leading-none ${liveFresh ? "text-secondary" : ""}`}>
              {liveFresh ? (idx === 0 ? m.live!.legs1 : m.live!.legs2) : (idx === 0 ? m.score1 ?? 0 : m.score2 ?? 0)}
            </span>
          </div>
        ))}
        {!m.winner && (m.scorekeeper || m.scorekeeperRule || m.board || liveFresh) && (
          <div className={`px-2.5 py-0.5 border-t border-border bg-muted flex items-center justify-between text-[9px] text-muted-foreground ${compact ? "" : "px-3 py-1 text-[10px]"}`}>
            <span className="truncate">✍️ {keeperLabel(m, matches) || "–"}</span>
            <span className="flex items-center gap-2 shrink-0">
              {liveFresh && (
                <span className="flex items-center gap-1 font-semibold text-secondary">
                  <LiveDot /> {t("tournament.live")}
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
        <LiveSectionLabel className={align === "center" ? "justify-center" : align === "right" ? "justify-end" : ""}>{roundLabel(round, totalRounds)}</LiveSectionLabel>
        <p className="text-[11px] text-muted-foreground tabular-nums">{cfg?.mode || fallbackMode} · FT{Math.ceil((cfg?.bestOf || fallbackBestOf) / 2)}</p>
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
        <div className="mb-3 rounded-[20px] border border-border p-3">
          <LiveSectionLabel className="mb-2">{t("tournament.preliminaryRound")}</LiveSectionLabel>
          <div className="flex flex-wrap gap-2">
            {prelimMatches.map(m => (
              <div key={m.id} className="min-w-[180px] flex-1">{renderMatch(m, "center", true)}</div>
            ))}
          </div>
        </div>
      )}
      <div className="relative rounded-[20px] border border-border overflow-hidden">
      <div className="absolute top-2 right-2 z-20 flex items-center gap-1 bg-card border border-border rounded-xl p-1">
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
            <img src={watermarkSrc} alt="" className="w-[65%] max-w-[900px] object-contain opacity-[0.07]" />
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
  const allRounds = [...(hasPrelim ? [0] : []), ...Array.from({ length: totalRounds }, (_, i) => i + 1)];
  // Promote whichever round(s) currently have an undecided, playable match to the very top —
  // otherwise the round actually worth watching could be buried in the middle of a long list
  // (up to 7 rounds for a 64-player bracket), and a viewer has to scan for it instead of seeing
  // it at a glance. Rounds without action keep their normal relative order after that.
  const roundHasAction = (round: number) => matches.some(m => m.round === round && !m.winner && isPlayable(m));
  const rounds = [...allRounds.filter(roundHasAction), ...allRounds.filter(r => !roundHasAction(r))];

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
        const isActive = liveList.length > 0;
        // A round nobody has reached yet — literally every match still waiting on both feeder
        // results — has nothing worth looking at; a whole grid of empty "TBD vs TBD" boxes was
        // just noise competing for attention with the round that actually matters right now.
        const notReachedYet = list.length > 0 && list.every(m => !isRealPlayer(m.player1) && !isRealPlayer(m.player2));
        return (
          <div key={round} className={`bg-card border rounded-[20px] overflow-hidden ${isActive ? "border-primary" : "border-border"}`}>
            <div className="px-4 py-2.5 border-b border-border flex items-center justify-between gap-2">
              <LiveSectionLabel className={isActive ? "text-foreground" : ""}>
                {isActive && <span aria-hidden className="inline-block h-2 w-2 rounded-full bg-primary animate-pulse shrink-0" />}
                {roundLabel(round, totalRounds)}
              </LiveSectionLabel>
              <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">{cfg?.mode || fallbackMode} · FT{Math.ceil((cfg?.bestOf || fallbackBestOf) / 2)}</span>
            </div>
            {notReachedYet ? (
              <p className="px-4 py-2.5 text-xs text-muted-foreground">{t("pt.roundNotReachedYet")}</p>
            ) : (
            <>
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
                    <div key={m.id} className="px-4 py-2.5 flex items-center gap-3 text-sm font-semibold">
                      {[m.player1, m.player2].map((player, idx) => (
                        <span key={idx} className={`flex-1 min-w-0 truncate ${m.winner === player ? "text-secondary" : !isRealPlayer(player) ? "text-muted-foreground/40 font-normal" : ""}`}>
                          {player || t("tournament.tbdPlaceholder")}
                        </span>
                      ))}
                      <span className={`shrink-0 font-display font-bold text-xl leading-none tabular-nums ${liveFresh ? "text-secondary" : ""}`}>
                        {liveFresh ? `${m.live!.legs1}:${m.live!.legs2}` : `${m.score1 ?? 0}:${m.score2 ?? 0}`}
                      </span>
                      {liveFresh && (
                        <span className="shrink-0 flex items-center gap-1 text-[10px] text-secondary">
                          <LiveDot /> {t("tournament.live")}
                        </span>
                      )}
                      {m.board ? (
                        <Badge variant="outline" className="shrink-0 rounded-md text-[10px] font-semibold bg-primary text-primary-foreground px-1.5 py-0.5 border-transparent">{t("camera.board")} {m.board}</Badge>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
            {otherList.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-1 p-1.5">
                {otherList.map(m => (
                  <div key={m.id} className="rounded-xl bg-muted px-2 py-1 text-xs min-w-0">
                    {[m.player1, m.player2].map((player, idx) => (
                      <p key={idx} className={`truncate leading-tight ${m.winner === player ? "text-secondary font-semibold" : !isRealPlayer(player) ? "text-muted-foreground/40" : "text-muted-foreground"}`}>
                        {player || t("tournament.tbdPlaceholder")}
                      </p>
                    ))}
                  </div>
                ))}
              </div>
            )}
            </>
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
        <p key={b.name} className="text-[clamp(0.7rem,1.1vw,0.9rem)] text-muted-foreground flex items-center gap-1.5">
          <span className="shrink-0">🎯 {b.name}:</span>
          <span className="font-display font-bold tracking-wide text-primary">{b.route.join(" ")}</span>
        </p>
      ))}
    </div>
  );
};

/** Branded splash for downtime (before the first game starts, or between rounds) — no live
 *  data of its own, just enough presence that a beamer/tablet showing it doesn't look broken. */
const WaitingSplash = ({ name }: { name: string }) => {
  const { t } = useLanguage();
  const { club, name: clubName, logoUrl } = useClubBranding();
  const watermarkSrc = club?.logo_path ? logoUrl : htuEmblem;
  return (
    <div className="flex flex-col items-center justify-center text-center py-10 px-4 min-h-[60vh]">
      {/* Same combined club-emblem + Darts-badge layering as the Home page hero (Index.tsx) — the
       *  large muted tree emblem behind, the sharp glowing circular Darts badge overlapping its
       *  lower trunk in front — so the live view's waiting screen reads as the same club identity
       *  a member already recognizes from the app, not a second, different logo treatment. */}
      <div className="relative mb-4 h-[196px] sm:h-[240px] w-full max-w-md">
        <img
          src={watermarkSrc}
          alt={clubName}
          className="absolute top-0 left-1/2 -translate-x-1/2 w-[180px] h-[180px] sm:w-[220px] sm:h-[220px] object-contain opacity-40 saturate-[0.65] pointer-events-none select-none"
        />
        <div className="absolute left-1/2 -translate-x-1/2 top-[104px] sm:top-[128px]">
          <div className="relative w-[92px] h-[92px] sm:w-[112px] sm:h-[112px] rounded-full border-2 border-primary bg-card overflow-hidden">
            <img src={logoUrl} alt={clubName} className="w-full h-full object-cover" />
          </div>
        </div>
      </div>
      <h2 className="font-display font-bold text-[clamp(1.75rem,4vw,3rem)] leading-tight mb-3">{name}</h2>
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground flex items-center gap-2">
        <Hourglass className="w-4 h-4" /> {t("pt.waitingSubtitle")}
      </p>
    </div>
  );
};

/** Registration/format overview — participant + check-in counts, legs-per-round, and a
 *  preliminary-round note. Meant to answer "how big is this thing and how's it structured"
 *  during the pre-start waiting period, without needing any match to have started yet. */
const FormatStatusPage = ({
  tournament, matches, isKo, totalRounds, started,
}: {
  tournament: TournamentRow;
  matches: Match[];
  isKo: boolean;
  totalRounds: number;
  started: boolean;
}) => {
  const { t } = useLanguage();
  const roundLabel = (round: number, total: number) => roundLabelFor(round, total, t);
  const attendanceEntries = tournament.attendance ? Object.keys(tournament.attendance).length : 0;
  const checkedIn = attendanceEntries > 0 ? Object.values(tournament.attendance!).filter(Boolean).length : null;
  const hasPrelim = isKo && matches.some((m) => m.round === 0);
  const rounds = isKo ? [...(hasPrelim ? [0] : []), ...Array.from({ length: totalRounds }, (_, i) => i + 1)] : [];

  return (
    <div className="max-w-xl mx-auto py-8 px-4 space-y-5">
      <div className={`grid gap-3 ${checkedIn !== null ? "grid-cols-2" : "grid-cols-1"}`}>
        <LivePanel className="p-5 text-center">
          <p className="font-display font-bold tabular-nums text-5xl leading-none">{tournament.players.length}</p>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground mt-2">{t("tournament.participants")}</p>
        </LivePanel>
        {checkedIn !== null && (
          <LivePanel className="p-5 text-center">
            <p className="font-display font-bold tabular-nums text-5xl leading-none text-secondary">{checkedIn} / {tournament.players.length}</p>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground mt-2">{t("pt.checkedInLabel")}</p>
          </LivePanel>
        )}
      </div>

      {isKo ? (
        <LivePanel className="p-5">
          <LiveSectionLabel className="mb-3">{t("pt.formatLabel")}</LiveSectionLabel>
          <ul className="divide-y divide-border text-base">
            {rounds.map((r) => {
              const cfg = (tournament.round_configs || [])[r === 0 ? totalRounds : r - 1];
              return (
                <li key={r} className="flex items-center justify-between py-2">
                  <span className="text-muted-foreground">{roundLabel(r, totalRounds)}</span>
                  <span className="font-semibold tabular-nums">{cfg?.mode || tournament.game_mode} · FT{Math.ceil((cfg?.bestOf || tournament.best_of_legs) / 2)}</span>
                </li>
              );
            })}
          </ul>
        </LivePanel>
      ) : (
        <LivePanel className="p-5 flex items-center justify-between text-base">
          <span className="text-muted-foreground">{t("pt.formatLabel")}</span>
          <span className="font-semibold tabular-nums">{tournament.game_mode} · FT{Math.ceil(tournament.best_of_legs / 2)}</span>
        </LivePanel>
      )}

      {/* Sets-Modus (2026-09-09): tournament-wide, so shown once here rather than repeated on
          every per-round line above — null/absent for the overwhelming majority of tournaments,
          which don't use it, so this whole block simply doesn't render for them. */}
      {!!tournament.best_of_sets && (
        <LivePanel className="p-5 flex items-center justify-between gap-3 text-base">
          <span className="text-muted-foreground">{t("game.setsMode")}</span>
          <span className="font-semibold tabular-nums text-right">FT{Math.ceil(tournament.best_of_sets / 2)} {t("game.setsSuffix")} · {t("game.legsPerSet")} FT{Math.ceil(tournament.best_of_legs / 2)}</span>
        </LivePanel>
      )}

      {hasPrelim ? (
        <LivePanel className="p-5 text-base text-center border-primary">
          {t("tournament.preliminaryRound")}
        </LivePanel>
      ) : isKo && !started ? (
        <p className="text-sm text-muted-foreground text-center">{t("pt.formatMayStillChange")}</p>
      ) : null}
    </div>
  );
};

/** Full-page QR invite — a spectator scans this to open the exact same live view on their own
 *  phone. Deliberately its own dedicated rotating page (not the small per-view "jump here"
 *  button that used to live on Board-Übersicht and was removed) — generateQrDataUrl is the
 *  same client-side generator the organizer's own QR buttons already use, just rendered
 *  full-page here instead of inside a dialog. */
const QrInvitePage = ({ url, name }: { url: string; name: string }) => {
  const { t } = useLanguage();
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    generateQrDataUrl(url, 480).then((d) => { if (!cancelled) setDataUrl(d); });
    return () => { cancelled = true; };
  }, [url]);

  return (
    <div className="flex flex-col items-center justify-center text-center py-10 px-4 min-h-[60vh]">
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground mb-1">{name}</p>
      <h2 className="font-display font-bold text-[clamp(1.5rem,3vw,2.25rem)] mb-6 flex items-center gap-2"><QrCode className="w-6 h-6 text-primary" /> {t("pt.qrInviteTitle")}</h2>
      {dataUrl ? (
        <img src={dataUrl} alt={t("pt.qrInviteTitle")} className="rounded-[20px] border border-border bg-white p-3 w-full max-w-[420px]" />
      ) : (
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      )}
      <p className="text-sm text-muted-foreground mt-6 max-w-sm">{t("pt.qrInviteDesc")}</p>
    </div>
  );
};

/** Whether a bracket entry (a player or a doubles team "Anna & Ben") is the chosen spectator. */
const entryIsMe = (entry: string | undefined, me: string): boolean =>
  !!me && !!entry && (entry === me || splitTeamName(entry).includes(me));

const MY_NAME_PREF_KEY = "dart-live-my-name";
/** Text size of the whole page for a beamer/TV: stepped, kept per device. */
const UI_SCALE_PREF_KEY = "dart-live-ui-scale";
const UI_SCALES = [1, 1.15, 1.3, 1.5, 1.75] as const;
/** "Ruhe" view: no buttons at all, the pages rotate on their own — for a screen nobody touches. */
const CALM_PREF_KEY = "dart-live-calm";

/**
 * "Wer bin ich?": a spectator who is also a player picks their name once and gets told, on any view, which board
 * they play on now or next — so nobody has to scan the board grid for their own name.
 */
const MyMatchBar = ({ names, myName, onChange, now, onDeck }: {
  names: string[];
  myName: string;
  onChange: (name: string) => void;
  now: BoardCard[];
  onDeck: BoardCard[];
}) => {
  const { t } = useLanguage();
  const opponentIn = (c: BoardCard) => (entryIsMe(c.player1, myName) ? c.player2 : c.player1);
  const playingNow = now.find((c) => entryIsMe(c.player1, myName) || entryIsMe(c.player2, myName));
  const upNext = !playingNow ? onDeck.find((c) => entryIsMe(c.player1, myName) || entryIsMe(c.player2, myName)) : undefined;
  const hit = playingNow ?? upNext;
  return (
    <div
      className={`mb-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border bg-card px-3 py-2 text-sm ${hit ? "border-primary" : "border-border"}`}
      data-testid="my-match-bar"
    >
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <UserRound className="h-4 w-4 shrink-0" />
        <span className="whitespace-nowrap">{t("pt.whoAmI")}</span>
        <select
          value={myName}
          onChange={(e) => onChange(e.target.value)}
          className="min-w-0 max-w-[11rem] h-9 rounded-xl border border-border bg-background px-2 text-sm text-foreground"
          aria-label={t("pt.whoAmI")}
        >
          <option value="">{t("pt.whoAmIPick")}</option>
          {names.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </label>
      {myName && (
        <p className={`min-w-0 flex-1 font-semibold ${hit ? "text-foreground" : "text-muted-foreground"}`}>
          {playingNow
            ? t("pt.youPlayNow").replace("{board}", String(playingNow.board)).replace("{name}", opponentIn(playingNow))
            : upNext
              ? t("pt.youAreNext").replace("{board}", String(upNext.board)).replace("{name}", opponentIn(upNext))
              : t("pt.youNotScheduled")}
        </p>
      )}
    </div>
  );
};

/** One player's line on a venue board card: name left, leg count right in big condensed figures. */
const BoardPlayerRow = ({ name, legs }: { name: string; legs: number }) => (
  <div className="flex items-baseline justify-between gap-3 min-w-0">
    <span className="min-w-0 break-words font-semibold leading-tight text-[clamp(1.25rem,2.6vw,2.1rem)]">{name}</span>
    <span className="shrink-0 font-display font-bold tabular-nums leading-none text-[clamp(2rem,4.2vw,3.4rem)]">
      <AnimatedScore value={legs} />
    </span>
  </div>
);

/** The live strip under a board card while someone is scoring the match via "Spiel starten":
 *  remaining points, average to 170 and checkout routes. */
const BoardLiveStrip = ({ card }: { card: BoardCard }) => {
  const { t } = useLanguage();
  const live = card.live!;
  return (
    <div className="broadcast-scorebar mt-3 px-3 py-2 sm:px-4">
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-1.5 text-[clamp(0.7rem,1.1vw,0.9rem)] font-semibold uppercase tracking-[0.12em] text-secondary">
          <LiveDot /> {t("tournament.live")}
        </span>
        <span className="font-display font-bold tabular-nums text-[clamp(1.3rem,2.4vw,1.9rem)]">
          <AnimatedScore value={live.remaining1 ?? 0} /> <span className="text-muted-foreground">:</span> <AnimatedScore value={live.remaining2 ?? 0} />
        </span>
      </div>
      {(live.averageTo170_1 !== undefined || live.averageTo170_2 !== undefined) && (
        <div className="mt-1 flex items-center justify-between text-[clamp(0.7rem,1.1vw,0.9rem)] text-muted-foreground">
          <span>{t("stats.averageTo170")}</span>
          <span className="font-display font-semibold tabular-nums">{live.averageTo170_1?.toFixed(1) ?? "–"} : {live.averageTo170_2?.toFixed(1) ?? "–"}</span>
        </div>
      )}
      <CheckoutBadges player1={card.player1} player2={card.player2} live={card.live} />
    </div>
  );
};

/** One board on the venue screen: board label, round, both players with their legs, scorekeeper. */
const BoardOverviewCard = ({ card, totalRounds, mine }: { card: BoardCard; totalRounds: number; mine: boolean }) => {
  const { t } = useLanguage();
  return (
    <div className={`broadcast-panel border p-4 sm:p-5 ${mine ? "border-2 border-accent" : "border-border"}`}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="flex items-center gap-2">
          <span className="broadcast-tag inline-flex px-2.5 py-1 font-display font-bold uppercase tracking-wide text-[clamp(0.9rem,1.5vw,1.15rem)]">
            {t("camera.board")} {card.board}
          </span>
          {mine && <span className="rounded-md bg-accent px-2 py-1 font-display font-bold uppercase tracking-wide text-accent-foreground text-[clamp(0.75rem,1.2vw,0.95rem)]">{t("pt.you")}</span>}
        </span>
        {card.round !== undefined && (
          <span className="text-right text-[clamp(0.7rem,1.1vw,0.9rem)] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{roundLabelFor(card.round, totalRounds, t)}</span>
        )}
      </div>
      <div className="space-y-1">
        <BoardPlayerRow name={card.player1} legs={card.score1} />
        <BoardPlayerRow name={card.player2} legs={card.score2} />
      </div>
      {card.scorekeeper !== undefined && (
        <p className="mt-2 flex items-center gap-1.5 text-[clamp(0.75rem,1.15vw,0.95rem)] text-muted-foreground">
          <PenLine className="h-3.5 w-3.5 shrink-0" /> {card.scorekeeper || "–"}
        </p>
      )}
      {isLiveSnapshotFresh(card.live) && <BoardLiveStrip card={card} />}
    </div>
  );
};

/**
 * Full-bleed, large-type board grid for TV/projector mirroring at club nights — shows
 * every board's current pairing + last known leg score at a glance from across the room,
 * alongside tablets showing the same view up close. Sizes fluidly via CSS clamp() instead
 * of fixed breakpoints so it stays legible whether mirrored to a 10" tablet or a 65" TV.
 * Always dark (VenueDarkSurface), in the club's colors.
 */
const BoardOverview = ({
  now, onDeck, queuedCount, totalRounds, myName = "",
}: {
  now: BoardCard[];
  onDeck: BoardCard[];
  queuedCount: number;
  totalRounds: number;
  myName?: string;
}) => {
  const { t } = useLanguage();
  const isMine = (c: BoardCard) => entryIsMe(c.player1, myName) || entryIsMe(c.player2, myName);
  const venueLabel = "flex items-center gap-2 text-[clamp(0.75rem,1.2vw,0.95rem)] font-semibold uppercase tracking-[0.12em] text-muted-foreground";

  return (
    <VenueDarkSurface className="min-h-[60vh] rounded-[20px] p-4 sm:p-6">
      <p className={`${venueLabel} mb-3`}>
        <LiveDot /> {t("pt.boardOverview")} · {t("tournament.live")}
      </p>

      {now.length === 0 ? (
        <div className="py-12 text-center text-muted-foreground">
          <Monitor className="mx-auto mb-3 h-[clamp(2.5rem,5vw,4rem)] w-[clamp(2.5rem,5vw,4rem)] opacity-40" />
          <p className="text-[clamp(1rem,2vw,1.5rem)]">{t("pt.noOngoingMatches")}</p>
        </div>
      ) : (
        <div className="grid gap-3 sm:gap-4" style={{ gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, 320px), 1fr))` }}>
          {now.map((c) => <BoardOverviewCard key={c.id} card={c} totalRounds={totalRounds} mine={isMine(c)} />)}
        </div>
      )}

      {onDeck.length > 0 && (
        <div className="mt-6">
          <p className={`${venueLabel} mb-2`}>{t("pt.upNext")}</p>
          <div className="flex flex-wrap gap-2">
            {onDeck.map((c) => (
              <div key={c.id} className={`flex min-w-0 max-w-full items-center gap-2 rounded-2xl bg-card px-3 py-2 ${isMine(c) ? "border-2 border-accent" : "border border-border"}`}>
                <span className="shrink-0 rounded-md bg-primary px-1.5 py-0.5 font-display font-bold uppercase text-primary-foreground text-[clamp(0.75rem,1.1vw,0.9rem)]">{t("camera.board")} {c.board}</span>
                <span className="min-w-0 break-words font-semibold text-[clamp(0.9rem,1.5vw,1.15rem)]">
                  {c.player1} <span className="font-normal text-muted-foreground">{t("common.vs")}</span> {c.player2}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
      {queuedCount > 0 && (
        <p className={`${venueLabel} mt-3`}>
          +{queuedCount} {t("pt.moreMatchesQueued")}
        </p>
      )}
    </VenueDarkSurface>
  );
};

// A device showing this page (a TV, a tablet propped up at the entrance) often never
// gets touched again after setup, so the chosen view/rotation has to survive a reload on
// its own — persisted per-device in localStorage, with the URL's `?view=` taking priority
// so one link/QR code can pin a specific screen to a specific view regardless of history.
const VIEW_PREF_KEY = "dart-live-view-pref";
const AUTO_ROTATE_PREF_KEY = "dart-live-autorotate-pref";
/** Defaults to "average" here specifically (unlike Tournament.tsx's own Teilnehmer list, which
 *  defaults to alphabetical) — this is the unattended spectator screen, and leading with "who's
 *  actually playing best today" reads more like a live leaderboard than an alphabetical roster
 *  does. Persisted per-device like the other view prefs, since whoever sets up the TV/tablet
 *  picks this once, not per session. */
const PARTICIPANTS_SORT_PREF_KEY = "dart-live-participants-sort";
const AUTO_ROTATE_MS = 15000;
/** Which of the 4 rotation-eligible slots ("bracket" covers both tree and list — they're two
 *  presentations of the same data, never both in the rotation at once) auto-rotate should cycle
 *  through. Persisted per-device like the view/autorotate prefs above; defaults to everything on
 *  so an existing device's behavior doesn't change until someone deliberately narrows it down. */
// RotationSlot itself now comes from utils/tournament.ts (shared with Tournament.tsx's
// pre-start-visibility checkboxes, see the prestartViews gating further below).
const ROTATION_ORDER: RotationSlot[] = ["boards", "bracket", "participants", "highlights", "waiting", "format", "qr"];
const ROTATION_SLOTS_PREF_KEY = "dart-live-rotation-slots";
const DEFAULT_ROTATION_SLOTS: Record<RotationSlot, boolean> = {
  boards: true, bracket: true, participants: true, highlights: true,
  waiting: true, format: true, qr: true,
};

const PublicTournamentPage = () => {
  const isMobile = useIsMobile();
  const [myName, setMyNameRaw] = useState<string>(() => {
    try { return window.localStorage.getItem(MY_NAME_PREF_KEY) ?? ""; } catch { return ""; }
  });
  const setMyName = (name: string) => {
    setMyNameRaw(name);
    try {
      if (name) window.localStorage.setItem(MY_NAME_PREF_KEY, name);
      else window.localStorage.removeItem(MY_NAME_PREF_KEY);
    } catch { /* storage blocked (private mode) — the choice just doesn't persist */ }
  };
  const activeTabRef = useRef<HTMLButtonElement | null>(null);
  const [scaleIndex, setScaleIndexRaw] = useState<number>(() => {
    try { const n = Number(window.localStorage.getItem(UI_SCALE_PREF_KEY)); return Number.isInteger(n) && n >= 0 && n < UI_SCALES.length ? n : 0; } catch { return 0; }
  });
  const stepScale = (delta: number) => {
    const next = Math.min(UI_SCALES.length - 1, Math.max(0, scaleIndex + delta));
    setScaleIndexRaw(next);
    try { window.localStorage.setItem(UI_SCALE_PREF_KEY, String(next)); } catch { /* storage blocked: size just does not persist */ }
  };
  const [calm, setCalmRaw] = useState<boolean>(() => {
    try {
      const fromUrl = new URLSearchParams(window.location.search).get("calm");
      if (fromUrl !== null) return fromUrl === "1";
      return window.localStorage.getItem(CALM_PREF_KEY) === "1";
    } catch { return false; }
  });
  const { slug } = useParams<{ slug: string }>();
  // Aliased to `tr` (not the usual `t`) — this component already uses `t` for the tournament
  // record itself (a name from long before this page had any translations, too widely
  // referenced below to rename instead).
  const { t: tr, language, setLanguage } = useLanguage();
  const { logoUrl } = useClubBranding();
  const [t, setT] = useState<TournamentRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [flash, setFlash] = useState<Match | null>(null);
  const seenResults = useRef<Set<string> | null>(null);
  const flashTimer = useRef<number | null>(null);
  // "You're up next" audio/haptic cue — the push notification (Tournament.tsx's
  // notifyMatchReady) reaches a player's own phone, but THIS screen is the one thing actually
  // visible/audible in a loud venue, and a silent visual-only board update is easy to miss
  // entirely (Rangliste Runde 2 #10). Tracks which match ids currently occupy a board across
  // renders (mirrors the seenResults/flash pattern above), firing only for an id that's newly
  // present — never on first load (a room full of already-running boards shouldn't all chime at
  // once) and never twice for the same match.
  const boardAnnounceSeen = useRef<Set<string> | null>(null);
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
  const isViewKey = (v: string | null): v is ViewKey => !!v && (ALL_VIEW_KEYS as string[]).includes(v);
  const hadExplicitViewPref =
    isViewKey(urlView) || urlView === "auto" ||
    (typeof window !== "undefined" && !!window.localStorage.getItem(VIEW_PREF_KEY));
  const [view, setViewRaw] = useState<ViewKey>(() => {
    if (typeof window === "undefined") return "tree";
    if (isViewKey(urlView)) return urlView;
    const stored = window.localStorage.getItem(VIEW_PREF_KEY);
    if (isViewKey(stored)) return stored;
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
  useEffect(() => {
    activeTabRef.current?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [view, autoRotate]);

  const setCalm = (next: boolean) => {
    setCalmRaw(next);
    try { window.localStorage.setItem(CALM_PREF_KEY, next ? "1" : "0"); } catch { /* storage blocked */ }
    if (next) {
      // a calm screen has no buttons to switch pages with, so the pages rotate by themselves
      setAutoRotateRaw(true);
      try { window.localStorage.setItem(AUTO_ROTATE_PREF_KEY, "1"); } catch { /* storage blocked */ }
    }
  };

  const selectView = (next: ViewKey) => {
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

  const [participantSort, setParticipantSortRaw] = useState<ParticipantSortMode>(() => {
    if (typeof window === "undefined") return "average";
    return window.localStorage.getItem(PARTICIPANTS_SORT_PREF_KEY) === "alpha" ? "alpha" : "average";
  });
  const setParticipantSort = (next: ParticipantSortMode) => {
    setParticipantSortRaw(next);
    if (typeof window !== "undefined") window.localStorage.setItem(PARTICIPANTS_SORT_PREF_KEY, next);
  };

  /** Anonymous spectators can't read games/game_legs directly (authenticated-only RLS) — this
   *  goes through the public_tournament_highlights RPC instead, which is gated on the same
   *  public_view flag tournaments_public already uses (see its migration for the full reasoning).
   *  The RPC piggybacks each game's average columns onto every one of its leg rows (one RPC, not
   *  two) — de-duplicate by game_id before handing them to computeTournamentAverages, which
   *  expects one row per game. Shared by the Highlights panel and the participants rotation view
   *  — there's no cheaper "averages only" endpoint for anonymous spectators, so both draw on the
   *  same one-time fetch instead of hitting the RPC twice. */
  const loadHighlightsAndAverages = useCallback(async (tournamentId: string, roster: string[]) => {
    const { data } = await supabase.rpc("public_tournament_highlights", { _tournament_id: tournamentId });
    const rows = (data || []) as unknown as (TournamentStatsLegRow & {
      game_id: string; leg_number: number; player1_id: string | null; player1_name: string; player1_average: number;
      player2_id: string | null; player2_name: string; player2_average: number;
    })[];
    const activeRoster = new Set(roster);
    // A withdrawn player's historical legs/games are still real rows in the DB (their past
    // results genuinely happened) but shouldn't keep surfacing in highlights once they're no
    // longer actually in the tournament. Filtering the raw leg rows by the CURRENT roster (one
    // row per player per leg) correctly drops exactly their own contributions while keeping
    // their past opponents' own rows intact — this also cascades into topCheckout/shortestLeg,
    // not just the participants table.
    setTournamentHighlights(computeTournamentHighlights(rows.filter((r) => activeRoster.has(r.player_name))));
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
    const gameRows = [...gamesByGameId.values()];
    // Passing the raw leg rows too fills in a team game's non-representative teammates in the
    // participants leaderboard — gameRows alone only ever names the one representative per side
    // (games.player1_id/player2_id), the same gap already fixed for the member-facing stats page.
    const averages = computeTournamentAverages(gameRows, rows);
    // Per-leg breakdown intentionally uses the UNFILTERED rows — a withdrawn player's own
    // already-played matches still show their real leg-by-leg average when expanded, same as the
    // match row itself (averages.games below) already isn't roster-filtered either.
    const legAveragesByGame = computeLegAveragesByGame(rows, gameRows);
    // Games rows cover both players at once, so dropping the row (like above) would also lose
    // the other, still-active player's data — filter the computed per-participant list instead.
    setTournamentAverages({
      participants: averages.participants.filter((p) => activeRoster.has(p.name)),
      games: averages.games.map((g) => ({ ...g, legs: legAveragesByGame.get(g.gameId) })),
    });
  }, []);

  // Only when the participants or highlights view is actually (or about to be, via rotation) on
  // screen — most spectators just watch the board/bracket view and never touch either of the
  // stats surfaces, so firing this RPC unconditionally for every page load would be a lot of
  // wasted per-dart throw data fetched for nothing on what's often a multi-viewer live-event page.
  // Re-fires on every `t` refresh (the same ~8s poll/realtime cadence as the rest of the live
  // view) rather than just once — it used to only ever fetch a single time per page visit
  // (gated behind `!tournamentAverages`), so a spectator who opened Highlights early in the
  // event kept seeing the same frozen numbers for the rest of it.
  useEffect(() => {
    if (!t) return;
    const willShowStats = view === "participants" || view === "highlights" || (autoRotate && (rotationSlots.participants || rotationSlots.highlights));
    if (!willShowStats) return;
    loadHighlightsAndAverages(t.id, t.players);
  }, [t, view, autoRotate, rotationSlots, loadHighlightsAndAverages]);

  /** The slot a given `view` value belongs to — tree/list both count as "bracket" since they're
   *  two presentations of the same data, never independently rotation-eligible. Also the shared
   *  taxonomy the pre-start gate (further below) checks against, via the same RotationSlot type
   *  the organizer's prestart_views checkboxes in Tournament.tsx use. */
  const slotOf = (v: ViewKey): RotationSlot =>
    v === "boards" || v === "participants" || v === "highlights" || v === "waiting" || v === "format" || v === "qr" ? v : "bracket";
  const viewForSlot = (slot: RotationSlot): ViewKey =>
    slot === "bracket" ? bracketViewRef.current : slot;

  // Computed here rather than after the loading/notFound early returns below — the auto-rotation
  // effects right below need it, and hooks must run unconditionally on every render regardless of
  // loading state, so `t` may still be null at this point during the initial load. Client-side
  // only: `view` was already driven entirely by local state/localStorage/the `?view=` param with
  // zero server enforcement before this, and still is — a curious visitor can still force a
  // locked view via that same URL param. A UI nicety appropriate for a club event, not a real
  // access boundary.
  // Automatic (first real result) OR an explicit organizer override for releasing early on
  // purpose, independent of match results.
  const started = t ? hasStarted(t) || !!t.manual_release : false;
  const prestartViews = t?.prestart_views?.length ? t.prestart_views : DEFAULT_PRESTART_VIEWS;
  const isLocked = (v: ViewKey) => !started && !prestartViews.includes(slotOf(v));
  // A plain string, not `prestartViews` itself, as the effects' dependency below — `t` (and with
  // it `t.prestart_views`) gets a brand-new array reference on every ~8s poll tick even when its
  // actual content hasn't changed, which was resetting the 15s rotation interval before it ever
  // got to fire a single switch. Content-derived strings compare by value, so this only changes
  // when the configured pre-start pages actually do.
  const prestartViewsKey = prestartViews.join(",");

  useEffect(() => {
    if (!autoRotate) return;
    // Pre-start, don't rotate through locked slots — an unattended screen shouldn't spend 15s
    // showing a lock-hint panel nobody asked to see.
    const enabledSlots = ROTATION_ORDER.filter((s) => rotationSlots[s] && (started || prestartViews.includes(s)));
    if (enabledSlots.length === 0) return;
    const id = window.setInterval(() => {
      setViewRaw((v) => {
        const curIdx = enabledSlots.indexOf(slotOf(v));
        const nextSlot = enabledSlots[(curIdx + 1) % enabledSlots.length];
        return viewForSlot(nextSlot);
      });
    }, AUTO_ROTATE_MS);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRotate, rotationSlots, started, prestartViewsKey]);

  // If the currently-shown view's slot gets unchecked (or locked) while auto-rotating, jump to
  // the next enabled one immediately instead of waiting out the rest of the interval.
  useEffect(() => {
    if (!autoRotate) return;
    if (rotationSlots[slotOf(view)] && !isLocked(view)) return;
    const enabledSlots = ROTATION_ORDER.filter((s) => rotationSlots[s] && (started || prestartViews.includes(s)));
    if (enabledSlots.length > 0) setViewRaw(viewForSlot(enabledSlots[0]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rotationSlots, autoRotate, started, prestartViewsKey]);

  // Two defaults, only when nothing already chose a view explicitly (URL param or a remembered
  // device preference), and only running once so neither ever overrides a view picked by hand
  // afterwards: (1) pre-start, land on the first configured pre-start page instead of a locked
  // bracket/list — a fresh visitor before doors open shouldn't immediately hit a lock-hint panel;
  // (2) once started, a 32+ player mirrored tree can't stay legible at any scale that also fits a
  // screen, so default those straight to the always-readable round list instead.
  useEffect(() => {
    if (autoViewSetRef.current || !t || hadExplicitViewPref) return;
    autoViewSetRef.current = true;
    if (!started) {
      const first = prestartViews[0] as ViewKey | undefined;
      if (first) { setViewRaw(first); return; }
    }
    const isKoNow = t.mode !== "round-robin";
    const ms = (t.bracket as Match[]) || [];
    const rounds = isKoNow && ms.length > 0 ? Math.max(...ms.map(m => m.round)) : 0;
    if (rounds >= 5) { setViewRaw("list"); bracketViewRef.current = "list"; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, hadExplicitViewPref, started, prestartViewsKey]);

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

  // Recomputes the same "now on a board" set the render below builds from `t.bracket` (KO via
  // currentBoardSchedule, round-robin via roundRobinBoardCards) rather than reusing the render
  // body's own boardCardsNow — that's derived after this component's loading early-return further
  // down, so it isn't available to a hook, which must run unconditionally on every render.
  useEffect(() => {
    if (!t) return;
    const bCount = Math.max(1, t.boards || 2);
    const nowIds = t.mode === "round-robin"
      ? new Set(roundRobinBoardCards(t.bracket as unknown as RoundRobinMatch[], bCount).now.map((c) => c.id))
      : new Set(currentBoardSchedule(t.bracket as Match[], bCount).now.map((e) => e.match.id));
    if (boardAnnounceSeen.current === null) { boardAnnounceSeen.current = nowIds; return; }
    const isNewOnBoard = [...nowIds].some((id) => !boardAnnounceSeen.current!.has(id));
    boardAnnounceSeen.current = nowIds;
    if (isNewOnBoard) playWalkonSound();
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

  // Separate effect (not folded into the slug-keyed one above) since it needs t.id, which isn't
  // known until that first load() resolves. Subscribes to pushLiveSnapshot's broadcast channel
  // (see tournamentMatchSync.ts) as a fast path layered on top of the postgres_changes/poll above
  // — that one still fires regardless and remains the durable source of truth for a viewer who
  // missed the broadcast; this only makes a mid-match score tick feel instant instead of
  // up-to-8s-stale, by patching just the one affected match's `live` field directly.
  useEffect(() => {
    if (!t?.id) return;
    const id = t.id;
    const channel = supabase
      .channel(`tournament-live-${id}`)
      .on("broadcast", { event: "live" }, ({ payload }) => {
        const { matchId, snapshot } = payload as { matchId: string; snapshot: LiveSnapshot };
        setT((prev) => (prev && prev.id === id
          ? { ...prev, bracket: prev.bracket.map((m) => (m.id === matchId ? { ...m, live: snapshot } : m)) }
          : prev));
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [t?.id]);

  // Called unconditionally, ahead of the loading/not-found early returns below — hooks can't be
  // called after an early return, so this can't sit next to isKo/matches (both AFTER those
  // returns, since they safely dereference `t` without a null check). Safe to call with `t` still
  // null: every effect/callback inside already no-ops on a falsy tournamentId. KO only — round-
  // robin matches live in a different shape (RoundRobinMatch, no stable Match.id to key a
  // prediction on), see the match_predictions migration's own note.
  const predictions = useMatchPredictions(t && t.mode !== "round-robin" ? t.id : undefined, !!t && t.mode !== "round-robin");

  if (loading) {
    return (
      <div role="status" aria-label={tr("common.loading")} className="min-h-screen bg-background flex items-center justify-center">
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

  const viewTabs: { key: ViewKey; icon: JSX.Element; label: string }[] = [
    { key: "boards", icon: <Monitor className="w-3.5 h-3.5" />, label: tr("pt.boardOverview") },
    ...(isKo ? [
      { key: "tree" as ViewKey, icon: <Network className="w-3.5 h-3.5" />, label: tr("tournament.bracketTreeTab") },
      { key: "list" as ViewKey, icon: <Rows3 className="w-3.5 h-3.5" />, label: tr("pt.roundList") },
    ] : [
      // Group mode: the table. It used to have no tab, so once another page was picked it could not be reached again.
      { key: "list" as ViewKey, icon: <ListOrdered className="w-3.5 h-3.5" />, label: tr("pt.standings") },
    ]),
    { key: "participants", icon: <Users className="w-3.5 h-3.5" />, label: tr("pt.participantsView") },
    { key: "highlights", icon: <Target className="w-3.5 h-3.5" />, label: tr("pt.highlightsLabel") },
    { key: "waiting", icon: <Hourglass className="w-3.5 h-3.5" />, label: tr("pt.waitingTab") },
    { key: "format", icon: <ListOrdered className="w-3.5 h-3.5" />, label: tr("pt.formatTab") },
    { key: "qr", icon: <QrCode className="w-3.5 h-3.5" />, label: tr("pt.qrTab") },
  ];
  const spectatorNames = [...new Set(t.players.flatMap((p) => splitTeamName(p)))].sort((a, b) => a.localeCompare(b));

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border px-4 sm:px-6 py-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <img src={logoUrl} alt="Logo" className="w-11 h-11 rounded-xl object-cover border border-border bg-muted shrink-0" />
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className={`inline-flex items-center gap-1.5 shrink-0 ${t.champion ? "" : "text-secondary"}`}>
                {t.champion ? (
                  <>
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-muted-foreground" /> {tr("pt.finished")}
                  </>
                ) : (
                  <>
                    <LiveDot /> {tr("tournament.live")}
                  </>
                )}
              </span>
              <span>
                {t.players.length} {tr("game.playersSuffix")} · {t.game_mode} FT{Math.ceil(t.best_of_legs / 2)}
                {!!t.best_of_sets && ` (${tr("game.setsSuffix")} FT${Math.ceil(t.best_of_sets / 2)})`}
                {" "}· {boardsCount} {tr("camera.board")}{boardsCount > 1 ? "s" : ""}
              </span>
            </p>
            <h1 className="font-display font-bold text-[clamp(1.6rem,3vw,2.5rem)] leading-tight break-words">{t.name}</h1>
          </div>
        </div>
        {t.champion && (
          <div className="rounded-2xl border border-border bg-card px-3 py-2 text-right shrink-0">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{tr("pt.champion")}</p>
            <p className="font-display font-bold text-2xl leading-tight"><Trophy aria-hidden className="inline w-5 h-5 -mt-1 mr-1 text-accent" />{t.champion}</p>
          </div>
        )}
      </header>

      {/* Always visible regardless of which view is active — previously this only rendered
          inside the tree/list branch, so landing on (or switching to) Board-Übersicht had no
          way back to the bracket at all. Also the shared fullscreen target — wrapping the
          toolbar in it too (not just the content below) means switching views, adjusting
          rotation, or exiting fullscreen never requires leaving fullscreen first. */}
      <div ref={viewWrapRef} className="px-4 pt-4 bg-background" style={UI_SCALES[scaleIndex] === 1 ? undefined : { zoom: UI_SCALES[scaleIndex] }}>
        {calm && (
          <button
            onClick={() => setCalm(false)}
            className="fixed right-2 top-2 z-40 rounded-lg border border-border bg-background/80 px-2.5 py-1.5 text-xs text-muted-foreground opacity-25 transition-opacity hover:opacity-100 focus:opacity-100"
          >
            {tr("pt.calmExit")}
          </button>
        )}
        <div className={`mb-2 ${calm ? "hidden" : "flex"} flex-wrap items-center gap-2`}>
          <div className="-mx-4 w-[calc(100%+2rem)] overflow-x-auto px-4 py-1 no-scrollbar sm:mx-0 sm:w-auto sm:overflow-visible sm:p-0">
          {/* flex-wrap (not overflow-x-auto scroll) — at a phone-width viewport (the actual
           *  real-world source for a beamer/TV mirror, not just a spectator's own screen) 8
           *  buttons badly overflowed a single scrollable row: only the first 3 stayed visible,
           *  requiring the operator to scroll blind to reach the rest. Wrapping shows every
           *  button always, at any width, instead of hiding most of them off-screen. */}
          <div className="flex w-max gap-1.5 sm:w-auto sm:max-w-full sm:flex-wrap">
            {viewTabs.map((tab) => {
              // in group mode "tree" and "list" both show the table, so either marks its tab
              const active = (view === tab.key || (!isKo && tab.key === "list" && view === "tree")) && !autoRotate;
              return (
                <button
                  key={tab.key}
                  ref={active ? activeTabRef : undefined}
                  onClick={() => selectView(tab.key)}
                  className={`h-9 px-3 rounded-xl border text-sm font-medium flex items-center gap-1.5 shrink-0 whitespace-nowrap ${active ? "bg-primary border-primary text-primary-foreground" : "border-border hover:bg-muted text-muted-foreground"}`}
                >
                  {tab.icon} {tab.label} {isLocked(tab.key) && <Lock className="w-3 h-3" />}
                </button>
              );
            })}
          </div>
          </div>
          <button
            onClick={toggleAutoRotate}
            className={`h-9 px-3 rounded-xl border text-xs font-medium flex items-center gap-1.5 ${autoRotate ? "border-secondary bg-secondary/15 text-secondary" : "border-border hover:bg-muted text-muted-foreground"}`}
            title={tr("pt.autoRotateTooltip")}
          >
            <RefreshCcw className={`w-3.5 h-3.5 ${autoRotate ? "animate-pulse" : ""}`} /> {tr("pt.autoSwitch")}
          </button>
          <button
            onClick={() => setShowRotationSettings((v) => !v)}
            className={`h-9 px-2.5 rounded-xl border text-xs flex items-center gap-1 ${showRotationSettings ? "border-secondary bg-secondary/15 text-secondary" : "border-border hover:bg-muted text-muted-foreground"}`}
            title={tr("pt.rotationSettingsTooltip")}
            aria-label={tr("pt.rotationSettingsTooltip")}
          >
            <Settings2 className="w-3.5 h-3.5" />
          </button>
          <div className="ml-auto inline-flex h-9 overflow-hidden rounded-xl border border-border" role="group" aria-label={tr("pt.textSize")}>
            <button onClick={() => stepScale(-1)} disabled={scaleIndex === 0} className="px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-muted disabled:opacity-40" aria-label={tr("pt.textSmaller")}>A−</button>
            <button onClick={() => stepScale(1)} disabled={scaleIndex === UI_SCALES.length - 1} className="border-l border-border px-2.5 py-1.5 text-sm text-muted-foreground hover:bg-muted disabled:opacity-40" aria-label={tr("pt.textLarger")}>A+</button>
          </div>
          <button
            onClick={() => setCalm(true)}
            className="h-9 px-2.5 rounded-xl border border-border text-xs font-medium flex items-center gap-1.5 hover:bg-muted text-muted-foreground"
            title={tr("pt.calmTooltip")}
          >
            <EyeOff className="w-3.5 h-3.5" /> {tr("pt.calm")}
          </button>
          <button
            onClick={toggleFullscreen}
            className="h-9 px-2.5 rounded-xl border border-border text-xs font-medium flex items-center gap-1.5 hover:bg-muted text-muted-foreground"
            title={isFullscreen ? tr("pt.exitFullscreen") : tr("pt.enterFullscreenTv")}
          >
            {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            {isFullscreen ? tr("pt.exitFullscreen") : tr("pt.fullscreenShort")}
          </button>
          {/* DE/EN only here (not the app's full 6-language list) — a spectator following a QR
           *  code cold has no prior language preference at all, and this is the one page in the
           *  app anonymous visitors actually reach. Shares the same LanguageContext/localStorage
           *  key as the rest of the app, just with a compact 2-option control instead of Settings'
           *  full dropdown. */}
          <div className="inline-flex h-9 rounded-xl border border-border overflow-hidden shrink-0">
            <button
              onClick={() => setLanguage("de")}
              className={`px-2.5 py-1.5 text-xs font-medium ${language === "de" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              DE
            </button>
            <button
              onClick={() => setLanguage("en")}
              className={`px-2.5 py-1.5 text-xs font-medium border-l border-border ${language === "en" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              EN
            </button>
          </div>
        </div>
        {showRotationSettings && !calm && (
          <div className="mb-2 rounded-[20px] border border-border bg-card p-3 max-w-xl">
            <p className="text-[11px] text-muted-foreground mb-2">{tr("pt.rotationSettingsDesc")}</p>
            <div className="flex flex-wrap gap-2">
              {([
                { slot: "boards" as const, label: tr("pt.boardOverview") },
                { slot: "bracket" as const, label: isKo ? tr("tournament.bracketTreeTab") : tr("pt.standings") },
                { slot: "participants" as const, label: tr("pt.participantsView") },
                { slot: "highlights" as const, label: tr("pt.highlightsLabel") },
                { slot: "waiting" as const, label: tr("pt.waitingTab") },
                { slot: "format" as const, label: tr("pt.formatTab") },
                { slot: "qr" as const, label: tr("pt.qrTab") },
              ]).map((opt) => (
                <button
                  key={opt.slot}
                  onClick={() => toggleRotationSlot(opt.slot)}
                  className={`flex items-center gap-1.5 h-9 px-2.5 rounded-xl border text-xs ${rotationSlots[opt.slot] ? "border-secondary bg-secondary/15 text-secondary" : "border-border text-muted-foreground"}`}
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

      {started && !t.champion && !calm && (
        <MyMatchBar names={spectatorNames} myName={myName} onChange={setMyName} now={boardCardsNow} onDeck={boardCardsOnDeck} />
      )}

      {isLocked(view) ? (
        <div className="flex flex-col items-center justify-center text-center py-16 px-4 min-h-[40vh]">
          <Lock className="w-8 h-8 text-muted-foreground mb-3" />
          <p className="text-sm text-muted-foreground max-w-xs">{tr("pt.lockedViewHint")}</p>
        </div>
      ) : view === "highlights" ? (
        <div className="px-4 pb-6">
          {/* No max-w here (used to cap at max-w-2xl) — a TV/tablet propped up for the live
              rotation has the width to spare, and the highlight table only grows as the
              tournament goes on, so it should use that width rather than stay narrow and squeeze
              a growing row/column count into a fixed small box. */}
          <LivePanel>
            <LiveSectionLabel className="mb-3"><Target className="w-4 h-4" /> {tr("pt.highlightsLabel")}</LiveSectionLabel>
            {!tournamentHighlights || !tournamentAverages ? (
              <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
            ) : (
              <TournamentHighlightsPanel highlights={tournamentHighlights} averages={tournamentAverages} liveView />
            )}
          </LivePanel>
        </div>
      ) : view === "participants" ? (
        <div className="px-4 pb-6">
          <LivePanel className="p-3">
            <div className="flex items-center justify-between gap-2 mb-2">
              <LiveSectionLabel><Users className="w-4 h-4" /> {tr("pt.participantsView")}</LiveSectionLabel>
              <div className="inline-flex h-9 rounded-xl border border-border overflow-hidden shrink-0">
                <button
                  onClick={() => setParticipantSort("alpha")}
                  className={`px-3 text-xs font-semibold uppercase tracking-wide ${participantSort === "alpha" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                >
                  A-Z
                </button>
                <button
                  onClick={() => setParticipantSort("average")}
                  className={`px-3 text-xs font-semibold uppercase tracking-wide border-l border-border ${participantSort === "average" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                >
                  Ø
                </button>
              </div>
            </div>
            {/* No longer gated on tournamentAverages — names + elimination-status coloring need
                no network data at all (eliminationStatus is derived straight from the bracket
                already in hand), so blocking the whole grid behind that RPC used to show a
                spinner instead of the one thing that was actually ready immediately. Each card's
                own Ø average just reads "–" until averages load in, same as before — and once
                they do, an Ø-sorted grid will visibly reorder itself as the tournament goes on,
                same as a live leaderboard would. */}
            <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-1.5">
              {sortParticipants(t.players, participantSort, tournamentAverages).map((p) => {
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
                  <div key={p} className={`rounded-xl bg-muted border-l-4 ${borderColor} px-2.5 py-1.5 min-w-0 ${status === "eliminated" ? "opacity-60" : ""}`}>
                    <p className="truncate text-sm font-semibold">{status === "champion" && "🏆 "}{p}</p>
                    <p className="font-display font-bold tabular-nums text-lg leading-tight">
                      {avgRow && avgRow.tournamentAverage > 0 ? `Ø ${avgRow.tournamentAverage.toFixed(1)}` : "–"}
                    </p>
                  </div>
                );
              })}
            </div>
          </LivePanel>
        </div>
      ) : view === "boards" ? (
        <div className="pb-4"><BoardOverview myName={myName} now={boardCardsNow} onDeck={boardCardsOnDeck} queuedCount={boardCardsQueued} totalRounds={totalRounds} /></div>
      ) : view === "waiting" ? (
        <WaitingSplash name={t.name} />
      ) : view === "format" ? (
        <FormatStatusPage tournament={t} matches={matches} isKo={isKo} totalRounds={totalRounds} started={started} />
      ) : view === "qr" ? (
        <QrInvitePage url={typeof window !== "undefined" ? window.location.href.split("?")[0] : ""} name={t.name} />
      ) : (
      <div className={`grid gap-4 p-4 ${view === "tree" ? "" : "lg:grid-cols-[1fr_320px]"}`}>
        <div className="min-w-0">
          {isKo && (
            <MatchPredictionsPanel
              matches={matches}
              tallies={predictions.tallies}
              myVotes={predictions.myVotes}
              onVote={predictions.castVote}
            />
          )}
          {/* "Jetzt am Board" used to duplicate here too — removed, the dedicated Board-Übersicht
              view (see view === "boards" above) is the one place for that now, so switching to
              tree/list/round-robin isn't showing the same live-match cards twice. */}
          {isKo ? (
            isMobile ? (
              <MobileBracket
                matches={matches}
                totalRounds={totalRounds}
                roundConfigs={t.round_configs}
                fallbackMode={t.game_mode}
                fallbackBestOf={t.best_of_legs}
              />
            ) : view === "tree" ? (
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
        /* order-first below lg — "Als Nächstes"/Live-Ticker used to always sit AFTER the main
         *  content in DOM order, which only reads as a side column once there's room for the 2-col
         *  grid (lg+). Below that (the actual real-world case: a phone's own narrow viewport
         *  mirrored to a beamer/TV, not a wide desktop) it just stacked BELOW the whole round
         *  list/tree instead, so "who's up next" was scrolled well out of view on first glance. */
        <aside className="flex flex-col gap-4 lg:sticky lg:top-4 self-start order-first lg:order-none">
          {isKo && (
            <LivePanel>
              <div className="flex items-center justify-between mb-3">
                <LiveSectionLabel><ListOrdered className="w-4 h-4" /> {tr("pt.upNext")}</LiveSectionLabel>
                <span className="text-xs text-muted-foreground flex items-center gap-1 tabular-nums">
                  <Monitor className="w-3.5 h-3.5" /> {boardsCount}
                </span>
              </div>
              {onDeck.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {nowBoards.length === 0 ? tr("pt.noPairingsYet") : tr("pt.allKnownPairingsRunning")}
                </p>
              ) : (
                // Each board now advances independently (see currentBoardSchedule), so this list
                // can mix rounds — one board can already be on-deck for round 2 while another is
                // still finishing round 1. A single shared header used to label the whole list off
                // just the first entry's round, which is only ever wrong once boards drift apart.
                <ul className="space-y-1.5">
                  {onDeck.map(({ board, match: m }) => (
                    <li key={m.id} className="flex items-center gap-2 text-sm bg-muted rounded-xl px-2.5 py-2">
                      <Badge variant="outline" className="rounded-md text-[10px] font-semibold bg-primary text-primary-foreground px-1.5 py-0.5 shrink-0 border-transparent">
                        {tr("camera.board")} {board}
                      </Badge>
                      <span className="truncate font-semibold flex-1">
                        {m.player1} <span className="text-muted-foreground font-normal">{tr("common.vs")}</span> {m.player2}
                      </span>
                      <span className="text-[11px] text-muted-foreground shrink-0">{roundLabel(m.round, totalRounds)}</span>
                    </li>
                  ))}
                </ul>
              )}
              {queuedCount > 0 && (
                <p className="mt-2.5 pt-2 border-t border-border text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  +{queuedCount} {tr("pt.moreMatchesQueued")}
                </p>
              )}
            </LivePanel>
          )}

          <LivePanel>
            <LiveSectionLabel className="mb-3"><Zap className="w-4 h-4" /> {tr("pt.liveTicker")}</LiveSectionLabel>
            {completed.length === 0 ? (
              <p className="text-sm text-muted-foreground">{tr("pt.noCompletedMatches")}</p>
            ) : (
              <ol className="divide-y divide-border">
                {completed.map(m => (
                  <li key={m.id} className="py-2 first:pt-0 text-sm">
                    <p className="font-semibold">
                      <span className="text-secondary">{m.winner}</span>
                      <span className="text-muted-foreground font-normal"> {tr("tournament.beats")} </span>
                      {m.winner === m.player1 ? m.player2 : m.player1}
                    </p>
                    <p className="text-xs text-muted-foreground tabular-nums">{roundLabel(m.round, totalRounds)} · {m.score1 ?? 0}:{m.score2 ?? 0}</p>
                  </li>
                ))}
              </ol>
            )}
            <div className="mt-3 pt-3 border-t border-border text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5" /> {t.players.length} {tr("tournament.participants")}
            </div>
          </LivePanel>
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
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 w-[calc(100%-2rem)] max-w-xl animate-slide-up">
          <div className="rounded-[20px] border border-border bg-card px-6 py-4 text-center shadow-elevation-lg">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground mb-1">{tr("pt.resultLabel")} · {roundLabel(flash.round, totalRounds)}</p>
            <p className="font-display font-bold text-[clamp(1.5rem,3vw,2.25rem)] leading-tight break-words">
              <span className="text-secondary">{flash.winner}</span>
              <span className="text-muted-foreground font-medium text-lg"> {tr("tournament.beats")} </span>
              {flash.winner === flash.player1 ? flash.player2 : flash.player1}
            </p>
            <p className="font-display font-bold tabular-nums text-3xl mt-1">{flash.score1 ?? 0} : {flash.score2 ?? 0}</p>
          </div>
        </div>
      )}
      </div>
    </div>
  );
};

export default PublicTournamentPage;