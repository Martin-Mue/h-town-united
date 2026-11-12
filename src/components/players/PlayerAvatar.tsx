import { useLanguage } from "@/contexts/LanguageContext";
import type { PlayerProfile } from "./playerProfile";

// Static fallback portraits
import portraitKarsten from "@/assets/portraits/karsten.jpg";
import portraitMartin1 from "@/assets/portraits/martin1.jpg";
import portraitMartin2 from "@/assets/portraits/martin2.jpg";
import portraitMartin3 from "@/assets/portraits/martin3.jpg";

/** Static portrait mapping by player ID */
const STATIC_PORTRAITS: Record<string, string> = {
  "a2f19689-d758-4c77-ad7d-69cedd69115a": portraitKarsten,
  "b1015e88-4cfd-43f5-a529-c5a193cb1ebe": portraitMartin1,
  "e5b1736c-a098-485b-9709-a692db1f4dee": portraitMartin2,
  "ff73f02d-6475-410e-8b97-c7c1452c2af3": portraitMartin3,
};

const SIZE_CLASSES = { sm: "w-11 h-11", md: "w-14 h-14", lg: "w-20 h-20" } as const;
const EMOJI_TEXT_SIZE = { sm: "text-xl", md: "text-2xl", lg: "text-4xl" } as const;

/** Round player picture (AI portrait > avatar > static portrait > emoji) with a green dot
 *  while the member is online. */
const PlayerAvatar = ({ player, online = false, size = "md" }: { player: PlayerProfile; online?: boolean; size?: keyof typeof SIZE_CLASSES }) => {
  const { t } = useLanguage();
  const imgUrl = player.ai_portrait_url || player.avatar_url || STATIC_PORTRAITS[player.id];

  return (
    <span className="relative inline-block shrink-0">
      {imgUrl ? (
        <img
          src={imgUrl}
          alt={`${player.name} portrait`}
          className={`${SIZE_CLASSES[size]} rounded-full object-cover bg-muted border border-border`}
          onError={(e) => {
            // Fall back to static portrait or emoji on load failure
            const staticUrl = STATIC_PORTRAITS[player.id];
            if (staticUrl && e.currentTarget.src !== staticUrl) {
              e.currentTarget.src = staticUrl;
            } else {
              e.currentTarget.style.display = "none";
            }
          }}
        />
      ) : (
        <span className={`${SIZE_CLASSES[size]} rounded-full bg-muted border border-border flex items-center justify-center ${EMOJI_TEXT_SIZE[size]}`}>
          {player.emoji}
        </span>
      )}
      {online && (
        <span title={t("players.onlineNow")} className="absolute bottom-0 right-0 block w-3.5 h-3.5 rounded-full bg-secondary border-2 border-background" />
      )}
    </span>
  );
};

export default PlayerAvatar;
