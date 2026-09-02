import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Settings as SettingsIcon, Moon, Bell, FileText, TriangleAlert, Languages, Pencil, Check, X, Loader2, Palette, BookOpen, SlidersHorizontal } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { useClubBranding } from "@/contexts/ClubBrandingContext";
import { usePushSubscription } from "@/hooks/usePushSubscription";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LANGUAGES, type Language } from "@/i18n/translations";
import { CLUB_THEME_PRESETS, resolveClubTheme, DEFAULT_CLUB_THEME_PRESET_ID } from "@/lib/clubThemePresets";
import GuidesTab from "@/components/settings/GuidesTab";

const LANGUAGE_LABEL_KEY: Record<Language, string> = {
  de: "settings.german", en: "settings.english", fr: "settings.french",
  pl: "settings.polish", nl: "settings.dutch", tr: "settings.turkish",
};

interface ImpressumRow {
  id: string;
  club_name: string;
  address: string;
  city: string;
  represented_by: string;
  email: string;
  phone: string;
  register_info: string;
}

const EMPTY_IMPRESSUM: Omit<ImpressumRow, "id"> = {
  club_name: "", address: "", city: "", represented_by: "", email: "", phone: "", register_info: "",
};

/** App-wide preferences. Dark mode and notifications used to also have their own header icons
 *  (see Layout.tsx) — consolidated here instead now that there's a real settings surface, so
 *  there's one place for these instead of two. Same underlying hooks/state either way. */
const SettingsPage = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const isAdmin = useIsAdmin(user?.id);
  const { resolvedTheme, setTheme } = useTheme();
  const { language, setLanguage, t } = useLanguage();
  const push = usePushSubscription(user?.id);
  const { club, personalThemePreset, setPersonalThemePreset } = useClubBranding();

  const [impressum, setImpressum] = useState<ImpressumRow | null>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Omit<ImpressumRow, "id">>(EMPTY_IMPRESSUM);
  const [saving, setSaving] = useState(false);

  const [activeTab, setActiveTab] = useState<"settings" | "guides">("settings");

  useEffect(() => {
    supabase.from("impressum").select("*").limit(1).maybeSingle().then(({ data }) => {
      if (data) setImpressum(data);
    });
  }, []);

  const startEdit = () => {
    if (!impressum) return;
    setForm({
      club_name: impressum.club_name, address: impressum.address, city: impressum.city,
      represented_by: impressum.represented_by, email: impressum.email, phone: impressum.phone,
      register_info: impressum.register_info,
    });
    setEditing(true);
  };

  const saveImpressum = async () => {
    if (!impressum) return;
    setSaving(true);
    const { error } = await supabase.from("impressum")
      .update({ ...form, updated_by: user?.id ?? null })
      .eq("id", impressum.id);
    setSaving(false);
    if (error) {
      toast({ title: t("common.error"), description: error.message, variant: "destructive" });
      return;
    }
    setImpressum({ ...impressum, ...form });
    setEditing(false);
  };

  // Only the fields that actually matter for §5 TMG validity — phone/register are optional
  // there (register entry only applies to a formally registered e.V. in the first place).
  const isComplete = !!impressum && [impressum.club_name, impressum.address, impressum.city, impressum.represented_by, impressum.email].every((f) => f.trim() !== "");

  return (
    <div className="container py-6 animate-slide-up max-w-2xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <SettingsIcon className="w-6 h-6 text-accent" />
        <h2 className="text-2xl font-display uppercase">{t("settings.title")}</h2>
      </div>

      <div className="flex gap-2 mb-6">
        <button onClick={() => setActiveTab("settings")}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-full text-xs font-medium transition-all ${activeTab === "settings" ? "bg-primary text-primary-foreground shadow-[0_0_16px_hsl(var(--primary)/0.35)]" : "border border-border text-muted-foreground hover:text-foreground"}`}>
          <SlidersHorizontal className="w-3.5 h-3.5" /> {t("settings.tabSettings")}
        </button>
        <button onClick={() => setActiveTab("guides")}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-full text-xs font-medium transition-all ${activeTab === "guides" ? "bg-primary text-primary-foreground shadow-[0_0_16px_hsl(var(--primary)/0.35)]" : "border border-border text-muted-foreground hover:text-foreground"}`}>
          <BookOpen className="w-3.5 h-3.5" /> {t("settings.tabGuides")}
        </button>
      </div>

      {activeTab === "guides" && <GuidesTab />}

      {activeTab === "settings" && (
      <>
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

        {/* Personal color override — local to this device only (localStorage, see
            ClubBrandingContext), never written anywhere shared. Everyone gets this, not just
            admins: only the 3 accent hues are personal, name/logo/tagline stay admin-only below. */}
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="flex items-center gap-3 mb-3">
            <Palette className="w-5 h-5 text-muted-foreground shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-medium">{t("settings.myColor")}</p>
              <p className="text-xs text-muted-foreground">{t("settings.myColorDesc")}</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setPersonalThemePreset(null)}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs text-left transition-colors ${
                !personalThemePreset ? "border-primary ring-2 ring-primary bg-primary/5" : "border-border hover:border-primary/50"
              }`}
            >
              <span className="flex gap-1 shrink-0">
                {(["--primary", "--secondary", "--accent"] as const).map((key) => {
                  const vars = resolveClubTheme(club?.theme_preset ?? DEFAULT_CLUB_THEME_PRESET_ID, resolvedTheme === "light" ? "light" : "dark");
                  return <span key={key} className="w-3 h-3 rounded-full" style={{ background: `hsl(${vars[key]})` }} />;
                })}
              </span>
              <span className="truncate">{t("settings.myColorClubDefault")}</span>
            </button>
            {CLUB_THEME_PRESETS.map((preset) => {
              const vars = resolveClubTheme(preset.id, resolvedTheme === "light" ? "light" : "dark");
              const selected = personalThemePreset === preset.id;
              return (
                <button
                  type="button"
                  key={preset.id}
                  onClick={() => setPersonalThemePreset(preset.id)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs text-left transition-colors ${
                    selected ? "border-primary ring-2 ring-primary bg-primary/5" : "border-border hover:border-primary/50"
                  }`}
                >
                  <span className="flex gap-1 shrink-0">
                    <span className="w-3 h-3 rounded-full" style={{ background: `hsl(${vars["--primary"]})` }} />
                    <span className="w-3 h-3 rounded-full" style={{ background: `hsl(${vars["--secondary"]})` }} />
                    <span className="w-3 h-3 rounded-full" style={{ background: `hsl(${vars["--accent"]})` }} />
                  </span>
                  <span className="truncate">{preset.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="bg-card border border-border rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-display text-sm uppercase text-muted-foreground flex items-center gap-2">
            <FileText className="w-4 h-4" /> {t("settings.impressum")}
          </h3>
          {isAdmin && impressum && !editing && (
            <Button size="sm" variant="ghost" className="h-8 gap-1.5 text-xs" onClick={startEdit}>
              <Pencil className="w-3.5 h-3.5" /> {t("common.edit")}
            </Button>
          )}
        </div>

        {!isComplete && (
          <div className="flex items-start gap-2 mb-3 text-xs text-accent bg-accent/10 rounded-lg p-2.5">
            <TriangleAlert className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <p>{t("settings.impressumWarning")}</p>
          </div>
        )}

        {!impressum ? (
          <div className="flex justify-center py-4"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
        ) : editing ? (
          <div className="space-y-2.5">
            <Input value={form.club_name} onChange={(e) => setForm((f) => ({ ...f, club_name: e.target.value }))} placeholder={t("settings.impressumClubPlaceholder")} className="bg-background border-border" />
            <Input value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} placeholder={t("settings.impressumAddressPlaceholder")} className="bg-background border-border" />
            <Input value={form.city} onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))} placeholder={t("settings.impressumCityPlaceholder")} className="bg-background border-border" />
            <Input value={form.represented_by} onChange={(e) => setForm((f) => ({ ...f, represented_by: e.target.value }))} placeholder={t("settings.impressumRepresentedPlaceholder")} className="bg-background border-border" />
            <Input value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} placeholder={t("settings.impressumEmailPlaceholder")} type="email" className="bg-background border-border" />
            <Input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} placeholder={t("settings.impressumPhoneOptional")} className="bg-background border-border" />
            <Input value={form.register_info} onChange={(e) => setForm((f) => ({ ...f, register_info: e.target.value }))} placeholder={t("settings.impressumRegisterPlaceholder")} className="bg-background border-border" />
            <div className="flex gap-2 justify-end pt-1">
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={saving}><X className="w-3.5 h-3.5" /></Button>
              <Button size="sm" onClick={saveImpressum} disabled={saving} className="gap-1.5">
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} {t("game.save")}
              </Button>
            </div>
          </div>
        ) : (
          <div className="text-xs text-muted-foreground space-y-3 leading-relaxed">
            <p>{t("settings.impressumHeading")}</p>
            <p>
              {impressum.club_name || t("settings.impressumClubPlaceholder")}<br />
              {impressum.address || t("settings.impressumAddressPlaceholder")}<br />
              {impressum.city || t("settings.impressumCityPlaceholder")}
            </p>
            <p><strong className="text-foreground">{t("settings.impressumRepresented")}</strong><br />{impressum.represented_by || t("settings.impressumRepresentedPlaceholder")}</p>
            <p>
              <strong className="text-foreground">{t("settings.impressumContact")}</strong><br />
              {impressum.email || t("settings.impressumEmailPlaceholder")}<br />
              {impressum.phone || t("settings.impressumPhoneOptional")}
            </p>
            <p><strong className="text-foreground">{t("settings.impressumRegister")}</strong><br />{impressum.register_info || t("settings.impressumRegisterPlaceholder")}</p>
          </div>
        )}
      </div>
      </>
      )}
    </div>
  );
};

export default SettingsPage;
