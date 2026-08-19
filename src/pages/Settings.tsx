import { useTheme } from "next-themes";
import { Settings as SettingsIcon, Moon, Bell, FileText, TriangleAlert } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { usePushSubscription } from "@/hooks/usePushSubscription";
import { Switch } from "@/components/ui/switch";

/** App-wide preferences. Dark mode and notifications were already toggleable from the header
 *  (see Layout.tsx) — those quick-access icons stay, this page just gives them a proper labeled
 *  home alongside things that don't fit a header icon at all (Impressum). Both toggles here use
 *  the exact same hooks/state as the header ones, so the two stay in sync automatically. */
const SettingsPage = () => {
  const { user } = useAuth();
  const { resolvedTheme, setTheme } = useTheme();
  const push = usePushSubscription(user?.id);

  return (
    <div className="container py-6 animate-slide-up max-w-2xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <SettingsIcon className="w-6 h-6 text-accent" />
        <h2 className="text-2xl font-display uppercase">Einstellungen</h2>
      </div>

      <div className="space-y-3 mb-6">
        <div className="bg-card border border-border rounded-xl p-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Moon className="w-5 h-5 text-muted-foreground shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-medium">Dunkles Design</p>
              <p className="text-xs text-muted-foreground">Wechselt zwischen hellem und dunklem Erscheinungsbild.</p>
            </div>
          </div>
          <Switch
            checked={resolvedTheme === "dark"}
            onCheckedChange={(checked) => setTheme(checked ? "dark" : "light")}
            aria-label="Dunkles Design"
          />
        </div>

        {push.supported && (
          <div className="bg-card border border-border rounded-xl p-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <Bell className="w-5 h-5 text-muted-foreground shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-medium">Benachrichtigungen</p>
                <p className="text-xs text-muted-foreground">Z. B. wenn dein Turnierspiel als Nächstes dran ist.</p>
              </div>
            </div>
            <Switch checked={push.enabled} onCheckedChange={push.toggle} disabled={push.busy} aria-label="Benachrichtigungen" />
          </div>
        )}
      </div>

      <div className="bg-card border border-border rounded-xl p-4">
        <h3 className="font-display text-sm uppercase text-muted-foreground mb-3 flex items-center gap-2">
          <FileText className="w-4 h-4" /> Impressum
        </h3>
        {/* Placeholder structure only — a real Impressum needs the club's actual legal details
            (§5 TMG), which I don't have and won't invent. Filled in with real data by the club,
            not shipped as-is. */}
        <div className="flex items-start gap-2 mb-3 text-xs text-accent bg-accent/10 rounded-lg p-2.5">
          <TriangleAlert className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <p>Vorlage — bitte mit den echten Vereinsangaben ausfüllen. Erst dann ist diese Seite ein rechtsgültiges Impressum nach §5 TMG.</p>
        </div>
        <div className="text-xs text-muted-foreground space-y-3 leading-relaxed">
          <p>Angaben gemäß § 5 TMG</p>
          <p>[Vereinsname einfügen]<br />[Straße, Hausnummer einfügen]<br />[PLZ, Ort einfügen]</p>
          <p><strong className="text-foreground">Vertreten durch:</strong><br />[Name des Vorstands/verantwortliche Person einfügen]</p>
          <p><strong className="text-foreground">Kontakt:</strong><br />E-Mail: [E-Mail-Adresse einfügen]<br />Telefon: [optional]</p>
          <p><strong className="text-foreground">Registereintrag:</strong><br />[Vereinsregister, Registergericht, Registernummer einfügen, falls vorhanden]</p>
        </div>
      </div>
    </div>
  );
};

export default SettingsPage;
