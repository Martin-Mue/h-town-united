import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { useClubBranding } from "@/contexts/ClubBrandingContext";
import { Loader2, Eye, EyeOff } from "lucide-react";
import { useNavigate, useLocation } from "react-router-dom";

const AuthPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  // Set by ProtectedRoute when it redirected here — e.g. a "Spiel starten" QR link scanned while
  // logged out. Falls back to the homepage for a direct/bookmarked visit to /auth.
  const from = (location.state as { from?: string } | null)?.from;
  const { user, loading: authLoading } = useAuth();
  const { club, name: clubName, logoUrl } = useClubBranding();
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
      toast({ title: "E-Mail erneut versendet", description: `Wir haben den Bestätigungslink noch einmal an ${pendingConfirm} geschickt.` });
    } catch (err: unknown) {
      const raw = err instanceof Error ? err.message : "";
      toast({
        title: "Fehler",
        description: /rate limit|too many|seconds/i.test(raw)
          ? "Bitte kurz warten, bevor du eine neue Mail anforderst."
          : raw || "E-Mail konnte nicht erneut versendet werden.",
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
      toast({ title: "Fehler", description: "Die Passwörter stimmen nicht überein.", variant: "destructive" });
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
            title: "Fast geschafft!",
            description: `Wir haben einen Bestätigungslink an ${normalizedEmail} geschickt. Bitte bestätige deine E-Mail-Adresse, danach kannst du dich einloggen.`,
          });
          setMode("login");
          setPassword("");
          setConfirmPassword("");
          return;
        }

        toast({
          title: "Willkommen im Verein! 🎯",
          description: "Lege jetzt dein Spielerprofil an.",
        });
        navigate(from || "/players?createProfile=1", { replace: true });
        return;
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(normalizedEmail, {
          redirectTo: `${window.location.origin}/reset-password`,
        });
        if (error) throw error;
        toast({
          title: "E-Mail versendet",
          description: "Prüfe dein Postfach für den Reset-Link.",
        });
        setMode("login");
        return;
      }
    } catch (err: unknown) {
      const raw: string = err instanceof Error ? err.message : "";
      const msg = /email not confirmed|not confirmed/i.test(raw)
        ? "Deine E-Mail-Adresse ist noch nicht bestätigt. Prüfe dein Postfach (auch den Spam-Ordner)."
        : raw.includes("Invalid login credentials")
        ? "E-Mail oder Passwort falsch. Tipp: Passwort mit dem Auge prüfen."
        : raw.includes("User already registered")
        ? "Für diese E-Mail existiert bereits ein Konto. Einfach einloggen."
        : raw.includes("Password should be at least")
        ? "Das Passwort muss mindestens 6 Zeichen lang sein."
        : /rate limit|too many/i.test(raw)
        ? "Zu viele Versuche. Bitte kurz warten und erneut probieren."
        : raw || "Authentifizierung fehlgeschlagen.";
      toast({
        title: "Fehler",
        description: msg,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          {club?.logo_path ? (
            <img
              src={logoUrl}
              alt={clubName}
              className="w-16 h-16 rounded-xl object-cover border border-primary/30 mx-auto mb-4 glow-cyan"
            />
          ) : (
            <div className="w-16 h-16 rounded-xl bg-primary/10 border border-primary/30 flex items-center justify-center mx-auto mb-4 glow-cyan">
              <span className="font-display text-primary font-bold text-3xl">{clubName.charAt(0).toUpperCase()}</span>
            </div>
          )}
          <h1 className="text-3xl font-display uppercase">{clubName}</h1>
        </div>

        <div className="bg-card border border-border rounded-xl p-6">
          <h2 className="font-display uppercase text-lg mb-4">
            {mode === "login" ? "Anmelden" : mode === "signup" ? "Registrieren" : "Passwort zurücksetzen"}
          </h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label>E-Mail</Label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                placeholder="email@example.com"
                className="bg-muted border-border"
                required
              />
            </div>
            {mode !== "reset" && (
              <div>
                <Label>Passwort</Label>
                <div className="relative">
                  <Input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete={mode === "login" ? "current-password" : "new-password"}
                    placeholder="••••••••"
                    className="bg-muted border-border pr-10"
                    required
                    minLength={6}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((s) => !s)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-1"
                    tabIndex={-1}
                    aria-label={showPassword ? "Passwort verbergen" : "Passwort anzeigen"}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {mode === "signup" && (
                  <p className="text-xs text-muted-foreground mt-1">Mindestens 6 Zeichen.</p>
                )}
              </div>
            )}
            {mode === "signup" && (
              <div>
                <Label>Passwort bestätigen</Label>
                <Input
                  type={showPassword ? "text" : "password"}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                  placeholder="••••••••"
                  className="bg-muted border-border"
                  required
                  minLength={6}
                />
                {confirmPassword.length > 0 && confirmPassword !== password && (
                  <p className="text-xs text-destructive mt-1">Stimmt noch nicht mit dem Passwort überein.</p>
                )}
              </div>
            )}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {mode === "login" ? "Einloggen" : mode === "signup" ? "Registrieren" : "Reset-Link senden"}
            </Button>
          </form>
          {pendingConfirm && mode !== "reset" && (
            <div className="mt-4 rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm">
              <p className="text-muted-foreground">
                Bestätigungslink an <span className="text-foreground">{pendingConfirm}</span> gesendet. Nicht angekommen?
                Schau auch im Spam-Ordner nach.
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-2 w-full"
                onClick={resendConfirmation}
                disabled={resending}
              >
                {resending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                E-Mail erneut senden
              </Button>
            </div>
          )}
          <div className="mt-4 space-y-2 text-sm text-center text-muted-foreground">
            {mode === "login" && (
              <>
                <p>
                  Noch kein Konto?{" "}
                  <button onClick={() => setMode("signup")} className="text-primary hover:underline">
                    Registrieren
                  </button>
                </p>
                <p>
                  <button onClick={() => setMode("reset")} className="text-primary hover:underline">
                    Passwort vergessen?
                  </button>
                </p>
              </>
            )}
            {mode === "signup" && (
              <p>
                Bereits registriert?{" "}
                <button onClick={() => setMode("login")} className="text-primary hover:underline">
                  Anmelden
                </button>
              </p>
            )}
            {mode === "reset" && (
              <p>
                <button onClick={() => setMode("login")} className="text-primary hover:underline">
                  Zurück zur Anmeldung
                </button>
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AuthPage;
