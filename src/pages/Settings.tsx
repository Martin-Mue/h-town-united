import { useTheme } from "next-themes";
import { Settings as SettingsIcon, Moon, Bell, FileText, TriangleAlert, Languages } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { usePushSubscription } from "@/hooks/usePushSubscription";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LANGUAGES, type Language } from "@/i18n/translations";

const LANGUAGE_LABEL_KEY: Record<Language, string> = {
  de: "settings.german", en: "settings.english", fr: "settings.french",
  pl: "settings.polish", nl: "settings.dutch", tr: "settings.turkish",
};

/** App-wide preferences. Dark mode and notifications used to also have their own header icons
 *  (see Layout.tsx) — consolidated here instead now that there's a real settings surface, so
 *  there's one place for these instead of two. Same underlying hooks/state either way. */
const SettingsPage = () => {
  const { user } = useAuth();
  const { resolvedTheme, setTheme } = useTheme();
  const { language, setLanguage, t } = useLanguage();
  const push = usePushSubscription(user?.id);

  return (
    <div className="container py-6 animate-slide-up max-w-2xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <SettingsIcon className="w-6 h-6 text-accent" />
        <h2 className="text-2xl font-display uppercase">{t("settings.title")}</h2>
      </div>

      <div className="space-y-3 mb-6">
        <div className="bg-card border border-border rounded-xl p-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Languages className="w-5 h-5 text-muted-foreground shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-medium">{t("settings.language")}</p>
              <p className="text-xs text-muted-foreground">{t("settings.languageDesc")}</p>
            </div>
          </div>
          <Select value={language} onValueChange={(v) => setLanguage(v as Language)}>
            <SelectTrigger className="w-[140px] shrink-0 bg-background border-border"><SelectValue /></SelectTrigger>
            <SelectContent className="bg-card border-border">
              {LANGUAGES.map((lang) => (
                <SelectItem key={lang} value={lang}>{t(LANGUAGE_LABEL_KEY[lang])}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="bg-card border border-border rounded-xl p-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Moon className="w-5 h-5 text-muted-foreground shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-medium">{t("settings.darkMode")}</p>
              <p className="text-xs text-muted-foreground">{t("settings.darkModeDesc")}</p>
            </div>
          </div>
          <Switch
            checked={resolvedTheme === "dark"}
            onCheckedChange={(checked) => setTheme(checked ? "dark" : "light")}
            aria-label={t("settings.darkMode")}
          />
        </div>

        {push.supported && (
          <div className="bg-card border border-border rounded-xl p-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <Bell className="w-5 h-5 text-muted-foreground shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-medium">{t("settings.notifications")}</p>
                <p className="text-xs text-muted-foreground">{t("settings.notificationsDesc")}</p>
              </div>
            </div>
            <Switch checked={push.enabled} onCheckedChange={push.toggle} disabled={push.busy} aria-label={t("settings.notifications")} />
          </div>
        )}
      </div>

      <div className="bg-card border border-border rounded-xl p-4">
        <h3 className="font-display text-sm uppercase text-muted-foreground mb-3 flex items-center gap-2">
          <FileText className="w-4 h-4" /> {t("settings.impressum")}
        </h3>
        {/* Placeholder structure only — a real Impressum needs the club's actual legal details
            (§5 TMG), which I don't have and won't invent. Filled in with real data by the club,
            not shipped as-is. */}
        <div className="flex items-start gap-2 mb-3 text-xs text-accent bg-accent/10 rounded-lg p-2.5">
          <TriangleAlert className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <p>{t("settings.impressumWarning")}</p>
        </div>
        <div className="text-xs text-muted-foreground space-y-3 leading-relaxed">
          <p>{t("settings.impressumHeading")}</p>
          <p>{t("settings.impressumClubPlaceholder")}<br />{t("settings.impressumAddressPlaceholder")}<br />{t("settings.impressumCityPlaceholder")}</p>
          <p><strong className="text-foreground">{t("settings.impressumRepresented")}</strong><br />{t("settings.impressumRepresentedPlaceholder")}</p>
          <p><strong className="text-foreground">{t("settings.impressumContact")}</strong><br />{t("settings.impressumEmailPlaceholder")}<br />{t("settings.impressumPhoneOptional")}</p>
          <p><strong className="text-foreground">{t("settings.impressumRegister")}</strong><br />{t("settings.impressumRegisterPlaceholder")}</p>
        </div>
      </div>
    </div>
  );
};

export default SettingsPage;
