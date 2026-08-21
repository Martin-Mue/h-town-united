import { useState, useEffect, useCallback, useMemo, useRef, Fragment } from "react";
import { Trophy, Plus, Play, RotateCcw, Trash2, Loader2, Users, Check, Sparkles, Layers, Radio, Copy, Zap, Maximize2, ZoomIn, ZoomOut, ChevronDown, ChevronUp, Shuffle, ArrowUp, ArrowDown, Settings2, PencilLine, ListOrdered, Network, UserMinus, Monitor, QrCode, RefreshCcw, Target } from "lucide-react";
import { computeTournamentHighlights, computeTournamentAverages, type TournamentHighlights, type TournamentAverages, type TournamentStatsLegRow, type TournamentStatsGameRow } from "@/utils/tournamentStats";
import TournamentHighlightsPanel from "@/components/tournament/TournamentHighlightsPanel";
import QrCodeDialog from "@/components/QrCodeDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { usePagedList } from "@/hooks/usePagedList";
import { ListPaginationFooter } from "@/components/ui/list-pagination-footer";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import type { Database, Json } from "@/integrations/supabase/types";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { LOCALE_BY_LANGUAGE } from "@/i18n/translations";
import { useToast } from "@/hooks/use-toast";
import { fetchClubPlayers, type ClubPlayer } from "@/lib/repositories/players";
import TrophyCeremony from "@/components/tournament/TrophyCeremony";
import htuEmblem from "@/assets/club-emblem.png";
import { Link, useNavigate } from "react-router-dom";
import {
  type Match,
  type RoundRobinMatch,
  type RoundRobinStanding,
  BYE,
  isRealPlayer,
  isPlayable,
  recomputeBracket,
  bracketChampion,
  buildSchedule,
  totalRoundsOf,
  resolveMatchUserIds,
  buildMatchReadyPush,
  currentBoardSchedule,
  isLiveSnapshotFresh,
  assignScorekeepers,
  roundLabelFor,
  scorekeeperLabel,
  calcStandings,
  newlyPlayableMatches,
} from "@/utils/tournament";

interface RoundConfig {
  mode: string;      // "501" | "301" | "Cricket" | "Extern"
  bestOf: number;    // best-of legs
}

interface SeriesRecord {
  id: string;
  name: string;
}

interface TournamentRecord {
  id: string;
  user_id?: string;
  name: string;
  mode: string;
  status: string;
  champion: string | null;
  players: string[];
  bracket: Match[] | RoundRobinMatch[];
  created_at: string;
  game_mode?: string;
  best_of_legs?: number;
  series_id?: string | null;
  round_configs?: RoundConfig[];
  public_view?: boolean;
  public_slug?: string | null;
  boards?: number;
  /** Off = pure bracket display + manual result entry, no "Spiel starten" button anywhere. Defaults on. */
  live_play_enabled?: boolean;
  /** Who's actually shown up, keyed by participant name (same name-keyed space as `players`/
   *  `bracket`) — organizer-only check-in state, independent of match results. */
  attendance?: Record<string, boolean> | null;
}

const BRACKET_SIZES = [4, 8, 16, 32, 64];
const BEST_OF_OPTIONS = [1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21];

const nextPowerOfTwo = (count: number) => Math.pow(2, Math.ceil(Math.log2(Math.max(count, 2))));
const lowerPowerOfTwo = (count: number) => Math.pow(2, Math.floor(Math.log2(Math.max(count, 2))));

/**
 * Picks the "auto" main bracket size for a field of `count` players. Both a preliminary
 * round (main size = lowerPowerOfTwo) and BYE-only padding (main size = the next power of
 * two up) end up producing the exact same set of matches for the players who'd be "extra"
 * either way — the only real difference is how many players are affected: a preliminary
 * round makes `2 * excess` players play one more match than everyone else, while BYE
 * padding just leaves `next - count` players idle for a round. So: use whichever framing
 * touches fewer players. E.g. 30 players is much closer to 32 than to 16 — a 32er bracket
 * with 2 BYEs beats forcing 28 of the 30 through a preliminary round to fill a 16er.
 * 34 players is the opposite case — 2 preliminary matches (4 players) beats a 64er
 * bracket with 30 BYE slots.
 */
const chooseAutoMainSize = (count: number): number => {
  const lower = Math.min(64, lowerPowerOfTwo(Math.max(count, 2)));
  if (count <= lower) return lower;
  const upper = lower * 2;
  if (upper > 64) return lower; // 64 is the largest supported bracket — no bigger option to compare against
  const excess = count - lower;
  const prelimPlayers = excess * 2;
  const byesIfUpper = upper - count;
  return byesIfUpper <= prelimPlayers ? upper : lower;
};

// A 32+ player mirrored tree can't stay legible at any scale that also fits a screen —
// default those straight to the always-readable "Spielplan" list instead of the tree.
const defaultBracketView = (bracket: Match[] | undefined): "tree" | "schedule" => {
  if (!bracket || bracket.length === 0) return "tree";
  const totalRounds = totalRoundsOf(bracket);
  return totalRounds >= 5 ? "schedule" : "tree";
};

const shuffle = <T,>(list: T[]) => {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
};

/** deterministic PRNG so preview and generated bracket use the exact same draw */
const mulberry32 = (seed: number) => {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const seededShuffle = <T,>(list: T[], seed: number) => {
  const rnd = mulberry32(seed);
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
};

/**
 * Distributes BYEs evenly across the first round: every player with a bye is placed
 * into their own match, spread over the bracket (never two byes next to each other
 * while real pairings are still possible).
 */
const distributeByes = (ordered: string[], size: number): string[] => {
  const slots: string[] = new Array(size).fill(BYE);
  const matchCount = size / 2;
  const byes = size - ordered.length;
  if (byes <= 0) return [...ordered];
  const list = [...ordered];
  // choose which matches get a bye – evenly spaced across the bracket
  const byeMatches = new Set<number>();
  const step = matchCount / Math.min(byes, matchCount);
  for (let i = 0; i < Math.min(byes, matchCount); i++) {
    byeMatches.add(Math.min(matchCount - 1, Math.round(i * step)));
  }
  for (let m = 0; m < matchCount; m++) {
    if (byeMatches.has(m)) {
      slots[m * 2] = list.shift() ?? BYE;
      slots[m * 2 + 1] = BYE;
    }
  }
  for (let m = 0; m < matchCount; m++) {
    if (byeMatches.has(m)) continue;
    slots[m * 2] = list.shift() ?? BYE;
    slots[m * 2 + 1] = list.shift() ?? BYE;
  }
  return slots;
};

interface Seeding {
  /** Round-1 slots (length = mainSize). `undefined` means "pending — filled by a preliminary-round winner". */
  round1: (string | undefined)[];
  prelimPairs: [string, string][];
  /** Parallel to prelimPairs: which round-1 match/slot that preliminary match's winner feeds into. */
  prelimFeeds: { position: number; slot: 1 | 2 }[];
}

/**
 * Seeds a clean power-of-two main bracket of `mainSize` players. When the real
 * player count exceeds `mainSize`, the excess plays a small preliminary round
 * (real matches, no BYEs) instead of padding the whole tree with BYEs up to the
 * next power of two above — e.g. 34 players → a 32er main bracket with 2
 * preliminary matches, not a 64er bracket with 30 BYE slots.
 */
const buildSeeding = (players: string[], mainSize: number): Seeding => {
  const excess = Math.max(0, players.length - mainSize);

  if (excess === 0) {
    // No preliminary round needed — same evenly-spaced BYE distribution as before.
    return { round1: distributeByes(players.slice(0, mainSize), mainSize), prelimPairs: [], prelimFeeds: [] };
  }

  const byePlayers = players.slice(0, mainSize - excess);
  const prelimPlayers = players.slice(mainSize - excess);
  const prelimPairs: [string, string][] = [];
  for (let i = 0; i < prelimPlayers.length; i += 2) prelimPairs.push([prelimPlayers[i], prelimPlayers[i + 1]]);

  // Reuse the evenly-spaced BYE distribution (byePlayers are `excess` short of a full
  // bracket) and turn each resulting BYE slot — there are exactly `excess` of them —
  // into a "pending, filled by a preliminary winner" slot. A round-1 match can end up
  // fed by up to two preliminary winners when excess is large (e.g. 62 players → a
  // 32er main bracket needs 30 preliminary matches, far more than the 16 round-1
  // matches can each take just one of).
  const spread = distributeByes(byePlayers, mainSize);
  const round1: (string | undefined)[] = [...spread];
  const prelimFeeds: { position: number; slot: 1 | 2 }[] = [];
  for (let i = 0; i < round1.length && prelimFeeds.length < prelimPairs.length; i++) {
    if (round1[i] === BYE) {
      round1[i] = undefined;
      prelimFeeds.push({ position: Math.floor(i / 2), slot: i % 2 === 0 ? 1 : 2 });
    }
  }
  return { round1, prelimPairs, prelimFeeds };
};

// ─── Bracket Viewport: auto-fit + zoom + pan ─────────────────
interface BracketViewportProps {
  matches: Match[];
  totalRounds: number;
  activeTournament: TournamentRecord;
  roundLabel: (round: number, total: number) => string;
  setKoWinner: (matchId: string, winner: string) => void;
  setKoScore: (matchId: string, slot: 1 | 2) => void;
  resetKoMatch: (matchId: string) => void;
  onEditMatch?: (match: Match) => void;
  /** undefined for a match round marked "Extern" (played outside the app) — no live-game option then. */
  canStartLiveGame: (match: Match) => boolean;
  onStartLiveGame: (match: Match) => void;
  /** Absolute URL for the QR code — null when the match isn't in a live-startable state. */
  getLiveGameUrl: (match: Match) => string | null;
  /** True SETTINGS edits (round mode/format) stay creator-only — DB-enforced, see
   *  20260815170000 migration. Used only for canEditPrelim below, NOT for manual result entry
   *  (that's canEditResults, a separate/broader prop — the DB already allows non-owners to write
   *  bracket/champion/status regardless). */
  isOwner: boolean;
  /** Manual tap/edit/reset controls for a match's RESULT — broader than isOwner (see its
   *  definition in the parent for why), since the DB itself already allows this. */
  canEditResults: boolean;
  /** Opens the round-mode editor for this round header (owner only, see roundHeader below). */
  onEditRoundMode: (round: number) => void;
}

const BracketViewport = ({ matches, totalRounds, activeTournament, roundLabel, setKoWinner, setKoScore, resetKoMatch, onEditMatch, canStartLiveGame, onStartLiveGame, getLiveGameUrl, isOwner, canEditResults, onEditRoundMode }: BracketViewportProps) => {
  // v2 — no continuous auto-measurement (see PublicTournament.tsx's LiveBracket for the same
  // change + full rationale): fixed, always-legible scale by default, native scroll for
  // overflow, manual zoom, and "fit to screen" as a one-time on-demand measurement instead of
  // a background process that could render at the wrong scale depending on layout timing.
  const { t } = useLanguage();
  const wrapRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [userZoom, setUserZoom] = useState(1);
  const [fullscreen, setFullscreen] = useState(false);
  // "zurücksetzen" cascades through recomputeBracket — resetting an early match can silently
  // undo every later result (and un-crown a champion) that depended on it. One un-confirmed tap
  // used to be enough; guard it the same way Players.tsx confirms a player deletion.
  const [confirmResetId, setConfirmResetId] = useState<string | null>(null);

  const fitToScreen = () => {
    const wrap = wrapRef.current?.getBoundingClientRect();
    const inner = innerRef.current?.getBoundingClientRect();
    if (!wrap?.width || !wrap.height || !inner?.width || !inner.height) return;
    const trueW = inner.width / userZoom;
    const trueH = inner.height / userZoom;
    if (!trueW || !trueH) return;
    setUserZoom(+Math.max(0.4, Math.min(wrap.width / trueW, wrap.height / trueH, 2.5)).toFixed(2));
  };

  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setFullscreen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullscreen]);

  // Auto-fit once, the first time there's real content to measure — deliberately NOT the old
  // v1 behaviour (see the comment atop this component) of re-measuring on every resize and
  // multiplying a computed scale into the existing zoom, which is what made the tree render at
  // the wrong scale unpredictably. This is a single absolute computation (same fitToScreen used
  // by the manual button), gated by autoFittedRef so it never fights a zoom level the player
  // has since set themselves. Waits for web fonts — card text width depends on them, and a fit
  // measured against the fallback font before they load lands slightly wrong.
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
  // deliberately overrides any zoom the player had set for the old orientation.
  useEffect(() => {
    const onOrientation = () => { window.setTimeout(fitToScreen, 200); };
    window.addEventListener("orientationchange", onOrientation);
    return () => window.removeEventListener("orientationchange", onOrientation);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const wrapperClass = fullscreen
    ? "fixed inset-0 z-50 bg-background flex flex-col"
    : "relative w-full";

  const renderMatch = (match: Match, side: "left" | "right" | "center", isLast: boolean) => {
    // While a linked live game is in progress, the match's own score1/score2 stay at their
    // pre-match value the whole time — recordMatchResult only writes them once, when the WHOLE
    // best-of-N match ends (see saveGame in Game.tsx), not leg by leg. match.live is the
    // periodically-pushed "score right now" snapshot built for the public spectator view
    // (PublicTournament.tsx already shows it); using it here too is what lets the bracket/
    // schedule itself show the current leg count instead of looking stuck at 0:0 all match.
    const liveFresh = !match.winner && isLiveSnapshotFresh(match.live);
    return (
    <div key={match.id} className={`bg-card border rounded-xl overflow-hidden relative ${match.winner ? "border-border" : "border-primary/30"}`}>
      {!isLast && side === "left" && (
        <span aria-hidden className="absolute top-1/2 -right-4 w-4 h-px bg-border" />
      )}
      {!isLast && side === "right" && (
        <span aria-hidden className="absolute top-1/2 -left-4 w-4 h-px bg-border" />
      )}
      {[match.player1, match.player2].map((player, idx) => (
        <div key={idx}
          className={`w-full px-3 py-2.5 text-sm text-left flex items-center justify-between gap-2 transition-colors ${
            idx === 0 ? "border-b border-border" : ""
          } ${match.winner === player ? "bg-secondary/10 text-secondary font-semibold" : player === BYE ? "text-muted-foreground/30" : "hover:bg-muted"} ${!player ? "text-muted-foreground/30" : ""}`}>
          <button disabled={!canEditResults || !player || player === BYE || !!match.winner} onClick={() => player && setKoWinner(match.id, player)} className="min-w-0 flex-1 truncate text-left uppercase tracking-wide disabled:cursor-not-allowed">{player || "TBD"}</button>
          {canEditResults && (
            <Button size="icon" variant="outline" className="h-9 w-9 shrink-0" disabled={!player || player === BYE || !!match.winner} onClick={() => setKoScore(match.id, idx === 0 ? 1 : 2)} title={t("tournament.legWon")} aria-label={`${t("tournament.legWonFor")} ${player || t("stats.player")}`}>
              <Plus className="w-4 h-4" />
            </Button>
          )}
          <span className={`w-6 text-center font-display text-base ${liveFresh ? "text-accent" : ""}`}>
            {liveFresh ? (idx === 0 ? match.live!.legs1 : match.live!.legs2) : (idx === 0 ? match.score1 || 0 : match.score2 || 0)}
          </span>
          {match.winner === player && <Check className="w-4 h-4 text-secondary" />}
        </div>
      ))}
      {(match.scorekeeper || match.scorekeeperRule || match.board || liveFresh) && !match.winner && (
        <div className="px-3 py-1 border-t border-border/60 bg-muted/20 flex items-center justify-between text-[10px] text-muted-foreground">
          <span className="truncate">✍️ {scorekeeperLabel(match, matches) || "–"}</span>
          <span className="flex items-center gap-2 shrink-0">
            {liveFresh && (
              <span className="flex items-center gap-1 text-accent">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent animate-pulse" /> {t("tournament.live")}
              </span>
            )}
            {match.board ? <span className="font-mono">{t("camera.board")} {match.board}</span> : null}
          </span>
        </div>
      )}
      {canStartLiveGame(match) && (
        <div className="flex border-t border-border/60">
          <Button variant="secondary" size="sm" className="flex-1 rounded-none h-11 text-xs gap-1.5" onClick={() => onStartLiveGame(match)}>
            <Play className="w-3.5 h-3.5" /> {t("game.startGame")}
          </Button>
          {getLiveGameUrl(match) && (
            <QrCodeDialog
              url={getLiveGameUrl(match)!}
              title={t("game.startGame")}
              description={t("tournament.scanOnBoardDevice")}
              downloadName={`match-${match.id}`}
              trigger={
                <button className="shrink-0 rounded-none border-l border-border/60 px-4 h-11 min-w-11 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors" title={t("tournament.qrForThisMatch")} aria-label={t("tournament.qrForThisMatchShow")}>
                  <QrCode className="w-3.5 h-3.5" />
                </button>
              }
            />
          )}
        </div>
      )}
      {canEditResults && (match.winner || match.score1 || match.score2 || onEditMatch) && (
        <div className="flex border-t border-border/60">
          {(match.winner || match.score1 || match.score2) && (
            <AlertDialog open={confirmResetId === match.id} onOpenChange={(open) => setConfirmResetId(open ? match.id : null)}>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" size="sm" className="flex-1 rounded-none h-7 text-xs" onClick={(e) => e.stopPropagation()}>
                  <RotateCcw className="w-3 h-3 mr-1" /> {t("tournament.resetLowercase")}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent onClick={(e) => e.stopPropagation()}>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t("tournament.resetMatchConfirm")}</AlertDialogTitle>
                  <AlertDialogDescription>
                    {match.player1} vs. {match.player2}: {t("tournament.resetMatchWarning")}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
                  <AlertDialogAction onClick={() => resetKoMatch(match.id)}>{t("tournament.resetCapital")}</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
          {onEditMatch && match.round === 1 && (
            <Button variant="ghost" size="sm" className="flex-1 rounded-none h-7 text-xs" onClick={() => onEditMatch(match)}>
              <PencilLine className="w-3 h-3 mr-1" /> {t("tournament.editLowercase")}
            </Button>
          )}
        </div>
      )}
    </div>
    );
  };
  const prelimMatches = matches.filter(m => m.round === 0).sort((a, b) => a.position - b.position);

  return (
    <div className={wrapperClass}>
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-border/60 bg-background/80 backdrop-blur sticky top-0 z-10">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
          {t("camera.zoom")} {(userZoom * 100).toFixed(0)}%
        </div>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setUserZoom(z => Math.max(0.3, z - 0.15))} title={t("tournament.zoomOut")} aria-label={t("tournament.zoomOut")}>
            <ZoomOut className="w-4 h-4" />
          </Button>
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={fitToScreen} title={t("tournament.fitToScreen")} aria-label={t("tournament.fitToScreen")}>
            <Maximize2 className="w-4 h-4" />
          </Button>
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setUserZoom(z => Math.min(3, z + 0.15))} title={t("tournament.zoomIn")} aria-label={t("tournament.zoomIn")}>
            <ZoomIn className="w-4 h-4" />
          </Button>
          <Button variant={fullscreen ? "default" : "outline"} size="sm" className="h-8 gap-1 ml-1" onClick={() => setFullscreen(f => !f)}>
            {fullscreen ? t("tournament.fullscreenExit") : t("tournament.fullscreenEnter")}
          </Button>
        </div>
      </div>
      {prelimMatches.length > 0 && (() => {
        // Same round_configs[totalRounds] convention as resolveRoundMode/resolveRoundBestOf in
        // the parent (TournamentPage) — round 0 has no valid index of its own within the
        // round-1..totalRounds array, so its override lives one slot past the last real round.
        const prelimCfg = (activeTournament.round_configs || [])[totalRounds];
        const prelimMode = prelimCfg?.mode || activeTournament.game_mode;
        const prelimBestOf = prelimCfg?.bestOf || activeTournament.best_of_legs;
        const canEditPrelim = isOwner && prelimMatches.every(m => !m.winner);
        return (
        <div className="mx-3 mt-3 rounded-xl border border-border bg-card/60 p-3">
          <div className="mb-2 flex items-center gap-1">
            <div>
              <p className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
                {t("tournament.preliminaryRound")}
              </p>
              <p className="text-[10px] text-primary/80 font-mono">{prelimMode} · BO{prelimBestOf}</p>
            </div>
            {canEditPrelim && (
              <button
                onClick={() => onEditRoundMode(0)}
                title={t("tournament.editRoundMode")}
                aria-label={t("tournament.editRoundMode")}
                className="p-1.5 -m-1 text-muted-foreground hover:text-primary transition-colors"
              >
                <Settings2 className="w-3 h-3" />
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {prelimMatches.map(m => (
              <div key={m.id} className="min-w-[220px] flex-1">{renderMatch(m, "center", true)}</div>
            ))}
          </div>
        </div>
        );
      })()}
      <div className="relative flex-1">
      <div
        ref={wrapRef}
        className="relative z-10 overflow-auto"
        style={{ height: fullscreen ? "calc(100dvh - 44px)" : "min(78dvh, 900px)", touchAction: "pan-x pan-y pinch-zoom" }}
      >
        <div
          ref={innerRef}
          className="relative"
          style={{
            transform: `scale(${userZoom})`,
            transformOrigin: "top left",
            width: "max-content",
          }}
        >
          {/* Scales and scrolls together with the tree, so it stays centered on the bracket itself. */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 z-0 flex items-center justify-center overflow-hidden"
          >
            <img
              src={htuEmblem}
              alt=""
              className="w-[70%] max-w-[900px] object-contain opacity-[0.06]"
            />
          </div>
          <div className="relative z-10 flex items-stretch gap-4 p-6">
          {(() => {
            // Two-sided (mirrored) bracket:
            //   [L R1 · L R2 · … · L Semi]  [Final]  [R Semi · … · R R2 · R R1]
            // Round r has N/2^r matches. Positions 1..half → left side, rest → right side.
            const roundHeader = (round: number, align: "left" | "center" | "right") => {
              const cfg = (activeTournament.round_configs || [])[round - 1];
              const roundMode = cfg?.mode || activeTournament.game_mode;
              const roundBestOf = cfg?.bestOf || activeTournament.best_of_legs;
              // Editable only before this round has a real decided match — once a match is
              // played, its own `games` row is durable and no longer reads round_configs at
              // all, but changing the round's mode after some matches in it already finished
              // would visually contradict what those finished matches actually played as.
              const roundUndecided = matches.filter(m => m.round === round).every(m => !m.winner);
              const canEditRound = isOwner && roundUndecided;
              return (
                <div className={`mb-1 flex items-center gap-1 ${align === "center" ? "justify-center" : align === "right" ? "justify-end" : "justify-start"}`}>
                  <div className={align === "center" ? "text-center" : align === "right" ? "text-right" : "text-left"}>
                    <h3 className="text-xs font-display uppercase text-muted-foreground">{roundLabel(round, totalRounds)}</h3>
                    <p className="text-[10px] text-primary/80 font-mono">{roundMode} · BO{roundBestOf}</p>
                  </div>
                  {canEditRound && (
                    <button
                      onClick={() => onEditRoundMode(round)}
                      title={t("tournament.editRoundMode")}
                      aria-label={t("tournament.editRoundMode")}
                      className="p-1.5 -m-1 text-muted-foreground hover:text-primary transition-colors"
                    >
                      <Settings2 className="w-3 h-3" />
                    </button>
                  )}
                </div>
              );
            };

            const compact = totalRounds >= 5;
            const colWidth = compact ? "min-w-[190px]" : "min-w-[230px]";
            const column = (round: number, side: "left" | "right", isLast: boolean) => {
              const all = matches.filter(m => m.round === round).sort((a, b) => a.position - b.position);
              const half = Math.ceil(all.length / 2);
              const slice = side === "left" ? all.slice(0, half) : all.slice(half);
              return (
                <div key={`${side}-${round}`} className={`flex flex-col gap-3 ${colWidth}`}>
                  {roundHeader(round, side === "left" ? "left" : "right")}
                  <div className={`flex flex-col justify-around flex-1 relative ${compact ? "gap-1.5" : "gap-3"}`}>
                    {slice.map(m => renderMatch(m, side, isLast))}
                  </div>
                </div>
              );
            };

            // Only mirror when there are at least 2 rounds. Otherwise fall back to single column.
            if (totalRounds < 2) {
              return column(1, "left", true);
            }

            const leftCols = [];
            const rightCols = [];
            // Rounds 1..(totalRounds-1) go on both sides; totalRounds is the final in the middle.
            for (let r = 1; r < totalRounds; r++) {
              leftCols.push(column(r, "left", false));
            }
            for (let r = totalRounds - 1; r >= 1; r--) {
              rightCols.push(column(r, "right", false));
            }

            const finalMatches = matches.filter(m => m.round === totalRounds).sort((a, b) => a.position - b.position);
            const finalCol = (
              <div key="final" className="flex flex-col gap-3 min-w-[260px] justify-center">
                {roundHeader(totalRounds, "center")}
                <div className="flex flex-col justify-center flex-1 gap-3">
                  {finalMatches.map(m => (
                    <div key={m.id} className="relative">
                      <Trophy aria-hidden className="absolute -top-6 left-1/2 -translate-x-1/2 w-5 h-5 text-accent" />
                      {renderMatch(m, "center", true)}
                    </div>
                  ))}
                </div>
              </div>
            );

            return (
              <>
                {leftCols}
                {finalCol}
                {rightCols}
              </>
            );
          })()}
          </div>
        </div>
      </div>
      </div>
    </div>
  );
};

const TournamentPage = () => {
  const { t, language } = useLanguage();
  const [phase, setPhase] = useState<"list" | "setup" | "bracket">("list");
  const [tournaments, setTournaments] = useState<TournamentRecord[]>([]);
  // Hook call stays unconditional (top-level, not inside the "list" phase's early return) since
  // this component branches on `phase` with early returns — a hook called only inside one of
  // those branches would violate the rules of hooks the moment `phase` itself changes.
  const pagedTournaments = usePagedList(tournaments);
  // Tournament-wide highlights (heatmap + per-participant 180s/big triples/bull/ton-plus
  // finishes) — fetched lazily on first expand rather than every time a tournament opens, since
  // it pulls every leg's full throw history for the tournament and most opens never look at it.
  const [tournamentHighlights, setTournamentHighlights] = useState<TournamentHighlights | null>(null);
  const [tournamentAverages, setTournamentAverages] = useState<TournamentAverages | null>(null);
  const [loadingHighlights, setLoadingHighlights] = useState(false);
  const [showHighlights, setShowHighlights] = useState(false);
  const [activeTournament, setActiveTournament] = useState<TournamentRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [ceremonyChampion, setCeremonyChampion] = useState<string | null>(null);
  const [seenCeremonyFor, setSeenCeremonyFor] = useState<string | null>(null);
  const [publicToggling, setPublicToggling] = useState(false);

  // Round-robin table/match-list windowing — computed here (top-level, unconditional) rather
  // than down in the round-robin render branch itself, since this whole component early-returns
  // per `phase`/`activeTournament` and a hook called only inside one of those branches would
  // violate the rules of hooks the moment that value changes across renders.
  const rrMatchesTop = activeTournament?.mode === "round-robin" ? (activeTournament.bracket as RoundRobinMatch[]) : [];
  const rrStandings = calcStandings(rrMatchesTop);
  const rrUnplayed = rrMatchesTop.filter(m => !m.played);
  const rrPlayed = rrMatchesTop.filter(m => m.played);
  const pagedRrStandings = usePagedList(rrStandings);
  const pagedRrUnplayed = usePagedList(rrUnplayed);
  const pagedRrPlayed = usePagedList(rrPlayed);

  // Setup state
  const [tournamentName, setTournamentName] = useState("");
  const [tournamentMode, setTournamentMode] = useState("ko");
  const [gameMode, setGameMode] = useState("501");
  const [bestOfLegs, setBestOfLegs] = useState(3);
  const [targetSize, setTargetSize] = useState("auto");
  const [seriesId, setSeriesId] = useState<string>("none");
  const [seriesList, setSeriesList] = useState<SeriesRecord[]>([]);
  const [roundConfigs, setRoundConfigs] = useState<RoundConfig[]>([]);
  const [drawMode, setDrawMode] = useState<"random" | "manual">("random");
  const [drawSeed, setDrawSeed] = useState(() => Math.floor(Math.random() * 1e9));
  const [boards, setBoards] = useState(2);
  const [livePlayEnabled, setLivePlayEnabled] = useState(true);
  const [bracketView, setBracketView] = useState<"tree" | "schedule">("tree");
  const [editMatch, setEditMatch] = useState<Match | null>(null);
  const [editP1, setEditP1] = useState("");
  const [editP2, setEditP2] = useState("");
  // Per-round mode override, edited from the bracket view itself (not the setup form) — see
  // openRoundModeEditor/saveRoundMode. Separate from editMatch above: this touches only the
  // tournament's own round_configs column, never the bracket/players/status/champion.
  const [editingRound, setEditingRound] = useState<number | null>(null);
  const [editRoundMode, setEditRoundMode] = useState("501");
  const [editRoundBestOf, setEditRoundBestOf] = useState(3);
  const [savingRoundMode, setSavingRoundMode] = useState(false);
  // Confirm before withdrawing a player mid-tournament — unlike removing a typo'd name during
  // setup (harmless, pre-draw), this forfeits every remaining match for a real participant,
  // often live at the venue. Same chip-based UI as setup made the two easy to confuse.
  const [confirmWithdraw, setConfirmWithdraw] = useState<string | null>(null);
  const [playerInput, setPlayerInput] = useState("");
  const [nicknameInput, setNicknameInput] = useState("");
  const [guestCount, setGuestCount] = useState(8);
  const [bulkInput, setBulkInput] = useState("");
  const [players, setPlayers] = useState<string[]>([]);
  const [savingTournament, setSavingTournament] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [dbPlayers, setDbPlayers] = useState<ClubPlayer[]>([]);

  const { session } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  /** True tournament SETTINGS edits (name, mode, round_configs, players, public_view, …) are
   *  creator-only, DB-enforced via the 20260815170000 migration's trigger — this just keeps the
   *  UI from showing controls that would fail server-side. `isOwnerOf` for the list view (many
   *  tournaments at once), `isOwner` for whichever one is currently open. */
  const isOwnerOf = (t: TournamentRecord) => !!session?.user?.id && t.user_id === session.user.id;
  const isOwner = activeTournament ? isOwnerOf(activeTournament) : false;
  /** RESULT/bracket edits (tap winner, +1 leg, reset a match, edit round-1 players, reshuffle
   *  scorekeepers) are a different story: the same trigger above explicitly exempts
   *  bracket/champion/status from the owner lock, specifically so a live game finishing on
   *  someone else's device can still write its result back. This one extra account is trusted
   *  the same way for the MANUAL entry path too, at the user's explicit request — logged into
   *  their own second (non-admin) account on whatever devices are scorekeeping. Not a role
   *  system; just this one id, matching how the app already hardcodes specific accounts
   *  elsewhere (e.g. Players.tsx's STATIC_PORTRAITS). */
  const TRUSTED_RESULT_EDITOR_ID = "37a33cda-b542-4b30-b9b3-49d597a3bb97"; // mueller-kim@outlook.com
  const canEditResults = isOwner || session?.user?.id === TRUSTED_RESULT_EDITOR_ID;

  const togglePublicView = async () => {
    if (!activeTournament) return;
    setPublicToggling(true);
    const next = !activeTournament.public_view;
    let slug = activeTournament.public_slug;
    if (next && !slug) {
      slug = `${activeTournament.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "turnier"}-${activeTournament.id.slice(0, 6)}`;
    }
    const { error } = await supabase.from("tournaments").update({
      public_view: next, public_slug: slug,
    }).eq("id", activeTournament.id);
    if (error) {
      toast({ title: t("common.error"), description: t("tournament.publicViewToggleFailed"), variant: "destructive" });
    } else {
      setActiveTournament({ ...activeTournament, public_view: next, public_slug: slug });
      toast({ title: next ? t("tournament.liveViewActive") : t("tournament.liveViewDeactivated"), description: next && slug ? `${window.location.origin}/live/${slug}` : undefined });
    }
    setPublicToggling(false);
  };

  const copyPublicLink = () => {
    if (!activeTournament?.public_slug) return;
    const url = `${window.location.origin}/live/${activeTournament.public_slug}`;
    navigator.clipboard.writeText(url).then(() => toast({ title: t("tournament.linkCopied"), description: url }));
  };

  const mapTournamentRow = (t: Database["public"]["Tables"]["tournaments"]["Row"]): TournamentRecord => ({
    ...t,
    players: (t.players as unknown as string[]) || [],
    bracket: (t.bracket as unknown as Match[] | RoundRobinMatch[]) || [],
    game_mode: t.game_mode || "501",
    best_of_legs: t.best_of_legs || 3,
    series_id: t.series_id || null,
    round_configs: (t.round_configs as unknown as RoundConfig[]) || [],
    public_view: t.public_view || false,
    public_slug: t.public_slug || null,
    boards: t.boards ?? 2,
    live_play_enabled: t.live_play_enabled ?? true,
    attendance: (t.attendance as unknown as Record<string, boolean>) || {},
  });

  const fetchTournaments = useCallback(async () => {
    const { data } = await supabase
      .from("tournaments")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);
    if (data) {
      setTournaments(data.map(mapTournamentRow));
    }
    setLoading(false);
  }, []);

  const fetchDbPlayers = useCallback(async () => {
    setDbPlayers(await fetchClubPlayers());
  }, []);

  /** Push "your match is up next" to whichever of the match's players have claimed their
   *  own club profile (players.user_id) and opted into notifications — most club members
   *  play under a shared/organizer login, so this silently no-ops for anyone who hasn't. */
  const notifyMatchReady = useCallback((match: Match) => {
    const userIds = resolveMatchUserIds(match, dbPlayers);
    if (userIds.length === 0) return;
    supabase.functions.invoke("send-push", {
      body: { userIds, ...buildMatchReadyPush(match) },
    }).catch((err) => console.error("notifyMatchReady failed", err));
  }, [dbPlayers]);

  const fetchSeries = useCallback(async () => {
    const { data } = await supabase.from("tournament_series").select("id, name").order("created_at", { ascending: false });
    if (data) setSeriesList(data);
  }, []);

  useEffect(() => { fetchTournaments(); fetchDbPlayers(); fetchSeries(); }, [fetchTournaments, fetchDbPlayers, fetchSeries]);

  // Keep the open bracket live across devices — a match started via "Spiel starten" on one
  // board's tablet (or a plain manual edit on another) should show up here without a manual
  // reload. Mirrors the public live view's realtime + polling fallback (PublicTournament.tsx).
  useEffect(() => {
    if (phase !== "bracket" || !activeTournament) return;
    const id = activeTournament.id;
    let cancelled = false;

    const refresh = async () => {
      const { data } = await supabase.from("tournaments").select("*").eq("id", id).maybeSingle();
      if (cancelled || !data) return;
      setActiveTournament((prev) => (prev && prev.id === id ? mapTournamentRow(data) : prev));
    };

    const interval = window.setInterval(refresh, 8000);
    const channel = supabase
      .channel(`tournament-edit-${id}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "tournaments", filter: `id=eq.${id}` }, refresh)
      .subscribe();

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, activeTournament?.id]);

  // Auto-generate round configs when target size or defaults change
  useEffect(() => {
    if (tournamentMode === "round-robin") return;
    // "auto" picks whichever main bracket size (see chooseAutoMainSize) keeps the
    // fewest players affected by a preliminary round or BYEs.
    const size = targetSize === "auto" ? chooseAutoMainSize(players.length) : Number(targetSize);
    const totalRounds = Math.log2(nextPowerOfTwo(size));
    setRoundConfigs((prev) => {
      const next: RoundConfig[] = [];
      for (let i = 0; i < totalRounds; i++) {
        next.push(prev[i] || { mode: gameMode, bestOf: bestOfLegs });
      }
      return next;
    });
  }, [targetSize, tournamentMode, gameMode, bestOfLegs, players.length]);

  /**
   * Effective MAIN bracket size (excludes any preliminary round): automatic mode uses
   * chooseAutoMainSize to minimize how many players are stuck with an "irregular" slot
   * (preliminary match or BYE); a manual override always pads with BYEs as before.
   */
  const effectiveSize = useMemo(() => {
    if (targetSize === "auto") return chooseAutoMainSize(players.length);
    const auto = nextPowerOfTwo(Math.max(players.length, 2));
    return Math.min(64, Math.max(auto, Number(targetSize)));
  }, [targetSize, players.length]);

  const addPlayers = (names: string[]) => {
    const cleaned = names.map((name) => name.trim()).filter(Boolean);
    setPlayers((prev) => [...prev, ...cleaned.filter((name) => !prev.includes(name))].slice(0, 64));
  };

  const addPlayer = () => {
    const parts = playerInput.split(/[\n,;]+/).map((n) => n.trim()).filter(Boolean);
    const nick = nicknameInput.trim();
    // a nickname only makes sense for a single entry – it keeps identical names distinguishable
    if (nick && parts.length === 1) addPlayers([`${parts[0]} (${nick})`]);
    else addPlayers(parts);
    setPlayerInput("");
    setNicknameInput("");
  };

  const addDbPlayer = (name: string) => {
    addPlayers([name]);
  };

  const addBulkPlayers = () => {
    addPlayers(bulkInput.split(/[\n,;]+/));
    setBulkInput("");
  };

  const fillGuestPlayers = () => {
    const target = targetSize === "auto" ? nextPowerOfTwo(Math.max(players.length, 2)) : Number(targetSize);
    const needed = Math.max(0, target - players.length);
    addPlayers(Array.from({ length: needed }, (_, i) => `Gast ${String(players.length + i + 1).padStart(2, "0")}`));
  };

  const removePlayer = (name: string) => setPlayers(players.filter(p => p !== name));

  const movePlayer = (index: number, dir: -1 | 1) => {
    setPlayers((prev) => {
      const next = [...prev];
      const target = index + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const shufflePlayers = () => setPlayers((prev) => shuffle(prev));

  /** The single source of truth for seeding – used by preview AND bracket generation. */
  const drawSeeding = useMemo(() => {
    const base = drawMode === "manual" ? [...players] : seededShuffle(players, drawSeed);
    return buildSeeding(base, effectiveSize);
  }, [players, drawMode, drawSeed, effectiveSize]);

  const redraw = () => setDrawSeed(Math.floor(Math.random() * 1e9));

  // ─── KO Bracket Generation ──────────────────────
  const generateKoBracket = (playerList: string[]): Match[] => {
    const size = effectiveSize;
    // exactly the draw shown in the preview
    const seeding = drawSeeding;

    const round0: Match[] = seeding.prelimPairs.map((pair, i) => ({
      id: `r0-${i}`,
      round: 0,
      position: i,
      table: i + 1,
      player1: pair[0],
      player2: pair[1],
      feedsRound1Position: seeding.prelimFeeds[i].position,
      feedsRound1Slot: seeding.prelimFeeds[i].slot,
    }));

    // Slots not fed by a preliminary match are always filled by buildSeeding (with a
    // real player or an explicit BYE); slots that are stay undefined (TBD) until the
    // preliminary match resolves.
    const firstRound: Match[] = [];
    for (let i = 0; i < seeding.round1.length; i += 2) {
      firstRound.push({
        id: `r1-${i / 2}`,
        round: 1,
        position: i / 2,
        table: i / 2 + 1,
        player1: seeding.round1[i],
        player2: seeding.round1[i + 1],
      });
    }

    const totalRounds = Math.log2(size);
    const allMatches = [...round0, ...firstRound];
    for (let round = 2; round <= totalRounds; round++) {
      const count = size / Math.pow(2, round);
      for (let pos = 0; pos < count; pos++) {
        allMatches.push({ id: `r${round}-${pos}`, round, position: pos, table: pos + 1 });
      }
    }
    return assignScorekeepers(recomputeBracket(allMatches), playerList, { boards, keepExisting: false });
  };

  // ─── Round Robin Generation ─────────────────────
  const generateRoundRobin = (playerList: string[]): RoundRobinMatch[] => {
    const matches: RoundRobinMatch[] = [];
    let id = 0;
    for (let i = 0; i < playerList.length; i++) {
      for (let j = i + 1; j < playerList.length; j++) {
        matches.push({ id: `rr-${id++}`, player1: playerList[i], player2: playerList[j], played: false });
      }
    }
    return shuffle(matches);
  };

  /** `live_play_enabled` is a recently-added column — if a given Supabase project hasn't had
   *  the migration applied yet, PostgREST rejects the whole write with a schema-cache error.
   *  Retry once without that field rather than hard-failing the entire save on account of it. */
  const missingLivePlayColumn = (error: { code?: string; message?: string } | null) =>
    !!error && (error.code === "42703" || String(error.message || "").includes("live_play_enabled"));

  // ─── Start Tournament ──────────────────────────
  const startTournament = async () => {
    if (players.length < 2 || savingTournament) return;
    setSavingTournament(true);
    try {
    const bracket = tournamentMode === "round-robin" ? generateRoundRobin(players) : generateKoBracket(players);

    if (editingId) {
      const payload: Database["public"]["Tables"]["tournaments"]["Update"] = {
        name: tournamentName || t("tournament.bigEvent"),
        mode: tournamentMode,
        game_mode: gameMode,
        best_of_legs: bestOfLegs,
        players: players as unknown as Json,
        bracket: bracket as unknown as Json,
        status: "active",
        champion: null,
        series_id: seriesId === "none" ? null : seriesId,
        round_configs: roundConfigs as unknown as Json,
        boards,
        live_play_enabled: livePlayEnabled,
      };
      let { data: upd, error: updErr } = await supabase.from("tournaments").update(payload).eq("id", editingId).select().single();
      if (updErr && missingLivePlayColumn(updErr)) {
        const { live_play_enabled, ...fallback } = payload;
        ({ data: upd, error: updErr } = await supabase.from("tournaments").update(fallback).eq("id", editingId).select().single());
        if (!updErr) toast({ title: t("common.notice"), description: t("tournament.liveGameSettingSaveFailed"), variant: "destructive" });
      }
      if (updErr || !upd) {
        toast({ title: t("common.error"), description: t("tournament.tournamentSaveFailed"), variant: "destructive" });
        return;
      }
      const rec: TournamentRecord = {
        ...upd,
        players: upd.players as unknown as string[],
        bracket: upd.bracket as unknown as Match[] | RoundRobinMatch[],
        round_configs: (upd.round_configs as unknown as RoundConfig[]) || [],
        boards: upd.boards ?? boards,
        live_play_enabled: upd.live_play_enabled ?? livePlayEnabled,
        attendance: (upd.attendance as unknown as Record<string, boolean>) || {},
      };
      setActiveTournament(rec);
      setEditingId(null);
      setBracketView(defaultBracketView(rec.bracket as Match[]));
      setPhase("bracket");
      setPlayers([]);
      setTournamentName("");
      fetchTournaments();
      toast({ title: t("tournament.tournamentUpdated") });
      return;
    }

    const insertPayload: Database["public"]["Tables"]["tournaments"]["Insert"] = {
      name: tournamentName || "Großevent",
      mode: tournamentMode,
      game_mode: gameMode,
      best_of_legs: bestOfLegs,
      user_id: session?.user?.id as string,
      players: players as unknown as Json,
      bracket: bracket as unknown as Json,
      status: "active",
      series_id: seriesId === "none" ? null : seriesId,
      round_configs: roundConfigs as unknown as Json,
      boards,
      live_play_enabled: livePlayEnabled,
    };
    let { data, error } = await supabase.from("tournaments").insert(insertPayload).select().single();
    if (error && missingLivePlayColumn(error)) {
      const { live_play_enabled, ...fallback } = insertPayload;
      ({ data, error } = await supabase.from("tournaments").insert(fallback).select().single());
    }

    if (error || !data) {
      toast({ title: t("common.error"), description: t("tournament.tournamentCreateFailed"), variant: "destructive" });
      return;
    }

    const record: TournamentRecord = {
      ...data,
      players: data.players as unknown as string[],
      bracket: data.bracket as unknown as Match[] | RoundRobinMatch[],
      game_mode: data.game_mode || gameMode,
      best_of_legs: data.best_of_legs || bestOfLegs,
      series_id: data.series_id,
      round_configs: (data.round_configs as unknown as RoundConfig[]) || [],
      boards: data.boards ?? boards,
      live_play_enabled: data.live_play_enabled ?? livePlayEnabled,
      attendance: (data.attendance as unknown as Record<string, boolean>) || {},
    };
    setActiveTournament(record);
    setBracketView(defaultBracketView(record.bracket as Match[]));
    setPhase("bracket");
    setPlayers([]);
    setTournamentName("");
    fetchTournaments();
    } finally {
      setSavingTournament(false);
    }
  };

  // ─── KO: persist a recomputed bracket ──────────
  // Takes a patch FUNCTION (not a precomputed array) and re-fetches the bracket fresh from
  // Supabase right before applying it. Several boards/devices can edit the same tournament
  // at once (manual taps on one screen while another board's live game auto-finishes) — a
  // patch built against a locally-cached `activeTournament.bracket` would silently overwrite
  // whichever other match got updated in between.
  const persistBracket = async (patch: (fresh: Match[]) => Match[], opts: { reshuffleKeepers?: boolean } = {}) => {
    if (!activeTournament) return;
    const { data: freshRow } = await supabase.from("tournaments").select("bracket, players").eq("id", activeTournament.id).single();
    const freshBracket = (freshRow?.bracket as unknown as Match[] | undefined) ?? (activeTournament.bracket as Match[]);
    const freshPlayers = (freshRow?.players as unknown as string[] | undefined) ?? activeTournament.players;
    const raw = patch(freshBracket);
    const recomputed = recomputeBracket(raw, freshPlayers);
    const withKeepers = assignScorekeepers(recomputed, freshPlayers, {
      boards: activeTournament.boards || 2,
      keepExisting: !opts.reshuffleKeepers,
    });
    const champion = bracketChampion(withKeepers);

    // "Your match is up next" — only for matches that just BECAME playable, so this fires once per
    // match. Diffs against freshBracket (not the stale local activeTournament.bracket) — another
    // board can have already advanced+notified this same match while this client hadn't re-polled
    // yet, and diffing against the stale copy would make it look "newly playable" again here too.
    newlyPlayableMatches(freshBracket, withKeepers).forEach(notifyMatchReady);

    await supabase.from("tournaments").update({
      bracket: withKeepers as unknown as Json,
      champion,
      status: champion ? "finished" : "active",
    }).eq("id", activeTournament.id);
    setActiveTournament({ ...activeTournament, bracket: withKeepers, players: freshPlayers, champion, status: champion ? "finished" : "active" });
    if (champion && seenCeremonyFor !== activeTournament.id) {
      setCeremonyChampion(champion);
      setSeenCeremonyFor(activeTournament.id);
    }
  };

  const setKoWinner = async (matchId: string, winner: string, score1?: number, score2?: number) => {
    if (!activeTournament) return;
    // score1/score2 are optional overrides — when omitted (the only way the UI actually calls
    // this today: tapping a player's name declares them the winner directly), keep whatever legs
    // were already tallied via the "+1" button (setKoScore) instead of wiping them to blank.
    await persistBracket((fresh) => fresh.map(m =>
      m.id === matchId ? { ...m, winner, score1: score1 ?? m.score1, score2: score2 ?? m.score2 } : { ...m }
    ));
  };

  const setKoScore = async (matchId: string, slot: 1 | 2) => {
    if (!activeTournament) return;
    const match = (activeTournament.bracket as Match[]).find(m => m.id === matchId);
    if (!match || !isPlayable(match)) return;
    const cfg = (activeTournament.round_configs || [])[match.round - 1];
    const bestOf = cfg?.bestOf || activeTournament.best_of_legs || 1;
    const legsToWin = Math.ceil(bestOf / 2);
    await persistBracket((fresh) => fresh.map(m => {
      if (m.id !== matchId) return { ...m };
      const score1 = slot === 1 ? (m.score1 || 0) + 1 : (m.score1 || 0);
      const score2 = slot === 2 ? (m.score2 || 0) + 1 : (m.score2 || 0);
      const winner = score1 >= legsToWin && score1 > score2 ? m.player1 : score2 >= legsToWin && score2 > score1 ? m.player2 : undefined;
      return { ...m, score1, score2, winner: winner ?? m.winner };
    }));
  };

  /** Resets a match AND every result that depended on it (cascade via recompute). */
  const resetKoMatch = async (matchId: string) => {
    if (!activeTournament) return;
    await persistBracket((fresh) => fresh.map(m =>
      m.id === matchId ? { ...m, winner: undefined, score1: undefined, score2: undefined } : { ...m }
    ));
  };

  /** Replace the two participants of a first-round match (late changes, no-shows …). */
  const saveMatchPlayers = async () => {
    if (!activeTournament || !editMatch) return;
    const p1 = editP1.trim() || BYE;
    const p2 = editP2.trim() || BYE;
    const patch = (fresh: Match[]) => fresh.map(m =>
      m.id === editMatch.id ? { ...m, player1: p1, player2: p2, winner: undefined, score1: undefined, score2: undefined } : { ...m }
    );
    const preview = patch(activeTournament.bracket as Match[]);
    const nextPlayers = Array.from(new Set(
      preview.filter(m => m.round === 1).flatMap(m => [m.player1, m.player2]).filter(isRealPlayer) as string[]
    ));
    await supabase.from("tournaments").update({ players: nextPlayers as unknown as Json }).eq("id", activeTournament.id);
    setActiveTournament({ ...activeTournament, players: nextPlayers });
    await persistBracket(patch);
    setEditMatch(null);
    toast({ title: t("tournament.bracketUpdated") });
  };

  /** Withdraw a player: only *unplayed* matches are adjusted, results stay untouched. */
  const withdrawPlayer = async (name: string) => {
    if (!activeTournament) return;
    // Round-1 slots are raw seed data → set directly to BYE. Later rounds are propagated by
    // recomputeBracket, which now auto-awards a walkover for any withdrawn (no-longer-active)
    // player as soon as their next opponent's slot becomes known — see its `activePlayers` param.
    const patch = (fresh: Match[]) => fresh.map(m => {
      if (m.winner || m.round !== 1) return { ...m };
      const copy = { ...m };
      if (copy.player1 === name) copy.player1 = BYE;
      if (copy.player2 === name) copy.player2 = BYE;
      return copy;
    });
    const nextPlayers = activeTournament.players.filter(p => p !== name);
    const { error } = await supabase.from("tournaments").update({ players: nextPlayers as unknown as Json }).eq("id", activeTournament.id);
    if (error) {
      toast({ title: t("common.error"), description: t("tournament.onlyCreatorCanWithdraw"), variant: "destructive" });
      return;
    }
    setActiveTournament({ ...activeTournament, players: nextPlayers });
    await persistBracket(patch);
    toast({ title: `${name} ${t("tournament.withdrawn")}`, description: t("tournament.withdrawnDesc") });
  };

  /** Check-in state is independent of match results/withdrawal — just who's physically here. */
  const toggleAttendance = async (name: string) => {
    if (!activeTournament) return;
    const next = { ...(activeTournament.attendance || {}), [name]: !(activeTournament.attendance?.[name]) };
    setActiveTournament({ ...activeTournament, attendance: next });
    await supabase.from("tournaments").update({ attendance: next as unknown as Json }).eq("id", activeTournament.id);
  };

  /** Manually set (and lock) the scorekeeper of a single match. */
  const setMatchScorekeeper = async (matchId: string, keeper: string) => {
    if (!activeTournament) return;
    await persistBracket((fresh) => fresh.map(m =>
      m.id === matchId
        ? { ...m, scorekeeper: keeper === "__auto" ? undefined : keeper, scorekeeperLocked: keeper !== "__auto" }
        : { ...m }
    ));
  };

  const reshuffleScorekeepers = async () => {
    if (!activeTournament) return;
    await persistBracket((fresh) => [...fresh], { reshuffleKeepers: true });
    toast({ title: t("tournament.scorekeeperRedrawn") });
  };

  /** "501" | "301" | "Cricket" | "Extern" — a round can override the tournament's default mode. */
  /** round_configs[i] holds round (i+1)'s override for every real round (1..totalRounds) — that
   *  indexing predates the preliminary round (round 0) ever being independently configurable, and
   *  round 0 has no valid negative index to reuse. Appending its override one slot past the last
   *  real round instead of renumbering keeps every existing tournament's round_configs reading
   *  exactly as before: that extra index is simply absent (reads as undefined, same as today) on
   *  any tournament saved before this. */
  const roundConfigIndex = (round: number): number =>
    round === 0 ? totalRoundsOf((activeTournament?.bracket as Match[]) || []) : round - 1;

  const resolveRoundMode = (round: number): string => {
    const cfg = (activeTournament?.round_configs || [])[roundConfigIndex(round)];
    return cfg?.mode || activeTournament?.game_mode || "501";
  };

  const resolveRoundBestOf = (round: number): number => {
    const cfg = (activeTournament?.round_configs || [])[roundConfigIndex(round)];
    return cfg?.bestOf || activeTournament?.best_of_legs || 3;
  };

  /** Opens the round-mode editor (bracket view, owner only) — seeds it from this round's
   *  current, already-resolved mode/bestOf so an untouched round doesn't look "unset". */
  const openRoundModeEditor = (round: number) => {
    setEditRoundMode(resolveRoundMode(round));
    setEditRoundBestOf(resolveRoundBestOf(round));
    setEditingRound(round);
  };

  /** Targeted update of just this one round's override — writes only `round_configs`, so unlike
   *  the setup form's startTournament (which regenerates the whole bracket) this can never touch
   *  an already-played match: every scoring entry point resolves mode live from this same column
   *  at click-time (resolveRoundMode/koLiveGamePath) and a decided match's own `games` row is
   *  already durable and fully decoupled from it by then. */
  const saveRoundMode = async () => {
    if (!activeTournament || editingRound === null) return;
    setSavingRoundMode(true);
    const idx = roundConfigIndex(editingRound);
    const next = [...(activeTournament.round_configs || [])];
    while (next.length <= idx) next.push({ mode: activeTournament.game_mode || "501", bestOf: activeTournament.best_of_legs || 3 });
    next[idx] = { mode: editRoundMode, bestOf: editRoundBestOf };
    const { error } = await supabase.from("tournaments").update({ round_configs: next as unknown as Json }).eq("id", activeTournament.id);
    if (error) {
      toast({ title: t("common.error"), description: t("tournament.roundModeSaveFailed"), variant: "destructive" });
    } else {
      setActiveTournament({ ...activeTournament, round_configs: next });
      toast({ title: editingRound === 0 ? `${t("tournament.preliminaryRoundLabel")} ${t("tournament.updatedSuffix")}` : `${t("tournament.modeForRoundUpdated")} ${editingRound} ${t("tournament.updatedSuffix")}` });
      setEditingRound(null);
    }
    setSavingRoundMode(false);
  };

  /** "Extern" rounds are explicitly played outside the app (a different system/board) — no live-game option for those.
   *  `live_play_enabled` is a per-tournament opt-out: pure bracket display + manual entry only.
   *  Also restricted to whichever match is actually up next per the board schedule — with
   *  several rounds simultaneously playable (normal once a bracket fills in), letting "Spiel
   *  starten" fire for any of them out of order was reported as too error-prone in real use. */
  const canStartLiveGame = (match: Match): boolean => {
    if (!(activeTournament?.live_play_enabled ?? true) || !isPlayable(match) || !!match.winner || resolveRoundMode(match.round) === "Extern") {
      return false;
    }
    if (activeTournament && activeTournament.mode !== "round-robin") {
      const schedule = currentBoardSchedule(activeTournament.bracket as Match[], activeTournament.boards || 2);
      return schedule.now.some((e) => e.match.id === match.id);
    }
    return true;
  };

  /** Opens Game.tsx prefilled for this match — playing stays entirely optional, this is purely
   *  an additive shortcut next to the existing manual "tap winner" / "+1 leg" controls. */
  const liveGamePath = (matchId: string, player1: string, player2: string, mode: string, bestOf: number): string => {
    const params = new URLSearchParams({
      tid: activeTournament!.id,
      mid: matchId,
      p1: player1,
      p2: player2,
      mode: mode.toLowerCase(),
      bestOf: String(bestOf),
      tname: activeTournament!.name,
    });
    return `/game?${params.toString()}`;
  };

  /** Shared by the "Spiel starten" button and the QR-code dialog — both point at the exact same URL. */
  const koLiveGamePath = (match: Match): string | null => {
    if (!activeTournament || !isRealPlayer(match.player1) || !isRealPlayer(match.player2)) return null;
    const roundMode = resolveRoundMode(match.round);
    const bestOf = resolveRoundBestOf(match.round);
    return liveGamePath(match.id, match.player1!, match.player2!, roundMode, bestOf);
  };

  const rrLiveGamePath = (match: RoundRobinMatch): string | null => {
    if (!activeTournament) return null;
    const roundMode = activeTournament.game_mode || "501";
    if (roundMode === "Extern") return null;
    return liveGamePath(match.id, match.player1, match.player2, roundMode, activeTournament.best_of_legs || 1);
  };

  // No server-side "claim" exists for a match — two people scanning the same QR (or one person
  // tapping it twice) each get an independent live-game session, both saved as separate games
  // and racing on the bracket write-back. The `live` snapshot every active linked game already
  // pushes every ~1.2s is the only signal available that a session might already be running, so
  // a plain confirm() (no existing AlertDialog wraps this button, and this only fires on the
  // rare actual collision) is a pragmatic guard rather than silently starting a duplicate.
  const startLiveGame = (match: Match) => {
    if (isLiveSnapshotFresh(match.live) && !window.confirm(`${match.player1} vs. ${match.player2} ${t("tournament.matchAlreadyRunningConfirm")}`)) {
      return;
    }
    const path = koLiveGamePath(match);
    if (path) navigate(path);
  };

  const startLiveGameRr = (match: RoundRobinMatch) => {
    if (isLiveSnapshotFresh(match.live) && !window.confirm(`${match.player1} vs. ${match.player2} ${t("tournament.matchAlreadyRunningConfirm")}`)) {
      return;
    }
    const path = rrLiveGamePath(match);
    if (path) navigate(path);
  };

  // ─── Round Robin: Set Winner ───────────────────
  // Same fresh-fetch-then-merge approach as persistBracket above — round-robin ties (both
  // manual taps and live-game auto-finishes) are just as race-prone across multiple boards.
  const setRrWinner = async (matchId: string, winner: string) => {
    if (!activeTournament) return;
    const { data: freshRow } = await supabase.from("tournaments").select("bracket").eq("id", activeTournament.id).single();
    const freshBracket = (freshRow?.bracket as unknown as RoundRobinMatch[] | undefined) ?? (activeTournament.bracket as RoundRobinMatch[]);
    const bracket = freshBracket.map(m => m.id === matchId ? { ...m, winner, played: true } : m);

    const allPlayed = bracket.every(m => m.played);
    let champion: string | null = null;
    if (allPlayed) {
      const standings = calcStandings(bracket);
      champion = standings[0]?.name || null;
    }

    await supabase.from("tournaments").update({
      bracket: bracket as unknown as Json,
      champion,
      status: champion ? "finished" : "active",
    }).eq("id", activeTournament.id);

    setActiveTournament({ ...activeTournament, bracket, champion });
    if (champion && seenCeremonyFor !== activeTournament.id) {
      setCeremonyChampion(champion);
      setSeenCeremonyFor(activeTournament.id);
    }
  };

  const openTournament = (t: TournamentRecord) => {
    setActiveTournament(t);
    setBracketView(defaultBracketView(t.bracket as Match[]));
    setPhase("bracket");
    setShowHighlights(false);
    setTournamentHighlights(null);
    setTournamentAverages(null);
  };

  /** Just the cheap half of toggleHighlights below (games rows only, no per-dart legs) — split
   *  out so the participants list can show each entrant's live tournament average right away
   *  without needing the heavier Highlights panel opened first. */
  const loadTournamentAverages = useCallback(async (tournamentId: string) => {
    const { data: games } = await supabase.from("games")
      .select("id, player1_id, player1_name, player1_average, player2_id, player2_name, player2_average")
      .eq("tournament_id", tournamentId);
    const gameRows = (games || []) as unknown as TournamentStatsGameRow[];
    setTournamentAverages(computeTournamentAverages(gameRows));
    return gameRows;
  }, []);

  // Fires once per opened tournament (not gated behind the Highlights panel's own expand) so the
  // participants list's "Turnier-Average" column is populated as soon as there's anything to
  // show — status is always "active" or "finished" here (there's no separate not-yet-started
  // state; a tournament gets its bracket the moment it's created), so this isn't gated on status.
  useEffect(() => {
    if (!activeTournament || tournamentAverages) return;
    loadTournamentAverages(activeTournament.id);
  }, [activeTournament, tournamentAverages, loadTournamentAverages]);

  /** Lazily fetches + computes this tournament's highlights on first expand, then just toggles
   *  visibility on subsequent clicks — cheap since the source data can't change for a match that's
   *  already been played (only new matches finishing would add more, and re-opening the section
   *  after closing it doesn't need a fresh reload for that to eventually be seen next visit).
   *  Averages come straight off the `games` rows (no per-dart data needed), so they work
   *  identically for a tournament played entirely without the camera. */
  const toggleHighlights = async () => {
    const next = !showHighlights;
    setShowHighlights(next);
    if (!next || tournamentHighlights || !activeTournament) return;
    setLoadingHighlights(true);
    const gameRows = await loadTournamentAverages(activeTournament.id);
    const gameIds = gameRows.map((g) => g.id);
    if (gameIds.length === 0) { setTournamentHighlights({ heatmapPoints: [], participants: [] }); setLoadingHighlights(false); return; }
    const { data: legs } = await supabase.from("game_legs")
      .select("player_id, player_name, starting_score, throws, won")
      .in("game_id", gameIds);
    setTournamentHighlights(computeTournamentHighlights((legs || []) as unknown as TournamentStatsLegRow[]));
    setLoadingHighlights(false);
  };

  const deleteTournament = async (id: string) => {
    await supabase.from("tournaments").delete().eq("id", id);
    fetchTournaments();
    if (activeTournament?.id === id) { setActiveTournament(null); setPhase("list"); }
  };

  const roundLabel = (round: number, total: number) => roundLabelFor(round, total, t);

  /** A tournament counts as started as soon as a real match (no BYE) has a winner. */
  const hasStarted = (t: TournamentRecord) => {
    if (t.mode === "round-robin") return ((t.bracket as RoundRobinMatch[]) || []).some((m) => m.played);
    return ((t.bracket as Match[]) || []).some(
      (m) => !!m.winner && isRealPlayer(m.player1) && isRealPlayer(m.player2)
    );
  };

  /** Load an unstarted tournament back into the setup screen. */
  const editTournament = (t: TournamentRecord) => {
    setEditingId(t.id);
    setTournamentName(t.name);
    setTournamentMode(t.mode);
    setGameMode(t.game_mode || "501");
    setBestOfLegs(t.best_of_legs || 3);
    setSeriesId(t.series_id || "none");
    setRoundConfigs(t.round_configs || []);
    setBoards(t.boards || 2);
    setLivePlayEnabled(t.live_play_enabled ?? true);
    setPlayers(t.players || []);
    setDrawMode("random");
    setDrawSeed(Math.floor(Math.random() * 1e9));
    setPhase("setup");
  };

  // ─── LIST PHASE ─────────────────────────────────
  if (phase === "list") {
    return (
      <div className="container py-6 animate-slide-up">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Trophy className="w-6 h-6 text-accent" />
            <h2 className="text-2xl font-display uppercase">{t("tournament.tournaments")}</h2>
          </div>
          <div className="flex items-center gap-2">
            <Link to="/tournaments/series" className="inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg border border-border hover:border-accent/50 transition-colors">
              <Layers className="w-3.5 h-3.5" /> {t("tournament.series")}
            </Link>
            <Button size="sm" onClick={() => { setEditingId(null); setPlayers([]); setTournamentName(""); setLivePlayEnabled(true); setDrawMode("random"); setDrawSeed(Math.floor(Math.random() * 1e9)); setPhase("setup"); }} className="gap-1">
              <Plus className="w-4 h-4" /> {t("tournament.newTournament")}
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
        ) : tournaments.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <Trophy className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p className="text-sm">{t("tournament.noTournamentsYet")}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {pagedTournaments.visible.map(tourn => (
              <div key={tourn.id} className="bg-card border border-border rounded-xl p-4 flex items-center justify-between">
                <button onClick={() => openTournament(tourn)} className="flex-1 text-left">
                  <div className="flex items-center gap-3">
                    <div className={`w-2 h-2 rounded-full ${tourn.status === "active" ? "bg-secondary animate-pulse" : tourn.status === "finished" ? "bg-accent" : "bg-muted-foreground"}`} />
                    <div>
                      <p className="font-semibold text-sm">{tourn.name}</p>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span className="bg-muted px-1.5 py-0.5 rounded font-mono">{tourn.mode === "round-robin" ? t("tournament.roundRobin") : "K.O."}</span>
                        <span><Users className="w-3 h-3 inline" /> {tourn.players.length}</span>
                        <span>{new Date(tourn.created_at).toLocaleDateString(LOCALE_BY_LANGUAGE[language])}</span>
                      </div>
                    </div>
                  </div>
                  {tourn.champion && <p className="text-xs text-accent mt-1">🏆 {tourn.champion}</p>}
                </button>
                {!hasStarted(tourn) && isOwnerOf(tourn) && (
                  <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); editTournament(tourn); }} className="text-xs">
                    {t("common.edit")}
                  </Button>
                )}
                {isOwnerOf(tourn) && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="ghost" size="icon" onClick={(e) => e.stopPropagation()} title={t("tournament.deleteTournament")} aria-label={t("tournament.deleteTournament")}>
                      <Trash2 className="w-4 h-4 text-muted-foreground hover:text-destructive" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent onClick={(e) => e.stopPropagation()}>
                    <AlertDialogHeader>
                      <AlertDialogTitle>{t("tournament.deleteTournamentConfirm")}</AlertDialogTitle>
                      <AlertDialogDescription>
                        „{tourn.name}" {t("tournament.deleteTournamentWarning")}
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
                      <AlertDialogAction onClick={() => deleteTournament(tourn.id)}>{t("stats.delete")}</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
                )}
              </div>
            ))}
          </div>
        )}
        <ListPaginationFooter list={pagedTournaments} />
      </div>
    );
  }

  // ─── SETUP PHASE ────────────────────────────────
  if (phase === "setup") {
    return (
      <div className="container py-6 animate-slide-up max-w-3xl mx-auto">
        <Button variant="ghost" onClick={() => { setEditingId(null); setPhase("list"); }} className="mb-4 text-muted-foreground text-sm">← {t("common.back")}</Button>
        <div className="mb-6 rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-2 text-accent text-xs uppercase tracking-wider"><Sparkles className="w-4 h-4" /> {t("tournament.bigEventMode")}</div>
          <h2 className="text-2xl font-display uppercase">{editingId ? t("tournament.editTournamentHeading") : t("tournament.createTournamentHeading")}</h2>
          <p className="text-sm text-muted-foreground">{t("tournament.upTo64Participants")}</p>
        </div>
        <div className="space-y-4">
          <div>
            <label className="text-sm text-muted-foreground mb-1 block">{t("tournament.tournamentName")}</label>
            <Input value={tournamentName} onChange={(e) => setTournamentName(e.target.value)} placeholder={t("tournament.tournamentNamePlaceholder")} className="bg-card border-border" />
          </div>
          {seriesList.length > 0 && (
            <div>
              <label className="text-sm text-muted-foreground mb-1 block flex items-center gap-1"><Layers className="w-3.5 h-3.5" /> {t("tournament.tournamentSeries")}</label>
              <Select value={seriesId} onValueChange={setSeriesId}>
                <SelectTrigger className="bg-card border-border"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-card border-border">
                  <SelectItem value="none">{t("tournament.noSeries")}</SelectItem>
                  {seriesList.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          <div>
            <label className="text-sm text-muted-foreground mb-1 block">{t("tournament.structureMode")}</label>
            <Select value={tournamentMode} onValueChange={setTournamentMode}>
              <SelectTrigger className="bg-card border-border"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-card border-border">
                <SelectItem value="ko">{t("tournament.koSystem")}</SelectItem>
                <SelectItem value="round-robin">{t("tournament.roundRobin")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">{t("game.gameMode")}</label>
              <Select value={gameMode} onValueChange={setGameMode}>
                <SelectTrigger className="bg-card border-border"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-card border-border">
                  <SelectItem value="501">501</SelectItem>
                  <SelectItem value="301">301</SelectItem>
                  <SelectItem value="Cricket">Cricket</SelectItem>
                  <SelectItem value="Extern">{t("tournament.playedExternally")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">{t("tournament.bestOfLegsLabel")}</label>
              <Select value={String(bestOfLegs)} onValueChange={(v) => setBestOfLegs(Number(v))}>
                <SelectTrigger className="bg-card border-border"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-card border-border">
                  {BEST_OF_OPTIONS.map(n => <SelectItem key={n} value={String(n)}>{t("stats.bestOf")} {n}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          {tournamentMode !== "round-robin" && (
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">{t("tournament.bracketSize")}</label>
              <Select value={targetSize} onValueChange={setTargetSize}>
                <SelectTrigger className="bg-card border-border"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-card border-border">
                  <SelectItem value="auto">{t("tournament.autoAdaptsToParticipants")}</SelectItem>
                  {BRACKET_SIZES.map(n => <SelectItem key={n} value={String(n)}>{t("tournament.fixed")}: {n}{t("tournament.playerBracketSuffix")}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground mt-1">
                {t("tournament.recommendedAuto")}
              </p>
            </div>
          )}

          <div>
            <label className="text-sm text-muted-foreground mb-1 block flex items-center gap-1"><Monitor className="w-3.5 h-3.5" /> {t("tournament.availableBoards")}</label>
            <Select value={String(boards)} onValueChange={(v) => setBoards(Number(v))}>
              <SelectTrigger className="bg-card border-border"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-card border-border">
                {[1, 2, 3, 4, 5, 6, 8, 10, 12].map(n => <SelectItem key={n} value={String(n)}>{n} {t("camera.board")}{n > 1 ? "s" : ""}</SelectItem>)}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground mt-1">{t("tournament.determinesScheduleOrder")}</p>
          </div>

          <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3">
            <div className="min-w-0">
              <Label htmlFor="live-play-enabled" className="text-sm flex items-center gap-1"><Play className="w-3.5 h-3.5" /> {t("tournament.livePlayFromBracket")}</Label>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {t("tournament.livePlayDesc")}
              </p>
            </div>
            <Switch id="live-play-enabled" checked={livePlayEnabled} onCheckedChange={setLivePlayEnabled} />
          </div>

          {tournamentMode !== "round-robin" && (
            <Collapsible className="bg-muted/30 border border-border rounded-xl">
              <CollapsibleTrigger className="group w-full flex items-center justify-between gap-2 px-3 py-3 text-sm text-muted-foreground">
                <span className="flex items-center gap-1"><Settings2 className="w-3.5 h-3.5" /> {t("tournament.draw")} · {drawMode === "random" ? t("tournament.random") : t("tournament.manual")}</span>
                <ChevronDown className="w-4 h-4 transition-transform group-data-[state=open]:rotate-180" />
              </CollapsibleTrigger>
              <CollapsibleContent className="px-3 pb-3 space-y-2">
                <Select value={drawMode} onValueChange={(v) => setDrawMode(v as "random" | "manual")}>
                  <SelectTrigger className="bg-card border-border"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-card border-border">
                    <SelectItem value="random">{t("tournament.randomDraw")}</SelectItem>
                    <SelectItem value="manual">{t("tournament.manualMatches")}</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">
                  {drawMode === "random"
                    ? t("tournament.randomDrawDesc")
                    : t("tournament.manualDrawDesc")}
                </p>
              </CollapsibleContent>
            </Collapsible>
          )}

          {tournamentMode !== "round-robin" && roundConfigs.length > 0 && (
            <Collapsible className="bg-muted/30 border border-border rounded-xl">
              <CollapsibleTrigger className="group w-full flex items-center justify-between gap-2 px-3 py-3 text-sm text-muted-foreground">
                <span className="flex items-center gap-1"><Sparkles className="w-3.5 h-3.5" /> {t("tournament.modePerRound")}</span>
                <ChevronDown className="w-4 h-4 transition-transform group-data-[state=open]:rotate-180" />
              </CollapsibleTrigger>
              <CollapsibleContent className="px-3 pb-3">
              <div className="space-y-2">
                {roundConfigs.map((cfg, idx) => {
                  const total = roundConfigs.length;
                  const label = roundLabelFor(idx + 1, total, t);
                  return (
                    <div key={idx} className="grid grid-cols-[80px_1fr_1fr] gap-2 items-center">
                      <span className="text-xs font-display uppercase text-muted-foreground">{label}</span>
                      <Select value={cfg.mode} onValueChange={(v) => setRoundConfigs((prev) => prev.map((c, i) => i === idx ? { ...c, mode: v } : c))}>
                        <SelectTrigger className="bg-card border-border h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent className="bg-card border-border">
                          <SelectItem value="501">501</SelectItem>
                          <SelectItem value="301">301</SelectItem>
                          <SelectItem value="Cricket">Cricket</SelectItem>
                          <SelectItem value="Extern">{t("tournament.external")}</SelectItem>
                        </SelectContent>
                      </Select>
                      <Select value={String(cfg.bestOf)} onValueChange={(v) => setRoundConfigs((prev) => prev.map((c, i) => i === idx ? { ...c, bestOf: Number(v) } : c))}>
                        <SelectTrigger className="bg-card border-border h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent className="bg-card border-border">
                          {BEST_OF_OPTIONS.map(n => <SelectItem key={n} value={String(n)}>{t("stats.bestOf")} {n}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  );
                })}
              </div>
              </CollapsibleContent>
            </Collapsible>
          )}

          {/* Add from club members */}
          {dbPlayers.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-sm text-muted-foreground">{t("tournament.addClubMembers")}</label>
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => addPlayers(dbPlayers.map(p => p.name))}>
                  {t("tournament.addAll")}
                </Button>
              </div>
              <div className="flex flex-wrap gap-2">
                {dbPlayers.filter(p => !players.includes(p.name)).map(p => (
                  <button key={p.id} onClick={() => addDbPlayer(p.name)}
                    className="bg-muted border border-border rounded-lg px-3 py-1 text-sm hover:border-primary/50 transition-colors">
                    {p.emoji} {p.name}
                  </button>
                ))}
                {dbPlayers.every(p => players.includes(p.name)) && (
                  <p className="text-xs text-muted-foreground italic py-1">{t("tournament.allMembersInTournament")}</p>
                )}
              </div>
            </div>
          )}

          <div>
            <label className="text-sm text-muted-foreground mb-1 block">{t("tournament.quickEntry")}</label>
            <div className="flex gap-2">
              <Input autoFocus value={playerInput} onChange={(e) => setPlayerInput(e.target.value)} placeholder={t("tournament.namePlaceholder")} className="bg-card border-border" onKeyDown={(e) => e.key === "Enter" && addPlayer()} />
              <Input value={nicknameInput} onChange={(e) => setNicknameInput(e.target.value)} placeholder={t("tournament.nicknamePlaceholder")} className="bg-card border-border w-44" onKeyDown={(e) => e.key === "Enter" && addPlayer()} />
              <Button onClick={addPlayer} size="icon" variant="outline" title={t("tournament.addPlayer")} aria-label={t("tournament.addPlayer")}><Plus className="w-4 h-4" /></Button>
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">
              {t("tournament.sameNamesHint")}
            </p>
          </div>

          {tournaments.length > 0 && (
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">{t("tournament.copyFromPreviousTournament")}</label>
              <Select value="none" onValueChange={(v) => { const found = tournaments.find(x => x.id === v); if (found) addPlayers(found.players); }}>
                <SelectTrigger className="bg-card border-border"><SelectValue placeholder={t("tournament.chooseTournament")} /></SelectTrigger>
                <SelectContent className="bg-card border-border">
                  <SelectItem value="none">{t("tournament.chooseTournament")} …</SelectItem>
                  {/* A dropdown's own content already scrolls for overflow — no "mehr anzeigen"/
                      pagination control makes sense inside a <Select>, just a generous cap. */}
                  {tournaments.slice(0, 100).map(tourn => (
                    <SelectItem key={tourn.id} value={tourn.id}>{tourn.name} ({tourn.players.length})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div>
            <label className="text-sm text-muted-foreground mb-1 block">{t("tournament.guestList")}</label>
            <Textarea value={bulkInput} onChange={(e) => setBulkInput(e.target.value)} placeholder={t("tournament.guestListPlaceholder")} />
            <div className="flex flex-wrap items-center gap-2 mt-2">
              <Button size="sm" variant="outline" onClick={addBulkPlayers}>{t("tournament.adoptList")}</Button>
              {tournamentMode !== "round-robin" && <Button size="sm" variant="outline" onClick={fillGuestPlayers}>{t("tournament.fillWithGuests")}</Button>}
              <div className="flex items-center gap-1">
                <Input type="number" min={1} max={64} value={guestCount} onChange={(e) => setGuestCount(Number(e.target.value))} className="h-8 w-16 bg-card border-border" />
                <Button size="sm" variant="outline" onClick={() => addPlayers(Array.from({ length: Math.max(1, guestCount) }, (_, i) => `${t("tournament.guestNamePrefix")} ${String(players.length + i + 1).padStart(2, "0")}`))}>
                  {t("tournament.addGuests")}
                </Button>
              </div>
              {players.length > 0 && (
                <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setPlayers([])}>{t("tournament.clearList")}</Button>
              )}
            </div>
          </div>

          {players.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-sm text-muted-foreground">{t("tournament.participants")} ({players.length})</label>
                {drawMode === "random" && (
                  <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={redraw}>
                    <Shuffle className="w-3.5 h-3.5" /> {t("tournament.redraw")}
                  </Button>
                )}
              </div>
              {drawMode === "manual" ? (
                <div className="space-y-1">
                  {players.map((p, i) => (
                    <div key={p} className="flex items-center gap-2 bg-card border border-border rounded-lg px-2 py-1.5 text-sm">
                      <span className="w-6 text-center font-mono text-xs text-muted-foreground">{i + 1}</span>
                      <span className="flex-1 truncate">{p}</span>
                      <Button size="icon" variant="ghost" className="h-8 w-8" disabled={i === 0} onClick={() => movePlayer(i, -1)} title={t("tournament.moveUp")} aria-label={`${p} ${t("tournament.moveUpFor")}`}><ArrowUp className="w-3.5 h-3.5" /></Button>
                      <Button size="icon" variant="ghost" className="h-8 w-8" disabled={i === players.length - 1} onClick={() => movePlayer(i, 1)} title={t("tournament.moveDown")} aria-label={`${p} ${t("tournament.moveDownFor")}`}><ArrowDown className="w-3.5 h-3.5" /></Button>
                      <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => removePlayer(p)} title={t("tournament.removeAction")} aria-label={`${p} ${t("tournament.removeFor")}`}><Trash2 className="w-3.5 h-3.5 text-muted-foreground hover:text-destructive" /></Button>
                    </div>
                  ))}
                  <p className="text-[11px] text-muted-foreground pt-1">
                    {t("tournament.orderDeterminesPairings")}
                  </p>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {players.map(p => (
                    <button key={p} onClick={() => removePlayer(p)}
                      className="bg-card border border-border rounded-lg px-3 py-1 text-sm hover:border-destructive hover:text-destructive transition-colors group">
                      {p} <span className="text-muted-foreground group-hover:text-destructive ml-1">×</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {tournamentMode !== "round-robin" && players.length >= 2 && (() => {
            const size = effectiveSize;
            const rounds = Math.log2(size);
            const seeding = drawSeeding;
            const byes = seeding.round1.filter(p => p === BYE).length;
            const previewMatches: Match[] = seeding.prelimPairs.map((pair, i) => ({
              id: `p0-${i}`, round: 0, position: i, player1: pair[0], player2: pair[1],
              feedsRound1Position: seeding.prelimFeeds[i].position, feedsRound1Slot: seeding.prelimFeeds[i].slot,
            }));
            for (let i = 0; i < seeding.round1.length; i += 2) {
              previewMatches.push({ id: `p1-${i / 2}`, round: 1, position: i / 2, player1: seeding.round1[i], player2: seeding.round1[i + 1] });
            }
            for (let r = 2; r <= rounds; r++) {
              for (let pos = 0; pos < size / Math.pow(2, r); pos++) {
                previewMatches.push({ id: `p${r}-${pos}`, round: r, position: pos });
              }
            }
            const tree = recomputeBracket(previewMatches);
            return (
              <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-primary">
                    <Network className="w-3.5 h-3.5" /> {t("tournament.bracketPreview")}
                  </div>
                  {drawMode === "random" && (
                    <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={redraw}>
                      <Shuffle className="w-3.5 h-3.5" /> {t("tournament.redraw")}
                    </Button>
                  )}
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
                  {[
                    { label: t("tournament.participants"), value: players.length },
                    { label: t("tournament.mainGrid"), value: `${size}er` },
                    { label: t("game.rounds"), value: rounds },
                    seeding.prelimPairs.length > 0
                      ? { label: t("tournament.preliminaryMatches"), value: seeding.prelimPairs.length }
                      : { label: t("tournament.byes"), value: byes },
                  ].map((s) => (
                    <div key={s.label} className="bg-card border border-border rounded-lg py-2">
                      <p className="font-display text-xl">{s.value}</p>
                      <p className="text-[10px] uppercase text-muted-foreground">{s.label}</p>
                    </div>
                  ))}
                </div>
                <div className="text-[11px] text-muted-foreground space-y-1">
                  <p>
                    {t("tournament.modeProgression")} {roundConfigs.map((c, i) => `${roundLabelFor(i + 1, roundConfigs.length, t)}: ${c.mode} BO${c.bestOf}`).join(" · ")}
                  </p>
                  <p>
                    {drawMode === "random"
                      ? t("tournament.fullyRandomDraw")
                      : t("tournament.pairingsAsBelow")}
                  </p>
                </div>
                <div className="max-h-[60vh] overflow-auto rounded-lg bg-card/40 p-2">
                  <div className="flex gap-3 min-w-max">
                    {[...(seeding.prelimPairs.length > 0 ? [0] : []), ...Array.from({ length: rounds }, (_, ri) => ri + 1)].map((r) => {
                      const list = tree.filter((m) => m.round === r).sort((a, b) => a.position - b.position);
                      return (
                        <div key={r} className="flex flex-col justify-around gap-1 min-w-[130px]">
                          <p className="text-[9px] uppercase tracking-wider text-muted-foreground text-center">
                            {roundLabelFor(r, rounds, t)}
                          </p>
                          {list.map((m, i) => (
                            <div key={m.id} className="bg-card border border-border rounded px-1.5 py-1 text-[10px] leading-tight">
                              <div className="flex items-center gap-1">
                                <span className="font-mono text-[8px] text-muted-foreground w-4">{r === 1 ? i + 1 : ""}</span>
                                <span className={`flex-1 truncate uppercase tracking-wide ${!isRealPlayer(m.player1) ? "text-muted-foreground/40" : ""}`}>{m.player1 || "—"}</span>
                              </div>
                              <div className="flex items-center gap-1">
                                <span className="w-4" />
                                <span className={`flex-1 truncate uppercase tracking-wide ${!isRealPlayer(m.player2) ? "text-muted-foreground/40" : ""}`}>{m.player2 || "—"}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })()}

          <Button onClick={startTournament} className="w-full mt-4 font-display uppercase text-lg py-6" disabled={players.length < 2 || savingTournament}>
            <Play className="w-5 h-5 mr-2" /> {savingTournament ? t("tournament.saving") : editingId ? t("tournament.saveChanges") : t("tournament.startTournament")}
          </Button>
        </div>
      </div>
    );
  }

  // ─── BRACKET PHASE ──────────────────────────────
  if (!activeTournament) return null;
  const isKo = activeTournament.mode !== "round-robin";

  // Shared by both the K.O. and round-robin returns below — one computed block instead of
  // duplicating the collapsible markup in each branch.
  const highlightsSection = (
    <div className="container mb-4">
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <button onClick={toggleHighlights} className="w-full flex items-center justify-between px-4 py-3 text-left">
          <span className="flex items-center gap-2 text-sm font-display uppercase text-muted-foreground">
            <Target className="w-4 h-4" /> {t("tournament.tournamentHighlights")}
          </span>
          {showHighlights ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </button>
        {showHighlights && (
          <div className="px-4 pb-4">
            {loadingHighlights ? (
              <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
            ) : tournamentHighlights && tournamentAverages ? (
              <TournamentHighlightsPanel highlights={tournamentHighlights} averages={tournamentAverages} showHeatmap />
            ) : null}
          </div>
        )}
      </div>
    </div>
  );

  if (isKo) {
    const matches = activeTournament.bracket as Match[];
    const totalRounds = totalRoundsOf(matches);

    return (
      <div className="py-2 animate-slide-up">
        <div className="container flex items-center justify-between mb-2">
          <div>
            <h2 className="text-lg font-display uppercase leading-tight">{activeTournament.name}</h2>
            <p className="text-xs text-muted-foreground">{t("tournament.koSystem")} · {activeTournament.players.length} {t("game.playersSuffix")} · {activeTournament.game_mode} · {t("stats.bestOf")} {activeTournament.best_of_legs}</p>
          </div>
          <div className="flex items-center gap-2">
            {/* Live-Spiel an/aus lives in the tournament edit form only now — a per-tournament
                setting, not something toggled casually from the bracket toolbar. Both this and
                Bearbeiten change tournament settings, which only the creator may (DB-enforced). */}
            {isOwner && (
              <Button variant={activeTournament.public_view ? "default" : "outline"} size="sm" onClick={togglePublicView} disabled={publicToggling} className="gap-1">
                <Radio className={`w-3.5 h-3.5 ${activeTournament.public_view ? "animate-pulse" : ""}`} />
                {activeTournament.public_view ? t("tournament.liveOn") : t("tournament.liveView")}
              </Button>
            )}
            {/* Link/QR live here only, in the "Beamer-Link" banner below — having them here
                too duplicated the exact same link/QR right on top of each other. */}
            {!hasStarted(activeTournament) && isOwner && (
              <Button variant="outline" size="sm" onClick={() => editTournament(activeTournament)}>
                {t("common.edit")}
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={() => { setActiveTournament(null); setPhase("list"); }}>
              ← {t("tournament.overview")}
            </Button>
          </div>
        </div>

        {activeTournament.public_view && activeTournament.public_slug && (
          <div className="container mb-2">
            <div className="bg-gradient-to-r from-secondary/10 via-primary/10 to-accent/10 border border-secondary/30 rounded-xl px-4 py-1.5 text-xs flex items-center gap-2">
              <span className="inline-block h-2 w-2 rounded-full bg-secondary animate-pulse shrink-0" />
              <span className="text-muted-foreground shrink-0 hidden sm:inline">{t("tournament.projectorLink")}</span>
              <code className="font-mono text-secondary truncate">{window.location.origin}/live/{activeTournament.public_slug}</code>
              <div className="flex items-center gap-1.5 ml-auto shrink-0">
                <Button variant="outline" size="sm" className="h-9 px-2.5 text-[11px] gap-1" onClick={copyPublicLink}>
                  <Copy className="w-3 h-3" /> {t("common.copy")}
                </Button>
                <QrCodeDialog
                  url={`${window.location.origin}/live/${activeTournament.public_slug}`}
                  title={t("tournament.liveView")}
                  description={t("tournament.scanForPublicLiveView")}
                  downloadName={`live-${activeTournament.public_slug}`}
                  trigger={
                    <Button variant="outline" size="sm" className="h-9 px-2.5 text-[11px] gap-1">
                      <QrCode className="w-3 h-3" /> QR
                    </Button>
                  }
                />
                <QrCodeDialog
                  url={`${window.location.origin}/live/${activeTournament.public_slug}?view=auto`}
                  title={t("tournament.screenMode")}
                  description={t("tournament.screenModeDesc")}
                  downloadName={`live-auto-${activeTournament.public_slug}`}
                  trigger={
                    <Button variant="outline" size="sm" className="h-9 px-2.5 text-[11px] gap-1" title={t("tournament.unattendedScreenTooltip")}>
                      <RefreshCcw className="w-3 h-3" /> Auto
                    </Button>
                  }
                />
              </div>
            </div>
          </div>
        )}

        {activeTournament.champion && (
          <div className="container mb-2">
            <div className="bg-card border-2 border-accent rounded-xl px-4 py-2 text-center glow-gold flex items-center justify-center gap-2 flex-wrap">
              <Trophy className="w-5 h-5 text-accent shrink-0" />
              <p className="font-display uppercase text-sm">{activeTournament.champion} <span className="text-accent">· {t("tournament.championSuffix")}</span></p>
              <Button size="sm" variant="ghost" className="text-xs h-7" onClick={() => setCeremonyChampion(activeTournament.champion)}>
                🏆 {t("tournament.ceremony")}
              </Button>
            </div>
          </div>
        )}

        {highlightsSection}

        {/* View switcher + tournament management */}
        <div className="container mb-2 flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-border overflow-hidden">
            <button onClick={() => setBracketView("tree")} className={`px-3 py-1.5 text-xs flex items-center gap-1 ${bracketView === "tree" ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>
              <Network className="w-3.5 h-3.5" /> {t("tournament.bracketTreeTab")}
            </button>
            <button onClick={() => setBracketView("schedule")} className={`px-3 py-1.5 text-xs flex items-center gap-1 ${bracketView === "schedule" ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>
              <ListOrdered className="w-3.5 h-3.5" /> {t("tournament.scheduleAndScorekeeper")}
            </button>
          </div>
          {canEditResults && (
            <Button size="sm" variant="outline" className="h-8 text-xs gap-1" onClick={reshuffleScorekeepers}>
              <Shuffle className="w-3.5 h-3.5" /> {t("tournament.redrawScorekeepers")}
            </Button>
          )}
          <span className="text-[11px] text-muted-foreground flex items-center gap-1">
            <Monitor className="w-3.5 h-3.5" /> {activeTournament.boards || 2} {t("camera.board")}s
          </span>
        </div>

        {bracketView === "tree" ? (
          <BracketViewport
            matches={matches}
            totalRounds={totalRounds}
            activeTournament={activeTournament}
            roundLabel={roundLabel}
            setKoWinner={setKoWinner}
            setKoScore={setKoScore}
            resetKoMatch={resetKoMatch}
            onEditMatch={(m) => { setEditMatch(m); setEditP1(m.player1 === BYE ? "" : m.player1 || ""); setEditP2(m.player2 === BYE ? "" : m.player2 || ""); }}
            canStartLiveGame={canStartLiveGame}
            onStartLiveGame={startLiveGame}
            getLiveGameUrl={(m) => { const p = koLiveGamePath(m); return p ? `${window.location.origin}${p}` : null; }}
            isOwner={isOwner}
            canEditResults={canEditResults}
            onEditRoundMode={openRoundModeEditor}
          />
        ) : (
          <div className="container space-y-4">
            {(() => {
              const schedule = buildSchedule(matches, activeTournament.boards || 2);
              const open = schedule.filter(e => !e.match.winner);
              const slots = [...new Set(open.map(e => e.slot))].sort((a, b) => a - b);
              if (slots.length === 0) {
                return <p className="text-sm text-muted-foreground">{t("tournament.allPlayableMatchesDone")}</p>;
              }
              return slots.map((slot, i) => (
                <div key={slot} className="bg-card border border-border rounded-xl overflow-hidden">
                  <div className="px-4 py-2 bg-muted/30 border-b border-border flex items-center justify-between">
                    <h3 className="font-display uppercase text-sm">
                      {roundLabel(open.find(e => e.slot === slot)!.round, totalRounds)}
                    </h3>
                    <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
                      {i === 0 ? t("tournament.nowOnBoard") : `${t("tournament.playRound")} ${i + 1}`}
                    </span>
                  </div>
                  <div className="divide-y divide-border">
                    {open.filter(e => e.slot === slot).map(e => (
                      <div key={e.match.id} className="px-4 py-2.5 flex items-center gap-3 text-sm">
                        <span className="font-mono text-xs bg-primary/10 text-primary rounded px-2 py-0.5 shrink-0">{t("camera.board")} {e.board}</span>
                        <span className="flex-1 truncate uppercase tracking-wide">
                          <strong>{e.match.player1}</strong> <span className="text-muted-foreground">vs</span> <strong>{e.match.player2}</strong>
                        </span>
                        {isLiveSnapshotFresh(e.match.live) && (
                          <span className="shrink-0 flex items-center gap-1 text-accent text-xs font-display">
                            <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent animate-pulse" />
                            {e.match.live!.legs1}:{e.match.live!.legs2}
                          </span>
                        )}
                        {canStartLiveGame(e.match) && (
                          <>
                            <Button size="sm" variant="secondary" className="h-9 text-xs gap-1 shrink-0" onClick={() => startLiveGame(e.match)}>
                              <Play className="w-3 h-3" /> {t("game.startGame")}
                            </Button>
                            {koLiveGamePath(e.match) && (
                              <QrCodeDialog
                                url={`${window.location.origin}${koLiveGamePath(e.match)}`}
                                title={t("game.startGame")}
                                description={t("tournament.scanOnBoardDevice")}
                                downloadName={`match-${e.match.id}`}
                                trigger={
                                  <Button size="icon" variant="outline" className="h-9 w-9 shrink-0" title={t("tournament.qrForThisMatch")} aria-label={t("tournament.qrForThisMatchShow")}>
                                    <QrCode className="w-3.5 h-3.5" />
                                  </Button>
                                }
                              />
                            )}
                          </>
                        )}
                        <div className="shrink-0 flex items-center gap-1">
                          <span className="text-xs">✍️</span>
                          <Select
                            value={e.match.scorekeeperLocked && e.match.scorekeeper ? e.match.scorekeeper : "__auto"}
                            onValueChange={(v) => setMatchScorekeeper(e.match.id, v)}
                          >
                            <SelectTrigger className="h-7 w-40 text-xs bg-background border-border">
                              <SelectValue>{scorekeeperLabel(e.match, matches) || "–"}</SelectValue>
                            </SelectTrigger>
                            <SelectContent className="bg-card border-border max-h-64">
                              <SelectItem value="__auto">{t("tournament.automaticTournamentRule")}</SelectItem>
                              {activeTournament.players
                                // Not just this match's own two players — anyone playing ANY match
                                // in this same slot is unavailable too (matches assignScorekeepers'
                                // own "busy" rule; the dropdown previously let you pick someone
                                // who's actually mid-match on a different board at the same time).
                                .filter(p => !open.some(oe => oe.slot === slot && (oe.match.player1 === p || oe.match.player2 === p)))
                                .map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    ))}
                  </div>
                  <p className="px-4 py-1.5 text-[10px] text-muted-foreground border-t border-border/60">
                    {t("tournament.autoScorekeeperExplain")}
                  </p>
                </div>
              ));
            })()}

            {isOwner && (
              <div className="bg-card border border-border rounded-xl p-4">
                <h3 className="font-display uppercase text-sm mb-2 flex items-center gap-2"><UserMinus className="w-4 h-4 text-muted-foreground" /> {t("tournament.manageParticipants")}</h3>
                <p className="text-[11px] text-muted-foreground mb-3">{t("tournament.withdrawHint")}</p>
                <div className="space-y-1.5">
                  {activeTournament.players.map(p => {
                    const avgRow = tournamentAverages?.participants.find(pa => pa.key === p || pa.name === p);
                    const present = !!activeTournament.attendance?.[p];
                    return (
                      <div key={p} className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors ${present ? "border-secondary/40 bg-secondary/10" : "border-border bg-muted/20"}`}>
                        <button
                          onClick={() => toggleAttendance(p)}
                          role="checkbox" aria-checked={present} aria-label={`${p} ${t("tournament.attendancePresent")}`}
                          className={`shrink-0 w-6 h-6 rounded-md border-2 flex items-center justify-center transition-colors ${present ? "bg-secondary border-secondary text-secondary-foreground" : "border-muted-foreground/40"}`}
                        >
                          {present && <Check className="w-4 h-4" />}
                        </button>
                        <span className="flex-1 min-w-0 truncate text-sm font-medium">{p}</span>
                        {avgRow && (
                          <span className="shrink-0 text-sm font-display text-primary" title={t("tournament.tournamentAverage")}>
                            Ø {avgRow.tournamentAverage > 0 ? avgRow.tournamentAverage.toFixed(1) : "–"}
                          </span>
                        )}
                        <AlertDialog open={confirmWithdraw === p} onOpenChange={(open) => setConfirmWithdraw(open ? p : null)}>
                          <AlertDialogTrigger asChild>
                            <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive" title={t("tournament.withdrawCapital")} aria-label={`${p} ${t("tournament.withdrawCapital")}`}>
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>{p} {t("tournament.withdrawConfirmSuffix")}</AlertDialogTitle>
                              <AlertDialogDescription>
                                {t("tournament.allOpenMatchesFrom")} {p} {t("tournament.withdrawWarning")}
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
                              <AlertDialogAction onClick={() => withdrawPlayer(p)}>{t("tournament.withdrawCapital")}</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {editMatch && (
          <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur flex items-center justify-center p-4" onClick={() => setEditMatch(null)}>
            <div className="bg-card border border-border rounded-xl p-5 w-full max-w-sm space-y-3" onClick={(e) => e.stopPropagation()}>
              <h3 className="font-display uppercase text-sm">{t("tournament.editMatchHeading")}</h3>
              <p className="text-[11px] text-muted-foreground">{t("tournament.emptyMeansBye")}</p>
              <Input value={editP1} onChange={(e) => setEditP1(e.target.value)} placeholder={t("tournament.player1ByePlaceholder")} className="bg-background border-border" />
              <Input value={editP2} onChange={(e) => setEditP2(e.target.value)} placeholder={t("tournament.player2ByePlaceholder")} className="bg-background border-border" />
              <div className="flex gap-2 justify-end pt-1">
                <Button size="sm" variant="ghost" onClick={() => setEditMatch(null)}>{t("common.cancel")}</Button>
                <Button size="sm" onClick={saveMatchPlayers}>{t("game.save")}</Button>
              </div>
            </div>
          </div>
        )}

        {editingRound !== null && (
          <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur flex items-center justify-center p-4" onClick={() => setEditingRound(null)}>
            <div className="bg-card border border-border rounded-xl p-5 w-full max-w-sm space-y-3" onClick={(e) => e.stopPropagation()}>
              <h3 className="font-display uppercase text-sm">
                {editingRound === 0
                  ? `${t("tournament.preliminaryRoundLabel")} ${t("tournament.editHeadingSuffix")}`
                  : `${t("tournament.editModeForRound")} ${editingRound} ${t("tournament.editHeadingSuffix")}`}
              </h3>
              <p className="text-[11px] text-muted-foreground">{t("tournament.roundModeScopeNote")}</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm text-muted-foreground mb-1 block">{t("game.gameMode")}</label>
                  <Select value={editRoundMode} onValueChange={setEditRoundMode}>
                    <SelectTrigger className="bg-background border-border"><SelectValue /></SelectTrigger>
                    <SelectContent className="bg-card border-border">
                      <SelectItem value="501">501</SelectItem>
                      <SelectItem value="301">301</SelectItem>
                      <SelectItem value="Cricket">Cricket</SelectItem>
                      <SelectItem value="Extern">{t("tournament.playedExternally")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-sm text-muted-foreground mb-1 block">{t("tournament.bestOfLegsLabel")}</label>
                  <Select value={String(editRoundBestOf)} onValueChange={(v) => setEditRoundBestOf(Number(v))}>
                    <SelectTrigger className="bg-background border-border"><SelectValue /></SelectTrigger>
                    <SelectContent className="bg-card border-border">
                      {BEST_OF_OPTIONS.map(n => <SelectItem key={n} value={String(n)}>{t("stats.bestOf")} {n}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex gap-2 justify-end pt-1">
                <Button size="sm" variant="ghost" onClick={() => setEditingRound(null)}>{t("common.cancel")}</Button>
                <Button size="sm" onClick={saveRoundMode} disabled={savingRoundMode} className="gap-1.5">
                  {savingRoundMode && <Loader2 className="w-3.5 h-3.5 animate-spin" />} {t("game.save")}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Live-Ticker */}
        {(() => {
          const done = (matches as Match[]).filter(m => m.winner && m.player1 && m.player2 && m.player1 !== "BYE" && m.player2 !== "BYE").slice(-10).reverse();
          if (done.length === 0) return null;
          return (
            <div className="container mb-6">
              <div className="bg-card border border-border rounded-xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Zap className="w-4 h-4 text-accent" />
                  <h3 className="font-display uppercase text-sm">{t("tournament.liveTickerHeading")}</h3>
                </div>
                <ol className="grid md:grid-cols-2 gap-2 text-xs">
                  {done.map(m => (
                    <li key={m.id} className="border-l-2 border-primary/40 pl-2">
                      <p className="font-display text-sm">
                        <span className="text-secondary">{m.winner}</span>
                        <span className="text-muted-foreground"> {t("tournament.beats")} </span>
                        {m.winner === m.player1 ? m.player2 : m.player1}
                      </p>
                      <p className="text-muted-foreground">{roundLabel(m.round, totalRounds)} · {m.score1 ?? 0}:{m.score2 ?? 0}</p>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          );
        })()}

        {ceremonyChampion && (
          <TrophyCeremony champion={ceremonyChampion} tournamentName={activeTournament.name} onClose={() => setCeremonyChampion(null)} />
        )}
      </div>
    );
  }

  // ─── ROUND ROBIN ────────────────────────────────
  const rrMatches = rrMatchesTop;
  const standings = rrStandings;
  const unplayed = rrUnplayed;
  const played = rrPlayed;

  return (
    <div className="container py-4 animate-slide-up">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xl font-display uppercase">{activeTournament.name}</h2>
          <p className="text-xs text-muted-foreground">{t("tournament.roundRobin")} · {activeTournament.players.length} {t("game.playersSuffix")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => { setActiveTournament(null); setPhase("list"); }}>
            ← {t("tournament.overview")}
          </Button>
        </div>
      </div>

      {activeTournament.champion && (
        <div className="bg-card border-2 border-accent rounded-xl p-4 text-center glow-gold mb-4">
          <Trophy className="w-8 h-8 text-accent mx-auto mb-1" />
          <p className="font-display uppercase text-xl">{activeTournament.champion}</p>
          <p className="text-accent text-sm font-display uppercase">{t("tournament.championSuffix")}</p>
          <Button size="sm" variant="ghost" className="mt-2 text-xs" onClick={() => setCeremonyChampion(activeTournament.champion)}>
            🏆 {t("tournament.showTrophyCeremony")}
          </Button>
        </div>
      )}

      {highlightsSection}

      {/* Standings table */}
      <div className="bg-card rounded-xl border border-border p-4 mb-4">
        <h3 className="font-display text-sm uppercase text-muted-foreground mb-3">{t("tournament.standingsTable")}</h3>
        <div className="grid grid-cols-[auto_1fr_repeat(4,40px)] gap-x-2 gap-y-1 text-xs">
          <span className="text-muted-foreground">#</span>
          <span className="text-muted-foreground">{t("stats.player")}</span>
          <span className="text-muted-foreground text-center">{t("tournament.playedAbbrev")}</span>
          <span className="text-muted-foreground text-center">{t("tournament.wonAbbrev")}</span>
          <span className="text-muted-foreground text-center">{t("tournament.lostAbbrev")}</span>
          <span className="text-muted-foreground text-center">{t("tournament.pointsAbbrev")}</span>
          {pagedRrStandings.visible.map((s) => {
            // True rank in the full table, not the index within this page/slice.
            const i = standings.indexOf(s);
            return (
              <Fragment key={s.name}>
                <span className={`font-display ${i === 0 ? "text-accent" : ""}`}>
                  {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`}
                </span>
                <span className="font-semibold truncate">{s.name}</span>
                <span className="text-center">{s.played}</span>
                <span className="text-center text-secondary">{s.won}</span>
                <span className="text-center text-destructive">{s.lost}</span>
                <span className="text-center font-display text-primary">{s.points}</span>
              </Fragment>
            );
          })}
        </div>
        <ListPaginationFooter list={pagedRrStandings} />
      </div>

      {/* Upcoming matches */}
      {unplayed.length > 0 && (
        <div className="bg-card rounded-xl border border-border p-4 mb-4">
          <h3 className="font-display text-sm uppercase text-muted-foreground mb-3">{t("tournament.upcomingMatches")} ({unplayed.length})</h3>
          <div className="space-y-2">
            {pagedRrUnplayed.visible.map(m => (
              <div key={m.id} className="flex items-center justify-between bg-muted/30 rounded-lg px-3 py-2">
                <span className="text-sm">{m.player1} <span className="text-muted-foreground">vs</span> {m.player2}</span>
                {isLiveSnapshotFresh(m.live) && (
                  <span className="shrink-0 flex items-center gap-1 text-accent text-xs font-display mx-2">
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent animate-pulse" />
                    {m.live!.legs1}:{m.live!.legs2}
                  </span>
                )}
                <div className="flex gap-1">
                  {(activeTournament.live_play_enabled ?? true) && activeTournament.game_mode !== "Extern" && (
                    <>
                      <Button size="sm" variant="secondary" className="text-xs h-9 px-2 gap-1" onClick={() => startLiveGameRr(m)}>
                        <Play className="w-3 h-3" /> {t("game.startGame")}
                      </Button>
                      {rrLiveGamePath(m) && (
                        <QrCodeDialog
                          url={`${window.location.origin}${rrLiveGamePath(m)}`}
                          title={t("game.startGame")}
                          description={t("tournament.scanOnBoardDevice")}
                          downloadName={`match-${m.id}`}
                          trigger={
                            <Button size="icon" variant="outline" className="h-9 w-9 shrink-0" title={t("tournament.qrForThisMatch")} aria-label={t("tournament.qrForThisMatchShow")}>
                              <QrCode className="w-3.5 h-3.5" />
                            </Button>
                          }
                        />
                      )}
                    </>
                  )}
                  {canEditResults && (
                    <>
                      <Button size="sm" variant="ghost" className="text-xs h-7 px-2" onClick={() => setRrWinner(m.id, m.player1)}>
                        {m.player1} ✓
                      </Button>
                      <Button size="sm" variant="ghost" className="text-xs h-7 px-2" onClick={() => setRrWinner(m.id, m.player2)}>
                        {m.player2} ✓
                      </Button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
          <ListPaginationFooter list={pagedRrUnplayed} />
        </div>
      )}

      {/* Played matches */}
      {played.length > 0 && (
        <div className="bg-card rounded-xl border border-border p-4">
          <h3 className="font-display text-sm uppercase text-muted-foreground mb-3">{t("tournament.playedMatches")} ({played.length})</h3>
          <div className="space-y-1">
            {pagedRrPlayed.visible.map(m => (
              <div key={m.id} className="flex items-center justify-between px-3 py-1.5 text-sm">
                <span>{m.player1} vs {m.player2}</span>
                <span className="text-xs text-secondary font-medium">{m.winner} ✓</span>
              </div>
            ))}
          </div>
          <ListPaginationFooter list={pagedRrPlayed} />
        </div>
      )}
      {ceremonyChampion && (
        <TrophyCeremony champion={ceremonyChampion} tournamentName={activeTournament.name} onClose={() => setCeremonyChampion(null)} />
      )}
    </div>
  );
};

export default TournamentPage;
