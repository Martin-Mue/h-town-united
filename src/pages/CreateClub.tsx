import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { useClubBranding } from "@/contexts/ClubBrandingContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { Trophy } from "lucide-react";
import EntryPageShell from "@/components/entry/EntryPageShell";
import EntryHeader from "@/components/entry/EntryHeader";
import EntryCard from "@/components/entry/EntryCard";
import EntryIconTile from "@/components/entry/EntryIconTile";
import EntryPrimaryButton from "@/components/entry/EntryPrimaryButton";
import { ENTRY_INPUT_CLASS } from "@/components/entry/entryFieldStyles";
import { DartLoaderIcon as Loader2 } from "@/components/icons/DartIcons";

/** Reached by any authenticated account with no club membership yet -- see RequireClub in
 *  App.tsx. Creates a brand-new club (via the create_club RPC, which also makes this account
 *  its first admin) rather than joining an existing one; joining happens exclusively through an
 *  admin-issued invite link (see InvitePage), not from here. */
const CreateClub = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { t } = useLanguage();
  const { signOut } = useAuth();
  const { club, refetch } = useClubBranding();
  const [name, setName] = useState("");
  const [tagline, setTagline] = useState("");
  const [saving, setSaving] = useState(false);

  // Safety net for RequireClub's redirect: if this account actually does have a club -- an
  // out-of-order fetch that has since self-corrected, or a stale membership snapshot catching up
  // -- bounce back the moment ClubBrandingContext confirms it, instead of leaving an existing
  // member stranded on the "create a club" form.
  useEffect(() => {
    if (club) navigate("/", { replace: true });
  }, [club, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || saving) return;
    setSaving(true);
    try {
      const { error } = await supabase.rpc("create_club", {
        _name: name.trim(),
        _tagline: tagline.trim() || null,
      });
      if (error) throw error;
      await refetch();
      toast({ title: t("createClub.createdTitle"), description: t("common.createProfileNowDesc") });
      navigate("/players?createProfile=1", { replace: true });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t("createClub.createFailedGeneric");
      toast({ title: t("common.error"), description: msg, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <EntryPageShell>
      <EntryHeader
        mark={<EntryIconTile icon={Trophy} />}
        title={t("createClub.title")}
        subtitle={t("createClub.description")}
      />

      <EntryCard>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="create-club-name">{t("createClub.nameLabel")}</Label>
              <Input
                id="create-club-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("createClub.namePlaceholder")}
                className={ENTRY_INPUT_CLASS}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="create-club-tagline">{t("createClub.taglineLabel")}</Label>
              <Input
                id="create-club-tagline"
                value={tagline}
                onChange={(e) => setTagline(e.target.value)}
                placeholder={t("createClub.taglinePlaceholder")}
                className={ENTRY_INPUT_CLASS}
              />
            </div>
            <EntryPrimaryButton type="submit" disabled={saving || !name.trim()}>
              {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {t("createClub.title")}
            </EntryPrimaryButton>
          </form>
          <div className="mt-3 text-center">
            <button onClick={() => signOut()} className="min-h-11 px-2 text-sm text-muted-foreground hover:text-foreground hover:underline">
              {t("header.signOut")}
            </button>
          </div>
      </EntryCard>
    </EntryPageShell>
  );
};

export default CreateClub;
