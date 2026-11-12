import { MapPin, Pencil } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import PlayerAvatar from "./PlayerAvatar";
import type { PlayerProfile } from "./playerProfile";

/** Profile top: big round picture, name, nickname, hometown, and the edit button for whoever
 *  may edit this profile. */
const PlayerProfileHeader = ({ player, online, canEdit, onEdit }: { player: PlayerProfile; online: boolean; canEdit: boolean; onEdit: () => void }) => {
  const { t } = useLanguage();
  return (
    <header className="flex items-center gap-4">
      <PlayerAvatar player={player} online={online} size="lg" />
      <div className="min-w-0 flex-1">
        <h1 className="font-display font-bold text-[28px] leading-tight break-words">{player.name}</h1>
        {player.nickname && <p className="text-sm text-muted-foreground truncate">"{player.nickname}"</p>}
        {player.hometown && (
          <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
            <MapPin className="w-3 h-3 shrink-0" aria-hidden /> {player.hometown}
            {player.joined_year && <span>· {t("players.sinceYear")} {player.joined_year}</span>}
          </p>
        )}
      </div>
      {canEdit && (
        <button
          type="button"
          onClick={onEdit}
          aria-label={t("players.editProfile")}
          title={t("players.editProfile")}
          className="flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-border px-3 text-sm font-semibold hover:bg-muted"
        >
          <Pencil className="w-4 h-4" />
          <span className="hidden sm:inline">{t("players.editProfile")}</span>
        </button>
      )}
    </header>
  );
};

export default PlayerProfileHeader;
