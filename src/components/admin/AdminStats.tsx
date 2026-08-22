import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, Image as ImageIcon, Gamepad2, Users, Info } from "lucide-react";
import { usePagedList } from "@/hooks/usePagedList";
import { ListPaginationFooter } from "@/components/ui/list-pagination-footer";

interface UserActivity {
  user_id: string;
  email: string;
  created_at: string;
  last_sign_in_at: string | null;
  player_name: string | null;
  games_played: number | null;
  average: number | null;
}

interface SampleRow {
  id: string;
  board: string;
  after_path: string;
  labels: unknown[];
  created_at: string;
}

/** Admin-only DB info panel: training-data volume + a visual sample of what's actually being
 *  captured, game counts, and per-member activity (join date / last login / games played).
 *  Everything here is a read against data that already exists — see the note in the JSX below
 *  for what's deliberately NOT here (login count, session duration) and why. */
const AdminStats = () => {
  const [loading, setLoading] = useState(true);
  const [activity, setActivity] = useState<UserActivity[]>([]);
  const pagedActivity = usePagedList(activity);
  const [sampleTotal, setSampleTotal] = useState(0);
  const [boardCounts, setBoardCounts] = useState<Record<string, number>>({});
  const [gameTotal, setGameTotal] = useState(0);
  const [modeCounts, setModeCounts] = useState<Record<string, number>>({});
  const [recentSamples, setRecentSamples] = useState<SampleRow[]>([]);
  const [sampleImages, setSampleImages] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [activityRes, boardsRes, modesRes, recentRes] = await Promise.all([
        supabase.rpc("admin_user_activity"),
        supabase.from("training_samples").select("board"),
        supabase.from("games").select("mode"),
        supabase.from("training_samples").select("id, board, after_path, labels, created_at").order("created_at", { ascending: false }).limit(8),
      ]);
      if (cancelled) return;
      if (activityRes.data) setActivity(activityRes.data as UserActivity[]);
      if (boardsRes.data) {
        setSampleTotal(boardsRes.data.length);
        const counts: Record<string, number> = {};
        boardsRes.data.forEach((r) => { counts[r.board] = (counts[r.board] || 0) + 1; });
        setBoardCounts(counts);
      }
      if (modesRes.data) {
        setGameTotal(modesRes.data.length);
        const counts: Record<string, number> = {};
        modesRes.data.forEach((r) => { counts[r.mode] = (counts[r.mode] || 0) + 1; });
        setModeCounts(counts);
      }
      if (recentRes.data) {
        setRecentSamples(recentRes.data as SampleRow[]);
        const { data: urls } = await supabase.storage.from("dart-training").createSignedUrls(recentRes.data.map((s) => s.after_path), 3600);
        if (!cancelled && urls) {
          const map: Record<string, string> = {};
          urls.forEach((u) => { if (u.signedUrl && u.path) map[u.path] = u.signedUrl; });
          setSampleImages(map);
        }
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <div role="status" aria-label="Lädt …" className="py-12 flex justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="bg-card border border-border rounded-xl p-4">
        <h3 className="font-display text-sm uppercase text-muted-foreground mb-3 flex items-center gap-2">
          <ImageIcon className="w-4 h-4" /> Trainingsdaten
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
          <div className="text-center">
            <p className="text-2xl font-display text-primary">{sampleTotal}</p>
            <p className="text-[10px] uppercase text-muted-foreground">Bildpaare gesamt</p>
          </div>
          {Object.entries(boardCounts).map(([board, count]) => (
            <div key={board} className="text-center">
              <p className="text-2xl font-display">{count}</p>
              <p className="text-[10px] uppercase text-muted-foreground">Board {board}</p>
            </div>
          ))}
        </div>
        {recentSamples.length > 0 && (
          <>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Letzte Aufnahmen (Board-Ausschnitt, nach dem Wurf)</p>
            <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
              {recentSamples.map((s) => (
                <div key={s.id} className="aspect-square rounded-lg overflow-hidden bg-muted border border-border relative" title={`Board ${s.board} · ${Array.isArray(s.labels) ? s.labels.length : 0} Darts markiert · ${new Date(s.created_at).toLocaleString("de-DE")}`}>
                  {sampleImages[s.after_path] ? (
                    <img src={sampleImages[s.after_path]} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                      <ImageIcon className="w-4 h-4" />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="bg-card border border-border rounded-xl p-4">
        <h3 className="font-display text-sm uppercase text-muted-foreground mb-3 flex items-center gap-2">
          <Gamepad2 className="w-4 h-4" /> Spiele
        </h3>
        <div className="grid grid-cols-3 gap-3">
          <div className="text-center">
            <p className="text-2xl font-display text-primary">{gameTotal}</p>
            <p className="text-[10px] uppercase text-muted-foreground">Gesamt</p>
          </div>
          {Object.entries(modeCounts).map(([mode, count]) => (
            <div key={mode} className="text-center">
              <p className="text-2xl font-display">{count}</p>
              <p className="text-[10px] uppercase text-muted-foreground">{mode}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <h3 className="font-display text-sm uppercase text-muted-foreground p-4 pb-0 flex items-center gap-2">
          <Users className="w-4 h-4" /> Mitglieder-Aktivität
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm mt-3">
            <thead className="bg-muted/50">
              <tr className="text-left text-xs uppercase text-muted-foreground">
                <th className="px-4 py-2">E-Mail</th>
                <th className="px-4 py-2">Spieler</th>
                <th className="px-4 py-2">Dabei seit</th>
                <th className="px-4 py-2">Zuletzt aktiv</th>
                <th className="px-4 py-2 text-right">Spiele</th>
              </tr>
            </thead>
            <tbody>
              {pagedActivity.visible.map((u) => (
                <tr key={u.user_id} className="border-t border-border">
                  <td className="px-4 py-2.5 font-mono text-xs">{u.email}</td>
                  <td className="px-4 py-2.5 text-xs">{u.player_name ?? <span className="text-muted-foreground">–</span>}</td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">{new Date(u.created_at).toLocaleDateString("de-DE")}</td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">
                    {u.last_sign_in_at ? new Date(u.last_sign_in_at).toLocaleString("de-DE") : "Nie eingeloggt"}
                  </td>
                  <td className="px-4 py-2.5 text-right text-xs">{u.games_played ?? "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ListPaginationFooter list={pagedActivity} />
        <div className="p-4 pt-3 flex gap-2 text-[11px] text-muted-foreground border-t border-border">
          <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <p>
            „Zuletzt aktiv" ist der letzte Login-Zeitpunkt (von Supabase Auth) — keine Login-Anzahl
            und keine Nutzungsdauer, das wird aktuell nirgends erfasst. Beides ließe sich nachrüsten,
            bräuchte aber neue Tracking-Logik (eigene Tabelle + Events beim Login/während der
            Nutzung) statt nur einer neuen Abfrage — sag Bescheid, falls das gewünscht ist.
          </p>
        </div>
      </div>
    </div>
  );
};

export default AdminStats;
