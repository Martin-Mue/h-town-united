import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useClubBranding } from "@/contexts/ClubBrandingContext";
import { useLanguage } from "@/contexts/LanguageContext";
import EntryPageShell from "@/components/entry/EntryPageShell";
import EntryHeader from "@/components/entry/EntryHeader";
import EntryCard from "@/components/entry/EntryCard";
import ClubLogoTile from "@/components/entry/ClubLogoTile";
import EntryPrimaryButton from "@/components/entry/EntryPrimaryButton";
import { ENTRY_INPUT_CLASS } from "@/components/entry/entryFieldStyles";
import { Eye, EyeOff } from "lucide-react";
import { DartLoaderIcon as Loader2 } from "@/components/icons/DartIcons";
import { useNavigate } from "react-router-dom";

const ResetPassword = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { t } = useLanguage();
  const { club, name: clubName, tagline, logoUrl } = useClubBranding();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // An expired or already-used recovery link redirects here with
  // #error=access_denied&error_code=otp_expired&error_description=... in the hash instead of a
  // real session — previously never checked, so the form showed as fully live regardless, and the
  // only sign anything was wrong was a generic "Auth session missing" error on submit with no
  // explanation and no offer to request a fresh link.
  const [linkExpired, setLinkExpired] = useState(false);

  useEffect(() => {
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    if (hashParams.get("error")) {
      setLinkExpired(true);
      setReady(true);
      return;
    }
    // Supabase recovery link drops tokens in the URL hash and triggers a
    // PASSWORD_RECOVERY event. We wait for a session to be available.
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" || session) setReady(true);
    });
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setReady(true);
      else {
        // Fallback: still allow showing the form; updateUser will fail clearly if no session.
        setTimeout(() => setReady(true), 1500);
      }
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 6) {
      setError(t("common.passwordMinLength"));
      return;
    }
    if (password !== confirm) {
      setError(t("common.passwordsDontMatch"));
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      toast({ title: t("resetPassword.updatedTitle"), description: t("resetPassword.updatedDesc") });
      await supabase.auth.signOut();
      navigate("/auth", { replace: true });
    } catch (err: unknown) {
      toast({
        title: t("common.error"),
        description: err instanceof Error ? err.message : t("resetPassword.updateFailedGeneric"),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <EntryPageShell>
      <EntryHeader
        mark={<ClubLogoTile logoUrl={club?.logo_path ? logoUrl : null} name={clubName} />}
        eyebrow={clubName}
        title={t("resetPassword.title")}
        subtitle={tagline}
      />
      <EntryCard>
          {!ready ? (
            <div role="status" aria-label={t("common.loading")} className="flex items-center justify-center py-8">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
          ) : linkExpired ? (
            <div className="space-y-4 text-center">
              <p className="text-sm text-muted-foreground">
                {t("resetPassword.linkExpiredMsg")}
              </p>
              <EntryPrimaryButton onClick={() => navigate("/auth")}>{t("common.goToLoginBtn")}</EntryPrimaryButton>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="reset-password">{t("resetPassword.title")}</Label>
                <div className="relative">
                  <Input
                    id="reset-password"
                    type={show ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="new-password"
                    placeholder="••••••••"
                    className={`${ENTRY_INPUT_CLASS} pr-12`}
                    required
                    minLength={6}
                  />
                  <button
                    type="button"
                    onClick={() => setShow((s) => !s)}
                    className="absolute right-0 top-0 flex h-12 w-12 items-center justify-center text-muted-foreground hover:text-foreground"
                    tabIndex={-1}
                    aria-label={show ? t("auth.hidePassword") : t("auth.showPassword")}
                  >
                    {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="reset-password-repeat">{t("resetPassword.repeatPasswordLabel")}</Label>
                <Input
                  id="reset-password-repeat"
                  type={show ? "text" : "password"}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  autoComplete="new-password"
                  placeholder="••••••••"
                  className={ENTRY_INPUT_CLASS}
                  required
                  minLength={6}
                />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <EntryPrimaryButton type="submit" disabled={loading}>
                {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                {t("resetPassword.saveBtn")}
              </EntryPrimaryButton>
              <button
                type="button"
                onClick={() => navigate("/auth")}
                className="w-full min-h-11 text-sm text-muted-foreground hover:text-foreground"
              >
                {t("common.cancel")}
              </button>
            </form>
          )}
      </EntryCard>
    </EntryPageShell>
  );
};

export default ResetPassword;