import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useClubBranding } from "@/contexts/ClubBrandingContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import QrCodeDialog from "@/components/QrCodeDialog";
import { Loader2, Mail, QrCode, Check, X, Ban, Copy } from "lucide-react";

interface PendingInvite {
  id: string;
  email: string;
  role: "admin" | "member";
  created_at: string;
  expires_at: string;
  token: string;
}

interface JoinRequest {
  id: string;
  user_id: string;
  email: string;
  created_at: string;
}

/** Admin.tsx "Einladungen" tab: two independent ways for someone to end up in this club --
 *  admin-issued, per-person invite links (this component sends them) and a standing "request to
 *  join" link the admin can share anywhere, with every request needing explicit approval here. */
const AdminInvites = () => {
  const { club } = useClubBranding();
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "member">("member");
  const [sending, setSending] = useState(false);
  const [invites, setInvites] = useState<PendingInvite[]>([]);
  const [requests, setRequests] = useState<JoinRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!club) return;
    const [{ data: inviteRows }, { data: requestRows }] = await Promise.all([
      supabase.from("club_invites").select("id, email, role, created_at, expires_at, token")
        .is("accepted_at", null).is("revoked_at", null).order("created_at", { ascending: false }),
      supabase.rpc("admin_list_join_requests"),
    ]);
    setInvites((inviteRows as PendingInvite[]) ?? []);
    setRequests((requestRows as JoinRequest[]) ?? []);
    setLoading(false);
  }, [club]);

  useEffect(() => { load(); }, [load]);

  const sendInvite = async () => {
    if (!club || !email.trim() || sending) return;
    setSending(true);
    const { error } = await supabase.from("club_invites").insert({
      club_id: club.id,
      email: email.trim().toLowerCase(),
      role,
      created_by: (await supabase.auth.getUser()).data.user?.id,
    });
    setSending(false);
    if (error) {
      toast({ title: "Fehler", description: error.message, variant: "destructive" });
      return;
    }
    setEmail("");
    setRole("member");
    toast({ title: "Einladung erstellt" });
    load();
  };

  const revokeInvite = async (id: string) => {
    setBusyId(id);
    const { error } = await supabase.from("club_invites").update({ revoked_at: new Date().toISOString() }).eq("id", id);
    setBusyId(null);
    if (error) {
      toast({ title: "Fehler", description: error.message, variant: "destructive" });
      return;
    }
    load();
  };

  const respond = async (id: string, approve: boolean) => {
    setBusyId(id);
    const { error } = await supabase.rpc("respond_to_join_request", { _request_id: id, _approve: approve });
    setBusyId(null);
    if (error) {
      toast({ title: "Fehler", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: approve ? "Beitritt genehmigt" : "Anfrage abgelehnt" });
    load();
  };

  if (loading) {
    return <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;
  }

  const joinLink = club ? `${window.location.origin}/join/${club.id}` : "";

  return (
    <div className="space-y-6">
      {/* Standing join-request link */}
      <div className="bg-card border border-border rounded-xl p-4">
        <h3 className="font-display text-sm uppercase text-muted-foreground mb-2">Beitritts-Link</h3>
        <p className="text-xs text-muted-foreground mb-3">
          Dieser Link kann überall geteilt werden (Website, WhatsApp-Gruppe, ...). Jede Anfrage muss hier bestätigt werden, bevor sie Zugriff bekommt.
        </p>
        <div className="flex gap-2">
          <Input readOnly value={joinLink} className="bg-background border-border text-xs font-mono" onFocus={(e) => e.target.select()} />
          <Button variant="outline" size="icon" onClick={() => { navigator.clipboard.writeText(joinLink); toast({ title: "Link kopiert" }); }}>
            <Copy className="w-4 h-4" />
          </Button>
          <QrCodeDialog url={joinLink} title="Beitritts-QR-Code" downloadName="vereins-beitritt" trigger={
            <Button variant="outline" size="icon"><QrCode className="w-4 h-4" /></Button>
          } />
        </div>
      </div>

      {/* Pending join requests */}
      <div className="bg-card border border-border rounded-xl p-4">
        <h3 className="font-display text-sm uppercase text-muted-foreground mb-3">Offene Beitrittsanfragen</h3>
        {requests.length === 0 ? (
          <p className="text-xs text-muted-foreground">Keine offenen Anfragen.</p>
        ) : (
          <div className="space-y-2">
            {requests.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="font-mono text-xs truncate">{r.email}</span>
                <div className="flex gap-1 shrink-0">
                  <Button size="sm" variant="outline" disabled={busyId === r.id} onClick={() => respond(r.id, true)} className="gap-1">
                    <Check className="w-3.5 h-3.5" /> Annehmen
                  </Button>
                  <Button size="sm" variant="outline" disabled={busyId === r.id} onClick={() => respond(r.id, false)} className="gap-1 text-muted-foreground hover:text-destructive">
                    <X className="w-3.5 h-3.5" /> Ablehnen
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Send a per-person invite */}
      <div className="bg-card border border-border rounded-xl p-4">
        <h3 className="font-display text-sm uppercase text-muted-foreground mb-3">Einladung versenden</h3>
        <div className="flex flex-col sm:flex-row gap-2">
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="email@example.com"
            className="bg-background border-border flex-1"
          />
          <Select value={role} onValueChange={(v) => setRole(v as "admin" | "member")}>
            <SelectTrigger className="w-full sm:w-[140px] bg-background border-border"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="member">Mitglied</SelectItem>
              <SelectItem value="admin">Admin</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={sendInvite} disabled={sending || !email.trim()} className="gap-1.5">
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />} Einladen
          </Button>
        </div>
      </div>

      {/* Pending invites already sent */}
      <div className="bg-card border border-border rounded-xl p-4">
        <h3 className="font-display text-sm uppercase text-muted-foreground mb-3">Offene Einladungen</h3>
        {invites.length === 0 ? (
          <p className="text-xs text-muted-foreground">Keine offenen Einladungen.</p>
        ) : (
          <div className="space-y-2">
            {invites.map((inv) => {
              const link = `${window.location.origin}/invite/${inv.token}`;
              const expired = new Date(inv.expires_at) < new Date();
              return (
                <div key={inv.id} className="flex items-center justify-between gap-2 text-sm">
                  <div className="min-w-0">
                    <p className="font-mono text-xs truncate">{inv.email} <span className="text-muted-foreground">({inv.role})</span></p>
                    {expired && <p className="text-[10px] text-destructive">Abgelaufen</p>}
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <QrCodeDialog url={link} title="Einladungs-QR-Code" downloadName="vereins-einladung" trigger={
                      <Button size="sm" variant="outline"><QrCode className="w-3.5 h-3.5" /></Button>
                    } />
                    <Button size="sm" variant="outline" disabled={busyId === inv.id} onClick={() => revokeInvite(inv.id)} className="gap-1 text-muted-foreground hover:text-destructive">
                      <Ban className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default AdminInvites;
