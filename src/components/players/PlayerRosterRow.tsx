import type { ReactNode } from "react";
import { ChevronDown, Pencil, Quote } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useLanguage } from "@/contexts/LanguageContext";
import PlayerAvatar from "./PlayerAvatar";
import { formatPlayerAverage, playerWinRate, type PlayerProfile } from "./playerProfile";

const throwingHandLabelKey = (hand: string | null | undefined) =>
  hand === "left" ? "players.left" : hand === "right" ? "players.right" : hand === "ambi" ? "players.both" : null;

/** One label/value pair in a roster row's expanded details. */
const RosterFact = ({ label, value }: { label: string; value: ReactNode }) => (
  <div className="min-w-0 rounded-xl bg-muted px-3 py-2">
    <p className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground truncate">{label}</p>
    <p className="text-sm truncate">{value}</p>
  </div>
);

/** A member in the club roster: avatar, name, short record and average; the chevron unfolds
 *  profile facts, the edit button and (via `children`) admin-only tools. Starts collapsed. */
const PlayerRosterRow = ({
  player, online, expanded, onExpandedChange, onOpenProfile, canEdit, onEdit, children,
}: {
  player: PlayerProfile;
  online: boolean;
  expanded: boolean;
  onExpandedChange: () => void;
  onOpenProfile: () => void;
  canEdit: boolean;
  onEdit: () => void;
  children?: ReactNode;
}) => {
  const { t } = useLanguage();
  const handKey = throwingHandLabelKey(player.throwing_hand);
  const recordLine = [
    `${player.games_played} ${t("stats.games")}`,
    `${playerWinRate(player)} % ${t("game.winsLabel")}`,
    player.favorite_double,
  ].filter(Boolean).join(" · ");

  return (
    <Collapsible open={expanded} onOpenChange={onExpandedChange}>
      <div className="rounded-[14px] border border-border bg-card">
        <div className="flex items-center gap-3 px-3.5 py-2.5">
          <button type="button" onClick={onOpenProfile} className="flex min-w-0 flex-1 items-center gap-3 text-left min-h-11">
            <PlayerAvatar player={player} online={online} size="sm" />
            <span className="min-w-0">
              <span className="block font-semibold truncate">
                {player.name}
                {player.nickname && <span className="font-normal text-muted-foreground"> "{player.nickname}"</span>}
              </span>
              <span className="block text-xs text-muted-foreground truncate">{recordLine}</span>
            </span>
          </button>
          <div className="text-right shrink-0">
            <p className="font-display font-bold text-xl leading-none tabular-nums">{formatPlayerAverage(player)}</p>
            <p className="text-[11px] text-muted-foreground">Ø</p>
          </div>
          <CollapsibleTrigger asChild>
            <button
              type="button"
              aria-label={t("players.moreDetails")}
              className="-mr-1.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-muted-foreground hover:bg-muted"
            >
              <ChevronDown className={`w-5 h-5 transition-transform ${expanded ? "rotate-180" : ""}`} />
            </button>
          </CollapsibleTrigger>
        </div>

        <CollapsibleContent>
          <div className="space-y-3 border-t border-border px-3.5 pb-3.5 pt-3">
            <div className="grid grid-cols-2 gap-2">
              <RosterFact label="Highscore" value={player.high_score || 0} />
              <RosterFact label={t("players.throwingHand")} value={handKey ? t(handKey) : "–"} />
              <RosterFact label={t("players.residence")} value={player.hometown || t("players.notSpecified")} />
              <RosterFact label={t("players.memberSince")} value={player.joined_year || "–"} />
              <RosterFact label={t("players.dartWeightShort")} value={player.dart_weight_g ? `${player.dart_weight_g} g` : "–"} />
              <RosterFact label={t("players.birthday")} value={player.birthday ? new Date(player.birthday).toLocaleDateString("de-DE") : "–"} />
            </div>
            {(player.motto || player.bio) && (
              <div className="space-y-1.5 rounded-xl bg-muted px-3 py-2.5">
                {player.motto && (
                  <p className="flex items-start gap-2 text-sm italic">
                    <Quote className="w-4 h-4 shrink-0 mt-0.5 text-accent" aria-hidden />
                    {player.motto}
                  </p>
                )}
                {player.bio && <p className="text-xs text-muted-foreground line-clamp-4 whitespace-pre-line">{player.bio}</p>}
              </div>
            )}
            {canEdit && (
              <button
                type="button"
                onClick={onEdit}
                className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-border text-sm font-semibold hover:bg-muted"
              >
                <Pencil className="w-4 h-4" /> {t("players.editProfile")}
              </button>
            )}
            {children}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
};

export default PlayerRosterRow;
