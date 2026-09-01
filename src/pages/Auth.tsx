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
  const { toast } = useToast();

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
        if (error) throw error;
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
        // signUp() only returns a live session immediately when email confirmation is off for
        // this project (currently the case, verified against auth.users — every account's
        // email_confirmed_at matches created_at to the millisecond, i.e. auto-confirmed). If that
        // account setting is ever flipped on, session comes back null instead — navigating to a
        // protected route as if logged in would just bounce straight back to /auth, contradicting
        // the "welcome" toast. Branch on what actually came back rather than assuming.
        if (!data.session) {
          toast({
            title: "Fast geschafft!",
            description: "Bitte bestätige deine E-Mail-Adresse über den Link, den wir dir geschickt haben.",
          });
          setMode("login");
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
      const msg = raw.includes("Invalid login credentials")
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
