import { useEffect, useMemo, useState, useCallback } from "react";
import { useParams } from "react-router-dom";
import { Trophy, Users, Radio, CalendarDays, CalendarPlus } from "lucide-react";
import { DartLoaderIcon as Loader2 } from "@/components/icons/DartIcons";
import { supabase } from "@/integrations/supabase/client";
import { useLanguage } from "@/contexts/LanguageContext";
import { LOCALE_BY_LANGUAGE } from "@/i18n/translations";
import { downloadIcsEvent } from "@/utils/calendarExport";
import { Button } from "@/components/ui/button";

interface PublicLeagueRow {
  id: string;
  name: string;
  format: string;
  result_mode: string;
  game_mode: string;
  best_of_legs: number;
  status: string;
  public_slug: string;
}

interface PublicFixtureRow {
  id: string;
  league_id: string;
  round_number: number;
  leg: string;
  player1_name: string | null;
  player2_name: string | null;
  status: string;
  player1_legs_won: number | null;
  player2_legs_won: number | null;
  winner_slot: number | null;
  scheduled_date: string | null;
}

/**
 * Read-only public counterpart to League.tsx's single-league detail view — standings + fixtures,
 * no login required. Deliberately far simpler than PublicTournament.tsx: leagues have no bracket,
 * boards, or live-camera concept, so this is just the same standings table + fixture list the
 * organizer sees, minus anything requiring auth (edit/enter-result controls, the Spieltag-date
 * editor). See the 20260909190000 migration's doc comment for why standings here are keyed by
 * PLAYER NAME rather than player id — league_fixtures_public deliberately doesn't expose the
 * player1_id/player2_id foreign keys (anon visitors couldn't resolve them to anything anyway,
 * since the `players` table itself stays authenticated-only), only the denormalized names.
 */
const PublicLeaguePage = () => {
  const { slug } = useParams<{ slug: string }>();
  const { t, language } = useLanguage();
  const [league, setLeague] = useState<PublicLeagueRow | null>(null);
  const [fixtures, setFixtures] = useState<PublicFixtureRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const load = useCallback(async () => {
    if (!slug) return;
    const { data: leagueData } = await supabase
      .from("leagues_public")
      .select("*")
      .eq("public_slug", slug)
      .maybeSingle();
    if (!leagueData) { setNotFound(true); setLoading(false); return; }
    setLeague(leagueData as unknown as PublicLeagueRow);
    const { data: fixtureData } = await supabase
      .from("league_fixtures_public")
      .select("*")
      .eq("league_id", leagueData.id)
      .order("round_number");
    setFixtures((fixtureData as unknown as PublicFixtureRow[]) ?? []);
    setLoading(false);
  }, [slug]);

  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    const run = async () => { if (!cancelled) await load(); };
    run();
    // Plain poll only, no realtime channel — unlike PublicTournament.tsx (which layers a
    // broadcast channel on top for instant mid-match score ticks), a league Spieltag changes
    // rarely enough that an 8s poll is plenty, and it avoids having to scope a postgres_changes
    // filter to this one league_id (only known after the first load resolves).
    const interval = window.setInterval(run, 8000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [slug, load]);

  const standings = useMemo(() => {
    const map = new Map<string, { name: string; played: number; won: number; lost: number; points: number; legsFor: number; legsAgainst: number }>();
    const ensure = (name: string | null) => {
      const key = name ?? "?";
      if (!map.has(key)) map.set(key, { name: key, played: 0, won: 0, lost: 0, points: 0, legsFor: 0, legsAgainst: 0 });
      return map.get(key)!;
    };
    fixtures.forEach((f) => { ensure(f.player1_name); ensure(f.player2_name); });
    fixtures.filter((f) => f.status === "finished").forEach((f) => {
      const s1 = ensure(f.player1_name);
      const s2 = ensure(f.player2_name);
      s1.played++; s2.played++;
      s1.legsFor += f.player1_legs_won ?? 0; s1.legsAgainst += f.player2_legs_won ?? 0;
      s2.legsFor += f.player2_legs_won ?? 0; s2.legsAgainst += f.player1_legs_won ?? 0;
      if (f.winner_slot === 1) { s1.won++; s1.points += 2; s2.lost++; }
      else if (f.winner_slot === 2) { s2.won++; s2.points += 2; s1.lost++; }
    });
    return Array.from(map.values()).sort((a, b) =>
      b.points - a.points || (b.legsFor - b.legsAgainst) - (a.legsFor - a.legsAgainst)
    );
  }, [fixtures]);

  const fixturesByRound = useMemo(() => {
    const rounds = new Map<number, PublicFixtureRow[]>();
    fixtures.forEach((f) => {
      if (!rounds.has(f.round_number)) rounds.set(f.round_number, []);
      rounds.get(f.round_number)!.push(f);
    });
    return Array.from(rounds.entries()).sort(([a], [b]) => a - b);
  }, [fixtures]);

  const legLabel = (leg: string) => leg === "first" ? t("league.firstLegLabel") : leg === "return" ? t("league.returnLegLabel") : null;

  if (loading) {
    return (
      <div role="status" aria-label={t("common.loading")} className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }
  if (notFound || !league) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center text-center p-6">
        <Radio className="w-10 h-10 text-muted-foreground mb-3" />
        <h1 className="font-display text-2xl uppercase mb-1">{t("league.publicNotFoundTitle")}</h1>
        <p className="text-sm text-muted-foreground">{t("league.publicNotFoundDesc")}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="container py-6 animate-slide-up max-w-3xl mx-auto">
        <div className="flex items-center gap-2 mb-1 text-xs text-secondary uppercase tracking-widest">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-secondary animate-pulse" /> {t("tournament.live")}
        </div>
        <h1 className="text-2xl font-display uppercase mb-1">{league.name}</h1>
        <p className="text-sm text-muted-foreground mb-6">
          {league.game_mode} · {t("stats.firstTo")} {Math.ceil(league.best_of_legs / 2)} · {league.format === "double" ? t("league.doubleRoundLabel") : t("league.singleRoundLabel")}
        </p>

        <div className="gradient-card border border-border shadow-elevation-sm rounded-xl p-4 mb-4">
          <h2 className="flex items-center gap-2 text-sm font-display uppercase text-muted-foreground mb-3">
            <Trophy className="w-4 h-4" /> {t("league.standingsTitle")}
          </h2>
          {standings.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">{t("league.noParticipantsYet")}</p>
          ) : (
            <div className="space-y-1">
              <div className="grid grid-cols-[auto_1fr_auto_auto_auto_auto] gap-2 px-3 text-[10px] text-muted-foreground uppercase mb-1">
                <span className="w-6" />
                <span />
                <span className="w-8 text-center">{t("league.colPlayed")}</span>
                <span className="w-8 text-center">{t("league.colWon")}</span>
                <span className="w-14 text-center">{t("league.colLegs")}</span>
                <span className="w-10 text-right">{t("league.colPoints")}</span>
              </div>
              {standings.map((s, i) => (
                <div key={s.name} className={`grid grid-cols-[auto_1fr_auto_auto_auto_auto] items-center gap-2 px-3 py-2 rounded-lg ${i < 3 ? "bg-muted/50" : "bg-muted/30"}`}>
                  <span className={`font-display w-6 ${i === 0 ? "text-accent" : "text-muted-foreground"}`}>
                    {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`}
                  </span>
                  <span className="text-sm font-medium truncate">{s.name}</span>
                  <span className="w-8 text-center text-xs text-muted-foreground">{s.played}</span>
                  <span className="w-8 text-center text-xs text-muted-foreground">{s.won}</span>
                  <span className="w-14 text-center text-xs text-muted-foreground font-mono">{s.legsFor}:{s.legsAgainst}</span>
                  <span className="w-10 text-right font-display text-primary">{s.points}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="gradient-card border border-border shadow-elevation-sm rounded-xl p-4">
          <h2 className="flex items-center gap-2 text-sm font-display uppercase text-muted-foreground mb-3">
            <Users className="w-4 h-4" /> {t("league.fixturesTitle")}
          </h2>
          {fixturesByRound.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("league.noFixturesYet")}</p>
          ) : (
            <div className="space-y-4">
              {fixturesByRound.map(([round, roundFixtures]) => {
                const scheduledDate = roundFixtures[0].scheduled_date;
                return (
                  <div key={round}>
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        {t("league.roundLabel")} {round}{legLabel(roundFixtures[0].leg) ? ` · ${legLabel(roundFixtures[0].leg)}` : ""}
                      </p>
                      {scheduledDate && (
                        <div className="flex items-center gap-1.5 shrink-0">
                          <p className="flex items-center gap-1 text-[10px] text-muted-foreground">
                            <CalendarDays className="w-3 h-3" />
                            {new Date(scheduledDate).toLocaleDateString(LOCALE_BY_LANGUAGE[language], { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" })}
                          </p>
                          <Button
                            size="icon" variant="ghost" className="h-6 w-6 shrink-0"
                            title={t("league.addToCalendar")}
                            onClick={() => downloadIcsEvent(
                              {
                                date: scheduledDate,
                                uid: `league-${league.id}-round-${round}`,
                                title: `${league.name} · ${t("league.roundLabel")} ${round}`,
                                description: roundFixtures.map((f) => `${f.player1_name ?? "?"} vs ${f.player2_name ?? "?"}`).join("\n"),
                              },
                              `${league.name.replace(/\s+/g, "_")}-Runde${round}.ics`,
                            )}
                          >
                            <CalendarPlus className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      )}
                    </div>
                    <div className="space-y-1.5">
                      {roundFixtures.map((f) => (
                        <div key={f.id} className="flex items-center gap-2 bg-muted/30 rounded-lg px-3 py-2">
                          <div className="flex-1 min-w-0 flex items-center justify-between gap-2 text-sm">
                            <span className={`truncate ${f.winner_slot === 1 ? "font-semibold text-primary" : ""}`}>{f.player1_name ?? "?"}</span>
                            {f.status === "finished" ? (
                              <span className="text-xs font-mono text-muted-foreground shrink-0">{f.player1_legs_won}:{f.player2_legs_won}</span>
                            ) : (
                              <span className="text-[10px] text-muted-foreground shrink-0">vs</span>
                            )}
                            <span className={`truncate text-right ${f.winner_slot === 2 ? "font-semibold text-primary" : ""}`}>{f.player2_name ?? "?"}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default PublicLeaguePage;
