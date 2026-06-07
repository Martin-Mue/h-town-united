import React, { useState, useEffect, useCallback, useMemo } from "react";
import { BarChart3, Trophy, Target, TrendingUp, Users, Flame, Calendar, Crosshair, Zap, Hash, Award, Percent, Filter, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  LineChart, Line, PieChart, Pie, Cell, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  AreaChart, Area,
} from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Loader2 } from "lucide-react";

interface GameRecord {
  id: string; mode: string; player1_name: string; player2_name: string;
  player1_average: number; player2_average: number; player1_highscore: number; player2_highscore: number;
  player1_legs_won: number; player2_legs_won: number; player1_double_rate: number; player2_double_rate: number;
  player1_total_throws: number; player2_total_throws: number; winner_name: string; played_at: string;
  player1_id: string | null; player2_id: string | null; start_score: number; best_of_legs: number;
}

interface PlayerStats {
  id: string; name: string; games_played: number; games_won: number;
  average: number; high_score: number; double_rate: number; emoji: string;
}

const CHART_COLORS = [
  "hsl(185 85% 48%)", "hsl(155 65% 42%)", "hsl(45 100% 58%)",
  "hsl(280 70% 55%)", "hsl(0 72% 51%)", "hsl(200 80% 55%)",
];

const TOOLTIP_STYLE = { background: "hsl(222 25% 9%)", border: "1px solid hsl(222 18% 14%)", borderRadius: 8, fontSize: 12 };

const StatisticsPage = () => {
  const [games, setGames] = useState<GameRecord[]>([]);
  const [players, setPlayers] = useState<PlayerStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState<"average" | "games_won" | "high_score" | "double_rate" | "win_rate">("average");
  const [compareP1, setCompareP1] = useState<string>("");
  const [compareP2, setCompareP2] = useState<string>("");
  const [selectedPlayerId, setSelectedPlayerId] = useState<string>("");
  const [activeTab, setActiveTab] = useState<"overview" | "players" | "h2h" | "history">("overview");
  const [filterTime, setFilterTime] = useState<"all" | "today" | "week" | "month" | "year">("all");
  const [filterMode, setFilterMode] = useState<string>("all");
  const [filterPlayerId, setFilterPlayerId] = useState<string>("all");
  const [filterBestOf, setFilterBestOf] = useState<string>("all");
  const { session } = useAuth();

  const fetchData = useCallback(async () => {
    const [gamesRes, playersRes] = await Promise.all([
      supabase.from("games").select("*").order("played_at", { ascending: false }).limit(500),
      supabase.from("players").select("id, name, games_played, games_won, average, high_score, double_rate, emoji").order("average", { ascending: false }),
    ]);
    if (gamesRes.data) setGames(gamesRes.data as GameRecord[]);
    if (playersRes.data) setPlayers(playersRes.data);
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
      if (filterMode !== "all" && g.mode !== filterMode) return false;
      if (filterPlayerId !== "all" && g.player1_id !== filterPlayerId && g.player2_id !== filterPlayerId) return false;
      if (filterBestOf !== "all" && Number(g.best_of_legs) !== Number(filterBestOf)) return false;
      return true;
    });
  }, [games, filterTime, filterMode, filterPlayerId, filterBestOf]);

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

  const filtersActive =
    filterTime !== "all" || filterMode !== "all" || filterPlayerId !== "all" || filterBestOf !== "all";

  const resetFilters = () => {
    setFilterTime("all"); setFilterMode("all"); setFilterPlayerId("all"); setFilterBestOf("all");
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
    return [...players].sort((a, b) => {
      if (sortBy === "average") return Number(b.average) - Number(a.average);
      if (sortBy === "games_won") return b.games_won - a.games_won;
      if (sortBy === "high_score") return b.high_score - a.high_score;
      if (sortBy === "win_rate") {
        const rateA = a.games_played > 0 ? a.games_won / a.games_played : 0;
        const rateB = b.games_played > 0 ? b.games_won / b.games_played : 0;
        return rateB - rateA;
      }
      return Number(b.double_rate) - Number(a.double_rate);
    });
  }, [players, sortBy]);

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

    return { player, winRate, averageTrend, currentStreak, bestStreak, recentForm, bestGameAvg, worstGameAvg, opponents, totalGames: playerGames.length };
  }, [selectedPlayerId, filteredGames, players]);

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

  if (loading) {
    return <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  }

  const tabs = [
    { key: "overview" as const, label: "Übersicht", icon: BarChart3 },
    { key: "players" as const, label: "Spieler", icon: Users },
    { key: "h2h" as const, label: "H2H", icon: Crosshair },
    { key: "history" as const, label: "Spiele", icon: Target },
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
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
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
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-display text-sm uppercase text-muted-foreground flex items-center gap-2"><Trophy className="w-4 h-4" /> Rangliste</h3>
              <Select value={sortBy} onValueChange={(v) => setSortBy(v as typeof sortBy)}>
                <SelectTrigger className="w-[140px] h-8 text-xs bg-muted border-border"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-card border-border">
                  <SelectItem value="average">Ø Average</SelectItem>
                  <SelectItem value="games_won">Siege</SelectItem>
                  <SelectItem value="win_rate">Siegquote %</SelectItem>
                  <SelectItem value="high_score">Highscore</SelectItem>
                  <SelectItem value="double_rate">Doppel %</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {leaderboard.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">Noch keine Spieler.</p>
            ) : (
              <div className="space-y-1">
                {leaderboard.map((p, i) => {
                  const winRate = p.games_played > 0 ? Math.round((p.games_won / p.games_played) * 100) : 0;
                  const sortVal = sortBy === "average" ? Number(p.average).toFixed(1) :
                    sortBy === "games_won" ? p.games_won : sortBy === "high_score" ? p.high_score :
                    sortBy === "win_rate" ? `${winRate}%` : `${Number(p.double_rate).toFixed(0)}%`;
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
            <p className="text-sm text-muted-foreground text-center py-4">Noch keine Spiele.</p>
          ) : (
            <div className="space-y-2">
              {recentGames.map(g => (
                <div key={g.id} className="flex items-center justify-between px-3 py-2 rounded-lg bg-muted/30">
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
                  <div className="flex flex-col items-end gap-0.5 shrink-0 ml-2">
                    <span className="text-xs text-muted-foreground">
                      {new Date(g.played_at).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" })}
                    </span>
                    <span className="text-xs text-secondary font-medium">{g.winner_name} ✓</span>
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
