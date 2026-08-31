import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Loader2, PartyPopper, TriangleAlert } from "lucide-react";
import htuLogoFallback from "@/assets/htu-logo.jpg";

interface InvitePreview {
  club_name: string;
  tagline: string | null;
  logo_path: string | null;
  expired: boolean;
  already_accepted: boolean;
}

/** Public landing page for an admin-issued invite link (/invite/:token) -- reachable with no
 *  session, same shape as PublicTournament's /live/:slug. Resolves the TARGET club (whoever
 *  issued the invite), not the visitor's own -- this is the one place in the app that
 *  deliberately does NOT use the shared ClubBrandingContext, since there is no "current club"
 *  for an anonymous or not-yet-a-member visitor. */
const InvitePage = () => {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user, loading: authLoading } = useAuth();
  const [preview, setPreview] = useState<InvitePreview | null | "not_found">(null);
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);

  useEffect(() => {
    if (!token) return;
    supabase.rpc("get_invite_preview", { _token: token }).then(({ data, error }) => {
      if (error || !data) {
        setPreview("not_found");
      } else {
        setPreview(data as unknown as InvitePreview);
      }
      setLoading(false);
    });
  }, [token]);

  const handleAccept = async () => {
    if (!token || accepting) return;
    setAccepting(true);
    try {
      const { error } = await supabase.rpc("accept_club_invite", { _token: token });
      if (error) throw error;
      toast({ title: "Willkommen im Verein! 🎯", description: "Lege jetzt dein Spielerprofil an." });
      navigate("/players?createProfile=1", { replace: true });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Einladung konnte nicht angenommen werden.";
      toast({ title: "Fehler", description: msg, variant: "destructive" });
    } finally {
      setAccepting(false);
    }
  };

  const logoUrl = preview && preview !== "not_found" && preview.logo_path
    ? supabase.storage.from("club-logos").getPublicUrl(preview.logo_path).data.publicUrl
    : htuLogoFallback;

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-sm text-center">
        {loading || authLoading ? (
          <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto" />
        ) : preview === "not_found" ? (
          <div className="bg-card border border-border rounded-xl p-6">
            <TriangleAlert className="w-8 h-8 text-destructive mx-auto mb-3" />
            <h1 className="text-lg font-display uppercase mb-1">Einladung nicht gefunden</h1>
            <p className="text-sm text-muted-foreground">Dieser Link ist ungültig.</p>
          </div>
        ) : preview?.expired ? (
          <div className="bg-card border border-border rounded-xl p-6">
            <TriangleAlert className="w-8 h-8 text-destructive mx-auto mb-3" />
            <h1 className="text-lg font-display uppercase mb-1">Einladung abgelaufen</h1>
            <p className="text-sm text-muted-foreground">Bitte frag den Verein nach einem neuen Link.</p>
          </div>
        ) : preview?.already_accepted ? (
          <div className="bg-card border border-border rounded-xl p-6">
            <PartyPopper className="w-8 h-8 text-accent mx-auto mb-3" />
            <h1 className="text-lg font-display uppercase mb-1">Einladung bereits verwendet</h1>
            <p className="text-sm text-muted-foreground mb-4">
              Diese Einladung wurde schon angenommen. Falls das nicht du warst, melde dich einfach an.
            </p>
            <Button onClick={() => navigate("/auth")}>Zur Anmeldung</Button>
          </div>
        ) : preview ? (
          <>
            <img src={logoUrl} alt={preview.club_name} className="w-16 h-16 rounded-xl object-cover border border-primary/30 mx-auto mb-4 glow-cyan" />
            <h1 className="text-2xl font-display uppercase">{preview.club_name}</h1>
            {preview.tagline && <p className="text-sm text-muted-foreground mt-1">{preview.tagline}</p>}
            <div className="bg-card border border-border rounded-xl p-6 mt-6">
              <p className="text-sm mb-4">Du wurdest eingeladen, diesem Verein beizutreten.</p>
              {user ? (
                <Button className="w-full" onClick={handleAccept} disabled={accepting}>
                  {accepting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  Einladung annehmen
                </Button>
              ) : (
                <div className="space-y-2">
                  <Button className="w-full" onClick={() => navigate("/auth", { state: { from: `/invite/${token}` } })}>
                    Anmelden
                  </Button>
                  <p className="text-xs text-muted-foreground">Noch kein Konto? Auf der Anmeldeseite registrieren.</p>
                </div>
              )}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
};

export default InvitePage;
