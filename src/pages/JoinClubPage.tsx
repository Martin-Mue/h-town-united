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
import { Send, TriangleAlert } from "lucide-react";
import { DartLoaderIcon as Loader2 } from "@/components/icons/DartIcons";
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
  const { t } = useLanguage();
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
      const msg = err instanceof Error ? err.message : t("joinClub.requestFailedGeneric");
      toast({ title: t("common.error"), description: msg, variant: "destructive" });
    } finally {
      setRequesting(false);
    }
  };

  const logoUrl = club && club !== "not_found" && club.logo_path
    ? supabase.storage.from("club-logos").getPublicUrl(club.logo_path).data.publicUrl
    : htuLogoFallback;

  return (
    <EntryPageShell>
        {loading || authLoading ? (
          <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto" />
        ) : club === "not_found" ? (
          <EntryStatusMessage
            icon={TriangleAlert}
            tone="destructive"
            title={t("joinClub.notFoundTitle")}
            description={t("common.invalidLinkGeneric")}
          />
        ) : club ? (
          <>
            <EntryHeader mark={<ClubLogoTile logoUrl={logoUrl} name={club.name} />} title={club.name} subtitle={club.tagline} />
            <EntryCard>
              {requested ? (
                <p className="text-sm">
                  {t("joinClub.requestSentMsg")}
                </p>
              ) : (
                <>
                  <p className="text-sm mb-4">{t("joinClub.prompt")}</p>
                  {user ? (
                    <EntryPrimaryButton onClick={handleRequest} disabled={requesting}>
                      {requesting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                      {t("joinClub.requestBtn")}
                    </EntryPrimaryButton>
                  ) : (
                    <div className="space-y-2">
                      <EntryPrimaryButton onClick={() => navigate("/auth", { state: { from: `/join/${clubId}` } })}>
                        {t("auth.loginTitle")}
                      </EntryPrimaryButton>
                      <p className="text-xs text-center text-muted-foreground">{t("common.noAccountRegisterHint")}</p>
                    </div>
                  )}
                </>
              )}
            </EntryCard>
          </>
        ) : null}
    </EntryPageShell>
  );
};

export default JoinClubPage;
