import { useEffect, useMemo, useState } from "react";
import { Info } from "lucide-react";
import { Card } from "@/components/ui/card";
import { DartLoaderIcon as Loader2 } from "@/components/icons/DartIcons";
import { supabase } from "@/integrations/supabase/client";

interface Overview {
  daily: { day: string; active: number }[];
  features: { feature: string; events: number; days: number }[];
  weekly: { week: string; active: number; repeat: number }[];
  clubs: { club: string; active: number }[];
}

/** Readable names for the feature keys sent by trackUsage(). Unknown keys are shown as they are. */
const FEATURE_LABELS: Record<string, string> = {
  "page:home": "Startseite",
  "page:game": "Spiel-Bildschirm",
  "page:tournament": "Turniere",
  "page:leagues": "Ligen",
  "page:statistics": "Statistiken",
  "page:training": "Training",
  "page:players": "Verein / Mitglieder",
  "page:settings": "Einstellungen",
  "page:admin": "Admin",
  "page:watch": "Zuschauen (Online-Spiele)",
  game_local_start: "Lokales Spiel gestartet",
  game_local_rematch: "Revanche (lokal)",
  game_online_1v1: "Online-Spiel 1:1 gespielt",
  game_online_doubles: "Online-Doppel gespielt",
  online_1v1_sent: "Online-Herausforderung gesendet",
  online_doubles_sent: "Online-Doppel angefragt",
  online_duel_sent: "Fernduell gesendet",
  camera_on: "Kamera eingeschaltet",
  bulloff_used: "Ausbullen genutzt",
  board_video_shared: "Board-Video geteilt",
  training_start: "Trainingsübung gestartet",
  recap_viewed: "Saison-Rückblick angesehen",
  rivalry_shown: "Rivalitäts-Geschichte gezeigt",
  push_enabled: "Push-Nachrichten aktiviert",
};
const labelOf = (key: string) => FEATURE_LABELS[key] ?? key;
const dayLabel = (iso: string) => new Date(iso).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });

const Tile = ({ value, label, note }: { value: string; label: string; note?: string }) => (
  <div className="rounded-xl border border-border p-3">
    <p className="text-2xl font-display tabular-nums">{value}</p>
    <p className="text-xs">{label}</p>
    {note && <p className="text-[11px] text-muted-foreground">{note}</p>}
  </div>
);

/** Platform-owner view of the anonymous usage statistics (see usage_overview): daily/weekly active
 *  members, how many come back within a week, which areas and features get used. */
const AdminUsage = () => {
  const [days, setDays] = useState(28);
  const [data, setData] = useState<Overview | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setFailed(false);
    supabase.rpc("usage_overview", { _days: days }).then(({ data: result, error }) => {
      if (cancelled) return;
      if (error || !result) setFailed(true);
      else setData(result as unknown as Overview);
    });
    return () => { cancelled = true; };
  }, [days]);

  const figures = useMemo(() => {
    if (!data) return null;
    const lastDay = data.daily[data.daily.length - 1];
    const lastWeek = data.weekly[data.weekly.length - 1];
    const dauAvg = data.daily.length ? data.daily.reduce((s, d) => s + d.active, 0) / data.daily.length : 0;
    return {
      today: lastDay?.active ?? 0,
      dauAvg,
      wau: lastWeek?.active ?? 0,
      repeatShare: lastWeek && lastWeek.active > 0 ? lastWeek.repeat / lastWeek.active : null,
    };
  }, [data]);

  const maxDaily = Math.max(1, ...(data?.daily.map((d) => d.active) ?? [1]));
  const maxEvents = Math.max(1, ...(data?.features.map((f) => f.events) ?? [1]));

  if (failed) return <Card className="p-4 text-sm text-muted-foreground">Die Auswertung konnte nicht geladen werden.</Card>;
  if (!data || !figures) {
    return <div role="status" className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {[7, 28, 90].map((d) => (
          <button key={d} type="button" onClick={() => setDays(d)}
            className={`rounded-md border px-3 py-1 text-xs ${days === d ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}>
            {d} Tage
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile value={String(figures.today)} label="Heute aktiv" note="Mitglieder, die heute etwas genutzt haben" />
        <Tile value={figures.dauAvg.toFixed(1).replace(".", ",")} label="Ø täglich aktiv" note={`über die letzten ${days} Tage`} />
        <Tile value={String(figures.wau)} label="Diese Woche aktiv" note="verschiedene Mitglieder, Montag bis heute" />
        <Tile
          value={figures.repeatShare === null ? "–" : `${Math.round(figures.repeatShare * 100)} %`}
          label="Kommen wieder"
          note="Anteil mit mindestens 2 aktiven Tagen in der Woche"
        />
      </div>

      <Card className="p-4">
        <p className="mb-3 text-sm font-semibold">Aktive Mitglieder pro Tag</p>
        {data.daily.length === 0 ? (
          <p className="text-xs text-muted-foreground">Noch keine Daten. Die Messung läuft ab sofort mit, sobald Mitglieder die neue Version öffnen.</p>
        ) : (
          <div className="flex h-28 items-end gap-1">
            {data.daily.map((d) => (
              <div key={d.day} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1" title={`${dayLabel(d.day)}: ${d.active}`}>
                <div className="w-full rounded-t bg-primary/70" style={{ height: `${Math.max(4, (d.active / maxDaily) * 100)}%` }} />
              </div>
            ))}
          </div>
        )}
        {data.daily.length > 0 && (
          <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
            <span>{dayLabel(data.daily[0].day)}</span>
            <span>{dayLabel(data.daily[data.daily.length - 1].day)}</span>
          </div>
        )}
      </Card>

      <Card className="p-4">
        <p className="mb-3 text-sm font-semibold">Was genutzt wird</p>
        {data.features.length === 0 ? (
          <p className="text-xs text-muted-foreground">Noch keine Daten.</p>
        ) : (
          <div className="space-y-1.5">
            {data.features.map((f) => (
              <div key={f.feature} className="flex items-center gap-2 text-sm">
                <span className="w-44 shrink-0 truncate">{labelOf(f.feature)}</span>
                <div className="h-2 flex-1 overflow-hidden rounded bg-muted"><div className="h-full bg-accent/80" style={{ width: `${(f.events / maxEvents) * 100}%` }} /></div>
                <span className="w-24 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{f.events}× · {f.days} Tage</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      {data.weekly.length > 0 && (
        <Card className="p-4">
          <p className="mb-3 text-sm font-semibold">Wochen</p>
          <div className="space-y-1 text-sm">
            {data.weekly.map((w) => (
              <div key={w.week} className="flex justify-between">
                <span className="text-muted-foreground">ab {dayLabel(w.week)}</span>
                <span className="tabular-nums">{w.active} aktiv · {w.repeat} kamen mehrfach</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {data.clubs.length > 1 && (
        <Card className="p-4">
          <p className="mb-3 text-sm font-semibold">Nach Verein (aktive Tage gesamt)</p>
          {data.clubs.map((c) => (
            <div key={c.club} className="flex justify-between text-sm"><span>{c.club}</span><span className="tabular-nums">{c.active}</span></div>
          ))}
        </Card>
      )}

      <div className="flex gap-2 text-[11px] leading-relaxed text-muted-foreground">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <p>
          Anonym gemessen: Es werden nur Zähler je Verein und Tag gespeichert, dazu ein Hash pro Mitglied, der jede Woche neu gesalzen
          wird und sich nicht über Wochen verknüpfen lässt. Keine Namen, keine Geräte-ID, keine Drittanbieter. Mitglieder können die
          Messung in den Einstellungen abschalten, dann zählt sie nicht mit. „Kommen wieder“ ist kein Wochen-Vergleich, sondern der
          Anteil der Aktiven mit mindestens 2 Tagen in derselben Woche.
        </p>
      </div>
    </div>
  );
};

export default AdminUsage;
