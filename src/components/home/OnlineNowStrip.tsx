import { Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { usePlayers } from "@/hooks/usePlayers";
import { useOnlineUserIds } from "@/lib/clubPresence";

/** Who is in the app right now (Realtime presence, see clubPresence.ts). Always shown, so the
 *  member can tell "nobody there" from "feature missing"; a tap goes straight to the online
 *  challenge screen. */
const OnlineNowStrip = () => {
  const { user } = useAuth();
  const { t } = useLanguage();
  const { data: players = [] } = usePlayers();
  const onlineNow = useOnlineUserIds();

  const others = players.filter((p) => p.user_id && p.user_id !== user?.id && onlineNow.has(p.user_id));

  return (
    <div className="mb-6">
      <h2 className="font-display uppercase text-sm text-muted-foreground mb-2 flex items-center gap-1.5">
        <span className="inline-block w-2 h-2 rounded-full bg-emerald-500" /> {t("home.onlineNowTitle")}
        <span className="text-xs normal-case text-muted-foreground/70">{others.length > 0 ? `· ${others.length}` : ""}</span>
      </h2>
      {others.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t("home.onlineNowNobody")}</p>
      ) : (
        <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
          {others.map((p) => (
            <Link
              key={p.id}
              to="/game?setup=online"
              title={t("home.onlineNowChallenge")}
              className="shrink-0 flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 hover:border-primary transition-colors"
            >
              <span className="relative text-lg leading-none">
                {p.emoji ?? "🎯"}
                <span className="absolute -bottom-0.5 -right-1 block w-2.5 h-2.5 rounded-full bg-emerald-500 border-2 border-background" />
              </span>
              <span className="text-sm">{p.name.split(" ")[0]}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
};

export default OnlineNowStrip;
