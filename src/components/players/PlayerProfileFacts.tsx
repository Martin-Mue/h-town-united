import { Calendar, Hand, Target, Trophy, type LucideIcon } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { PlayersCard, PlayersSectionLabel } from "./PlayersPagePrimitives";
import type { PlayerProfile } from "./playerProfile";

interface ProfileFact {
  icon: LucideIcon;
  label: string;
  value: string;
}

/** "Auf einen Blick": throwing hand, dart weight, favourite double, birthday — only the ones the
 *  player filled in; renders nothing when none are set. */
const PlayerProfileFacts = ({ player }: { player: PlayerProfile }) => {
  const { t } = useLanguage();
  const facts: ProfileFact[] = [];
  if (player.throwing_hand) {
    facts.push({
      icon: Hand,
      label: t("players.throwingHand"),
      value: player.throwing_hand === "right" ? t("players.right") : player.throwing_hand === "left" ? t("players.left") : t("players.ambidextrous"),
    });
  }
  if (player.dart_weight_g) facts.push({ icon: Target, label: t("players.dartWeight"), value: `${player.dart_weight_g} g` });
  if (player.favorite_double) facts.push({ icon: Trophy, label: t("players.favoriteDouble"), value: player.favorite_double });
  if (player.birthday) facts.push({ icon: Calendar, label: t("players.birthday"), value: new Date(player.birthday).toLocaleDateString("de-DE") });
  if (facts.length === 0) return null;

  return (
    <section className="space-y-2">
      <PlayersSectionLabel>{t("players.profileFactsHeading")}</PlayersSectionLabel>
      <PlayersCard className="p-0 divide-y divide-border">
        {facts.map((fact) => (
          <div key={fact.label} className="flex items-center gap-3 px-4 py-3">
            <fact.icon className="w-4 h-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="flex-1 min-w-0 text-sm text-muted-foreground truncate">{fact.label}</span>
            <span className="font-display font-bold text-lg tabular-nums">{fact.value}</span>
          </div>
        ))}
      </PlayersCard>
    </section>
  );
};

export default PlayerProfileFacts;
