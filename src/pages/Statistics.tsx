import React, { useState, useEffect, useCallback, useMemo } from "react";
import { BarChart3, Trophy, Target, TrendingUp, Users, ArrowUpDown, Flame, Calendar, Crosshair, Zap, Hash } from "lucide-react";
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
  id: string;
  mode: string;
  player1_name: string;
  player2_name: string;
  player1_average: number;
  player2_average: number;
  player1_highscore: number;
  player2_highscore: number;
  player1_legs_won: number;
  player2_legs_won: number;
  player1_double_rate: number;
  player2_double_rate: number;
  player1_total_throws: number;
  player2_total_throws: number;
  winner_name: string;
  played_at: string;
  player1_id: string | null;
  player2_id: string | null;
  start_score: number;
}

interface PlayerStats {
  id: string;
  name: string;
  games_played: number;
  games_won: number;
  average: number;
  high_score: number;
  double_rate: number;
  emoji: string;
}

const CHART_COLORS = [
  "hsl(185 85% 48%)", "hsl(155 65% 42%)", "hsl(45 100% 58%)",
  "hsl(280 70% 55%)", "hsl(0 72% 51%)", "hsl(200 80% 55%)",
];

const StatisticsPage = () => {
  const [games, setGames] = useState<GameRecord[]>([]);
  const [players, setPlayers] = useState<PlayerStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState<"average" | "games_won" | "high_score" | "double_rate" | "win_rate">("average");
  const [compareP1, setCompareP1] = useState<string>("");
  const [compareP2, setCompareP2] = useState<string>("");
  const [selectedPlayerId, setSelectedPlayerId] = useState<string>("");
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

  // Club-wide stats
  const clubStats = useMemo(() => {
    const totalGames = games.length;
    const totalPlayers = players.length;
    const avgOfAverages = players.length > 0
      ? players.reduce((s, p) => s + Number(p.average), 0) / players.length : 0;
    const bestAvg = players.reduce((best, p) => Number(p.average) > best.val ? { name: p.name, val: Number(p.average) } : best, { name: "-", val: 0 });
    const bestHighscore = players.reduce((best, p) => p.high_score > best.val ? { name: p.name, val: p.high_score } : best, { name: "-", val: 0 });
    const mostGames = players.reduce((best, p) => p.games_played > best.val ? { name: p.name, val: p.games_played } : best, { name: "-", val: 0 });
    const totalDarts = games.reduce((s, g) => s + g.player1_total_throws + g.player2_total_throws, 0);
    const highestGameAvg = games.reduce((best, g) => {
      const max = Math.max(g.player1_average, g.player2_average);
      if (max > best.val) {
        const name = g.player1_average > g.player2_average ? g.player1_name : g.player2_name;
        return { name, val: max };
      }
      return best;
    }, { name: "-", val: 0 });

    return { totalGames, totalPlayers, avgOfAverages, bestAvg, bestHighscore, mostGames, totalDarts, highestGameAvg };
  }, [games, players]);

  // Leaderboard sorted
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

  // Mode distribution
  const modeDistribution = useMemo(() => {
    const counts: Record<string, number> = {};
    games.forEach(g => { counts[g.mode] = (counts[g.mode] || 0) + 1; });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [games]);

  // Games per day (last 30 days)
  const gamesTimeline = useMemo(() => {
    const days: Record<string, number> = {};
    const now = new Date();
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      days[d.toISOString().slice(0, 10)] = 0;
    }
    games.forEach(g => {
      const day = g.played_at.slice(0, 10);
      if (days[day] !== undefined) days[day]++;
    });
    return Object.entries(days).map(([date, count]) => ({ date: date.slice(5), count }));
  }, [games]);

  // Per-player average trend over time
  const playerAverageTrend = useMemo(() => {
    if (!selectedPlayerId) return [];
    const playerGames = games.filter(
      g => g.player1_id === selectedPlayerId || g.player2_id === selectedPlayerId
    ).reverse(); // oldest first

    let runningAvg = 0;
    return playerGames.map((g, i) => {
      const avg = g.player1_id === selectedPlayerId ? g.player1_average : g.player2_average;
      runningAvg = (runningAvg * i + Number(avg)) / (i + 1);
      return {
        game: i + 1,
        date: new Date(g.played_at).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" }),
        average: Number(avg).toFixed(1),
        runningAvg: runningAvg.toFixed(1),
      };
    });
  }, [selectedPlayerId, games]);

  // H2H records
  const h2hRecords = useMemo(() => {
    if (!compareP1 || !compareP2) return null;
    const p1 = players.find(p => p.id === compareP1);
    const p2 = players.find(p => p.id === compareP2);
    if (!p1 || !p2) return null;

    const h2hGames = games.filter(g =>
      (g.player1_id === compareP1 && g.player2_id === compareP2) ||
      (g.player1_id === compareP2 && g.player2_id === compareP1)
    );

    let p1Wins = 0, p2Wins = 0;
    let p1AvgSum = 0, p2AvgSum = 0;
    let p1HighestAvg = 0, p2HighestAvg = 0;

    h2hGames.forEach(g => {
      const isP1First = g.player1_id === compareP1;
      const myAvg = isP1First ? g.player1_average : g.player2_average;
      const oppAvg = isP1First ? g.player2_average : g.player1_average;

      p1AvgSum += Number(myAvg);
      p2AvgSum += Number(oppAvg);
      p1HighestAvg = Math.max(p1HighestAvg, Number(myAvg));
      p2HighestAvg = Math.max(p2HighestAvg, Number(oppAvg));

      if (g.winner_name === p1.name) p1Wins++;
      else if (g.winner_name === p2.name) p2Wins++;
    });

    const winRate = (p: PlayerStats) => p.games_played > 0 ? Math.round((p.games_won / p.games_played) * 100) : 0;

    return {
      p1, p2,
      h2hGames: h2hGames.length,
      p1Wins, p2Wins,
      p1AvgH2H: h2hGames.length > 0 ? (p1AvgSum / h2hGames.length).toFixed(1) : "0",
      p2AvgH2H: h2hGames.length > 0 ? (p2AvgSum / h2hGames.length).toFixed(1) : "0",
      p1HighestAvg: p1HighestAvg.toFixed(1),
      p2HighestAvg: p2HighestAvg.toFixed(1),
      radar: [
        { skill: "Average", p1: Math.min(Number(p1.average), 100), p2: Math.min(Number(p2.average), 100) },
        { skill: "Highscore", p1: (p1.high_score / 180) * 100, p2: (p2.high_score / 180) * 100 },
        { skill: "Siegquote", p1: winRate(p1), p2: winRate(p2) },
        { skill: "Erfahrung", p1: Math.min(p1.games_played * 5, 100), p2: Math.min(p2.games_played * 5, 100) },
        { skill: "Doppel %", p1: Number(p1.double_rate), p2: Number(p2.double_rate) },
      ],
    };
  }, [compareP1, compareP2, players, games]);

  // Recent games
  const recentGames = games.slice(0, 15);

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="container py-6 animate-slide-up">
      <div className="flex items-center gap-3 mb-6">
        <BarChart3 className="w-6 h-6 text-primary" />
        <h2 className="text-2xl font-display uppercase">Statistiken</h2>
      </div>

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

      {/* Records row */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <div className="bg-card rounded-xl p-4 border border-border">
          <Trophy className="w-4 h-4 text-accent mb-1" />
          <p className="text-xl font-display">{clubStats.bestHighscore.val}</p>
          <p className="text-xs text-muted-foreground">Höchster Score</p>
          <p className="text-[10px] text-primary">{clubStats.bestHighscore.name}</p>
        </div>
        <div className="bg-card rounded-xl p-4 border border-border">
          <Flame className="w-4 h-4 text-destructive mb-1" />
          <p className="text-xl font-display">{clubStats.bestAvg.val.toFixed(1)}</p>
          <p className="text-xs text-muted-foreground">Bester Ø</p>
          <p className="text-[10px] text-primary">{clubStats.bestAvg.name}</p>
        </div>
        <div className="bg-card rounded-xl p-4 border border-border">
          <Zap className="w-4 h-4 text-secondary mb-1" />
          <p className="text-xl font-display">{clubStats.highestGameAvg.val.toFixed(1)}</p>
          <p className="text-xs text-muted-foreground">Bester Game-Ø</p>
          <p className="text-[10px] text-primary">{clubStats.highestGameAvg.name}</p>
        </div>
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
              <Tooltip contentStyle={{ background: "hsl(222 25% 9%)", border: "1px solid hsl(222 18% 14%)", borderRadius: 8, fontSize: 12 }} />
              <Bar dataKey="count" fill="hsl(185 85% 48%)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Player Average Trend */}
      {players.length > 0 && (
        <div className="bg-card rounded-xl border border-border p-4 mb-6">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-display text-sm uppercase text-muted-foreground flex items-center gap-2">
              <TrendingUp className="w-4 h-4" /> Average-Verlauf
            </h3>
            <Select value={selectedPlayerId} onValueChange={setSelectedPlayerId}>
              <SelectTrigger className="w-[160px] h-8 text-xs bg-muted border-border">
                <SelectValue placeholder="Spieler wählen" />
              </SelectTrigger>
              <SelectContent className="bg-card border-border">
                {players.map(p => (
                  <SelectItem key={p.id} value={p.id}>{p.emoji} {p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {playerAverageTrend.length > 0 ? (
            <ResponsiveContainer width="100%" height={160}>
              <AreaChart data={playerAverageTrend}>
                <defs>
                  <linearGradient id="avgGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(185 85% 48%)" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="hsl(185 85% 48%)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="date" tick={{ fontSize: 9, fill: "hsl(222 12% 50%)" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 9, fill: "hsl(222 12% 50%)" }} axisLine={false} tickLine={false} domain={["auto", "auto"]} />
                <Tooltip contentStyle={{ background: "hsl(222 25% 9%)", border: "1px solid hsl(222 18% 14%)", borderRadius: 8, fontSize: 12 }} />
                <Area type="monotone" dataKey="average" stroke="hsl(185 85% 48%)" fill="url(#avgGradient)" strokeWidth={2} name="Game Ø" />
                <Line type="monotone" dataKey="runningAvg" stroke="hsl(155 65% 42%)" strokeWidth={2} strokeDasharray="5 3" dot={false} name="Laufender Ø" />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-6">
              {selectedPlayerId ? "Keine Spiele für diesen Spieler." : "Wähle einen Spieler aus."}
            </p>
          )}
        </div>
      )}

      {/* Mode distribution */}
      {modeDistribution.length > 0 && (
        <div className="bg-card rounded-xl border border-border p-4 mb-6">
          <h3 className="font-display text-sm uppercase mb-3 text-muted-foreground">Spielmodi-Verteilung</h3>
          <div className="flex items-center gap-6">
            <ResponsiveContainer width={120} height={120}>
              <PieChart>
                <Pie data={modeDistribution} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={50} strokeWidth={0}>
                  {modeDistribution.map((_, i) => (
                    <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                  ))}
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
      <div className="bg-card rounded-xl border border-border p-4 mb-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-display text-sm uppercase text-muted-foreground flex items-center gap-2">
            <Trophy className="w-4 h-4" /> Rangliste
          </h3>
          <Select value={sortBy} onValueChange={(v) => setSortBy(v as typeof sortBy)}>
            <SelectTrigger className="w-[140px] h-8 text-xs bg-muted border-border">
              <SelectValue />
            </SelectTrigger>
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
          <p className="text-sm text-muted-foreground text-center py-4">Noch keine Spieler vorhanden.</p>
        ) : (
          <div className="space-y-1">
            {leaderboard.map((p, i) => {
              const winRate = p.games_played > 0 ? Math.round((p.games_won / p.games_played) * 100) : 0;
              const sortVal = sortBy === "average" ? Number(p.average).toFixed(1) :
                sortBy === "games_won" ? p.games_won :
                sortBy === "high_score" ? p.high_score :
                sortBy === "win_rate" ? `${winRate}%` :
                `${Number(p.double_rate).toFixed(0)}%`;
              return (
                <div key={p.id} className={`flex items-center gap-3 px-3 py-2 rounded-lg ${i < 3 ? "bg-muted/50" : ""}`}>
                  <span className={`w-6 text-center font-display text-sm ${
                    i === 0 ? "text-accent" : i === 1 ? "text-muted-foreground" : i === 2 ? "text-orange-400" : "text-muted-foreground"
                  }`}>
                    {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`}
                  </span>
                  <span className="text-lg">{p.emoji}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate">{p.name}</p>
                    <p className="text-[10px] text-muted-foreground">{p.games_played} Spiele · {winRate}% Siege</p>
                  </div>
                  <span className="font-display text-lg text-primary">{sortVal}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* H2H Player comparison */}
      {players.length >= 2 && (
        <div className="bg-card rounded-xl border border-border p-4 mb-6">
          <h3 className="font-display text-sm uppercase mb-3 text-muted-foreground flex items-center gap-2">
            <Crosshair className="w-4 h-4" /> Head-to-Head
          </h3>
          <div className="grid grid-cols-2 gap-3 mb-4">
            <Select value={compareP1} onValueChange={setCompareP1}>
              <SelectTrigger className="bg-muted border-border text-sm">
                <SelectValue placeholder="Spieler 1" />
              </SelectTrigger>
              <SelectContent className="bg-card border-border">
                {players.map(p => (
                  <SelectItem key={p.id} value={p.id}>{p.emoji} {p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={compareP2} onValueChange={setCompareP2}>
              <SelectTrigger className="bg-muted border-border text-sm">
                <SelectValue placeholder="Spieler 2" />
              </SelectTrigger>
              <SelectContent className="bg-card border-border">
                {players.map(p => (
                  <SelectItem key={p.id} value={p.id}>{p.emoji} {p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {h2hRecords && (
            <div>
              {/* H2H record */}
              {h2hRecords.h2hGames > 0 && (
                <div className="bg-muted/30 rounded-lg p-3 mb-4 text-center">
                  <p className="text-xs text-muted-foreground mb-1">{h2hRecords.h2hGames} direkte Duelle</p>
                  <div className="flex items-center justify-center gap-4">
                    <div>
                      <p className="text-2xl font-display text-primary">{h2hRecords.p1Wins}</p>
                      <p className="text-[10px] text-muted-foreground">{h2hRecords.p1.name}</p>
                    </div>
                    <span className="text-muted-foreground text-lg">:</span>
                    <div>
                      <p className="text-2xl font-display text-secondary">{h2hRecords.p2Wins}</p>
                      <p className="text-[10px] text-muted-foreground">{h2hRecords.p2.name}</p>
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
            </div>
          )}
        </div>
      )}

      {/* Recent games */}
      <div className="bg-card rounded-xl border border-border p-4">
        <h3 className="font-display text-sm uppercase mb-3 text-muted-foreground flex items-center gap-2">
          <Target className="w-4 h-4" /> Letzte Spiele
        </h3>
        {recentGames.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">Noch keine Spiele gespielt.</p>
        ) : (
          <div className="space-y-2">
            {recentGames.map(g => (
              <div key={g.id} className="flex items-center justify-between px-3 py-2 rounded-lg bg-muted/30">
                <div className="flex items-center gap-3">
                  <span className="text-xs bg-muted px-2 py-0.5 rounded-md font-mono">{g.mode}</span>
                  <div>
                    <span className="text-sm">
                      {g.player1_name} <span className="text-muted-foreground">vs</span> {g.player2_name}
                    </span>
                    <div className="text-[10px] text-muted-foreground">
                      Ø {Number(g.player1_average).toFixed(1)} - {Number(g.player2_average).toFixed(1)} · {g.player1_legs_won}:{g.player2_legs_won} Legs
                    </div>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-0.5">
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
    </div>
  );
};

export default StatisticsPage;
