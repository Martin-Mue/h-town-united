import { Link } from "react-router-dom";
import { ArrowRight, Play, Radio, Swords, TrendingUp } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { roundLabelFor } from "@/utils/tournament";
import type { NextTournamentMatch, ResumableGame } from "@/utils/homeHighlights";

export interface LiveTournamentInfo {
  id: string;
  name: string;
}

export interface MyForm {
  name: string;
  average: number;
  elo: number;
  wins: number;
  played: number;
  highScore: number;
}

interface HomeHighlightsProps {
  resume: ResumableGame | null;
  live: LiveTournamentInfo[];
  next: NextTournamentMatch | null;
  form: MyForm | null;
}

const tileBase = "gradient-card group flex flex-col gap-1.5 rounded-xl border p-4 shadow-elevation-sm transition-all active:scale-[0.98]";

/**
 * "Für dich": the few things worth a tap on the start page right now — a game you left running, a tournament that is
 * live, your own next tournament match, and your numbers. Shows nothing at all when there is nothing of that.
 */
const HomeHighlights = ({ resume, live, next, form }: HomeHighlightsProps) => {
  const { t } = useLanguage();
  if (!resume && live.length === 0 && !next && !form) return null;

  return (
    <section className="mb-6">
      <h2 className="mb-3 font-display text-sm uppercase text-muted-foreground">{t("home.forYou")}</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {resume && (
          <Link to="/game" className={`${tileBase} border-primary/50 hover:border-primary`} style={{ background: "linear-gradient(120deg, hsl(var(--primary) / 0.18), transparent 70%)" }}>
            <span className="flex items-center gap-2 text-[11px] font-display uppercase tracking-wide text-primary"><Play className="h-3.5 w-3.5" /> {t("home.resumeGame")}</span>
            <span className="truncate font-display text-lg leading-tight">
              {resume.names.length === 2 ? (
                <>{resume.names[0]} <span className="tabular-nums text-primary">{resume.scores[0]}</span> <span className="text-muted-foreground">:</span> <span className="tabular-nums text-primary">{resume.scores[1]}</span> {resume.names[1]}</>
              ) : (
                resume.names.join(" · ")
              )}
            </span>
            <span className="flex items-center justify-between text-xs text-muted-foreground">
              {resume.activeName && t("home.resumeTurn").replace("{name}", resume.activeName)}
              <ArrowRight className="h-4 w-4 text-primary transition-transform group-hover:translate-x-0.5" />
            </span>
          </Link>
        )}

        {live.map((tourn) => (
          <Link key={tourn.id} to={`/tournament/${tourn.id}`} className={`${tileBase} border-secondary/40 hover:border-secondary`}>
            <span className="flex items-center gap-2 text-[11px] font-display uppercase tracking-wide text-secondary">
              <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-secondary opacity-60" /><span className="relative inline-flex h-2 w-2 rounded-full bg-secondary" /></span>
              <Radio className="h-3.5 w-3.5" /> {t("home.liveTournament")}
            </span>
            <span className="truncate font-display text-lg leading-tight">{tourn.name}</span>
            <span className="flex items-center justify-between text-xs text-muted-foreground">
              {t("home.liveWatch")} <ArrowRight className="h-4 w-4 text-secondary transition-transform group-hover:translate-x-0.5" />
            </span>
          </Link>
        ))}

        {next && (
          <Link to={`/tournament/${next.tournamentId}`} className={`${tileBase} border-accent/40 hover:border-accent`}>
            <span className="flex items-center gap-2 text-[11px] font-display uppercase tracking-wide text-accent"><Swords className="h-3.5 w-3.5" /> {t("home.nextMatchTitle")}</span>
            <span className="truncate font-display text-lg leading-tight">
              {next.opponent ? t("home.nextMatchVs").replace("{name}", next.opponent) : t("home.nextMatchTbd")}
            </span>
            <span className="flex items-center justify-between text-xs text-muted-foreground">
              <span className="truncate">{next.tournamentName}{next.round !== null && next.totalRounds !== null ? ` · ${roundLabelFor(next.round, next.totalRounds, t)}` : ""}</span>
              <ArrowRight className="h-4 w-4 shrink-0 text-accent transition-transform group-hover:translate-x-0.5" />
            </span>
          </Link>
        )}

        {form && (
          <Link to="/statistics" className={`${tileBase} border-border hover:border-primary/40`}>
            <span className="flex items-center gap-2 text-[11px] font-display uppercase tracking-wide text-muted-foreground"><TrendingUp className="h-3.5 w-3.5" /> {t("home.yourForm")} · {form.name}</span>
            <span className="grid grid-cols-4 gap-2 text-center">
              {[
                [t("home.formAverage"), form.average > 0 ? form.average.toFixed(1) : "–"],
                [t("home.formElo"), String(Math.round(form.elo))],
                [t("home.formWins"), `${form.wins}/${form.played}`],
                [t("home.formBest"), form.highScore > 0 ? String(form.highScore) : "–"],
              ].map(([label, value]) => (
                <span key={label} className="flex flex-col">
                  <span className="font-display text-xl leading-none tabular-nums text-foreground">{value}</span>
                  <span className="mt-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
                </span>
              ))}
            </span>
          </Link>
        )}
      </div>
    </section>
  );
};

export default HomeHighlights;
