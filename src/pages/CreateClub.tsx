import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { useClubBranding } from "@/contexts/ClubBrandingContext";
import { Loader2, Trophy } from "lucide-react";

/** Reached by any authenticated account with no club membership yet -- see RequireClub in
 *  App.tsx. Creates a brand-new club (via the create_club RPC, which also makes this account
 *  its first admin) rather than joining an existing one; joining happens exclusively through an
 *  admin-issued invite link (see InvitePage), not from here. */
const CreateClub = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { signOut } = useAuth();
  const { refetch } = useClubBranding();
  const [name, setName] = useState("");
  const [tagline, setTagline] = useState("");
  const [saving, setSaving] = useState(false);

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
      toast({ title: "Verein angelegt! 🎯", description: "Lege jetzt dein Spielerprofil an." });
      navigate("/players?createProfile=1", { replace: true });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Verein konnte nicht angelegt werden.";
      toast({ title: "Fehler", description: msg, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-xl bg-primary/10 border border-primary/30 flex items-center justify-center mx-auto mb-4 glow-cyan">
            <Trophy className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-2xl font-display uppercase">Verein anlegen</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Dieser Account gehört noch zu keinem Verein. Lege jetzt deinen eigenen an, oder nutze
            einen Einladungslink von einem bestehenden Verein.
          </p>
        </div>

        <div className="bg-card border border-border rounded-xl p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label>Vereinsname</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="z. B. Dartfreunde Musterstadt e.V."
                className="bg-muted border-border"
                required
              />
            </div>
            <div>
              <Label>Leitspruch (optional)</Label>
              <Input
                value={tagline}
                onChange={(e) => setTagline(e.target.value)}
                placeholder="Ein kurzer Slogan für euren Verein"
                className="bg-muted border-border"
              />
            </div>
            <Button type="submit" className="w-full" disabled={saving || !name.trim()}>
              {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Verein anlegen
            </Button>
          </form>
          <div className="mt-4 text-center">
            <button onClick={() => signOut()} className="text-sm text-muted-foreground hover:text-foreground hover:underline">
              Abmelden
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CreateClub;
