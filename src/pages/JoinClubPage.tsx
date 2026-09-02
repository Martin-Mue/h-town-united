import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Send, TriangleAlert } from "lucide-react";
import htuLogoFallback from "@/assets/htu-logo.jpg";

interface ClubPreview {
  id: string;
  name: string;
  tagline: string | null;
  logo_path: string | null;
}

/** Public landing page for a club's standing "request to join" link (/join/:clubId) -- the
 *  second, joiner-initiated path alongside admin-issued invites (see InvitePage.tsx). Unlike an
 *  invite, this link isn't per-person or single-use: the same link works for anyone the club
 *  shares it with, and every submission needs the admin's explicit approval (see AdminInvites.tsx)
 *  before it grants anything. */
const JoinClubPage = () => {
  const { clubId } = useParams<{ clubId: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user, loading: authLoading } = useAuth();
  const [club, setClub] = useState<ClubPreview | null | "not_found">(null);
  const [loading, setLoading] = useState(true);
  const [requesting, setRequesting] = useState(false);
  const [requested, setRequested] = useState(false);

  useEffect(() => {
    if (!clubId) return;
    supabase.from("clubs_public").select("id, name, tagline, logo_path").eq("id", clubId).maybeSingle().then(({ data }) => {
      setClub(data ?? "not_found");
      setLoading(false);
    });
  }, [clubId]);

  const handleRequest = async () => {
    if (!clubId || requesting) return;
    setRequesting(true);
    try {
      const { error } = await supabase.rpc("request_to_join_club", { _club_id: clubId });
      if (error) throw error;
      setRequested(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Anfrage konnte nicht gesendet werden.";
      toast({ title: "Fehler", description: msg, variant: "destructive" });
    } finally {
      setRequesting(false);
    }
  };

  const logoUrl = club && club !== "not_found" && club.logo_path
    ? supabase.storage.from("club-logos").getPublicUrl(club.logo_path).data.publicUrl
    : htuLogoFallback;

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-sm text-center">
        {loading || authLoading ? (
          <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto" />
        ) : club === "not_found" ? (
          <div className="bg-card border border-border rounded-2xl p-6">
            <TriangleAlert className="w-8 h-8 text-destructive mx-auto mb-3" />
            <h1 className="text-lg font-display uppercase mb-1">Verein nicht gefunden</h1>
            <p className="text-sm text-muted-foreground">Dieser Link ist ungültig.</p>
          </div>
        ) : club ? (
          <>
            <div className="gradient-hero rounded-2xl p-6 pt-8 mb-4 border border-border relative overflow-hidden">
              <div aria-hidden className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,hsl(var(--primary)/0.12),transparent_65%)]" />
              <div className="relative">
                <img src={logoUrl} alt={club.name} className="w-16 h-16 rounded-xl object-cover border border-primary/30 mx-auto mb-4 glow-cyan" />
                <h1 className="text-2xl font-display uppercase">{club.name}</h1>
                {club.tagline && <p className="text-sm text-muted-foreground mt-1">{club.tagline}</p>}
              </div>
            </div>
            <div className="bg-card border border-border rounded-2xl p-6">
              {requested ? (
                <p className="text-sm">
                  Deine Anfrage wurde gesendet. Ein Admin des Vereins muss sie noch bestätigen — das kann etwas dauern.
                </p>
              ) : (
                <>
                  <p className="text-sm mb-4">Beantrage hier die Mitgliedschaft in diesem Verein.</p>
                  {user ? (
                    <Button className="w-full gap-2" onClick={handleRequest} disabled={requesting}>
                      {requesting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                      Beitritt beantragen
                    </Button>
                  ) : (
                    <div className="space-y-2">
                      <Button className="w-full" onClick={() => navigate("/auth", { state: { from: `/join/${clubId}` } })}>
                        Anmelden
                      </Button>
                      <p className="text-xs text-muted-foreground">Noch kein Konto? Auf der Anmeldeseite registrieren.</p>
                    </div>
                  )}
                </>
              )}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
};

export default JoinClubPage;
