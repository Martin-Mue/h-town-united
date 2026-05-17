import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";

const AuthPage = () => {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (isLogin) {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin },
        });
        if (error) throw error;
        toast({
          title: "Willkommen im Verein! 🎯",
          description: "Du bist direkt eingeloggt.",
        });
        return;
      }
    } catch (err: any) {
      toast({
        title: "Fehler",
        description: err.message || "Authentifizierung fehlgeschlagen.",
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
            {isLogin ? "Anmelden" : "Registrieren"}
          </h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label>E-Mail</Label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="email@example.com"
                className="bg-muted border-border"
                required
              />
            </div>
            <div>
              <Label>Passwort</Label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="bg-muted border-border"
                required
                minLength={6}
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {isLogin ? "Einloggen" : "Registrieren"}
            </Button>
          </form>
          <p className="text-sm text-center text-muted-foreground mt-4">
            {isLogin ? "Noch kein Konto?" : "Bereits registriert?"}{" "}
            <button
              onClick={() => setIsLogin(!isLogin)}
              className="text-primary hover:underline"
            >
              {isLogin ? "Registrieren" : "Anmelden"}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
};

export default AuthPage;
