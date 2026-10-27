import { useEffect, useState } from "react";
import { Trophy } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useLanguage } from "@/contexts/LanguageContext";

interface Row { player_id: string; name: string; emoji: string; played: number; wins: number; win_rate: number }

/** Online-only ranking (games.played_online) — wins first, then win rate. Collapsed by default,
 *  same as every other expandable list in the app. */
const OnlineLeaderboard = () => {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    if (!open || rows) return;
    supabase.rpc("online_leaderboard").then(({ data }) => setRows((data ?? []) as Row[]));
  }, [open, rows]);

  return (
    <div className="rounded-lg border border-border bg-muted/30 px-4 py-3">
      <button type="button" onClick={() => setOpen((o) => !o)} className="w-full flex items-center justify-between text-xs text-muted-foreground uppercase font-display">
        <span className="flex items-center gap-1.5"><Trophy className="w-3.5 h-3.5 text-accent" /> {t("players.onlineLeaderboard")}</span>
        <span>{open ? "−" : "+"}</span>
      </button>
      {open && (
        <div className="mt-3 space-y-1">
          {rows === null ? <p className="text-xs text-muted-foreground">…</p>
            : rows.length === 0 ? <p className="text-xs text-muted-foreground">{t("players.onlineLeaderboardEmpty")}</p>
            : rows.slice(0, 15).map((r, i) => (
              <div key={r.player_id} className="flex items-center gap-2 text-sm">
                <span className="w-5 text-xs text-muted-foreground tabular-nums">{i + 1}.</span>
                <span className="shrink-0">{r.emoji}</span>
                <span className="flex-1 min-w-0 truncate">{r.name}</span>
                <span className="text-xs text-muted-foreground tabular-nums">{r.wins}/{r.played}</span>
                <span className="w-12 text-right text-xs font-display tabular-nums">{r.win_rate}%</span>
              </div>
            ))}
        </div>
      )}
    </div>
  );
};

export default OnlineLeaderboard;
