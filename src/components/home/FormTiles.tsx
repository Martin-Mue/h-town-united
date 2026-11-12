import { Link } from "react-router-dom";
import { useLanguage } from "@/contexts/LanguageContext";

export interface MyForm {
  average: number;
  /** Checkout rate in percent (players.double_rate). */
  checkoutRate: number;
  elo: number;
  /** 1-based rank by Elo among the club's players. */
  eloRank: number | null;
  wins: number;
  played: number;
  highScore: number;
}

/** "Deine Form": three number tiles (Average, Checkout, Elo) linking to the statistics page. */
const FormTiles = ({ form }: { form: MyForm }) => {
  const { t } = useLanguage();
  const winRate = form.played > 0 ? Math.round((form.wins / form.played) * 100) : 0;
  const tiles = [
    // "Average" is the darts term in every supported language (home.formAverage is just "Ø").
    { label: "Average", value: form.average > 0 ? form.average.toFixed(1) : "–", sub: form.highScore > 0 ? t("home.formBestVisit").replace("{n}", String(form.highScore)) : "" },
    { label: t("home.formCheckout"), value: form.checkoutRate > 0 ? `${Math.round(form.checkoutRate)} %` : "–", sub: t("home.formWinRate").replace("{n}", String(winRate)) },
    { label: t("home.formElo"), value: String(Math.round(form.elo)), sub: form.eloRank ? t("home.formEloRank").replace("{n}", String(form.eloRank)) : "" },
  ];
  return (
    <section aria-label={t("home.yourForm")} className="grid grid-cols-3 gap-2.5">
      {tiles.map((tile) => (
        <Link key={tile.label} to="/statistics" className="min-w-0 rounded-2xl border border-border bg-card p-3 active:scale-[0.98] transition-transform">
          <p className="text-xs text-muted-foreground truncate">{tile.label}</p>
          <p className="font-display font-bold text-[30px] leading-tight tabular-nums">{tile.value}</p>
          {tile.sub && <p className="text-xs text-muted-foreground leading-snug">{tile.sub}</p>}
        </Link>
      ))}
    </section>
  );
};

export default FormTiles;
