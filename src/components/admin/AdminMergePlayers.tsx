import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Merge } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Eyebrow, SectionCard } from "@/components/stats/StatPrimitives";
import { usePlayers, PLAYERS_QUERY_KEY } from "@/hooks/usePlayers";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

/**
 * Admin → Mitglieder: merges a profile that was created twice (another spelling in one tournament, a walk-in who later
 * got an account profile) into the one to keep. Games, legs, clips, league fixtures and tournaments move over, the
 * statistics of the kept profile are recomputed, the other profile is deleted. The profile with an account has to be
 * the one that stays (the database refuses otherwise).
 */
const AdminMergePlayers = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: players = [] } = usePlayers();
  const [keepId, setKeepId] = useState("");
  const [removeId, setRemoveId] = useState("");
  const [busy, setBusy] = useState(false);
  const keep = players.find((p) => p.id === keepId);
  const remove = players.find((p) => p.id === removeId);
  const removeHasAccount = !!remove?.user_id && remove.user_id !== keep?.user_id;
  const ready = !!keep && !!remove && keep.id !== remove.id && !removeHasAccount;
  const sorted = [...players].sort((a, b) => a.name.localeCompare(b.name));

  const merge = async () => {
    if (!ready) return;
    setBusy(true);
    const { data, error } = await supabase.rpc("merge_players", { p_keep: keep.id, p_remove: remove.id });
    setBusy(false);
    if (error) {
      toast({ title: "Zusammenführen fehlgeschlagen", description: error.message, variant: "destructive" });
      return;
    }
    const legs = (data as { legs_moved?: number } | null)?.legs_moved ?? 0;
    toast({ title: `„${remove.name}“ in „${keep.name}“ zusammengeführt`, description: `${legs} Legs übernommen.` });
    setKeepId("");
    setRemoveId("");
    await queryClient.invalidateQueries({ queryKey: PLAYERS_QUERY_KEY });
  };

  return (
    <SectionCard className="mt-6 space-y-3">
      <Eyebrow icon={Merge}>Spieler zusammenführen</Eyebrow>
      <p className="text-xs text-muted-foreground">
        Für ein doppelt angelegtes Profil: Alle Spiele, Legs, Turniere und Highlights des zweiten Profils wandern zum ersten, dessen Statistik wird neu berechnet, danach wird das zweite gelöscht. Das lässt sich nicht rückgängig machen.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-sm text-muted-foreground">Behalten (mit Konto)</label>
          <Select value={keepId} onValueChange={setKeepId}>
            <SelectTrigger className="bg-muted border-border"><SelectValue placeholder="Profil wählen" /></SelectTrigger>
            <SelectContent className="bg-card border-border">
              {sorted.map((p) => <SelectItem key={p.id} value={p.id}>{p.emoji} {p.name}{p.user_id ? " · Konto" : ""}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="mb-1 block text-sm text-muted-foreground">Entfernen (wird eingemischt)</label>
          <Select value={removeId} onValueChange={setRemoveId}>
            <SelectTrigger className="bg-muted border-border"><SelectValue placeholder="Profil wählen" /></SelectTrigger>
            <SelectContent className="bg-card border-border">
              {sorted.filter((p) => p.id !== keepId).map((p) => <SelectItem key={p.id} value={p.id}>{p.emoji} {p.name}{p.user_id ? " · Konto" : ""}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>
      {removeHasAccount && <p className="text-xs text-destructive">Das Profil zum Entfernen gehört zu einem Konto. Tausche die Auswahl: das Profil mit Konto bleibt.</p>}
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button disabled={!ready || busy} className="gap-1.5"><Merge className="h-4 w-4" /> Zusammenführen</Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>„{remove?.name}“ in „{keep?.name}“ zusammenführen?</AlertDialogTitle>
            <AlertDialogDescription>
              „{remove?.name}“ wird gelöscht, seine Spiele und Turniere gehören danach zu „{keep?.name}“. Das kann nicht rückgängig gemacht werden.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction onClick={merge}>Zusammenführen</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SectionCard>
  );
};

export default AdminMergePlayers;
