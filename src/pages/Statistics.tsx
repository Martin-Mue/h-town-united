import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Link } from "react-router-dom";
import { BarChart3, Trophy, Target, TrendingUp, Users, Flame, Calendar, Crosshair, Zap, Hash, Award, Percent, Filter, X, ChevronDown, ChevronUp, Video, Trash2, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  LineChart, Line, PieChart, Pie, Cell, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  AreaChart, Area,
} from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Loader2 } from "lucide-react";
import DartboardHeatmap from "@/components/stats/DartboardHeatmap";
import {
  first9Average, average, highestVisit, count180s, computeCheckoutStats, combineCheckoutStats,
  computeCricketStats, combineCricketStats,
  type DartThrow, type CheckoutStats, type CricketStats,
} from "@/utils/dartStats";

interface GameRecord {
  id: string; mode: string; player1_name: string; player2_name: string;
  player1_average: number; player2_average: number; player1_highscore: number; player2_highscore: number;
  player1_legs_won: number; player2_legs_won: number; player1_double_rate: number; player2_double_rate: number;
  player1_total_throws: number; player2_total_throws: number; winner_name: string; winner_id: string | null; played_at: string;
  player1_id: string | null; player2_id: string | null; start_score: number; best_of_legs: number;
  detail_stats?: {
    players?: DetailStat[];
    /** Legacy shape from before detail_stats covered every player, not just the top 2. */
    player1?: DetailStat | null;
    player2?: DetailStat | null;
  } | null;
}

interface DetailStat {
  name: string; player_id?: string | null; visits: number; trebleless: number; treblelessRate: number; triples: number;
  t20?: number; t19?: number; t18?: number; t17?: number; t16?: number;
}

interface PlayerStats {
  id: string; name: string; games_played: number; games_won: number;
  average: number; high_score: number; double_rate: number; emoji: string;
}

interface GameLegRecord {
  id: string; game_id: string; leg_number: number; player_index: number;
  player_name: string; player_id: string | null; starting_score: number;
  throws: DartThrow[]; won: boolean;
}

interface HighlightClipRecord {
  id: string; game_id: string | null; player_id: string | null; player_name: string;
  kind: string; points: number; darts: DartThrow[]; storage_path: string; mime: string; created_at: string;
}

const CHART_COLORS = [
  "hsl(185 85% 48%)", "hsl(155 65% 42%)", "hsl(45 100% 58%)",
  "hsl(280 70% 55%)", "hsl(0 72% 51%)", "hsl(200 80% 55%)",
];

const TOOLTIP_STYLE = { background: "hsl(222 25% 9%)", border: "1px solid hsl(222 18% 14%)", borderRadius: 8, fontSize: 12 };

const StatisticsPage = () => {
  const [games, setGames] = useState<GameRecord[]>([]);
  const [players, setPlayers] = useState<PlayerStats[]>([]);
  const [gameLegs, setGameLegs] = useState<GameLegRecord[]>([]);
  const [highlightClips, setHighlightClips] = useState<HighlightClipRecord[]>([]);
  const [cleanupDays, setCleanupDays] = useState("90");
  const [cleaningUpClips, setCleaningUpClips] = useState(false);
  const [deletingClipId, setDeletingClipId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState<"average" | "games_won" | "high_score" | "double_rate" | "win_rate" | "checkout" | "points">("average");
  const [compareP1, setCompareP1] = useState<string>("");
  const [compareP2, setCompareP2] = useState<string>("");
  const [selectedPlayerId, setSelectedPlayerId] = useState<string>("");
  const [activeTab, setActiveTab] = useState<"overview" | "players" | "h2h" | "history" | "highlights">("overview");
  const [expandedGameId, setExpandedGameId] = useState<string | null>(null);
  const [filterTime, setFilterTime] = useState<"all" | "today" | "week" | "month" | "year">("all");
  const [filterMode, setFilterMode] = useState<string>("all");
  const [filterPlayerId, setFilterPlayerId] = useState<string>("all");
  const [filterBestOf, setFilterBestOf] = useState<string>("all");
  const [filterYear, setFilterYear] = useState<string>("all");
  const { session } = useAuth();

  const fetchData = useCallback(async () => {
    const [gamesRes, playersRes, legsRes, clipsRes] = await Promise.all([
      supabase.from("games").select("*").order("played_at", { ascending: false }).limit(500),
      supabase.from("players").select("id, name, games_played, games_won, average, high_score, double_rate, emoji").order("average", { ascending: false }),
      supabase.from("game_legs").select("*").order("created_at", { ascending: false }).limit(4000),
      supabase.from("highlight_clips").select("*").order("created_at", { ascending: false }).limit(200),
    ]);
    if (gamesRes.data) setGames(gamesRes.data as GameRecord[]);
    if (playersRes.data) setPlayers(playersRes.data);
    if (legsRes.data) setGameLegs(legsRes.data as unknown as GameLegRecord[]);
    if (clipsRes.data) setHighlightClips(clipsRes.data as unknown as HighlightClipRecord[]);
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Filtered games — drives every aggregation below
  const filteredGames = useMemo(() => {
    const now = Date.now();
    const dayMs = 86_400_000;
    let cutoff = 0;
    if (filterTime === "today") cutoff = new Date(new Date().setHours(0, 0, 0, 0)).getTime();
    else if (filterTime === "week") cutoff = now - 7 * dayMs;
    else if (filterTime === "month") cutoff = now - 30 * dayMs;
    else if (filterTime === "year") cutoff = now - 365 * dayMs;
    return games.filter((g) => {
      if (cutoff > 0 && new Date(g.played_at).getTime() < cutoff) return false;
      if (filterYear !== "all" && new Date(g.played_at).getFullYear() !== Number(filterYear)) return false;
      if (filterMode !== "all" && g.mode !== filterMode) return false;
      if (filterPlayerId !== "all" && g.player1_id !== filterPlayerId && g.player2_id !== filterPlayerId) return false;
      if (filterBestOf !== "all" && Number(g.best_of_legs) !== Number(filterBestOf)) return false;
      return true;
    });
  }, [games, filterTime, filterYear, filterMode, filterPlayerId, filterBestOf]);

  const availableModes = useMemo(() => {
    const s = new Set<string>();
    games.forEach((g) => s.add(g.mode));
    return Array.from(s);
  }, [games]);

  const availableBestOf = useMemo(() => {
    const s = new Set<number>();
    games.forEach((g) => { if (g.best_of_legs) s.add(Number(g.best_of_legs)); });
    return Array.from(s).sort((a, b) => a - b);
  }, [games]);

  const availableYears = useMemo(() => {
    const s = new Set<number>();
    games.forEach((g) => s.add(new Date(g.played_at).getFullYear()));
    return Array.from(s).sort((a, b) => b - a);
  }, [games]);

  const filtersActive =
    filterTime !== "all" || filterYear !== "all" || filterMode !== "all" || filterPlayerId !== "all" || filterBestOf !== "all";

  // Treble-less visits + big-triple hit distribution (from per-game detail stats)
  const trebleStats = useMemo(() => {
    const entries: DetailStat[] = [];
    filteredGames.forEach((g) => {
      const ds = (g.detail_stats || {}) as { players?: DetailStat[]; player1?: DetailStat | null; player2?: DetailStat | null };
      if (ds.players && ds.players.length > 0) {
        ds.players.forEach((d) => {
          if (!d) return;
          if (filterPlayerId !== "all" && (d.player_id ?? null) !== filterPlayerId) return;
          entries.push(d);
        });
      } else {
        // Legacy games saved before detail_stats covered every player, not just the top 2.
        ([["player1", g.player1_id], ["player2", g.player2_id]] as const).forEach(([key, pid]) => {
          const d = ds[key];
          if (!d) return;
          if (filterPlayerId !== "all" && pid !== filterPlayerId) return;
          entries.push(d);
        });
      }
    });
    const visits = entries.reduce((s, d) => s + (d.visits || 0), 0);
    const trebleless = entries.reduce((s, d) => s + (d.trebleless || 0), 0);
    const triples = entries.reduce((s, d) => s + (d.triples || 0), 0);
    const bigTriples = [20, 19, 18, 17, 16].map((n) => ({
      name: `T${n}`,
      value: entries.reduce((s, d) => s + ((d as any)[`t${n}`] || 0), 0),
    }));
    const perPlayer = Object.values(
      entries.reduce<Record<string, { name: string; visits: number; trebleless: number; triples: number }>>((acc, d) => {
        const cur = acc[d.name] || { name: d.name, visits: 0, trebleless: 0, triples: 0 };
        cur.visits += d.visits || 0;
        cur.trebleless += d.trebleless || 0;
        cur.triples += d.triples || 0;
        acc[d.name] = cur;
        return acc;
      }, {})
    ).sort((a, b) => (a.trebleless / Math.max(1, a.visits)) - (b.trebleless / Math.max(1, b.visits)));
    return {
      hasData: entries.length > 0,
      visits, trebleless, triples, bigTriples, perPlayer,
      treblelessRate: visits ? (trebleless / visits) * 100 : 0,
    };
  }, [filteredGames, filterPlayerId]);

  // Checkout %, highest checkout, first-9 average — computed from the dart-by-dart
  // game_legs data (not available on X01 games only; Cricket has no "checkout").
  const advancedByPlayer = useMemo(() => {
    const filteredIds = new Set(filteredGames.map((g) => g.id));
    const modeById = new Map(games.map((g) => [g.id, g.mode]));
    const byPlayer: Record<string, { name: string; checkouts: CheckoutStats[]; first9s: number[] }> = {};
    gameLegs.forEach((leg) => {
      if (!filteredIds.has(leg.game_id)) return;
      if (modeById.get(leg.game_id) === "cricket") return;
      if (!leg.player_id || !Array.isArray(leg.throws) || leg.throws.length === 0) return;
      const bucket = byPlayer[leg.player_id] || (byPlayer[leg.player_id] = { name: leg.player_name, checkouts: [], first9s: [] });
      bucket.checkouts.push(computeCheckoutStats(leg.throws, leg.starting_score));
      bucket.first9s.push(first9Average(leg.throws));
    });
    const result: Record<string, { name: string; checkout: CheckoutStats; first9: number }> = {};
    Object.entries(byPlayer).forEach(([id, v]) => {
      result[id] = {
        name: v.name,
        checkout: combineCheckoutStats(v.checkouts),
        first9: v.first9s.length ? v.first9s.reduce((a, b) => a + b, 0) / v.first9s.length : 0,
      };
    });
    return result;
  }, [gameLegs, filteredGames, games]);

  // Season/filter-aware leaderboard stats — built from game_legs (covers every player,
  // not just the top-2 tracked on the `games` row) so a season/year filter actually
  // changes the leaderboard instead of always showing lifetime totals.
  const filteredPlayerStats = useMemo(() => {
    const filteredIds = new Set(filteredGames.map((g) => g.id));
    const winsByPlayer: Record<string, number> = {};
    filteredGames.forEach((g) => { if (g.winner_id) winsByPlayer[g.winner_id] = (winsByPlayer[g.winner_id] || 0) + 1; });
    const byPlayer: Record<string, { name: string; gameIds: Set<string>; throws: DartThrow[]; highScore: number; checkouts: CheckoutStats[] }> = {};
    gameLegs.forEach((leg) => {
      if (!filteredIds.has(leg.game_id) || !leg.player_id || !Array.isArray(leg.throws)) return;
      const bucket = byPlayer[leg.player_id] || (byPlayer[leg.player_id] = { name: leg.player_name, gameIds: new Set(), throws: [], highScore: 0, checkouts: [] });
      bucket.gameIds.add(leg.game_id);
      bucket.throws.push(...leg.throws);
      bucket.highScore = Math.max(bucket.highScore, highestVisit(leg.throws));
      bucket.checkouts.push(computeCheckoutStats(leg.throws, leg.starting_score));
    });
    const result: Record<string, PlayerStats> = {};
    Object.entries(byPlayer).forEach(([id, v]) => {
      const club = players.find((p) => p.id === id);
      result[id] = {
        id, name: v.name, emoji: club?.emoji || "🎯",
        games_played: v.gameIds.size,
        games_won: winsByPlayer[id] || 0,
        average: average(v.throws),
        high_score: v.highScore,
        double_rate: combineCheckoutStats(v.checkouts).percentage,
      };
    });
    return result;
  }, [gameLegs, filteredGames, players]);

  const bestCheckoutRate = useMemo(() => {
    return Object.values(advancedByPlayer)
      .filter((p) => p.checkout.attempts >= 5)
      .reduce((best, p) => (p.checkout.percentage > best.val ? { name: p.name, val: p.checkout.percentage } : best), { name: "-", val: 0 });
  }, [advancedByPlayer]);

  const bestHighestCheckout = useMemo(() => {
    return Object.values(advancedByPlayer)
      .reduce((best, p) => (p.checkout.highestCheckout > best.val ? { name: p.name, val: p.checkout.highestCheckout } : best), { name: "-", val: 0 });
  }, [advancedByPlayer]);

  // Cricket-specific stats (MPR, hit rate) — separate from the X01-only checkout/first-9 bucket above.
  const cricketByPlayer = useMemo(() => {
    const filteredIds = new Set(filteredGames.map((g) => g.id));
    const modeById = new Map(games.map((g) => [g.id, g.mode]));
    const byPlayer: Record<string, { name: string; legs: CricketStats[] }> = {};
    gameLegs.forEach((leg) => {
      if (!filteredIds.has(leg.game_id)) return;
      if (modeById.get(leg.game_id) !== "cricket") return;
      if (!leg.player_id || !Array.isArray(leg.throws) || leg.throws.length === 0) return;
      const bucket = byPlayer[leg.player_id] || (byPlayer[leg.player_id] = { name: leg.player_name, legs: [] });
      bucket.legs.push(computeCricketStats(leg.throws));
    });
    const result: Record<string, { name: string; cricket: CricketStats }> = {};
    Object.entries(byPlayer).forEach(([id, v]) => {
      result[id] = { name: v.name, cricket: combineCricketStats(v.legs) };
    });
    return result;
  }, [gameLegs, filteredGames, games]);

  const bestMpr = useMemo(() => {
    return Object.values(cricketByPlayer)
      .filter((p) => p.cricket.rounds >= 3)
      .reduce((best, p) => (p.cricket.mpr > best.val ? { name: p.name, val: p.cricket.mpr } : best), { name: "-", val: 0 });
  }, [cricketByPlayer]);

  const resetFilters = () => {
    setFilterTime("all"); setFilterYear("all"); setFilterMode("all"); setFilterPlayerId("all"); setFilterBestOf("all");
  };

  // Club-wide stats
  const clubStats = useMemo(() => {
    const totalGames = filteredGames.length;
    const totalPlayers = players.length;
    const avgOfAverages = players.length > 0 ? players.reduce((s, p) => s + Number(p.average), 0) / players.length : 0;
    const bestAvg = players.reduce((best, p) => Number(p.average) > best.val ? { name: p.name, val: Number(p.average), emoji: p.emoji } : best, { name: "-", val: 0, emoji: "" });
    const bestHighscore = players.reduce((best, p) => p.high_score > best.val ? { name: p.name, val: p.high_score, emoji: p.emoji } : best, { name: "-", val: 0, emoji: "" });
    const mostGames = players.reduce((best, p) => p.games_played > best.val ? { name: p.name, val: p.games_played, emoji: p.emoji } : best, { name: "-", val: 0, emoji: "" });
    const totalDarts = filteredGames.reduce((s, g) => s + g.player1_total_throws + g.player2_total_throws, 0);
    const highestGameAvg = filteredGames.reduce((best, g) => {
      const max = Math.max(g.player1_average, g.player2_average);
      if (max > best.val) {
        const name = g.player1_average > g.player2_average ? g.player1_name : g.player2_name;
        return { name, val: max };
      }
      return best;
    }, { name: "-", val: 0 });
    const mostWins = players.reduce((best, p) => p.games_won > best.val ? { name: p.name, val: p.games_won, emoji: p.emoji } : best, { name: "-", val: 0, emoji: "" });
    return { totalGames, totalPlayers, avgOfAverages, bestAvg, bestHighscore, mostGames, totalDarts, highestGameAvg, mostWins };
  }, [filteredGames, players]);

  const leaderboard = useMemo(() => {
    // Any active filter (season, time range, mode, ...) switches the leaderboard from
    // lifetime totals to stats recomputed for just the filtered games.
    const source = filtersActive ? Object.values(filteredPlayerStats) : players;
    return [...source].sort((a, b) => {
      if (sortBy === "average") return Number(b.average) - Number(a.average);
      if (sortBy === "games_won") return b.games_won - a.games_won;
      if (sortBy === "high_score") return b.high_score - a.high_score;
      if (sortBy === "win_rate") {
        const rateA = a.games_played > 0 ? a.games_won / a.games_played : 0;
        const rateB = b.games_played > 0 ? b.games_won / b.games_played : 0;
        return rateB - rateA;
      }
      if (sortBy === "checkout") {
        return (advancedByPlayer[b.id]?.checkout.percentage ?? 0) - (advancedByPlayer[a.id]?.checkout.percentage ?? 0);
      }
      if (sortBy === "points") return b.games_won * 2 - a.games_won * 2;
      return Number(b.double_rate) - Number(a.double_rate);
    });
  }, [players, sortBy, advancedByPlayer, filteredPlayerStats, filtersActive]);

  const exportLeaderboardCsv = () => {
    const header = ["Platz", "Name", "Spiele", "Siege", "Punkte", "Average", "Highscore", "Doppel %"];
    const rows = leaderboard.map((p, i) => [
      i + 1, p.name, p.games_played, p.games_won, p.games_won * 2,
      Number(p.average).toFixed(1), p.high_score, Number(p.double_rate).toFixed(0),
    ]);
    const csv = [header, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(";")).join("\n");
    const blob = new Blob([String.fromCharCode(0xFEFF) + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const suffix = filterYear !== "all" ? `saison-${filterYear}` : "gesamt";
    a.href = url;
    a.download = `bestenliste-${suffix}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const modeDistribution = useMemo(() => {
    const counts: Record<string, number> = {};
    filteredGames.forEach(g => { counts[g.mode] = (counts[g.mode] || 0) + 1; });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [filteredGames]);

  const gamesTimeline = useMemo(() => {
    const days: Record<string, number> = {};
    const now = new Date();
    for (let i = 29; i >= 0; i--) { const d = new Date(now); d.setDate(d.getDate() - i); days[d.toISOString().slice(0, 10)] = 0; }
    filteredGames.forEach(g => { const day = g.played_at.slice(0, 10); if (days[day] !== undefined) days[day]++; });
    return Object.entries(days).map(([date, count]) => ({ date: date.slice(5), count }));
  }, [filteredGames]);

  // Per-player stats
  const playerDetailStats = useMemo(() => {
    if (!selectedPlayerId) return null;
    const player = players.find(p => p.id === selectedPlayerId);
    if (!player) return null;
    const playerGames = filteredGames.filter(g => g.player1_id === selectedPlayerId || g.player2_id === selectedPlayerId);
    const winRate = player.games_played > 0 ? Math.round((player.games_won / player.games_played) * 100) : 0;

    // Average trend (oldest first)
    let runningAvg = 0;
    const averageTrend = [...playerGames].reverse().map((g, i) => {
      const avg = g.player1_id === selectedPlayerId ? g.player1_average : g.player2_average;
      runningAvg = (runningAvg * i + Number(avg)) / (i + 1);
      return {
        game: i + 1,
        date: new Date(g.played_at).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" }),
        average: Number(avg).toFixed(1),
        runningAvg: runningAvg.toFixed(1),
      };
    });

    // Win streak
    let currentStreak = 0, bestStreak = 0;
    [...playerGames].reverse().forEach(g => {
      const isP1 = g.player1_id === selectedPlayerId;
      const won = g.winner_name === (isP1 ? g.player1_name : g.player2_name);
      if (won) { currentStreak++; bestStreak = Math.max(bestStreak, currentStreak); }
      else currentStreak = 0;
    });

    // Recent form (last 10)
    const recentForm = playerGames.slice(0, 10).map(g => {
      const isP1 = g.player1_id === selectedPlayerId;
      return {
        won: g.winner_name === (isP1 ? g.player1_name : g.player2_name),
        avg: Number(isP1 ? g.player1_average : g.player2_average),
        opponent: isP1 ? g.player2_name : g.player1_name,
        date: new Date(g.played_at).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" }),
      };
    });

    // Best/worst game avg
    const allAvgs = playerGames.map(g => Number(g.player1_id === selectedPlayerId ? g.player1_average : g.player2_average));
    const bestGameAvg = allAvgs.length > 0 ? Math.max(...allAvgs) : 0;
    const worstGameAvg = allAvgs.length > 0 ? Math.min(...allAvgs) : 0;

    // Opponents breakdown
    const opponents: Record<string, { wins: number; losses: number }> = {};
    playerGames.forEach(g => {
      const isP1 = g.player1_id === selectedPlayerId;
      const opp = isP1 ? g.player2_name : g.player1_name;
      if (!opponents[opp]) opponents[opp] = { wins: 0, losses: 0 };
      if (g.winner_name === (isP1 ? g.player1_name : g.player2_name)) opponents[opp].wins++;
      else opponents[opp].losses++;
    });

    // Nemesis / favorite opponent — needs at least 2 games against them so a single fluke
    // result doesn't get crowned "0% win rate against X" or "100% against Y".
    const qualifyingOpponents = Object.entries(opponents).filter(([, r]) => r.wins + r.losses >= 2);
    const nemesis = qualifyingOpponents.reduce<{ name: string; losses: number; wins: number } | null>((worst, [name, r]) => {
      const rate = r.losses / (r.wins + r.losses);
      const worstRate = worst ? worst.losses / (worst.losses + worst.wins) : -1;
      return rate > worstRate ? { name, losses: r.losses, wins: r.wins } : worst;
    }, null);
    const favoriteOpponent = qualifyingOpponents.reduce<{ name: string; losses: number; wins: number } | null>((best, [name, r]) => {
      const rate = r.wins / (r.wins + r.losses);
      const bestRate = best ? best.wins / (best.wins + best.losses) : -1;
      return rate > bestRate ? { name, losses: r.losses, wins: r.wins } : best;
    }, null);

    return { player, winRate, averageTrend, currentStreak, bestStreak, recentForm, bestGameAvg, worstGameAvg, opponents, nemesis, favoriteOpponent, totalGames: playerGames.length };
  }, [selectedPlayerId, filteredGames, players]);

  // Throw heatmap — board-relative tip coordinates (boardU/boardV) are camera-framing-
  // independent, so points from different games/devices/sessions are directly comparable.
  // Only camera-scored throws carry them; manual entries simply don't contribute a dot.
  const playerHeatmapPoints = useMemo(() => {
    if (!selectedPlayerId) return [];
    const filteredIds = new Set(filteredGames.map((g) => g.id));
    const points: { u: number; v: number; points: number }[] = [];
    gameLegs.forEach((leg) => {
      if (leg.player_id !== selectedPlayerId || !filteredIds.has(leg.game_id) || !Array.isArray(leg.throws)) return;
      (leg.throws as unknown as DartThrow[]).forEach((t) => {
        if (typeof t.boardU === "number" && typeof t.boardV === "number") {
          points.push({ u: t.boardU, v: t.boardV, points: t.points });
        }
      });
    });
    return points;
  }, [selectedPlayerId, filteredGames, gameLegs]);

  // Achievements — derived entirely from data already loaded (games/legs/players),
  // no separate table: unlocking is just "does the existing stat cross this threshold".
  const playerAchievements = useMemo(() => {
    if (!selectedPlayerId || !playerDetailStats) return [];
    const player = playerDetailStats.player;
    const myLegs = gameLegs.filter((l) => l.player_id === selectedPlayerId && Array.isArray(l.throws));
    const total180s = myLegs.reduce((s, l) => s + count180s(l.throws as unknown as DartThrow[]), 0);
    const nineDarters = myLegs.filter((l) => l.won && l.throws.length === 9).length;
    const highestCheckout = advancedByPlayer[player.id]?.checkout.highestCheckout ?? 0;
    const bestMpr = cricketByPlayer[player.id]?.cricket.mpr ?? 0;

    const defs: { icon: string; title: string; desc: string; unlocked: boolean }[] = [
      { icon: "🎮", title: "Erstes Spiel", desc: "Das erste Spiel gespielt", unlocked: player.games_played >= 1 },
      { icon: "💯", title: "100 Spiele", desc: "100 Spiele gespielt", unlocked: player.games_played >= 100 },
      { icon: "🎯", title: "Erster 180er", desc: "Einen 180er geworfen", unlocked: total180s >= 1 },
      { icon: "🔥", title: "180er-Serie", desc: "10× die 180 getroffen", unlocked: total180s >= 10 },
      { icon: "⚡", title: "Siegesserie", desc: "5 Spiele in Folge gewonnen", unlocked: playerDetailStats.bestStreak >= 5 },
      { icon: "🚀", title: "Ton-Finish", desc: "Ein Checkout von 100+ geworfen", unlocked: highestCheckout >= 100 },
      { icon: "🐐", title: "170er-Finish", desc: "Das höchstmögliche Checkout: 170", unlocked: highestCheckout >= 170 },
      { icon: "🎳", title: "Perfektes Leg", desc: "Ein Leg in genau 9 Darts gewonnen", unlocked: nineDarters >= 1 },
      { icon: "📈", title: "Klub-Elite", desc: "Ø 60+ über die Karriere", unlocked: Number(player.average) >= 60 },
      { icon: "🦾", title: "Cricket-Meister", desc: "3.0+ MPR in einem Spiel", unlocked: bestMpr >= 3 },
    ];
    return defs;
  }, [selectedPlayerId, playerDetailStats, gameLegs, advancedByPlayer, cricketByPlayer]);

  const h2hRecords = useMemo(() => {
    if (!compareP1 || !compareP2) return null;
    const p1 = players.find(p => p.id === compareP1);
    const p2 = players.find(p => p.id === compareP2);
    if (!p1 || !p2) return null;
    const h2hGames = filteredGames.filter(g =>
      (g.player1_id === compareP1 && g.player2_id === compareP2) || (g.player1_id === compareP2 && g.player2_id === compareP1)
    );
    let p1Wins = 0, p2Wins = 0, p1AvgSum = 0, p2AvgSum = 0, p1HighestAvg = 0, p2HighestAvg = 0;
    h2hGames.forEach(g => {
      const isP1First = g.player1_id === compareP1;
      const myAvg = isP1First ? g.player1_average : g.player2_average;
      const oppAvg = isP1First ? g.player2_average : g.player1_average;
      p1AvgSum += Number(myAvg); p2AvgSum += Number(oppAvg);
      p1HighestAvg = Math.max(p1HighestAvg, Number(myAvg)); p2HighestAvg = Math.max(p2HighestAvg, Number(oppAvg));
      if (g.winner_name === p1.name) p1Wins++; else if (g.winner_name === p2.name) p2Wins++;
    });
    const winRate = (p: PlayerStats) => p.games_played > 0 ? Math.round((p.games_won / p.games_played) * 100) : 0;
    return {
      p1, p2, h2hGames: h2hGames.length, p1Wins, p2Wins,
      p1AvgH2H: h2hGames.length > 0 ? (p1AvgSum / h2hGames.length).toFixed(1) : "0",
      p2AvgH2H: h2hGames.length > 0 ? (p2AvgSum / h2hGames.length).toFixed(1) : "0",
      p1HighestAvg: p1HighestAvg.toFixed(1), p2HighestAvg: p2HighestAvg.toFixed(1),
      radar: [
        { skill: "Average", p1: Math.min(Number(p1.average), 100), p2: Math.min(Number(p2.average), 100) },
        { skill: "Highscore", p1: (p1.high_score / 180) * 100, p2: (p2.high_score / 180) * 100 },
        { skill: "Siegquote", p1: winRate(p1), p2: winRate(p2) },
        { skill: "Erfahrung", p1: Math.min(p1.games_played * 5, 100), p2: Math.min(p2.games_played * 5, 100) },
        { skill: "Doppel %", p1: Number(p1.double_rate), p2: Number(p2.double_rate) },
      ],
    };
  }, [compareP1, compareP2, players, filteredGames]);

  const recentGames = filteredGames.slice(0, 20);

  // Leg-by-leg breakdown per game, from the dart-by-dart game_legs data.
  const legsByGame = useMemo(() => {
    const byGame: Record<string, GameLegRecord[]> = {};
    gameLegs.forEach((leg) => {
      (byGame[leg.game_id] ||= []).push(leg);
    });
    const gameById = new Map(games.map((g) => [g.id, g]));
    const result: Record<string, { legNumber: number; mode: string; players: { name: string; average: number; first9: number; mpr: number; hitRate: number; points: number; dartsThrown: number; won: boolean }[] }[]> = {};
    Object.entries(byGame).forEach(([gameId, legs]) => {
      const mode = gameById.get(gameId)?.mode || "501";
      const isCricket = mode === "cricket";
      const byLegNumber: Record<number, GameLegRecord[]> = {};
      legs.forEach((l) => { (byLegNumber[l.leg_number] ||= []).push(l); });
      result[gameId] = Object.entries(byLegNumber)
        .sort(([a], [b]) => Number(a) - Number(b))
        .map(([legNumber, rows]) => ({
          legNumber: Number(legNumber),
          mode,
          players: [...rows].sort((a, b) => a.player_index - b.player_index).map((r) => {
            const cricket = isCricket ? computeCricketStats(r.throws) : null;
            return {
              name: r.player_name,
              average: average(r.throws),
              first9: !isCricket ? first9Average(r.throws) : 0,
              mpr: cricket?.mpr ?? 0,
              hitRate: cricket?.hitRate ?? 0,
              points: r.throws.reduce((s, t) => s + t.points, 0),
              dartsThrown: r.throws.length,
              won: r.won,
            };
          }),
        }));
    });
    return result;
  }, [gameLegs, games]);

  const filteredClips = useMemo(() => {
    const now = Date.now();
    const dayMs = 86_400_000;
    let cutoff = 0;
    if (filterTime === "today") cutoff = new Date(new Date().setHours(0, 0, 0, 0)).getTime();
    else if (filterTime === "week") cutoff = now - 7 * dayMs;
    else if (filterTime === "month") cutoff = now - 30 * dayMs;
    else if (filterTime === "year") cutoff = now - 365 * dayMs;
    return highlightClips.filter((c) => {
      if (cutoff > 0 && new Date(c.created_at).getTime() < cutoff) return false;
      if (filterPlayerId !== "all" && c.player_id !== filterPlayerId) return false;
      return true;
    });
  }, [highlightClips, filterTime, filterPlayerId]);

  const clipUrl = (path: string) => supabase.storage.from("dart-clips").getPublicUrl(path).data.publicUrl;

  const deleteClip = async (clip: HighlightClipRecord) => {
    if (deletingClipId) return;
    setDeletingClipId(clip.id);
    try {
      await supabase.storage.from("dart-clips").remove([clip.storage_path]);
      await supabase.from("highlight_clips").delete().eq("id", clip.id);
      setHighlightClips((prev) => prev.filter((c) => c.id !== clip.id));
    } finally {
      setDeletingClipId(null);
    }
  };

  const clipKindLabel = (kind: string) => kind === "180" ? "🎯 180" : kind === "checkout" ? "🏆 Checkout" : "🔥 Ton+";

  const oldClips = useMemo(() => {
    const cutoff = Date.now() - Number(cleanupDays) * 86_400_000;
    return highlightClips.filter((c) => new Date(c.created_at).getTime() < cutoff);
  }, [highlightClips, cleanupDays]);

  const deleteOldClips = async () => {
    if (oldClips.length === 0 || cleaningUpClips) return;
    setCleaningUpClips(true);
    try {
      await supabase.storage.from("dart-clips").remove(oldClips.map((c) => c.storage_path));
      await supabase.from("highlight_clips").delete().in("id", oldClips.map((c) => c.id));
      const removedIds = new Set(oldClips.map((c) => c.id));
      setHighlightClips((prev) => prev.filter((c) => !removedIds.has(c.id)));
    } finally {
      setCleaningUpClips(false);
    }
  };

  // The clip's game_id is a soft reference (no DB-enforced FK — see migration
  // 20260811180049) since the clip is often captured before the `games` row exists,
  // so a miss here just means the match/leg context isn't shown, not an error.
  const gamesById = useMemo(() => new Map(games.map((g) => [g.id, g])), [games]);
  const clipGameLabel = (clip: HighlightClipRecord): string | null => {
    if (!clip.game_id) return null;
    const g = gamesById.get(clip.game_id);
    if (!g) return null;
    const modeLabel = g.mode === "cricket" ? "Cricket" : g.mode === "custom" ? `Custom ${g.start_score}` : g.mode;
    const opponent = g.player1_name === clip.player_name ? g.player2_name : g.player1_name;
    return opponent && opponent !== "—" ? `${modeLabel} · vs ${opponent}` : modeLabel;
  };

  if (loading) {
    return <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  }

  const tabs = [
    { key: "overview" as const, label: "Übersicht", icon: BarChart3 },
    { key: "players" as const, label: "Spieler", icon: Users },
    { key: "h2h" as const, label: "H2H", icon: Crosshair },
    { key: "history" as const, label: "Spiele", icon: Target },
    { key: "highlights" as const, label: "Highlights", icon: Video },
  ];

  return (
    <div className="container py-6 animate-slide-up">
      <div className="flex items-center gap-3 mb-4">
        <BarChart3 className="w-6 h-6 text-primary" />
        <h2 className="text-2xl font-display uppercase">Statistiken</h2>
      </div>

      {/* Filter bar */}
      <div className="bg-card rounded-xl border border-border p-3 mb-4">
        <div className="flex items-center justify-between mb-2">
          <span className="flex items-center gap-1.5 text-xs font-display uppercase tracking-wider text-muted-foreground">
            <Filter className="w-3.5 h-3.5" /> Filter
            {filtersActive && (
              <span className="ml-2 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] text-primary">
                {filteredGames.length} / {games.length} Spiele
              </span>
            )}
          </span>
          {filtersActive && (
            <button onClick={resetFilters} className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1">
              <X className="w-3 h-3" /> Zurücksetzen
            </button>
          )}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          <Select value={filterTime} onValueChange={(v) => setFilterTime(v as typeof filterTime)}>
            <SelectTrigger className="h-9 bg-muted border-border text-xs"><SelectValue placeholder="Zeitraum" /></SelectTrigger>
            <SelectContent className="bg-card border-border">
              <SelectItem value="all">Alle Zeit</SelectItem>
              <SelectItem value="today">Heute</SelectItem>
              <SelectItem value="week">Letzte 7 Tage</SelectItem>
              <SelectItem value="month">Letzte 30 Tage</SelectItem>
              <SelectItem value="year">Letzte 12 Monate</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filterYear} onValueChange={setFilterYear}>
            <SelectTrigger className="h-9 bg-muted border-border text-xs"><SelectValue placeholder="Saison" /></SelectTrigger>
            <SelectContent className="bg-card border-border">
              <SelectItem value="all">Alle Saisons</SelectItem>
              {availableYears.map(y => <SelectItem key={y} value={String(y)}>Saison {y}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filterMode} onValueChange={setFilterMode}>
            <SelectTrigger className="h-9 bg-muted border-border text-xs"><SelectValue placeholder="Modus" /></SelectTrigger>
            <SelectContent className="bg-card border-border">
              <SelectItem value="all">Alle Modi</SelectItem>
              {availableModes.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filterPlayerId} onValueChange={setFilterPlayerId}>
            <SelectTrigger className="h-9 bg-muted border-border text-xs"><SelectValue placeholder="Spieler" /></SelectTrigger>
            <SelectContent className="bg-card border-border">
              <SelectItem value="all">Alle Spieler</SelectItem>
              {players.map(p => <SelectItem key={p.id} value={p.id}>{p.emoji} {p.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filterBestOf} onValueChange={setFilterBestOf}>
            <SelectTrigger className="h-9 bg-muted border-border text-xs"><SelectValue placeholder="Best of" /></SelectTrigger>
            <SelectContent className="bg-card border-border">
              <SelectItem value="all">Alle Formate</SelectItem>
              {availableBestOf.map(n => <SelectItem key={n} value={String(n)}>Best of {n}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Tab navigation */}
      <div className="flex gap-1 mb-6 bg-card rounded-lg border border-border p-1">
        {tabs.map(t => (
          <button key={t.key} onClick={() => setActiveTab(t.key)}
            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium transition-all ${activeTab === t.key ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground"}`}>
            <t.icon className="w-3.5 h-3.5" />{t.label}
          </button>
        ))}
      </div>

      {/* OVERVIEW TAB */}
      {activeTab === "overview" && (
        <>
          {/* Club overview cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            {[
              { label: "Gespielte Spiele", value: clubStats.totalGames, icon: Target, color: "text-primary" },
              { label: "Mitglieder", value: clubStats.totalPlayers, icon: Users, color: "text-secondary" },
              { label: "Ø Club-Average", value: clubStats.avgOfAverages.toFixed(1), icon: TrendingUp, color: "text-accent" },
              { label: "Geworfene Darts", value: clubStats.totalDarts.toLocaleString(), icon: Hash, color: "text-primary" },
            ].map(s => (
              <div key={s.label} className="bg-card rounded-xl p-4 border border-border">
                <s.icon className={`w-4 h-4 ${s.color} mb-1`} />
                <p className="text-2xl font-display">{s.value}</p>
                <p className="text-xs text-muted-foreground">{s.label}</p>
              </div>
            ))}
          </div>

          {/* Records */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            {[
              { label: "Höchster Score", value: clubStats.bestHighscore.val, sub: clubStats.bestHighscore.name, icon: Trophy, color: "text-accent" },
              { label: "Bester Ø", value: clubStats.bestAvg.val.toFixed(1), sub: clubStats.bestAvg.name, icon: Flame, color: "text-destructive" },
              { label: "Bester Game-Ø", value: clubStats.highestGameAvg.val.toFixed(1), sub: clubStats.highestGameAvg.name, icon: Zap, color: "text-secondary" },
              { label: "Meiste Siege", value: clubStats.mostWins.val, sub: clubStats.mostWins.name, icon: Award, color: "text-primary" },
              { label: "Höchstes Finish", value: bestHighestCheckout.val || "-", sub: bestHighestCheckout.name, icon: Crosshair, color: "text-accent" },
              { label: "Beste Checkout %", value: bestCheckoutRate.val ? `${bestCheckoutRate.val.toFixed(0)}%` : "-", sub: bestCheckoutRate.name, icon: Percent, color: "text-secondary" },
              { label: "Beste MPR (Cricket)", value: bestMpr.val ? bestMpr.val.toFixed(2) : "-", sub: bestMpr.name, icon: Target, color: "text-accent" },
            ].map(s => (
              <div key={s.label} className="bg-card rounded-xl p-3 border border-border">
                <s.icon className={`w-4 h-4 ${s.color} mb-1`} />
                <p className="text-xl font-display">{s.value}</p>
                <p className="text-[10px] text-muted-foreground">{s.label}</p>
                <p className="text-[10px] text-primary">{s.sub}</p>
              </div>
            ))}
          </div>

          {/* Games timeline */}
          {gamesTimeline.some(d => d.count > 0) && (
            <div className="bg-card rounded-xl border border-border p-4 mb-6">
              <h3 className="font-display text-sm uppercase mb-3 text-muted-foreground flex items-center gap-2">
                <Calendar className="w-4 h-4" /> Spiele der letzten 30 Tage
              </h3>
              <ResponsiveContainer width="100%" height={120}>
                <BarChart data={gamesTimeline}>
                  <XAxis dataKey="date" tick={{ fontSize: 9, fill: "hsl(222 12% 50%)" }} interval={4} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 9, fill: "hsl(222 12% 50%)" }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} />
                  <Bar dataKey="count" fill="hsl(185 85% 48%)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Mode distribution */}
          {trebleStats.hasData && (
            <div className="bg-card rounded-xl border border-border p-4 mb-6">
              <h3 className="font-display text-sm uppercase mb-3 text-muted-foreground flex items-center gap-2">
                <Crosshair className="w-4 h-4" /> Triple-Analyse
              </h3>
              <div className="grid grid-cols-3 gap-3 mb-4">
                <div className="bg-muted/30 rounded-lg p-3">
                  <p className="text-2xl font-display text-destructive">{trebleStats.treblelessRate.toFixed(1)}%</p>
                  <p className="text-[10px] text-muted-foreground">Trebleless Visits</p>
                </div>
                <div className="bg-muted/30 rounded-lg p-3">
                  <p className="text-2xl font-display">{trebleStats.trebleless}</p>
                  <p className="text-[10px] text-muted-foreground">von {trebleStats.visits} Visits</p>
                </div>
                <div className="bg-muted/30 rounded-lg p-3">
                  <p className="text-2xl font-display text-secondary">{trebleStats.triples}</p>
                  <p className="text-[10px] text-muted-foreground">Triples gesamt</p>
                </div>
              </div>
              <ResponsiveContainer width="100%" height={140}>
                <BarChart data={trebleStats.bigTriples}>
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: "hsl(222 12% 50%)" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 9, fill: "hsl(222 12% 50%)" }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} />
                  <Bar dataKey="value" fill="hsl(155 65% 42%)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
              {trebleStats.perPlayer.length > 1 && (
                <div className="mt-3 space-y-1">
                  {trebleStats.perPlayer.slice(0, 8).map((p) => (
                    <div key={p.name} className="flex items-center justify-between text-xs">
                      <span className="truncate">{p.name}</span>
                      <span className="text-muted-foreground font-mono">
                        {((p.trebleless / Math.max(1, p.visits)) * 100).toFixed(1)}% trebleless · {p.triples} Triples
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {modeDistribution.length > 0 && (
            <div className="bg-card rounded-xl border border-border p-4 mb-6">
              <h3 className="font-display text-sm uppercase mb-3 text-muted-foreground">Spielmodi</h3>
              <div className="flex items-center gap-6">
                <ResponsiveContainer width={120} height={120}>
                  <PieChart>
                    <Pie data={modeDistribution} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={50} strokeWidth={0}>
                      {modeDistribution.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                <div className="space-y-1">
                  {modeDistribution.map((m, i) => (
                    <div key={m.name} className="flex items-center gap-2 text-sm">
                      <div className="w-3 h-3 rounded-sm" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
                      <span className="font-mono">{m.name}</span>
                      <span className="text-muted-foreground">({m.value})</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Leaderboard */}
          <div className="bg-card rounded-xl border border-border p-4">
            <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
              <h3 className="font-display text-sm uppercase text-muted-foreground flex items-center gap-2">
                <Trophy className="w-4 h-4" /> Rangliste{filterYear !== "all" ? ` · Saison ${filterYear}` : filtersActive ? " · gefiltert" : ""}
              </h3>
              <div className="flex items-center gap-1.5">
                <Button size="sm" variant="outline" className="h-8 text-xs gap-1" onClick={exportLeaderboardCsv} disabled={leaderboard.length === 0} title="Als CSV exportieren">
                  <Download className="w-3.5 h-3.5" /> CSV
                </Button>
                <Select value={sortBy} onValueChange={(v) => setSortBy(v as typeof sortBy)}>
                  <SelectTrigger className="w-[140px] h-8 text-xs bg-muted border-border"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-card border-border">
                    <SelectItem value="points">Punkte (Saison)</SelectItem>
                    <SelectItem value="average">Ø Average</SelectItem>
                    <SelectItem value="games_won">Siege</SelectItem>
                    <SelectItem value="win_rate">Siegquote %</SelectItem>
                    <SelectItem value="high_score">Highscore</SelectItem>
                    <SelectItem value="double_rate">Doppel %</SelectItem>
                    <SelectItem value="checkout">Checkout %</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground mb-3">
              {sortBy === "points"
                ? "2 Punkte pro Sieg — als Saison-Tabelle nutzbar, wenn oben eine Saison ausgewählt ist."
                : filtersActive ? "Werte für den aktuell gefilterten Zeitraum/Modus." : "Lebenszeit-Werte über alle Spiele."}
            </p>
            {leaderboard.length === 0 ? (
              <div className="text-center py-4">
                <p className="text-sm text-muted-foreground mb-3">Noch keine Spieler.</p>
                <Button asChild size="sm"><Link to="/players">Mitglied hinzufügen</Link></Button>
              </div>
            ) : (
              <div className="space-y-1">
                {leaderboard.map((p, i) => {
                  const winRate = p.games_played > 0 ? Math.round((p.games_won / p.games_played) * 100) : 0;
                  const sortVal = sortBy === "average" ? Number(p.average).toFixed(1) :
                    sortBy === "games_won" ? p.games_won : sortBy === "high_score" ? p.high_score :
                    sortBy === "win_rate" ? `${winRate}%` :
                    sortBy === "checkout" ? `${(advancedByPlayer[p.id]?.checkout.percentage ?? 0).toFixed(0)}%` :
                    sortBy === "points" ? `${p.games_won * 2} Pkt` :
                    `${Number(p.double_rate).toFixed(0)}%`;
                  return (
                    <button key={p.id} onClick={() => { setSelectedPlayerId(p.id); setActiveTab("players"); }}
                      className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors hover:bg-muted/80 ${i < 3 ? "bg-muted/50" : ""}`}>
                      <span className={`w-6 text-center font-display text-sm ${i === 0 ? "text-accent" : i === 1 ? "text-muted-foreground" : i === 2 ? "text-orange-400" : "text-muted-foreground"}`}>
                        {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`}
                      </span>
                      <span className="text-lg">{p.emoji}</span>
                      <div className="flex-1 min-w-0 text-left">
                        <p className="text-sm font-semibold truncate">{p.name}</p>
                        <p className="text-[10px] text-muted-foreground">{p.games_played} Spiele · {winRate}%</p>
                      </div>
                      <span className="font-display text-lg text-primary">{sortVal}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}

      {/* PLAYERS TAB */}
      {activeTab === "players" && (
        <>
          <div className="mb-4">
            <Select value={selectedPlayerId} onValueChange={setSelectedPlayerId}>
              <SelectTrigger className="bg-card border-border"><SelectValue placeholder="Spieler wählen..." /></SelectTrigger>
              <SelectContent className="bg-card border-border">
                {players.map(p => <SelectItem key={p.id} value={p.id}>{p.emoji} {p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {playerDetailStats ? (
            <>
              {/* Player header */}
              <div className="bg-card rounded-xl border border-border p-4 mb-4">
                <div className="flex items-center gap-3 mb-3">
                  <span className="text-3xl">{playerDetailStats.player.emoji}</span>
                  <div>
                    <h3 className="text-xl font-display uppercase">{playerDetailStats.player.name}</h3>
                    <p className="text-xs text-muted-foreground">{playerDetailStats.totalGames} Spiele · {playerDetailStats.winRate}% Siegquote</p>
                  </div>
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {[
                    { label: "Ø Average", value: Number(playerDetailStats.player.average).toFixed(1), color: "text-primary" },
                    { label: "Highscore", value: playerDetailStats.player.high_score, color: "text-accent" },
                    { label: "Serie", value: `${playerDetailStats.currentStreak}🔥`, color: "text-destructive" },
                    { label: "Beste Serie", value: playerDetailStats.bestStreak, color: "text-secondary" },
                  ].map(s => (
                    <div key={s.label} className="text-center">
                      <p className={`text-lg font-display ${s.color}`}>{s.value}</p>
                      <p className="text-[10px] text-muted-foreground">{s.label}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Achievements */}
              {playerAchievements.length > 0 && (
                <div className="bg-card rounded-xl border border-border p-4 mb-4">
                  <h3 className="font-display text-sm uppercase mb-3 text-muted-foreground flex items-center gap-2">
                    <Award className="w-4 h-4" /> Erfolge
                    <span className="text-[10px] normal-case text-muted-foreground/70">
                      ({playerAchievements.filter((a) => a.unlocked).length}/{playerAchievements.length})
                    </span>
                  </h3>
                  <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                    {playerAchievements.map((a) => (
                      <div key={a.title} title={a.desc}
                        className={`rounded-lg border p-2 text-center transition-opacity ${a.unlocked ? "border-accent/40 bg-accent/10" : "border-border bg-muted/20 opacity-40"}`}>
                        <p className="text-xl">{a.icon}</p>
                        <p className="text-[9px] mt-0.5 leading-tight">{a.title}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Best/worst game */}
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div className="bg-card rounded-xl border border-border p-3 text-center">
                  <p className="text-xs text-muted-foreground mb-1">Bester Game-Ø</p>
                  <p className="text-2xl font-display text-secondary">{playerDetailStats.bestGameAvg.toFixed(1)}</p>
                </div>
                <div className="bg-card rounded-xl border border-border p-3 text-center">
                  <p className="text-xs text-muted-foreground mb-1">Schlechtester Game-Ø</p>
                  <p className="text-2xl font-display text-destructive">{playerDetailStats.worstGameAvg.toFixed(1)}</p>
                </div>
              </div>

              {/* Checkout & first-9 (from dart-by-dart data — only available for games played since this was added) */}
              {advancedByPlayer[playerDetailStats.player.id] && (
                <div className="bg-card rounded-xl border border-border p-4 mb-4">
                  <h3 className="font-display text-sm uppercase mb-3 text-muted-foreground flex items-center gap-2">
                    <Crosshair className="w-4 h-4" /> Checkout &amp; Eröffnung
                  </h3>
                  <div className="grid grid-cols-4 gap-2">
                    {[
                      { label: "First 9 Ø", value: advancedByPlayer[playerDetailStats.player.id].first9.toFixed(1), color: "text-primary" },
                      { label: "Checkout %", value: `${advancedByPlayer[playerDetailStats.player.id].checkout.percentage.toFixed(0)}%`, color: "text-secondary" },
                      { label: "Höchstes Finish", value: advancedByPlayer[playerDetailStats.player.id].checkout.highestCheckout, color: "text-accent" },
                      { label: "Checkout-Versuche", value: advancedByPlayer[playerDetailStats.player.id].checkout.attempts, color: "text-muted-foreground" },
                    ].map(s => (
                      <div key={s.label} className="text-center">
                        <p className={`text-lg font-display ${s.color}`}>{s.value}</p>
                        <p className="text-[10px] text-muted-foreground">{s.label}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Cricket-specific stats (from dart-by-dart data on Cricket legs) */}
              {cricketByPlayer[playerDetailStats.player.id] && (
                <div className="bg-card rounded-xl border border-border p-4 mb-4">
                  <h3 className="font-display text-sm uppercase mb-3 text-muted-foreground flex items-center gap-2">
                    <Target className="w-4 h-4" /> Cricket
                  </h3>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { label: "MPR", value: cricketByPlayer[playerDetailStats.player.id].cricket.mpr.toFixed(2), color: "text-primary" },
                      { label: "Trefferquote", value: `${cricketByPlayer[playerDetailStats.player.id].cricket.hitRate.toFixed(0)}%`, color: "text-secondary" },
                      { label: "Marks gesamt", value: cricketByPlayer[playerDetailStats.player.id].cricket.marks, color: "text-accent" },
                    ].map(s => (
                      <div key={s.label} className="text-center">
                        <p className={`text-lg font-display ${s.color}`}>{s.value}</p>
                        <p className="text-[10px] text-muted-foreground">{s.label}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Throw heatmap — only camera-scored throws carry a tip position */}
              {playerHeatmapPoints.length > 0 && (
                <div className="bg-card rounded-xl border border-border p-4 mb-4">
                  <h3 className="font-display text-sm uppercase mb-1 text-muted-foreground flex items-center gap-2">
                    <Crosshair className="w-4 h-4" /> Wurf-Heatmap
                  </h3>
                  <p className="text-[10px] text-muted-foreground mb-3">
                    {playerHeatmapPoints.length} per Kamera erfasste Würfe · zeigt, wo die Darts wirklich landen
                  </p>
                  <DartboardHeatmap points={playerHeatmapPoints} />
                </div>
              )}

              {/* Average trend */}
              {playerDetailStats.averageTrend.length > 0 && (
                <div className="bg-card rounded-xl border border-border p-4 mb-4">
                  <h3 className="font-display text-sm uppercase mb-3 text-muted-foreground flex items-center gap-2">
                    <TrendingUp className="w-4 h-4" /> Average-Verlauf
                  </h3>
                  <ResponsiveContainer width="100%" height={160}>
                    <AreaChart data={playerDetailStats.averageTrend}>
                      <defs>
                        <linearGradient id="avgGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="hsl(185 85% 48%)" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="hsl(185 85% 48%)" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <XAxis dataKey="date" tick={{ fontSize: 9, fill: "hsl(222 12% 50%)" }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 9, fill: "hsl(222 12% 50%)" }} axisLine={false} tickLine={false} domain={["auto", "auto"]} />
                      <Tooltip contentStyle={TOOLTIP_STYLE} />
                      <Area type="monotone" dataKey="average" stroke="hsl(185 85% 48%)" fill="url(#avgGrad)" strokeWidth={2} name="Game Ø" />
                      <Line type="monotone" dataKey="runningAvg" stroke="hsl(155 65% 42%)" strokeWidth={2} strokeDasharray="5 3" dot={false} name="Laufender Ø" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* Recent form */}
              {playerDetailStats.recentForm.length > 0 && (
                <div className="bg-card rounded-xl border border-border p-4 mb-4">
                  <h3 className="font-display text-sm uppercase mb-3 text-muted-foreground">Letzte 10 Spiele</h3>
                  <div className="flex gap-1 mb-3">
                    {playerDetailStats.recentForm.map((f, i) => (
                      <div key={i} className={`w-7 h-7 rounded-md flex items-center justify-center text-xs font-bold ${f.won ? "bg-secondary/20 text-secondary" : "bg-destructive/20 text-destructive"}`}>
                        {f.won ? "W" : "L"}
                      </div>
                    ))}
                  </div>
                  <div className="space-y-1">
                    {playerDetailStats.recentForm.map((f, i) => (
                      <div key={i} className="flex items-center justify-between text-xs px-2 py-1 rounded bg-muted/30">
                        <span className={`font-bold ${f.won ? "text-secondary" : "text-destructive"}`}>{f.won ? "Sieg" : "Ndl."}</span>
                        <span className="text-muted-foreground">vs {f.opponent}</span>
                        <span className="font-display">Ø {f.avg.toFixed(1)}</span>
                        <span className="text-muted-foreground">{f.date}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Nemesis / favorite opponent */}
              {(playerDetailStats.nemesis || playerDetailStats.favoriteOpponent) && (
                <div className="grid grid-cols-2 gap-3 mb-4">
                  <div className="bg-card rounded-xl border border-destructive/30 p-3 text-center">
                    <p className="text-xs text-muted-foreground mb-1">😈 Nemesis</p>
                    {playerDetailStats.nemesis ? (
                      <>
                        <p className="text-lg font-display text-destructive truncate">{playerDetailStats.nemesis.name}</p>
                        <p className="text-[10px] text-muted-foreground">{playerDetailStats.nemesis.wins}W-{playerDetailStats.nemesis.losses}L gegen sie</p>
                      </>
                    ) : <p className="text-xs text-muted-foreground">Noch keine Daten</p>}
                  </div>
                  <div className="bg-card rounded-xl border border-secondary/30 p-3 text-center">
                    <p className="text-xs text-muted-foreground mb-1">🎯 Lieblingsgegner</p>
                    {playerDetailStats.favoriteOpponent ? (
                      <>
                        <p className="text-lg font-display text-secondary truncate">{playerDetailStats.favoriteOpponent.name}</p>
                        <p className="text-[10px] text-muted-foreground">{playerDetailStats.favoriteOpponent.wins}W-{playerDetailStats.favoriteOpponent.losses}L gegen sie</p>
                      </>
                    ) : <p className="text-xs text-muted-foreground">Noch keine Daten</p>}
                  </div>
                </div>
              )}

              {/* Opponents breakdown */}
              {Object.keys(playerDetailStats.opponents).length > 0 && (
                <div className="bg-card rounded-xl border border-border p-4">
                  <h3 className="font-display text-sm uppercase mb-3 text-muted-foreground">Gegner-Bilanz</h3>
                  <div className="space-y-1">
                    {Object.entries(playerDetailStats.opponents)
                      .sort(([, a], [, b]) => (b.wins + b.losses) - (a.wins + a.losses))
                      .map(([name, record]) => (
                        <div key={name} className="flex items-center justify-between px-2 py-1.5 rounded bg-muted/30">
                          <span className="text-sm">{name}</span>
                          <div className="flex items-center gap-2 text-xs">
                            <span className="text-secondary font-bold">{record.wins}W</span>
                            <span className="text-muted-foreground">-</span>
                            <span className="text-destructive font-bold">{record.losses}L</span>
                            <span className="text-muted-foreground">
                              ({Math.round((record.wins / (record.wins + record.losses)) * 100)}%)
                            </span>
                          </div>
                        </div>
                      ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="text-center py-12 text-muted-foreground">
              <Users className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className="text-sm">Wähle einen Spieler aus.</p>
            </div>
          )}
        </>
      )}

      {/* H2H TAB */}
      {activeTab === "h2h" && (
        <>
          {players.length >= 2 ? (
            <div className="bg-card rounded-xl border border-border p-4">
              <div className="grid grid-cols-2 gap-3 mb-4">
                <Select value={compareP1} onValueChange={setCompareP1}>
                  <SelectTrigger className="bg-muted border-border text-sm"><SelectValue placeholder="Spieler 1" /></SelectTrigger>
                  <SelectContent className="bg-card border-border">
                    {players.map(p => <SelectItem key={p.id} value={p.id}>{p.emoji} {p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={compareP2} onValueChange={setCompareP2}>
                  <SelectTrigger className="bg-muted border-border text-sm"><SelectValue placeholder="Spieler 2" /></SelectTrigger>
                  <SelectContent className="bg-card border-border">
                    {players.map(p => <SelectItem key={p.id} value={p.id}>{p.emoji} {p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {h2hRecords && (
                <>
                  {h2hRecords.h2hGames > 0 && (
                    <div className="bg-muted/30 rounded-lg p-4 mb-4 text-center">
                      <p className="text-xs text-muted-foreground mb-2">{h2hRecords.h2hGames} direkte Duelle</p>
                      <div className="flex items-center justify-center gap-6">
                        <div>
                          <p className="text-3xl font-display text-primary">{h2hRecords.p1Wins}</p>
                          <p className="text-xs text-muted-foreground">{h2hRecords.p1.emoji} {h2hRecords.p1.name}</p>
                        </div>
                        <span className="text-2xl text-muted-foreground font-display">:</span>
                        <div>
                          <p className="text-3xl font-display text-secondary">{h2hRecords.p2Wins}</p>
                          <p className="text-xs text-muted-foreground">{h2hRecords.p2.emoji} {h2hRecords.p2.name}</p>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-3 gap-2 text-center text-xs mb-4">
                    <div className="font-semibold text-primary">{h2hRecords.p1.emoji} {h2hRecords.p1.name}</div>
                    <div className="text-muted-foreground">vs</div>
                    <div className="font-semibold text-secondary">{h2hRecords.p2.emoji} {h2hRecords.p2.name}</div>
                    {[
                      { label: "Ø Gesamt", v1: Number(h2hRecords.p1.average).toFixed(1), v2: Number(h2hRecords.p2.average).toFixed(1) },
                      { label: "Ø im Duell", v1: h2hRecords.p1AvgH2H, v2: h2hRecords.p2AvgH2H },
                      { label: "Highscore", v1: h2hRecords.p1.high_score, v2: h2hRecords.p2.high_score },
                      { label: "Beste Game-Ø", v1: h2hRecords.p1HighestAvg, v2: h2hRecords.p2HighestAvg },
                      { label: "Siege", v1: h2hRecords.p1.games_won, v2: h2hRecords.p2.games_won },
                      { label: "Doppel %", v1: `${Number(h2hRecords.p1.double_rate).toFixed(0)}%`, v2: `${Number(h2hRecords.p2.double_rate).toFixed(0)}%` },
                    ].map(row => (
                      <React.Fragment key={row.label}>
                        <div className="font-display text-sm">{row.v1}</div>
                        <div className="text-muted-foreground text-[10px]">{row.label}</div>
                        <div className="font-display text-sm">{row.v2}</div>
                      </React.Fragment>
                    ))}
                  </div>
                  <ResponsiveContainer width="100%" height={200}>
                    <RadarChart data={h2hRecords.radar}>
                      <PolarGrid stroke="hsl(222 18% 14%)" />
                      <PolarAngleAxis dataKey="skill" tick={{ fontSize: 10, fill: "hsl(222 12% 50%)" }} />
                      <PolarRadiusAxis tick={false} axisLine={false} domain={[0, 100]} />
                      <Radar dataKey="p1" stroke="hsl(185 85% 48%)" fill="hsl(185 85% 48%)" fillOpacity={0.15} strokeWidth={2} />
                      <Radar dataKey="p2" stroke="hsl(155 65% 42%)" fill="hsl(155 65% 42%)" fillOpacity={0.15} strokeWidth={2} />
                    </RadarChart>
                  </ResponsiveContainer>
                </>
              )}
              {!h2hRecords && compareP1 && compareP2 && (
                <p className="text-sm text-muted-foreground text-center py-4">Keine gemeinsamen Spiele gefunden.</p>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-12">Mindestens 2 Spieler nötig für H2H-Vergleich.</p>
          )}
        </>
      )}

      {/* HISTORY TAB */}
      {activeTab === "history" && (
        <div className="bg-card rounded-xl border border-border p-4">
          <h3 className="font-display text-sm uppercase mb-3 text-muted-foreground flex items-center gap-2">
            <Target className="w-4 h-4" /> Spielverlauf
          </h3>
          {recentGames.length === 0 ? (
            <div className="text-center py-4">
              <p className="text-sm text-muted-foreground mb-3">Noch keine Spiele.</p>
              <Button asChild size="sm"><Link to="/game">Spiel starten</Link></Button>
            </div>
          ) : (
            <div className="space-y-2">
              {recentGames.map(g => {
                const legs = legsByGame[g.id];
                const isExpanded = expandedGameId === g.id;
                return (
                  <div key={g.id} className="rounded-lg bg-muted/30 overflow-hidden">
                    <button
                      onClick={() => setExpandedGameId(isExpanded ? null : g.id)}
                      className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <span className="text-xs bg-muted px-2 py-0.5 rounded-md font-mono shrink-0">{g.mode}</span>
                        <div className="min-w-0">
                          <span className="text-sm block truncate">
                            {g.player1_name} <span className="text-muted-foreground">vs</span> {g.player2_name}
                          </span>
                          <div className="text-[10px] text-muted-foreground">
                            Ø {Number(g.player1_average).toFixed(1)} - {Number(g.player2_average).toFixed(1)} · {g.player1_legs_won}:{g.player2_legs_won} Legs
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0 ml-2">
                        <div className="flex flex-col items-end gap-0.5">
                          <span className="text-xs text-muted-foreground">
                            {new Date(g.played_at).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" })}
                          </span>
                          <span className="text-xs text-secondary font-medium">{g.winner_name} ✓</span>
                        </div>
                        {legs && legs.length > 0 && (
                          isExpanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />
                        )}
                      </div>
                    </button>

                    {isExpanded && (
                      legs && legs.length > 0 ? (
                        <div className="px-3 pb-3 space-y-1.5 border-t border-border/60 pt-2">
                          {legs.map((leg) => (
                            <div key={leg.legNumber} className="rounded-md bg-background/60 px-2.5 py-2">
                              <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Leg {leg.legNumber}</p>
                              <div className="space-y-1">
                                {leg.players.map((p) => (
                                  <div key={p.name} className="flex items-center justify-between text-xs">
                                    <span className={`truncate ${p.won ? "text-secondary font-semibold" : "text-foreground"}`}>
                                      {p.won && "🏆 "}{p.name}
                                    </span>
                                    <span className="text-muted-foreground font-mono shrink-0 ml-2">
                                      {leg.mode === "cricket"
                                        ? `MPR ${p.mpr.toFixed(2)} · ${p.hitRate.toFixed(0)}% Trefferquote`
                                        : `Ø ${p.average.toFixed(1)}${p.first9 > 0 ? ` · F9 ${p.first9.toFixed(1)}` : ""}`}
                                      {" · "}{p.dartsThrown} Darts
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="px-3 pb-3 pt-1 text-[11px] text-muted-foreground border-t border-border/60">
                          Keine Leg-Details verfügbar — dieses Spiel wurde vor der Detail-Aufzeichnung gespielt.
                        </p>
                      )
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* HIGHLIGHTS TAB */}
      {activeTab === "highlights" && (
        <div className="bg-card rounded-xl border border-border p-4">
          <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
            <h3 className="font-display text-sm uppercase text-muted-foreground flex items-center gap-2">
              <Video className="w-4 h-4" /> Highlight-Clips
            </h3>
            {highlightClips.length > 0 && (
              <div className="flex items-center gap-1.5">
                <Select value={cleanupDays} onValueChange={setCleanupDays}>
                  <SelectTrigger className="h-7 w-[110px] text-[11px] bg-background border-border"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-card border-border">
                    <SelectItem value="30">älter als 30 Tage</SelectItem>
                    <SelectItem value="90">älter als 90 Tage</SelectItem>
                    <SelectItem value="365">älter als 1 Jahr</SelectItem>
                  </SelectContent>
                </Select>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button size="sm" variant="outline" className="h-7 text-[11px] gap-1" disabled={oldClips.length === 0}>
                      <Trash2 className="w-3 h-3" /> Aufräumen ({oldClips.length})
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>{oldClips.length} Clips löschen?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Alle Highlight-Clips, die älter als {cleanupDays === "365" ? "1 Jahr" : `${cleanupDays} Tage`} sind, werden unwiderruflich gelöscht — Video-Dateien und Datenbankeinträge.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                      <AlertDialogAction onClick={deleteOldClips} disabled={cleaningUpClips}>
                        {cleaningUpClips ? "Löscht…" : "Löschen"}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            )}
          </div>
          {filteredClips.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              Noch keine Highlight-Clips. 180er, Checkouts und Ton-Plus-Aufnahmen aus der Kamera-Erkennung landen hier automatisch.
            </p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {filteredClips.map((clip) => (
                <div key={clip.id} className="rounded-xl border border-border bg-muted/20 overflow-hidden">
                  <video src={clipUrl(clip.storage_path)} controls playsInline className="w-full aspect-video bg-black" preload="metadata" />
                  <div className="p-2.5">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-display uppercase truncate">{clip.player_name}</span>
                      <span className="text-[10px] rounded-full bg-accent/15 text-accent px-2 py-0.5 shrink-0 ml-1">{clipKindLabel(clip.kind)}</span>
                    </div>
                    {clipGameLabel(clip) && (
                      <p className="text-[10px] text-primary/80 truncate mb-1">{clipGameLabel(clip)}</p>
                    )}
                    <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                      <span>{clip.points} Punkte · {new Date(clip.created_at).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit" })}</span>
                      <button onClick={() => deleteClip(clip)} disabled={deletingClipId === clip.id}
                        className="p-2 -m-2 text-muted-foreground hover:text-destructive transition-colors disabled:opacity-40"
                        title="Clip löschen" aria-label="Clip löschen">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default StatisticsPage;
