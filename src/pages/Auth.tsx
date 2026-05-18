import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { Loader2, Eye, EyeOff } from "lucide-react";
import { useNavigate } from "react-router-dom";

const AuthPage = () => {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const [mode, setMode] = useState<"login" | "signup" | "reset">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (!authLoading && user) {
      navigate("/", { replace: true });
    }
  }, [authLoading, navigate, user]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const normalizedEmail = email.trim().toLowerCase();
      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({ email: normalizedEmail, password });
        if (error) throw error;
        navigate("/", { replace: true });
      } else if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email: normalizedEmail,
          password,
          options: { emailRedirectTo: window.location.origin },
        });
        if (error) throw error;
        toast({
          title: "Willkommen im Verein! 🎯",
          description: "Du bist direkt eingeloggt.",
        });
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
    } catch (err: any) {
      const msg = err?.message?.includes("Invalid login credentials")
        ? "E-Mail oder Passwort falsch. Tipp: Passwort mit dem Auge prüfen."
        : err?.message || "Authentifizierung fehlgeschlagen.";
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
          <div className="w-16 h-16 rounded-xl bg-primary/10 border border-primary/30 flex items-center justify-center mx-auto mb-4 glow-cyan">
            <span className="font-display text-primary font-bold text-3xl">H</span>
          </div>
          <h1 className="text-3xl font-display uppercase">
            H-Town <span className="text-primary">United</span>
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Dart Club</p>
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
