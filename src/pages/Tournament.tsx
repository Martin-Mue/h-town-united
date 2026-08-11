import { useState, useEffect, useCallback, useMemo, useRef, useLayoutEffect } from "react";
import { Trophy, Plus, Play, RotateCcw, Trash2, Loader2, Users, Check, Sparkles, Layers, Radio, Copy, Zap, Maximize2, ZoomIn, ZoomOut, ChevronDown, Shuffle, ArrowUp, ArrowDown, Settings2, PencilLine, ListOrdered, Network, UserMinus, Monitor } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import TrophyCeremony from "@/components/tournament/TrophyCeremony";
import htuEmblem from "@/assets/club-emblem.png";
import { Link } from "react-router-dom";
import {
  type Match,
  BYE,
  isRealPlayer,
  isPlayable,
  recomputeBracket,
  bracketChampion,
  buildSchedule,
  assignScorekeepers,
  roundLabelFor,
  scorekeeperLabel,
} from "@/utils/tournament";

interface RoundConfig {
  mode: string;      // "501" | "301" | "Cricket" | "Extern"
  bestOf: number;    // best-of legs
}

interface SeriesRecord {
  id: string;
  name: string;
}

interface RoundRobinMatch {
  id: string;
  player1: string;
  player2: string;
  winner?: string;
  played: boolean;
}

interface RoundRobinStanding {
  name: string;
  played: number;
  won: number;
  lost: number;
  points: number;
}

interface TournamentRecord {
  id: string;
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
}

const BRACKET_SIZES = [4, 8, 16, 32, 64];
const BEST_OF_OPTIONS = [1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21];

const nextPowerOfTwo = (count: number) => Math.pow(2, Math.ceil(Math.log2(Math.max(count, 2))));
const lowerPowerOfTwo = (count: number) => Math.pow(2, Math.floor(Math.log2(Math.max(count, 2))));

// A 32+ player mirrored tree can't stay legible at any scale that also fits a screen —
// default those straight to the always-readable "Spielplan" list instead of the tree.
const defaultBracketView = (bracket: Match[] | undefined): "tree" | "schedule" => {
  if (!bracket || bracket.length === 0) return "tree";
  const totalRounds = Math.max(...bracket.map(m => m.round));
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
}

const BracketViewport = ({ matches, totalRounds, activeTournament, roundLabel, setKoWinner, setKoScore, resetKoMatch, onEditMatch }: BracketViewportProps) => {
  const wrapRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [sizes, setSizes] = useState({ wrapW: 0, wrapH: 0, innerW: 0, innerH: 0 });
  const [userZoom, setUserZoom] = useState(1);
  const [fullscreen, setFullscreen] = useState(false);

  const measure = useCallback(() => {
    if (!wrapRef.current || !innerRef.current) return;
    const wrap = wrapRef.current.getBoundingClientRect();
    // measure at scale 1
    const prevTransform = innerRef.current.style.transform;
    innerRef.current.style.transform = "none";
    const inner = innerRef.current.getBoundingClientRect();
    innerRef.current.style.transform = prevTransform;
    if (!wrap.width || !wrap.height || !inner.width || !inner.height) return;
    setSizes({ wrapW: wrap.width, wrapH: wrap.height, innerW: inner.width, innerH: inner.height });
  }, []);

  // Fit the whole tree when it reasonably can; below a legible floor, stop shrinking
  // and let it scroll/pan instead — the "Spielplan & Schreiber" list view is the
  // always-legible fallback for large brackets, and zoom/fullscreen cover close-up taps.
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

  useLayoutEffect(() => { measure(); }, [measure, totalRounds, matches.length, fullscreen]);
  useEffect(() => {
    // Re-fit after fonts/layout settle and on orientation change
    const ro = new ResizeObserver(() => measure());
    if (wrapRef.current) ro.observe(wrapRef.current);
    window.addEventListener("resize", measure);
    window.addEventListener("orientationchange", measure);
    const t = window.setTimeout(measure, 120);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("orientationchange", measure);
      window.clearTimeout(t);
    };
  }, [measure]);
  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setFullscreen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullscreen]);

  const wrapperClass = fullscreen
    ? "fixed inset-0 z-50 bg-background flex flex-col"
    : "relative w-full";

  const renderMatch = (match: Match, side: "left" | "right" | "center", isLast: boolean) => (
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
          <button disabled={!player || player === BYE || !!match.winner} onClick={() => player && setKoWinner(match.id, player)} className="min-w-0 flex-1 truncate text-left uppercase tracking-wide disabled:cursor-not-allowed">{player || "TBD"}</button>
          <Button size="icon" variant="outline" className="h-9 w-9 shrink-0" disabled={!player || player === BYE || !!match.winner} onClick={() => setKoScore(match.id, idx === 0 ? 1 : 2)} title="Leg gewonnen">
            <Plus className="w-4 h-4" />
          </Button>
          <span className="w-6 text-center font-display text-base">{idx === 0 ? match.score1 || 0 : match.score2 || 0}</span>
          {match.winner === player && <Check className="w-4 h-4 text-secondary" />}
        </div>
      ))}
      {(match.scorekeeper || match.scorekeeperRule || match.board) && !match.winner && (
        <div className="px-3 py-1 border-t border-border/60 bg-muted/20 flex items-center justify-between text-[10px] text-muted-foreground">
          <span className="truncate">✍️ {scorekeeperLabel(match, matches) || "–"}</span>
          {match.board ? <span className="font-mono">Board {match.board}</span> : null}
        </div>
      )}
      {(match.winner || match.score1 || match.score2 || onEditMatch) && (
        <div className="flex border-t border-border/60">
          {(match.winner || match.score1 || match.score2) && (
            <Button variant="ghost" size="sm" className="flex-1 rounded-none h-7 text-xs" onClick={() => resetKoMatch(match.id)}>
              <RotateCcw className="w-3 h-3 mr-1" /> zurücksetzen
            </Button>
          )}
          {onEditMatch && match.round === 1 && (
            <Button variant="ghost" size="sm" className="flex-1 rounded-none h-7 text-xs" onClick={() => onEditMatch(match)}>
              <PencilLine className="w-3 h-3 mr-1" /> bearbeiten
            </Button>
          )}
        </div>
      )}
    </div>
  );
  const prelimMatches = matches.filter(m => m.round === 0).sort((a, b) => a.position - b.position);

  return (
    <div className={wrapperClass}>
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-border/60 bg-background/80 backdrop-blur sticky top-0 z-10">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
          Zoom {(scale * 100).toFixed(0)}%
        </div>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setUserZoom(z => Math.max(0.3, z - 0.15))} title="Verkleinern">
            <ZoomOut className="w-4 h-4" />
          </Button>
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setUserZoom(1)} title="Auf Bildschirm einpassen">
            <Maximize2 className="w-4 h-4" />
          </Button>
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setUserZoom(z => Math.min(3, z + 0.15))} title="Vergrößern">
            <ZoomIn className="w-4 h-4" />
          </Button>
          <Button variant={fullscreen ? "default" : "outline"} size="sm" className="h-8 gap-1 ml-1" onClick={() => setFullscreen(f => !f)}>
            {fullscreen ? "Schließen" : "Vollbild"}
          </Button>
        </div>
      </div>
      {prelimMatches.length > 0 && (
        <div className="mx-3 mt-3 rounded-xl border border-border bg-card/60 p-3">
          <p className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground mb-2">
            Preliminary Round · winners advance to the main bracket
          </p>
          <div className="flex flex-wrap gap-2">
            {prelimMatches.map(m => (
              <div key={m.id} className="min-w-[220px] flex-1">{renderMatch(m, "center", true)}</div>
            ))}
          </div>
        </div>
      )}
      <div className="relative flex-1">
      <div
        ref={wrapRef}
        className={`relative z-10 ${overflowing ? "overflow-auto" : "overflow-hidden"}`}
        style={{ height: fullscreen ? "calc(100dvh - 44px)" : "min(78dvh, 900px)" }}
      >
        <div
          ref={innerRef}
          className="relative"
          style={{
            transform: `translate(${offsetX}px, ${offsetY}px) scale(${scale})`,
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
              return (
                <div className={`mb-1 ${align === "center" ? "text-center" : align === "right" ? "text-right" : "text-left"}`}>
                  <h3 className="text-xs font-display uppercase text-muted-foreground">{roundLabel(round, totalRounds)}</h3>
                  <p className="text-[10px] text-primary/80 font-mono">{roundMode} · BO{roundBestOf}</p>
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
  const [phase, setPhase] = useState<"list" | "setup" | "bracket">("list");
  const [tournaments, setTournaments] = useState<TournamentRecord[]>([]);
  const [activeTournament, setActiveTournament] = useState<TournamentRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [ceremonyChampion, setCeremonyChampion] = useState<string | null>(null);
  const [seenCeremonyFor, setSeenCeremonyFor] = useState<string | null>(null);
  const [publicToggling, setPublicToggling] = useState(false);

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
  const [bracketView, setBracketView] = useState<"tree" | "schedule">("tree");
  const [editMatch, setEditMatch] = useState<Match | null>(null);
  const [editP1, setEditP1] = useState("");
  const [editP2, setEditP2] = useState("");
  const [playerInput, setPlayerInput] = useState("");
  const [nicknameInput, setNicknameInput] = useState("");
  const [guestCount, setGuestCount] = useState(8);
  const [bulkInput, setBulkInput] = useState("");
  const [players, setPlayers] = useState<string[]>([]);
  const [savingTournament, setSavingTournament] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [dbPlayers, setDbPlayers] = useState<{ id: string; name: string; emoji: string }[]>([]);

  const { session } = useAuth();
  const { toast } = useToast();

  const togglePublicView = async () => {
    if (!activeTournament) return;
    setPublicToggling(true);
    const next = !activeTournament.public_view;
    let slug = activeTournament.public_slug;
    if (next && !slug) {
      slug = `${activeTournament.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "turnier"}-${activeTournament.id.slice(0, 6)}`;
    }
    const { error } = await (supabase as any).from("tournaments").update({
      public_view: next, public_slug: slug,
    }).eq("id", activeTournament.id);
    if (error) {
      toast({ title: "Fehler", description: "Öffentliche Ansicht konnte nicht geändert werden.", variant: "destructive" });
    } else {
      setActiveTournament({ ...activeTournament, public_view: next, public_slug: slug });
      toast({ title: next ? "Live-Ansicht aktiv" : "Live-Ansicht deaktiviert", description: next && slug ? `${window.location.origin}/live/${slug}` : undefined });
    }
    setPublicToggling(false);
  };

  const copyPublicLink = () => {
    if (!activeTournament?.public_slug) return;
    const url = `${window.location.origin}/live/${activeTournament.public_slug}`;
    navigator.clipboard.writeText(url).then(() => toast({ title: "Link kopiert", description: url }));
  };

  const fetchTournaments = useCallback(async () => {
    const { data } = await supabase
      .from("tournaments")
      .select("*")
      .order("created_at", { ascending: false });
    if (data) {
      setTournaments(data.map(t => ({
        ...t,
        players: (t.players as any) || [],
        bracket: (t.bracket as any) || [],
        game_mode: (t as any).game_mode || "501",
        best_of_legs: (t as any).best_of_legs || 3,
        series_id: (t as any).series_id || null,
        round_configs: ((t as any).round_configs as RoundConfig[]) || [],
        public_view: (t as any).public_view || false,
        public_slug: (t as any).public_slug || null,
        boards: (t as any).boards ?? 2,
      })) as TournamentRecord[]);
    }
    setLoading(false);
  }, []);

  const fetchDbPlayers = useCallback(async () => {
    const { data } = await supabase.from("players").select("id, name, emoji").order("name");
    if (data) setDbPlayers(data);
  }, []);

  const fetchSeries = useCallback(async () => {
    const { data } = await supabase.from("tournament_series" as any).select("id, name").order("created_at", { ascending: false });
    if (data) setSeriesList(data as any);
  }, []);

  useEffect(() => { fetchTournaments(); fetchDbPlayers(); fetchSeries(); }, [fetchTournaments, fetchDbPlayers, fetchSeries]);

  // Auto-generate round configs when target size or defaults change
  useEffect(() => {
    if (tournamentMode === "round-robin") return;
    // "auto" targets a clean main bracket (a preliminary round absorbs any excess
    // players instead of padding the whole tree with BYEs up to the next power of two).
    const size = targetSize === "auto" ? Math.min(64, lowerPowerOfTwo(Math.max(players.length, 2))) : Number(targetSize);
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
   * Effective MAIN bracket size (excludes any preliminary round): automatic mode
   * uses the largest clean power of two the field already fills (any excess plays
   * a preliminary round); a manual override always pads with BYEs as before.
   */
  const effectiveSize = useMemo(() => {
    if (targetSize === "auto") return Math.min(64, lowerPowerOfTwo(Math.max(players.length, 2)));
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

  // ─── Start Tournament ──────────────────────────
  const startTournament = async () => {
    if (players.length < 2 || savingTournament) return;
    setSavingTournament(true);
    try {
    const bracket = tournamentMode === "round-robin" ? generateRoundRobin(players) : generateKoBracket(players);

    if (editingId) {
      const { data: upd, error: updErr } = await supabase.from("tournaments").update({
        name: tournamentName || "Großevent",
        mode: tournamentMode,
        game_mode: gameMode,
        best_of_legs: bestOfLegs,
        players: players as any,
        bracket: bracket as any,
        status: "active",
        champion: null,
        series_id: seriesId === "none" ? null : seriesId,
        round_configs: roundConfigs as any,
        boards,
      }).eq("id", editingId).select().single();
      if (updErr || !upd) {
        toast({ title: "Fehler", description: "Turnier konnte nicht gespeichert werden.", variant: "destructive" });
        return;
      }
      const rec: TournamentRecord = { ...(upd as any), players: (upd as any).players, bracket: (upd as any).bracket, round_configs: (upd as any).round_configs || [], boards: (upd as any).boards ?? boards };
      setActiveTournament(rec);
      setEditingId(null);
      setBracketView(defaultBracketView(rec.bracket as Match[]));
      setPhase("bracket");
      setPlayers([]);
      setTournamentName("");
      fetchTournaments();
      toast({ title: "Turnier aktualisiert" });
      return;
    }

    const { data, error } = await supabase.from("tournaments").insert({
      name: tournamentName || "Großevent",
      mode: tournamentMode,
      game_mode: gameMode,
      best_of_legs: bestOfLegs,
      user_id: session?.user?.id,
      players: players as any,
      bracket: bracket as any,
      status: "active",
      series_id: seriesId === "none" ? null : seriesId,
      round_configs: roundConfigs as any,
      boards,
    }).select().single();

    if (error || !data) {
      toast({ title: "Fehler", description: "Turnier konnte nicht erstellt werden.", variant: "destructive" });
      return;
    }

    const record: TournamentRecord = { ...data, players: data.players as any, bracket: data.bracket as any, game_mode: (data as any).game_mode || gameMode, best_of_legs: (data as any).best_of_legs || bestOfLegs, series_id: (data as any).series_id, round_configs: (data as any).round_configs || [], boards: (data as any).boards ?? boards };
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
  const persistBracket = async (raw: Match[], opts: { reshuffleKeepers?: boolean } = {}) => {
    if (!activeTournament) return;
    const recomputed = recomputeBracket(raw);
    const withKeepers = assignScorekeepers(recomputed, activeTournament.players, {
      boards: activeTournament.boards || 2,
      keepExisting: !opts.reshuffleKeepers,
    });
    const champion = bracketChampion(withKeepers);
    await supabase.from("tournaments").update({
      bracket: withKeepers as any,
      champion,
      status: champion ? "finished" : "active",
    }).eq("id", activeTournament.id);
    setActiveTournament({ ...activeTournament, bracket: withKeepers, champion, status: champion ? "finished" : "active" });
    if (champion && seenCeremonyFor !== activeTournament.id) {
      setCeremonyChampion(champion);
      setSeenCeremonyFor(activeTournament.id);
    }
  };

  const setKoWinner = async (matchId: string, winner: string, score1?: number, score2?: number) => {
    if (!activeTournament) return;
    const updated = (activeTournament.bracket as Match[]).map(m =>
      m.id === matchId ? { ...m, winner, score1, score2 } : { ...m }
    );
    await persistBracket(updated);
  };

  const setKoScore = async (matchId: string, slot: 1 | 2) => {
    if (!activeTournament) return;
    const match = (activeTournament.bracket as Match[]).find(m => m.id === matchId);
    if (!match || !isPlayable(match)) return;
    const score1 = slot === 1 ? (match.score1 || 0) + 1 : (match.score1 || 0);
    const score2 = slot === 2 ? (match.score2 || 0) + 1 : (match.score2 || 0);
    const cfg = (activeTournament.round_configs || [])[match.round - 1];
    const bestOf = cfg?.bestOf || activeTournament.best_of_legs || 1;
    const legsToWin = Math.ceil(bestOf / 2);
    const winner = score1 >= legsToWin && score1 > score2 ? match.player1 : score2 >= legsToWin && score2 > score1 ? match.player2 : undefined;
    const bracket = (activeTournament.bracket as Match[]).map(m =>
      m.id === matchId ? { ...m, score1, score2, winner: winner ?? m.winner } : { ...m }
    );
    await persistBracket(bracket);
  };

  /** Resets a match AND every result that depended on it (cascade via recompute). */
  const resetKoMatch = async (matchId: string) => {
    if (!activeTournament) return;
    const bracket = (activeTournament.bracket as Match[]).map(m =>
      m.id === matchId ? { ...m, winner: undefined, score1: undefined, score2: undefined } : { ...m }
    );
    await persistBracket(bracket);
  };

  /** Replace the two participants of a first-round match (late changes, no-shows …). */
  const saveMatchPlayers = async () => {
    if (!activeTournament || !editMatch) return;
    const p1 = editP1.trim() || BYE;
    const p2 = editP2.trim() || BYE;
    const bracket = (activeTournament.bracket as Match[]).map(m =>
      m.id === editMatch.id ? { ...m, player1: p1, player2: p2, winner: undefined, score1: undefined, score2: undefined } : { ...m }
    );
    const nextPlayers = Array.from(new Set(
      bracket.filter(m => m.round === 1).flatMap(m => [m.player1, m.player2]).filter(isRealPlayer) as string[]
    ));
    await supabase.from("tournaments").update({ players: nextPlayers as any }).eq("id", activeTournament.id);
    setActiveTournament({ ...activeTournament, players: nextPlayers });
    await persistBracket(bracket);
    setEditMatch(null);
    toast({ title: "Turnierbaum aktualisiert" });
  };

  /** Withdraw a player: only *unplayed* matches are adjusted, results stay untouched. */
  const withdrawPlayer = async (name: string) => {
    if (!activeTournament) return;
    const bracket = (activeTournament.bracket as Match[]).map(m => {
      const copy = { ...m };
      // already decided matches keep their result – history stays intact
      if (copy.winner) return copy;
      if (copy.round === 1) {
        if (copy.player1 === name) copy.player1 = BYE;
        if (copy.player2 === name) copy.player2 = BYE;
      } else {
        // later round: walkover for the opponent, seeded slots are recomputed anyway
        if (copy.player1 === name && isRealPlayer(copy.player2)) copy.winner = copy.player2;
        if (copy.player2 === name && isRealPlayer(copy.player1)) copy.winner = copy.player1;
      }
      return copy;
    });
    const nextPlayers = activeTournament.players.filter(p => p !== name);
    await supabase.from("tournaments").update({ players: nextPlayers as any }).eq("id", activeTournament.id);
    setActiveTournament({ ...activeTournament, players: nextPlayers });
    await persistBracket(bracket);
    toast({ title: `${name} zurückgezogen`, description: "Gespielte Partien bleiben erhalten, nur offene Stellen werden angepasst." });
  };

  /** Manually set (and lock) the scorekeeper of a single match. */
  const setMatchScorekeeper = async (matchId: string, keeper: string) => {
    if (!activeTournament) return;
    const bracket = (activeTournament.bracket as Match[]).map(m =>
      m.id === matchId
        ? { ...m, scorekeeper: keeper === "__auto" ? undefined : keeper, scorekeeperLocked: keeper !== "__auto" }
        : { ...m }
    );
    await persistBracket(bracket);
  };

  const reshuffleScorekeepers = async () => {
    if (!activeTournament) return;
    await persistBracket([...(activeTournament.bracket as Match[])], { reshuffleKeepers: true });
    toast({ title: "Schreiber neu ausgelost" });
  };

  // ─── Round Robin: Set Winner ───────────────────
  const setRrWinner = async (matchId: string, winner: string) => {
    if (!activeTournament) return;
    const bracket = (activeTournament.bracket as RoundRobinMatch[]).map(m =>
      m.id === matchId ? { ...m, winner, played: true } : m
    );

    const allPlayed = bracket.every(m => m.played);
    let champion: string | null = null;
    if (allPlayed) {
      const standings = calcStandings(bracket);
      champion = standings[0]?.name || null;
    }

    await supabase.from("tournaments").update({
      bracket: bracket as any,
      champion,
      status: champion ? "finished" : "active",
    }).eq("id", activeTournament.id);

    setActiveTournament({ ...activeTournament, bracket, champion });
    if (champion && seenCeremonyFor !== activeTournament.id) {
      setCeremonyChampion(champion);
      setSeenCeremonyFor(activeTournament.id);
    }
  };

  const calcStandings = (matches: RoundRobinMatch[]): RoundRobinStanding[] => {
    const map: Record<string, RoundRobinStanding> = {};
    matches.forEach(m => {
      [m.player1, m.player2].forEach(p => {
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

  const openTournament = (t: TournamentRecord) => {
    setActiveTournament(t);
    setBracketView(defaultBracketView(t.bracket as Match[]));
    setPhase("bracket");
  };

  const deleteTournament = async (id: string) => {
    await supabase.from("tournaments").delete().eq("id", id);
    fetchTournaments();
    if (activeTournament?.id === id) { setActiveTournament(null); setPhase("list"); }
  };

  const roundLabel = roundLabelFor;

  /** A tournament counts as started as soon as a real match (no BYE) has a winner. */
  const hasStarted = (t: TournamentRecord) => {
    if (t.mode === "round-robin") return ((t.bracket as any[]) || []).some((m: any) => m.played);
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
            <h2 className="text-2xl font-display uppercase">Turniere</h2>
          </div>
          <div className="flex items-center gap-2">
            <Link to="/tournaments/series" className="inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg border border-border hover:border-accent/50 transition-colors">
              <Layers className="w-3.5 h-3.5" /> Serien
            </Link>
            <Button size="sm" onClick={() => { setEditingId(null); setPlayers([]); setTournamentName(""); setDrawMode("random"); setDrawSeed(Math.floor(Math.random() * 1e9)); setPhase("setup"); }} className="gap-1">
              <Plus className="w-4 h-4" /> Neues Turnier
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
        ) : tournaments.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <Trophy className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p className="text-sm">Noch keine Turniere. Erstelle dein erstes!</p>
          </div>
        ) : (
          <div className="space-y-3">
            {tournaments.map(t => (
              <div key={t.id} className="bg-card border border-border rounded-xl p-4 flex items-center justify-between">
                <button onClick={() => openTournament(t)} className="flex-1 text-left">
                  <div className="flex items-center gap-3">
                    <div className={`w-2 h-2 rounded-full ${t.status === "active" ? "bg-secondary animate-pulse" : t.status === "finished" ? "bg-accent" : "bg-muted-foreground"}`} />
                    <div>
                      <p className="font-semibold text-sm">{t.name}</p>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span className="bg-muted px-1.5 py-0.5 rounded font-mono">{t.mode === "round-robin" ? "Jeder gegen Jeden" : "K.O."}</span>
                        <span><Users className="w-3 h-3 inline" /> {t.players.length}</span>
                        <span>{new Date(t.created_at).toLocaleDateString("de-DE")}</span>
                      </div>
                    </div>
                  </div>
                  {t.champion && <p className="text-xs text-accent mt-1">🏆 {t.champion}</p>}
                </button>
                {!hasStarted(t) && (
                  <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); editTournament(t); }} className="text-xs">
                    Bearbeiten
                  </Button>
                )}
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="ghost" size="icon" onClick={(e) => e.stopPropagation()} title="Turnier löschen" aria-label="Turnier löschen">
                      <Trash2 className="w-4 h-4 text-muted-foreground hover:text-destructive" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent onClick={(e) => e.stopPropagation()}>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Turnier löschen?</AlertDialogTitle>
                      <AlertDialogDescription>
                        „{t.name}" wird unwiderruflich gelöscht, inklusive Turnierbaum und Ergebnissen.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                      <AlertDialogAction onClick={() => deleteTournament(t.id)}>Löschen</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ─── SETUP PHASE ────────────────────────────────
  if (phase === "setup") {
    return (
      <div className="container py-6 animate-slide-up max-w-3xl mx-auto">
        <Button variant="ghost" onClick={() => { setEditingId(null); setPhase("list"); }} className="mb-4 text-muted-foreground text-sm">← Zurück</Button>
        <div className="mb-6 rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-2 text-accent text-xs uppercase tracking-wider"><Sparkles className="w-4 h-4" /> Großevent-Modus</div>
          <h2 className="text-2xl font-display uppercase">{editingId ? "Turnier bearbeiten" : "Turnier erstellen"}</h2>
          <p className="text-sm text-muted-foreground">Für bis zu 64 Teilnehmer, Gastspieler und schnelle Ergebnis-Erfassung.</p>
        </div>
        <div className="space-y-4">
          <div>
            <label className="text-sm text-muted-foreground mb-1 block">Turniername</label>
            <Input value={tournamentName} onChange={(e) => setTournamentName(e.target.value)} placeholder="z.B. Vereinsmeisterschaft 2026" className="bg-card border-border" />
          </div>
          {seriesList.length > 0 && (
            <div>
              <label className="text-sm text-muted-foreground mb-1 block flex items-center gap-1"><Layers className="w-3.5 h-3.5" /> Turnierserie (optional)</label>
              <Select value={seriesId} onValueChange={setSeriesId}>
                <SelectTrigger className="bg-card border-border"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-card border-border">
                  <SelectItem value="none">Keine Serie</SelectItem>
                  {seriesList.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          <div>
            <label className="text-sm text-muted-foreground mb-1 block">Modus</label>
            <Select value={tournamentMode} onValueChange={setTournamentMode}>
              <SelectTrigger className="bg-card border-border"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-card border-border">
                <SelectItem value="ko">K.O.-System</SelectItem>
                <SelectItem value="round-robin">Jeder gegen Jeden</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">Spielmodus</label>
              <Select value={gameMode} onValueChange={setGameMode}>
                <SelectTrigger className="bg-card border-border"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-card border-border">
                  <SelectItem value="501">501</SelectItem>
                  <SelectItem value="301">301</SelectItem>
                  <SelectItem value="Cricket">Cricket</SelectItem>
                  <SelectItem value="Extern">Extern gespielt</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">Best of Legs</label>
              <Select value={String(bestOfLegs)} onValueChange={(v) => setBestOfLegs(Number(v))}>
                <SelectTrigger className="bg-card border-border"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-card border-border">
                  {BEST_OF_OPTIONS.map(n => <SelectItem key={n} value={String(n)}>Best of {n}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          {tournamentMode !== "round-robin" && (
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">Turnierbaum-Größe</label>
              <Select value={targetSize} onValueChange={setTargetSize}>
                <SelectTrigger className="bg-card border-border"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-card border-border">
                  <SelectItem value="auto">Automatisch – passt sich der Teilnehmerzahl an</SelectItem>
                  {BRACKET_SIZES.map(n => <SelectItem key={n} value={String(n)}>Fest: {n}er Baum</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground mt-1">
                Empfohlen: Automatisch. Der Baum wird dann genau so groß wie nötig – das ergibt die wenigsten Freilose.
              </p>
            </div>
          )}

          <div>
            <label className="text-sm text-muted-foreground mb-1 block flex items-center gap-1"><Monitor className="w-3.5 h-3.5" /> Verfügbare Boards</label>
            <Select value={String(boards)} onValueChange={(v) => setBoards(Number(v))}>
              <SelectTrigger className="bg-card border-border"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-card border-border">
                {[1, 2, 3, 4, 5, 6, 8, 10, 12].map(n => <SelectItem key={n} value={String(n)}>{n} Board{n > 1 ? "s" : ""}</SelectItem>)}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground mt-1">Bestimmt Spielplan-Reihenfolge und Schreiber-Einteilung.</p>
          </div>

          {tournamentMode !== "round-robin" && (
            <Collapsible className="bg-muted/30 border border-border rounded-xl">
              <CollapsibleTrigger className="group w-full flex items-center justify-between gap-2 px-3 py-3 text-sm text-muted-foreground">
                <span className="flex items-center gap-1"><Settings2 className="w-3.5 h-3.5" /> Auslosung · {drawMode === "random" ? "Zufällig" : "Manuell"}</span>
                <ChevronDown className="w-4 h-4 transition-transform group-data-[state=open]:rotate-180" />
              </CollapsibleTrigger>
              <CollapsibleContent className="px-3 pb-3 space-y-2">
                <Select value={drawMode} onValueChange={(v) => setDrawMode(v as "random" | "manual")}>
                  <SelectTrigger className="bg-card border-border"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-card border-border">
                    <SelectItem value="random">Zufällige Auslosung</SelectItem>
                    <SelectItem value="manual">Manuell festgelegte Partien</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">
                  {drawMode === "random"
                    ? "Die Paarungen der ersten Runde werden beim Start zufällig gelost."
                    : "Die Reihenfolge der Teilnehmerliste bestimmt die Paarungen: 1 vs 2, 3 vs 4, usw."}
                </p>
              </CollapsibleContent>
            </Collapsible>
          )}

          {tournamentMode !== "round-robin" && roundConfigs.length > 0 && (
            <Collapsible className="bg-muted/30 border border-border rounded-xl">
              <CollapsibleTrigger className="group w-full flex items-center justify-between gap-2 px-3 py-3 text-sm text-muted-foreground">
                <span className="flex items-center gap-1"><Sparkles className="w-3.5 h-3.5" /> Modus pro Runde (optional, Steigerung möglich)</span>
                <ChevronDown className="w-4 h-4 transition-transform group-data-[state=open]:rotate-180" />
              </CollapsibleTrigger>
              <CollapsibleContent className="px-3 pb-3">
              <div className="space-y-2">
                {roundConfigs.map((cfg, idx) => {
                  const total = roundConfigs.length;
                  const label = roundLabelFor(idx + 1, total);
                  return (
                    <div key={idx} className="grid grid-cols-[80px_1fr_1fr] gap-2 items-center">
                      <span className="text-xs font-display uppercase text-muted-foreground">{label}</span>
                      <Select value={cfg.mode} onValueChange={(v) => setRoundConfigs((prev) => prev.map((c, i) => i === idx ? { ...c, mode: v } : c))}>
                        <SelectTrigger className="bg-card border-border h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent className="bg-card border-border">
                          <SelectItem value="501">501</SelectItem>
                          <SelectItem value="301">301</SelectItem>
                          <SelectItem value="Cricket">Cricket</SelectItem>
                          <SelectItem value="Extern">Extern</SelectItem>
                        </SelectContent>
                      </Select>
                      <Select value={String(cfg.bestOf)} onValueChange={(v) => setRoundConfigs((prev) => prev.map((c, i) => i === idx ? { ...c, bestOf: Number(v) } : c))}>
                        <SelectTrigger className="bg-card border-border h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent className="bg-card border-border">
                          {BEST_OF_OPTIONS.map(n => <SelectItem key={n} value={String(n)}>Best of {n}</SelectItem>)}
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
                <label className="text-sm text-muted-foreground">Vereinsmitglieder hinzufügen</label>
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => addPlayers(dbPlayers.map(p => p.name))}>
                  Alle übernehmen
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
                  <p className="text-xs text-muted-foreground italic py-1">Alle Vereinsmitglieder sind bereits im Turnier.</p>
                )}
              </div>
            </div>
          )}

          <div>
            <label className="text-sm text-muted-foreground mb-1 block">Schnell-Eingabe (Enter = übernehmen, mehrere Namen mit Komma)</label>
            <div className="flex gap-2">
              <Input autoFocus value={playerInput} onChange={(e) => setPlayerInput(e.target.value)} placeholder="Name, Name, Name …" className="bg-card border-border" onKeyDown={(e) => e.key === "Enter" && addPlayer()} />
              <Input value={nicknameInput} onChange={(e) => setNicknameInput(e.target.value)} placeholder="Spitzname (optional)" className="bg-card border-border w-44" onKeyDown={(e) => e.key === "Enter" && addPlayer()} />
              <Button onClick={addPlayer} size="icon" variant="outline" title="Spieler hinzufügen" aria-label="Spieler hinzufügen"><Plus className="w-4 h-4" /></Button>
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">
              Gleiche Namen? Mit Spitznamen bleiben sie unterscheidbar – er wird als „Name (Spitzname)" im Turnierbaum und Spielplan angezeigt.
            </p>
          </div>

          {tournaments.length > 0 && (
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">Teilnehmerfeld aus früherem Turnier übernehmen</label>
              <Select value="none" onValueChange={(v) => { const t = tournaments.find(x => x.id === v); if (t) addPlayers(t.players); }}>
                <SelectTrigger className="bg-card border-border"><SelectValue placeholder="Turnier wählen" /></SelectTrigger>
                <SelectContent className="bg-card border-border">
                  <SelectItem value="none">Turnier wählen …</SelectItem>
                  {tournaments.slice(0, 15).map(t => (
                    <SelectItem key={t.id} value={t.id}>{t.name} ({t.players.length})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div>
            <label className="text-sm text-muted-foreground mb-1 block">Gastliste einfügen</label>
            <Textarea value={bulkInput} onChange={(e) => setBulkInput(e.target.value)} placeholder="Ein Name pro Zeile oder per Komma getrennt" />
            <div className="flex flex-wrap items-center gap-2 mt-2">
              <Button size="sm" variant="outline" onClick={addBulkPlayers}>Liste übernehmen</Button>
              {tournamentMode !== "round-robin" && <Button size="sm" variant="outline" onClick={fillGuestPlayers}>Mit Gästen auffüllen</Button>}
              <div className="flex items-center gap-1">
                <Input type="number" min={1} max={64} value={guestCount} onChange={(e) => setGuestCount(Number(e.target.value))} className="h-8 w-16 bg-card border-border" />
                <Button size="sm" variant="outline" onClick={() => addPlayers(Array.from({ length: Math.max(1, guestCount) }, (_, i) => `Gast ${String(players.length + i + 1).padStart(2, "0")}`))}>
                  Gäste hinzufügen
                </Button>
              </div>
              {players.length > 0 && (
                <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setPlayers([])}>Liste leeren</Button>
              )}
            </div>
          </div>

          {players.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-sm text-muted-foreground">Teilnehmer ({players.length})</label>
                {drawMode === "random" && (
                  <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={redraw}>
                    <Shuffle className="w-3.5 h-3.5" /> Neu auslosen
                  </Button>
                )}
              </div>
              {drawMode === "manual" ? (
                <div className="space-y-1">
                  {players.map((p, i) => (
                    <div key={p} className="flex items-center gap-2 bg-card border border-border rounded-lg px-2 py-1.5 text-sm">
                      <span className="w-6 text-center font-mono text-xs text-muted-foreground">{i + 1}</span>
                      <span className="flex-1 truncate">{p}</span>
                      <Button size="icon" variant="ghost" className="h-7 w-7" disabled={i === 0} onClick={() => movePlayer(i, -1)} title="Nach oben" aria-label={`${p} nach oben verschieben`}><ArrowUp className="w-3.5 h-3.5" /></Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7" disabled={i === players.length - 1} onClick={() => movePlayer(i, 1)} title="Nach unten" aria-label={`${p} nach unten verschieben`}><ArrowDown className="w-3.5 h-3.5" /></Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => removePlayer(p)} title="Entfernen" aria-label={`${p} entfernen`}><Trash2 className="w-3.5 h-3.5 text-muted-foreground hover:text-destructive" /></Button>
                    </div>
                  ))}
                  <p className="text-[11px] text-muted-foreground pt-1">
                    Reihenfolge bestimmt die Paarungen – siehe Vorschau unten.
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
                    <Network className="w-3.5 h-3.5" /> Vorschau Turnierbaum
                  </div>
                  {drawMode === "random" && (
                    <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={redraw}>
                      <Shuffle className="w-3.5 h-3.5" /> Neu auslosen
                    </Button>
                  )}
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
                  {[
                    { label: "Teilnehmer", value: players.length },
                    { label: "Hauptraster", value: `${size}er` },
                    { label: "Runden", value: rounds },
                    seeding.prelimPairs.length > 0
                      ? { label: "Preliminary Matches", value: seeding.prelimPairs.length }
                      : { label: "Freilose", value: byes },
                  ].map((s) => (
                    <div key={s.label} className="bg-card border border-border rounded-lg py-2">
                      <p className="font-display text-xl">{s.value}</p>
                      <p className="text-[10px] uppercase text-muted-foreground">{s.label}</p>
                    </div>
                  ))}
                </div>
                <div className="text-[11px] text-muted-foreground space-y-1">
                  <p>
                    Modus-Verlauf: {roundConfigs.map((c, i) => `${roundLabelFor(i + 1, roundConfigs.length)}: ${c.mode} BO${c.bestOf}`).join(" · ")}
                  </p>
                  <p>
                    {drawMode === "random"
                      ? "Vollständig zufällige Auslosung – genau diese Paarungen werden beim Start übernommen."
                      : "Paarungen wie unten festgelegt."}
                  </p>
                </div>
                <div className="max-h-[60vh] overflow-auto rounded-lg bg-card/40 p-2">
                  <div className="flex gap-3 min-w-max">
                    {[...(seeding.prelimPairs.length > 0 ? [0] : []), ...Array.from({ length: rounds }, (_, ri) => ri + 1)].map((r) => {
                      const list = tree.filter((m) => m.round === r).sort((a, b) => a.position - b.position);
                      return (
                        <div key={r} className="flex flex-col justify-around gap-1 min-w-[130px]">
                          <p className="text-[9px] uppercase tracking-wider text-muted-foreground text-center">
                            {roundLabelFor(r, rounds)}
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
            <Play className="w-5 h-5 mr-2" /> {savingTournament ? "Speichern…" : editingId ? "Änderungen speichern" : "Turnier starten"}
          </Button>
        </div>
      </div>
    );
  }

  // ─── BRACKET PHASE ──────────────────────────────
  if (!activeTournament) return null;
  const isKo = activeTournament.mode !== "round-robin";

  if (isKo) {
    const matches = activeTournament.bracket as Match[];
    const totalRounds = matches.length > 0 ? Math.max(...matches.map(m => m.round)) : 0;

    return (
      <div className="py-4 animate-slide-up">
        <div className="container flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-display uppercase">{activeTournament.name}</h2>
            <p className="text-xs text-muted-foreground">K.O.-System · {activeTournament.players.length} Spieler · {activeTournament.game_mode} · Best of {activeTournament.best_of_legs}</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant={activeTournament.public_view ? "default" : "outline"} size="sm" onClick={togglePublicView} disabled={publicToggling} className="gap-1">
              <Radio className={`w-3.5 h-3.5 ${activeTournament.public_view ? "animate-pulse" : ""}`} />
              {activeTournament.public_view ? "Live an" : "Live-Ansicht"}
            </Button>
            {activeTournament.public_view && activeTournament.public_slug && (
              <Button variant="outline" size="sm" onClick={copyPublicLink} className="gap-1" title="Link kopieren">
                <Copy className="w-3.5 h-3.5" /> Link
              </Button>
            )}
            {!hasStarted(activeTournament) && (
              <Button variant="outline" size="sm" onClick={() => editTournament(activeTournament)}>
                Bearbeiten
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={() => { setActiveTournament(null); setPhase("list"); }}>
              ← Übersicht
            </Button>
          </div>
        </div>

        {activeTournament.public_view && activeTournament.public_slug && (
          <div className="container mb-4">
            <div className="bg-gradient-to-r from-secondary/10 via-primary/10 to-accent/10 border border-secondary/30 rounded-xl px-4 py-2 text-xs flex items-center gap-2">
              <span className="inline-block h-2 w-2 rounded-full bg-secondary animate-pulse" />
              <span className="text-muted-foreground">Beamer-Link:</span>
              <code className="font-mono text-secondary truncate">{window.location.origin}/live/{activeTournament.public_slug}</code>
              <Button variant="outline" size="sm" className="h-6 px-2 text-[11px] gap-1 ml-auto shrink-0" onClick={copyPublicLink}>
                <Copy className="w-3 h-3" /> Kopieren
              </Button>
            </div>
          </div>
        )}

        {activeTournament.champion && (
          <div className="container mb-4">
            <div className="bg-card border-2 border-accent rounded-xl p-4 text-center glow-gold">
              <Trophy className="w-8 h-8 text-accent mx-auto mb-1" />
              <p className="font-display uppercase text-xl">{activeTournament.champion}</p>
              <p className="text-accent text-sm font-display uppercase">Champion!</p>
              <Button size="sm" variant="ghost" className="mt-2 text-xs" onClick={() => setCeremonyChampion(activeTournament.champion)}>
                🏆 Pokal-Zeremonie zeigen
              </Button>
            </div>
          </div>
        )}

        {/* View switcher + tournament management */}
        <div className="container mb-3 flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-border overflow-hidden">
            <button onClick={() => setBracketView("tree")} className={`px-3 py-1.5 text-xs flex items-center gap-1 ${bracketView === "tree" ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>
              <Network className="w-3.5 h-3.5" /> Turnierbaum
            </button>
            <button onClick={() => setBracketView("schedule")} className={`px-3 py-1.5 text-xs flex items-center gap-1 ${bracketView === "schedule" ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>
              <ListOrdered className="w-3.5 h-3.5" /> Spielplan &amp; Schreiber
            </button>
          </div>
          <Button size="sm" variant="outline" className="h-8 text-xs gap-1" onClick={reshuffleScorekeepers}>
            <Shuffle className="w-3.5 h-3.5" /> Schreiber neu auslosen
          </Button>
          <span className="text-[11px] text-muted-foreground flex items-center gap-1">
            <Monitor className="w-3.5 h-3.5" /> {activeTournament.boards || 2} Boards
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
          />
        ) : (
          <div className="container space-y-4">
            {(() => {
              const schedule = buildSchedule(matches, activeTournament.boards || 2);
              const open = schedule.filter(e => !e.match.winner);
              const slots = [...new Set(open.map(e => e.slot))].sort((a, b) => a - b);
              if (slots.length === 0) {
                return <p className="text-sm text-muted-foreground">Alle aktuell spielbaren Partien sind erledigt.</p>;
              }
              return slots.map((slot, i) => (
                <div key={slot} className="bg-card border border-border rounded-xl overflow-hidden">
                  <div className="px-4 py-2 bg-muted/30 border-b border-border flex items-center justify-between">
                    <h3 className="font-display uppercase text-sm">
                      {roundLabel(open.find(e => e.slot === slot)!.round, totalRounds)}
                    </h3>
                    <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
                      {i === 0 ? "Jetzt am Board" : `Spielrunde ${i + 1}`}
                    </span>
                  </div>
                  <div className="divide-y divide-border">
                    {open.filter(e => e.slot === slot).map(e => (
                      <div key={e.match.id} className="px-4 py-2.5 flex items-center gap-3 text-sm">
                        <span className="font-mono text-xs bg-primary/10 text-primary rounded px-2 py-0.5 shrink-0">Board {e.board}</span>
                        <span className="flex-1 truncate uppercase tracking-wide">
                          <strong>{e.match.player1}</strong> <span className="text-muted-foreground">vs</span> <strong>{e.match.player2}</strong>
                        </span>
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
                              <SelectItem value="__auto">Automatisch (Turnier-Regel)</SelectItem>
                              {activeTournament.players
                                .filter(p => p !== e.match.player1 && p !== e.match.player2)
                                .map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    ))}
                  </div>
                  <p className="px-4 py-1.5 text-[10px] text-muted-foreground border-t border-border/60">
                    „Automatisch" = Schreiber wird vom Turnierplan vergeben: bevorzugt bereits ausgeschiedene Spieler,
                    sonst der Verlierer des vorherigen Spiels am selben Board; in der ersten Runde ein Spieler, der erst später dran ist.
                  </p>
                </div>
              ));
            })()}

            <div className="bg-card border border-border rounded-xl p-4">
              <h3 className="font-display uppercase text-sm mb-2 flex items-center gap-2"><UserMinus className="w-4 h-4 text-muted-foreground" /> Teilnehmer verwalten</h3>
              <p className="text-[11px] text-muted-foreground mb-2">Spieler, die nicht erscheinen oder aufgeben, hier zurückziehen – Baum, Spielplan und Schreiber werden neu berechnet.</p>
              <div className="flex flex-wrap gap-2">
                {activeTournament.players.map(p => (
                  <button key={p} onClick={() => withdrawPlayer(p)}
                    className="bg-muted border border-border rounded-lg px-3 py-1 text-xs hover:border-destructive hover:text-destructive transition-colors">
                    {p} ×
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {editMatch && (
          <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur flex items-center justify-center p-4" onClick={() => setEditMatch(null)}>
            <div className="bg-card border border-border rounded-xl p-5 w-full max-w-sm space-y-3" onClick={(e) => e.stopPropagation()}>
              <h3 className="font-display uppercase text-sm">Partie bearbeiten</h3>
              <p className="text-[11px] text-muted-foreground">Leer lassen = Freilos (BYE). Ergebnisse dieser Partie werden zurückgesetzt.</p>
              <Input value={editP1} onChange={(e) => setEditP1(e.target.value)} placeholder="Spieler 1 (leer = BYE)" className="bg-background border-border" />
              <Input value={editP2} onChange={(e) => setEditP2(e.target.value)} placeholder="Spieler 2 (leer = BYE)" className="bg-background border-border" />
              <div className="flex gap-2 justify-end pt-1">
                <Button size="sm" variant="ghost" onClick={() => setEditMatch(null)}>Abbrechen</Button>
                <Button size="sm" onClick={saveMatchPlayers}>Speichern</Button>
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
                  <h3 className="font-display uppercase text-sm">Live-Ticker · Turnierverlauf</h3>
                </div>
                <ol className="grid md:grid-cols-2 gap-2 text-xs">
                  {done.map(m => (
                    <li key={m.id} className="border-l-2 border-primary/40 pl-2">
                      <p className="font-display text-sm">
                        <span className="text-secondary">{m.winner}</span>
                        <span className="text-muted-foreground"> schlägt </span>
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
  const rrMatches = activeTournament.bracket as RoundRobinMatch[];
  const standings = calcStandings(rrMatches);
  const unplayed = rrMatches.filter(m => !m.played);
  const played = rrMatches.filter(m => m.played);

  return (
    <div className="container py-4 animate-slide-up">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xl font-display uppercase">{activeTournament.name}</h2>
          <p className="text-xs text-muted-foreground">Round Robin · {activeTournament.players.length} Spieler</p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => { setActiveTournament(null); setPhase("list"); }}>
          ← Übersicht
        </Button>
      </div>

      {activeTournament.champion && (
        <div className="bg-card border-2 border-accent rounded-xl p-4 text-center glow-gold mb-4">
          <Trophy className="w-8 h-8 text-accent mx-auto mb-1" />
          <p className="font-display uppercase text-xl">{activeTournament.champion}</p>
          <p className="text-accent text-sm font-display uppercase">Champion!</p>
          <Button size="sm" variant="ghost" className="mt-2 text-xs" onClick={() => setCeremonyChampion(activeTournament.champion)}>
            🏆 Pokal-Zeremonie zeigen
          </Button>
        </div>
      )}

      {/* Standings table */}
      <div className="bg-card rounded-xl border border-border p-4 mb-4">
        <h3 className="font-display text-sm uppercase text-muted-foreground mb-3">Tabelle</h3>
        <div className="grid grid-cols-[auto_1fr_repeat(4,40px)] gap-x-2 gap-y-1 text-xs">
          <span className="text-muted-foreground">#</span>
          <span className="text-muted-foreground">Spieler</span>
          <span className="text-muted-foreground text-center">Sp</span>
          <span className="text-muted-foreground text-center">S</span>
          <span className="text-muted-foreground text-center">N</span>
          <span className="text-muted-foreground text-center">Pkt</span>
          {standings.map((s, i) => (
            <>
              <span key={`pos-${s.name}`} className={`font-display ${i === 0 ? "text-accent" : ""}`}>
                {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`}
              </span>
              <span key={`name-${s.name}`} className="font-semibold truncate">{s.name}</span>
              <span key={`p-${s.name}`} className="text-center">{s.played}</span>
              <span key={`w-${s.name}`} className="text-center text-secondary">{s.won}</span>
              <span key={`l-${s.name}`} className="text-center text-destructive">{s.lost}</span>
              <span key={`pts-${s.name}`} className="text-center font-display text-primary">{s.points}</span>
            </>
          ))}
        </div>
      </div>

      {/* Upcoming matches */}
      {unplayed.length > 0 && (
        <div className="bg-card rounded-xl border border-border p-4 mb-4">
          <h3 className="font-display text-sm uppercase text-muted-foreground mb-3">Ausstehende Spiele ({unplayed.length})</h3>
          <div className="space-y-2">
            {unplayed.map(m => (
              <div key={m.id} className="flex items-center justify-between bg-muted/30 rounded-lg px-3 py-2">
                <span className="text-sm">{m.player1} <span className="text-muted-foreground">vs</span> {m.player2}</span>
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" className="text-xs h-7 px-2" onClick={() => setRrWinner(m.id, m.player1)}>
                    {m.player1} ✓
                  </Button>
                  <Button size="sm" variant="ghost" className="text-xs h-7 px-2" onClick={() => setRrWinner(m.id, m.player2)}>
                    {m.player2} ✓
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Played matches */}
      {played.length > 0 && (
        <div className="bg-card rounded-xl border border-border p-4">
          <h3 className="font-display text-sm uppercase text-muted-foreground mb-3">Gespielte Partien ({played.length})</h3>
          <div className="space-y-1">
            {played.map(m => (
              <div key={m.id} className="flex items-center justify-between px-3 py-1.5 text-sm">
                <span>{m.player1} vs {m.player2}</span>
                <span className="text-xs text-secondary font-medium">{m.winner} ✓</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {ceremonyChampion && (
        <TrophyCeremony champion={ceremonyChampion} tournamentName={activeTournament.name} onClose={() => setCeremonyChampion(null)} />
      )}
    </div>
  );
};

export default TournamentPage;
