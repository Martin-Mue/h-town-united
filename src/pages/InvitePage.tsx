import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import EntryPageShell from "@/components/entry/EntryPageShell";
import EntryHeader from "@/components/entry/EntryHeader";
import EntryCard from "@/components/entry/EntryCard";
import ClubLogoTile from "@/components/entry/ClubLogoTile";
import EntryPrimaryButton from "@/components/entry/EntryPrimaryButton";
import EntryStatusMessage from "@/components/entry/EntryStatusMessage";
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
    <EntryPageShell>
        {loading || authLoading ? (
          <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto" />
        ) : preview === "not_found" ? (
          <EntryStatusMessage
            icon={TriangleAlert}
            tone="destructive"
            title={t("invite.notFoundTitle")}
            description={t("common.invalidLinkGeneric")}
          />
        ) : preview?.expired ? (
          <EntryStatusMessage
            icon={TriangleAlert}
            tone="destructive"
            title={t("invite.expiredTitle")}
            description={t("invite.expiredDesc")}
          />
        ) : preview?.already_accepted ? (
          <EntryStatusMessage
            icon={PartyPopper}
            title={t("invite.alreadyAcceptedTitle")}
            description={t("invite.alreadyAcceptedDesc")}
            action={<EntryPrimaryButton onClick={() => navigate("/auth")}>{t("common.goToLoginBtn")}</EntryPrimaryButton>}
          />
        ) : preview ? (
          <>
            <EntryHeader
              mark={<ClubLogoTile logoUrl={logoUrl} name={preview.club_name} />}
              title={preview.club_name}
              subtitle={preview.tagline}
            />
            <EntryCard>
              <p className="text-sm mb-4">{t("invite.prompt")}</p>
              {user ? (
                <EntryPrimaryButton onClick={handleAccept} disabled={accepting}>
                  {accepting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  {t("invite.acceptBtn")}
                </EntryPrimaryButton>
              ) : (
                <div className="space-y-2">
                  <EntryPrimaryButton onClick={() => navigate("/auth", { state: { from: `/invite/${token}` } })}>
                    {t("auth.loginTitle")}
                  </EntryPrimaryButton>
                  <p className="text-xs text-center text-muted-foreground">{t("common.noAccountRegisterHint")}</p>
                </div>
              )}
            </EntryCard>
          </>
        ) : null}
    </EntryPageShell>
  );
};

export default InvitePage;
