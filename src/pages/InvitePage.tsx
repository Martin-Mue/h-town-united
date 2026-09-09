import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import ClubCrest from "@/components/ClubCrest";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { useToast } from "@/hooks/use-toast";
import { PartyPopper, TriangleAlert } from "lucide-react";
import { DartLoaderIcon as Loader2 } from "@/components/icons/DartIcons";
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
  const { t } = useLanguage();
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
      toast({ title: t("common.welcomeToClubTitle"), description: t("common.createProfileNowDesc") });
      navigate("/players?createProfile=1", { replace: true });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t("invite.acceptFailedGeneric");
      toast({ title: t("common.error"), description: msg, variant: "destructive" });
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
          <div className="gradient-card border border-border shadow-elevation-sm rounded-2xl p-6">
            <TriangleAlert className="w-8 h-8 text-destructive mx-auto mb-3" />
            <h1 className="text-lg font-display uppercase mb-1">{t("invite.notFoundTitle")}</h1>
            <p className="text-sm text-muted-foreground">{t("common.invalidLinkGeneric")}</p>
          </div>
        ) : preview?.expired ? (
          <div className="gradient-card border border-border shadow-elevation-sm rounded-2xl p-6">
            <TriangleAlert className="w-8 h-8 text-destructive mx-auto mb-3" />
            <h1 className="text-lg font-display uppercase mb-1">{t("invite.expiredTitle")}</h1>
            <p className="text-sm text-muted-foreground">{t("invite.expiredDesc")}</p>
          </div>
        ) : preview?.already_accepted ? (
          <div className="gradient-card border border-border shadow-elevation-sm rounded-2xl p-6">
            <PartyPopper className="w-8 h-8 text-accent mx-auto mb-3" />
            <h1 className="text-lg font-display uppercase mb-1">{t("invite.alreadyAcceptedTitle")}</h1>
            <p className="text-sm text-muted-foreground mb-4">
              {t("invite.alreadyAcceptedDesc")}
            </p>
            <Button onClick={() => navigate("/auth")}>{t("common.goToLoginBtn")}</Button>
          </div>
        ) : preview ? (
          <>
            <div className="gradient-hero rounded-2xl p-6 pt-8 mb-4 border border-border relative overflow-hidden">
              <div aria-hidden className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,hsl(var(--primary)/0.12),transparent_65%)]" />
              <div className="relative">
                <ClubCrest logoUrl={logoUrl} alt={preview.club_name} initial={preview.club_name.charAt(0).toUpperCase()} />
                <h1 className="text-2xl font-display uppercase">{preview.club_name}</h1>
                {preview.tagline && <p className="text-sm text-muted-foreground mt-1">{preview.tagline}</p>}
              </div>
            </div>
            <div className="gradient-card border border-border shadow-elevation-sm rounded-2xl p-6">
              <p className="text-sm mb-4">{t("invite.prompt")}</p>
              {user ? (
                <Button className="w-full" onClick={handleAccept} disabled={accepting}>
                  {accepting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  {t("invite.acceptBtn")}
                </Button>
              ) : (
                <div className="space-y-2">
                  <Button className="w-full" onClick={() => navigate("/auth", { state: { from: `/invite/${token}` } })}>
                    {t("auth.loginTitle")}
                  </Button>
                  <p className="text-xs text-muted-foreground">{t("common.noAccountRegisterHint")}</p>
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
