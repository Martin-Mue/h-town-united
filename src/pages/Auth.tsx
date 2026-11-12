import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { useClubBranding } from "@/contexts/ClubBrandingContext";
import { useLanguage } from "@/contexts/LanguageContext";
import EntryPageShell from "@/components/entry/EntryPageShell";
import EntryHeader from "@/components/entry/EntryHeader";
import EntryCard from "@/components/entry/EntryCard";
import ClubLogoTile from "@/components/entry/ClubLogoTile";
import EntryPrimaryButton from "@/components/entry/EntryPrimaryButton";
import { ENTRY_INPUT_CLASS, ENTRY_TEXT_LINK_CLASS } from "@/components/entry/entryFieldStyles";
import { Eye, EyeOff } from "lucide-react";
import { DartLoaderIcon as Loader2 } from "@/components/icons/DartIcons";
import { useNavigate, useLocation } from "react-router-dom";

const AuthPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useLanguage();
  // Set by ProtectedRoute when it redirected here — e.g. a "Spiel starten" QR link scanned while
  // logged out. Falls back to the homepage for a direct/bookmarked visit to /auth.
  const from = (location.state as { from?: string } | null)?.from;
  const { user, loading: authLoading } = useAuth();
  const { club, name: clubName, tagline, logoUrl } = useClubBranding();
  const [mode, setMode] = useState<"login" | "signup" | "reset">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  // Sichtbar sobald eine Registrierung eine Bestätigungsmail ausgelöst hat oder ein Login an
  // einer unbestätigten Adresse gescheitert ist – erlaubt erneutes Zusenden der Mail.
  const [pendingConfirm, setPendingConfirm] = useState<string | null>(null);
  const [resending, setResending] = useState(false);
  const { toast } = useToast();

  const resendConfirmation = async () => {
    if (!pendingConfirm || resending) return;
    setResending(true);
    try {
      const { error } = await supabase.auth.resend({
        type: "signup",
        email: pendingConfirm,
        options: { emailRedirectTo: `${window.location.origin}${from || ""}` },
      });
      if (error) throw error;
      toast({ title: t("auth.resendSuccessTitle"), description: `${t("auth.resendSuccessDescPrefix")} ${pendingConfirm} ${t("auth.resendSuccessDescSuffix")}` });
    } catch (err: unknown) {
      const raw = err instanceof Error ? err.message : "";
      toast({
        title: t("common.error"),
        description: /rate limit|too many|seconds/i.test(raw)
          ? t("auth.rateLimitResend")
          : raw || t("auth.resendFailedGeneric"),
        variant: "destructive",
      });
    } finally {
      setResending(false);
    }
  };


  useEffect(() => {
    if (!authLoading && user) {
      navigate(from || "/", { replace: true });
    }
  }, [authLoading, navigate, user, from]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === "signup" && password !== confirmPassword) {
      toast({ title: t("common.error"), description: t("common.passwordsDontMatch"), variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      const normalizedEmail = email.trim().toLowerCase();
      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({ email: normalizedEmail, password });
        if (error) {
          // Unbestätigte Adresse ist kein "falsches Passwort" — Hinweis + Resend anbieten.
          if (/email not confirmed|not confirmed/i.test(error.message)) setPendingConfirm(normalizedEmail);
          throw error;
        }
        setPendingConfirm(null);
        navigate(from || "/", { replace: true });
      } else if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email: normalizedEmail,
          password,
          // Redirect back to wherever signup was actually initiated from (e.g. an invite link)
          // instead of the bare origin — otherwise confirming by email always drops the new
          // member on "/" with no club yet, losing the invite they came from. Same pattern
          // resetPasswordForEmail below already uses for its own redirect target.
          options: { emailRedirectTo: `${window.location.origin}${from || ""}` },
        });
        if (error) throw error;
        // Mit aktivierter E-Mail-Bestätigung liefert signUp() keine Session zurück — der Account
        // wird erst durch den Klick im Bestätigungslink nutzbar. Nur wenn wider Erwarten doch
        // eine Session kommt (Auto-Confirm), geht es direkt weiter in die App.
        if (!data.session) {
          setPendingConfirm(normalizedEmail);
          toast({
            title: t("auth.almostDoneTitle"),
            description: `${t("auth.almostDoneDescPrefix")} ${normalizedEmail} ${t("auth.almostDoneDescSuffix")}`,
          });
          setMode("login");
          setPassword("");
          setConfirmPassword("");
          return;
        }

        toast({
          title: t("common.welcomeToClubTitle"),
          description: t("common.createProfileNowDesc"),
        });
        navigate(from || "/players?createProfile=1", { replace: true });
        return;
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(normalizedEmail, {
          redirectTo: `${window.location.origin}/reset-password`,
        });
        if (error) throw error;
        toast({
          title: t("auth.resetEmailSentTitle"),
          description: t("auth.resetEmailSentDesc"),
        });
        setMode("login");
        return;
      }
    } catch (err: unknown) {
      const raw: string = err instanceof Error ? err.message : "";
      const msg = /email not confirmed|not confirmed/i.test(raw)
        ? t("auth.errNotConfirmed")
        : raw.includes("Invalid login credentials")
        ? t("auth.errInvalidCredentials")
        : raw.includes("User already registered")
        ? t("auth.errAlreadyRegistered")
        : raw.includes("Password should be at least")
        ? t("common.passwordMinLength")
        : /rate limit|too many/i.test(raw)
        ? t("auth.errRateLimit")
        : raw || t("auth.errGeneric");
      toast({
        title: t("common.error"),
        description: msg,
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
        title={mode === "login" ? t("auth.loginTitle") : mode === "signup" ? t("auth.signupTitle") : t("auth.resetTitle")}
        subtitle={tagline}
      />

      <EntryCard>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="auth-email">{t("auth.emailLabel")}</Label>
              <Input
                id="auth-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                placeholder="email@example.com"
                className={ENTRY_INPUT_CLASS}
                required
              />
            </div>
            {mode !== "reset" && (
              <div className="space-y-1.5">
                <Label htmlFor="auth-password">{t("auth.passwordLabel")}</Label>
                <div className="relative">
                  <Input
                    id="auth-password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete={mode === "login" ? "current-password" : "new-password"}
                    placeholder="••••••••"
                    className={`${ENTRY_INPUT_CLASS} pr-12`}
                    required
                    minLength={6}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((s) => !s)}
                    className="absolute right-0 top-0 flex h-12 w-12 items-center justify-center text-muted-foreground hover:text-foreground"
                    tabIndex={-1}
                    aria-label={showPassword ? t("auth.hidePassword") : t("auth.showPassword")}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {mode === "signup" && (
                  <p className="text-xs text-muted-foreground mt-1">{t("auth.minLengthHint")}</p>
                )}
              </div>
            )}
            {mode === "signup" && (
              <div className="space-y-1.5">
                <Label htmlFor="auth-confirm-password">{t("auth.confirmPasswordLabel")}</Label>
                <Input
                  id="auth-confirm-password"
                  type={showPassword ? "text" : "password"}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                  placeholder="••••••••"
                  className={ENTRY_INPUT_CLASS}
                  required
                  minLength={6}
                />
                {confirmPassword.length > 0 && confirmPassword !== password && (
                  <p className="text-xs text-destructive mt-1">{t("auth.confirmMismatch")}</p>
                )}
              </div>
            )}
            <EntryPrimaryButton type="submit" disabled={loading}>
              {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {mode === "login" ? t("auth.loginBtn") : mode === "signup" ? t("auth.signupTitle") : t("auth.resetLinkBtn")}
            </EntryPrimaryButton>
          </form>
          {pendingConfirm && mode !== "reset" && (
            <div className="mt-4 rounded-xl border border-border bg-muted p-3 text-sm">
              <p className="text-muted-foreground">
                {t("auth.confirmSentPrefix")} <span className="text-foreground">{pendingConfirm}</span> {t("auth.confirmSentSuffix")}
              </p>
              <Button
                type="button"
                variant="outline"
                className="mt-3 h-11 w-full rounded-xl hover:shadow-none"
                onClick={resendConfirmation}
                disabled={resending}
              >
                {resending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                {t("auth.resendBtn")}
              </Button>
            </div>
          )}
          <div className="mt-3 space-y-1 text-sm text-center text-muted-foreground">
            {mode === "login" && (
              <>
                <p>
                  {t("auth.noAccountYet")}{" "}
                  <button onClick={() => setMode("signup")} className={ENTRY_TEXT_LINK_CLASS}>
                    {t("auth.signupTitle")}
                  </button>
                </p>
                <p>
                  <button onClick={() => setMode("reset")} className={ENTRY_TEXT_LINK_CLASS}>
                    {t("auth.forgotPassword")}
                  </button>
                </p>
              </>
            )}
            {mode === "signup" && (
              <p>
                {t("auth.alreadyRegistered")}{" "}
                <button onClick={() => setMode("login")} className={ENTRY_TEXT_LINK_CLASS}>
                  {t("auth.loginTitle")}
                </button>
              </p>
            )}
            {mode === "reset" && (
              <p>
                <button onClick={() => setMode("login")} className={ENTRY_TEXT_LINK_CLASS}>
                  {t("auth.backToLogin")}
                </button>
              </p>
            )}
          </div>
      </EntryCard>
    </EntryPageShell>
  );
};

export default AuthPage;
