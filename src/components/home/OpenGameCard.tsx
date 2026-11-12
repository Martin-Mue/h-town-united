import { Link } from "react-router-dom";
import { useLanguage } from "@/contexts/LanguageContext";
import type { ResumableGame } from "@/utils/homeHighlights";

/**
 * Top card of the start page (redesign 2026-11): the game saved on this device with the big
 * remaining scores and "Weiterspielen", or — with nothing to resume — a plain invitation to start
 * one. /game itself decides what to show (it resumes a saved game), this card only links there.
 */
const OpenGameCard = ({ resume }: { resume: ResumableGame | null }) => {
  const { t } = useLanguage();

  if (!resume) {
    return (
      <section className="rounded-[20px] border border-border bg-card p-4 flex items-center gap-3">
        <p className="flex-1 min-w-0 font-display text-2xl font-bold leading-tight">{t("home.readyToPlay")}</p>
        <Link
          to="/game"
          className="h-[52px] px-5 rounded-[14px] bg-primary text-primary-foreground font-semibold text-[17px] flex items-center justify-center shrink-0 active:scale-[0.97] transition-transform"
        >
          {t("home.newGame")}
        </Link>
      </section>
    );
  }

  const twoSides = resume.names.length === 2;
  return (
    <section className="rounded-[20px] border border-primary/40 bg-card p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-[0.12em] text-primary">{t("home.openGame")}</span>
        <span className="text-[13px] text-muted-foreground truncate">
          {resume.modeLabel} · Leg {resume.legNumber}
        </span>
      </div>
      <div className={twoSides ? "grid grid-cols-2 gap-3" : "grid grid-cols-2 sm:grid-cols-4 gap-3"}>
        {resume.names.map((name, i) => {
          const active = i === resume.activeSide;
          return (
            <div key={`${name}-${i}`} className="min-w-0">
              <p className={`text-sm font-semibold truncate ${active ? "" : "text-muted-foreground"}`}>
                {name}
                {active && <span className="text-primary"> · {t("home.onThrow")}</span>}
              </p>
              <p
                className={`font-display font-bold leading-none tabular-nums ${twoSides ? "text-[60px]" : "text-4xl"} ${active ? "" : "text-muted-foreground"}`}
              >
                {resume.scores[i] ?? "–"}
              </p>
              <p className="text-[13px] text-muted-foreground">{(resume.legsWon[i] ?? 0) === 1 ? t("home.legsWonOne") : t("home.legsWonShort").replace("{n}", String(resume.legsWon[i] ?? 0))}</p>
            </div>
          );
        })}
      </div>
      <Link
        to="/game"
        className="h-[52px] rounded-[14px] bg-primary text-primary-foreground font-semibold text-[17px] flex items-center justify-center active:scale-[0.98] transition-transform"
      >
        {t("home.continuePlaying")}
      </Link>
    </section>
  );
};

export default OpenGameCard;
