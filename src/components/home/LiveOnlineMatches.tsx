import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Eye, Radio } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import type { OnlineGameState } from "@/hooks/useOnlineMatch";

interface LiveRow { id: string; mode: string; is_doubles: boolean; player1_user_id: string; player2_user_id: string; game_state: OnlineGameState | null }

/** Other members' running online matches (watchable via /watch/:id). Hidden when there is none,
 *  and a match you play yourself never shows up here — it has its own join card above. */
const LiveOnlineMatches = () => {
  const { user } = useAuth();
  const { t } = useLanguage();
  const [rows, setRows] = useState<LiveRow[]>([]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const load = async () => {
      const { data } = await supabase
        .from("online_matches")
        .select("id, mode, is_doubles, player1_user_id, player2_user_id, game_state")
        .eq("status", "active");
      if (cancelled) return;
      const mine = new Set<string>();
      const { data: seats } = await supabase.from("online_match_players").select("match_id").eq("user_id", user.id);
      (seats ?? []).forEach((s) => mine.add(s.match_id));
      setRows(((data ?? []) as unknown as LiveRow[]).filter((m) => m.player1_user_id !== user.id && m.player2_user_id !== user.id && !mine.has(m.id)));
    };
    void load();
    const interval = window.setInterval(load, 10000);
    return () => { cancelled = true; window.clearInterval(interval); };
  }, [user]);

  if (rows.length === 0) return null;
  return (
    <>
      <h2 className="font-display uppercase text-sm text-muted-foreground mb-3 flex items-center gap-1.5">
        <Radio className="w-3.5 h-3.5 text-accent" /> {t("home.liveOnlineMatches")}
      </h2>
      <div className="space-y-2 mb-6">
        {rows.map((m) => {
          const g = m.game_state;
          const label = g?.teams?.length ? g.teams.map((tm) => tm.name).join(" – ") : g?.players.map((p) => p.name).join(" – ") ?? "?";
          return (
            <Link key={m.id} to={`/watch/${m.id}`} className="bg-card border border-border rounded-xl px-4 py-2.5 flex items-center gap-3 hover:border-primary transition-colors">
              <Eye className="w-4 h-4 text-muted-foreground shrink-0" />
              <span className="flex-1 min-w-0 truncate text-sm">{label}</span>
              <span className="text-[10px] uppercase text-muted-foreground shrink-0">{m.mode === "cricket" ? "Cricket" : m.mode}{m.is_doubles ? " · 2v2" : ""}</span>
            </Link>
          );
        })}
      </div>
    </>
  );
};

export default LiveOnlineMatches;
