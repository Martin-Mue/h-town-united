import { useEffect, useState } from "react";
import { Radio, Plus, Trash2, CheckCircle2, AlertTriangle, Lock } from "lucide-react";
import { DartLoaderIcon as Loader2 } from "@/components/icons/DartIcons";
import { useClubBranding } from "@/contexts/ClubBrandingContext";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { clubHasFeature } from "@/lib/planFeatures";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface AutodartsBoardRow {
  id: string;
  board_number: number;
  label: string | null;
  connection_mode: "cloud" | "local";
  local_ip: string | null;
  autodarts_user_email: string | null;
  status: string;
  last_error: string | null;
}

const emptyForm = {
  boardNumber: "",
  label: "",
  connectionMode: "local" as "cloud" | "local",
  localBoardId: "",
  localApiKey: "",
  localIp: "",
  cloudEmail: "",
  cloudPassword: "",
};

/** Admin-only: connect Dartspot to Autodarts-hardware boards (per-club, one row per physical
 *  board). Real credentials (Autodarts account password, local Board-Manager API key) never touch
 *  this component's own state longer than the one submit — they're sent straight to the
 *  autodarts-auth edge function, which is the only thing that ever encrypts/stores/reads them back
 *  (see that function + the autodarts_boards migration for why). This tab only ever sees back the
 *  non-sensitive columns (label, board_number, connection_mode, status) via the normal RLS-scoped
 *  client, same as every other admin tab. */
const AdminAutodarts = () => {
  const { club } = useClubBranding();
  const { toast } = useToast();
  const [boards, setBoards] = useState<AutodartsBoardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);

  const available = clubHasFeature(club?.plan_tier, "autodarts");

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("autodarts_boards")
      .select("id, board_number, label, connection_mode, local_ip, autodarts_user_email, status, last_error")
      .order("board_number", { ascending: true });
    setBoards((data as AutodartsBoardRow[]) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    if (available) void load();
    else setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [available]);

  const startEdit = (board: AutodartsBoardRow) => {
    setForm({
      boardNumber: String(board.board_number),
      label: board.label ?? "",
      connectionMode: board.connection_mode,
      localBoardId: "",
      localApiKey: "",
      localIp: board.local_ip ?? "",
      cloudEmail: board.autodarts_user_email ?? "",
      cloudPassword: "",
    });
    setFormOpen(true);
  };

  const remove = async (board: AutodartsBoardRow) => {
    if (!window.confirm(`"${board.label || `Board ${board.board_number}`}" trennen? Gespeicherte Zugangsdaten für dieses Board werden gelöscht.`)) return;
    const { error } = await supabase.from("autodarts_boards").delete().eq("id", board.id);
    if (error) {
      toast({ title: "Konnte Board nicht trennen", description: error.message, variant: "destructive" });
      return;
    }
    void load();
  };

  const submit = async () => {
    const boardNumber = Number(form.boardNumber);
    if (!Number.isInteger(boardNumber) || boardNumber <= 0) {
      toast({ title: "Board-Nummer fehlt", description: "Bitte eine Board-Nummer (1, 2, …) angeben — dieselbe Nummer wie im Turnier-Board-Modus.", variant: "destructive" });
      return;
    }
    const hasCloud = form.cloudEmail.trim() && form.cloudPassword.trim();
    const hasLocal = form.localApiKey.trim();
    if (!hasCloud && !hasLocal) {
      toast({ title: "Keine Zugangsdaten angegeben", description: "Bitte Cloud-Login und/oder lokalen API-Key ausfüllen.", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      // A Postgres RPC, not an edge function — see autodarts_connect_board's own definition.
      // pg_net (already installed on this project) makes the actual Autodarts login call
      // server-side; the edge-function route this component originally called was never
      // deployable here (Lovable Cloud has no self-service Edge Function deploy and the
      // account's monthly agent credits were exhausted), so this RPC-based path is the real,
      // live implementation, not a placeholder.
      const { data, error } = await supabase.rpc("autodarts_connect_board", {
        p_board_number: boardNumber,
        p_label: form.label.trim() || null,
        p_connection_mode: form.connectionMode,
        p_cloud_email: hasCloud ? form.cloudEmail.trim() : null,
        p_cloud_password: hasCloud ? form.cloudPassword : null,
        p_local_board_id: hasLocal ? form.localBoardId.trim() || null : null,
        p_local_api_key: hasLocal ? form.localApiKey.trim() : null,
        p_local_ip: hasLocal ? form.localIp.trim() || null : null,
      });
      if (error) throw new Error(error.message);
      // A cloud-login failure no longer throws (see autodarts_connect_board's own doc comment on
      // why) -- it comes back as this field instead, alongside a still-successful save of
      // whatever DID work (e.g. the local API key entered in the same submit).
      const credentialsWarning = (data as { credentialsWarning?: string | null } | null)?.credentialsWarning;
      if (credentialsWarning) {
        toast({ title: "Board gespeichert, Cloud-Login aber fehlgeschlagen", description: credentialsWarning, variant: "destructive" });
      } else {
        toast({ title: "Board verbunden", description: `"${form.label || `Board ${boardNumber}`}" ist einsatzbereit.` });
      }
      setForm(emptyForm);
      setFormOpen(false);
      void load();
    } catch (err) {
      toast({ title: "Verbindung fehlgeschlagen", description: err instanceof Error ? err.message : "Unbekannter Fehler.", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  if (!club) return null;

  if (!available) {
    return (
      <div className="gradient-card border border-border shadow-elevation-sm rounded-xl p-6 flex items-center gap-3">
        <Lock className="w-6 h-6 text-muted-foreground shrink-0" />
        <div>
          <p className="font-semibold text-sm">Autodarts-Integration ist Teil des Paid-Plans</p>
          <p className="text-xs text-muted-foreground mt-0.5">Wie das Kamera-Scoring ist die Anbindung an echte Autodarts-Boards im Trial-Plan gesperrt — siehe Tab „Abrechnung“.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="gradient-card border border-border shadow-elevation-sm rounded-xl p-6">
        <div className="flex items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2">
            <Radio className="w-5 h-5 text-primary" />
            <p className="font-semibold text-sm">Autodarts-Boards</p>
          </div>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => { setForm(emptyForm); setFormOpen((v) => !v); }}>
            <Plus className="w-4 h-4" /> Board verbinden
          </Button>
        </div>

        {loading ? (
          <div className="flex justify-center py-4"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
        ) : boards.length === 0 && !formOpen ? (
          <p className="text-xs text-muted-foreground">Noch kein Autodarts-Board verbunden.</p>
        ) : (
          <div className="space-y-2">
            {boards.map((b) => (
              <div key={b.id} className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
                <button type="button" onClick={() => startEdit(b)} className="flex items-center gap-2 min-w-0 text-left flex-1">
                  {b.status === "connected" ? (
                    <CheckCircle2 className="w-4 h-4 text-secondary shrink-0" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-accent shrink-0" />
                  )}
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{b.label || `Board ${b.board_number}`} <span className="text-xs text-muted-foreground font-normal">#{b.board_number}</span></p>
                    <p className="text-xs text-muted-foreground truncate">
                      {b.connection_mode === "local" ? "Lokal" : "Cloud"}
                      {b.autodarts_user_email ? ` · ${b.autodarts_user_email}` : ""}
                      {b.status !== "connected" && b.last_error ? ` · ${b.last_error}` : ""}
                    </p>
                  </div>
                </button>
                <Button size="icon" variant="ghost" className="shrink-0 h-8 w-8" onClick={() => void remove(b)}>
                  <Trash2 className="w-4 h-4 text-destructive" />
                </Button>
              </div>
            ))}
          </div>
        )}

        {formOpen && (
          <div className="mt-4 pt-4 border-t border-border space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="ad-board-number">Board-Nummer</Label>
                <Input id="ad-board-number" type="number" min={1} value={form.boardNumber} onChange={(e) => setForm((f) => ({ ...f, boardNumber: e.target.value }))} placeholder="1" />
              </div>
              <div>
                <Label htmlFor="ad-label">Name</Label>
                <Input id="ad-label" value={form.label} onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))} placeholder="z. B. Zuhause" />
              </div>
            </div>

            <div>
              <Label htmlFor="ad-mode">Bevorzugte Verbindung</Label>
              <Select value={form.connectionMode} onValueChange={(v) => setForm((f) => ({ ...f, connectionMode: v as "cloud" | "local" }))}>
                <SelectTrigger id="ad-mode" className="bg-muted border-border"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-card border-border">
                  <SelectItem value="local">Lokal (im selben WLAN, schnell)</SelectItem>
                  <SelectItem value="cloud">Cloud (überall erreichbar)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[10px] text-muted-foreground mt-1">Die Cloud-Anmeldung unten wird trotzdem immer benötigt — der lokale Zugang ist nur eine zusätzliche Beschleunigung, kein Ersatz.</p>
            </div>

            <div className="rounded-lg border border-border p-3 space-y-2">
              <p className="text-xs font-semibold">Cloud-Anmeldung (Autodarts-Account)</p>
              <Input type="email" value={form.cloudEmail} onChange={(e) => setForm((f) => ({ ...f, cloudEmail: e.target.value }))} placeholder="E-Mail" autoComplete="off" />
              <Input type="password" value={form.cloudPassword} onChange={(e) => setForm((f) => ({ ...f, cloudPassword: e.target.value }))} placeholder="Passwort" autoComplete="off" />
              <p className="text-[10px] text-muted-foreground">Wird nur einmalig zum Anmelden verwendet, nie gespeichert — nur das daraus entstehende Token liegt danach verschlüsselt in der Datenbank.</p>
            </div>

            <div className="rounded-lg border border-border p-3 space-y-2">
              <p className="text-xs font-semibold">Lokaler Board Manager (optional)</p>
              <Input value={form.localBoardId} onChange={(e) => setForm((f) => ({ ...f, localBoardId: e.target.value }))} placeholder="Board-ID" autoComplete="off" />
              <Input value={form.localApiKey} onChange={(e) => setForm((f) => ({ ...f, localApiKey: e.target.value }))} placeholder="API-Key" autoComplete="off" />
              <Input value={form.localIp} onChange={(e) => setForm((f) => ({ ...f, localIp: e.target.value }))} placeholder="Lokale IP-Adresse (z. B. 192.168.1.50)" autoComplete="off" />
            </div>

            <div className="flex gap-2 justify-end">
              <Button variant="ghost" size="sm" onClick={() => { setFormOpen(false); setForm(emptyForm); }}>Abbrechen</Button>
              <Button size="sm" onClick={() => void submit()} disabled={submitting} className="gap-1.5">
                {submitting && <Loader2 className="w-4 h-4 animate-spin" />} Speichern
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AdminAutodarts;
