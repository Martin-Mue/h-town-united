import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DartLoaderIcon as Loader2 } from "@/components/icons/DartIcons";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

interface ClubRowData {
  id: string;
  name: string;
  plan_tier: string;
  pilot_until: string | null;
  members: number;
  players: number;
  active_7d: number;
  created_at: string;
}

const TIER_LABEL: Record<string, string> = { trial: "Trial", paid: "Bezahlt", free_locked: "Dauerhaft frei", pilot: "Pilot" };
const dateLabel = (iso: string) => new Date(iso + "T12:00:00").toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
const inDays = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** Platform-owner view of all clubs: who is on which plan, how active they are, and the pilot switch
 *  (set_club_pilot / end_club_pilot). Pilots get every feature until the end date, then fall back to trial. */
const AdminClubs = () => {
  const { toast } = useToast();
  const [clubs, setClubs] = useState<ClubRowData[] | null>(null);
  const [dates, setDates] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc("platform_clubs");
    if (error) { toast({ title: "Vereine konnten nicht geladen werden", description: error.message, variant: "destructive" }); setClubs([]); return; }
    setClubs((data ?? []) as ClubRowData[]);
  }, [toast]);
  useEffect(() => { void load(); }, [load]);

  const startPilot = async (c: ClubRowData) => {
    const until = dates[c.id] || inDays(90);
    setBusy(c.id);
    const { error } = await supabase.rpc("set_club_pilot", { _club: c.id, _until: until });
    setBusy(null);
    if (error) { toast({ title: "Pilot konnte nicht gesetzt werden", description: error.message, variant: "destructive" }); return; }
    toast({ title: `Pilot für ${c.name} bis ${dateLabel(until)}` });
    await load();
  };
  const endPilot = async (c: ClubRowData) => {
    setBusy(c.id);
    const { error } = await supabase.rpc("end_club_pilot", { _club: c.id });
    setBusy(null);
    if (error) { toast({ title: "Pilot konnte nicht beendet werden", description: error.message, variant: "destructive" }); return; }
    toast({ title: `Pilot für ${c.name} beendet` });
    await load();
  };

  if (!clubs) return <div role="status" className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Pilotvereine bekommen bis zum Enddatum alle Funktionen (Kamera, große Turniere, KI-Kommentar, Autodarts). Danach gelten wieder
        die Trial-Grenzen. Bezahlte und dauerhaft freie Vereine bleiben unberührt.
      </p>
      {clubs.map((c) => {
        const canPilot = c.plan_tier === "trial" || c.plan_tier === "pilot";
        const expired = c.plan_tier === "pilot" && !!c.pilot_until && c.pilot_until < inDays(0);
        return (
          <Card key={c.id} className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{c.name}</p>
                <p className="text-xs text-muted-foreground">
                  {c.members} Mitglieder · {c.players} Spielerprofile · {c.active_7d} aktive Tage in 7 Tagen
                </p>
              </div>
              <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] ${c.plan_tier === "pilot" && !expired ? "border-primary text-primary" : "border-border text-muted-foreground"}`}>
                {TIER_LABEL[c.plan_tier] ?? c.plan_tier}
                {c.plan_tier === "pilot" && c.pilot_until ? ` bis ${dateLabel(c.pilot_until)}${expired ? " (abgelaufen)" : ""}` : ""}
              </span>
            </div>
            {canPilot && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <input
                  type="date"
                  min={inDays(1)}
                  max={inDays(365)}
                  value={dates[c.id] ?? c.pilot_until ?? inDays(90)}
                  onChange={(e) => setDates((prev) => ({ ...prev, [c.id]: e.target.value }))}
                  className="rounded-md border border-border bg-muted px-2 py-1 text-xs text-foreground"
                />
                <Button size="sm" disabled={busy === c.id} onClick={() => startPilot(c)}>
                  {c.plan_tier === "pilot" ? "Pilot verlängern" : "Pilot starten"}
                </Button>
                {c.plan_tier === "pilot" && (
                  <Button size="sm" variant="outline" disabled={busy === c.id} onClick={() => endPilot(c)}>Pilot beenden</Button>
                )}
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
};

export default AdminClubs;
