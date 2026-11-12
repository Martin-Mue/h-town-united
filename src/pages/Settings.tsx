import { useEffect, useState, type ReactNode } from "react";
import { useTheme } from "next-themes";
import { useQueryClient } from "@tanstack/react-query";
import { Moon, Bell, TriangleAlert, Languages, Pencil, Check, X, Palette, BookOpen, SlidersHorizontal, KeyRound, BarChart3, type LucideIcon } from "lucide-react";
import { DartLoaderIcon as Loader2 } from "@/components/icons/DartIcons";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { usePushSubscription } from "@/hooks/usePushSubscription";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { usePlayers, PLAYERS_QUERY_KEY } from "@/hooks/usePlayers";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Switch } from "@/components/ui/switch";
import { setUsageTrackingEnabled, usageTrackingEnabled } from "@/lib/analytics";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LANGUAGES, type Language } from "@/i18n/translations";
import SettingsSection from "@/components/settings/SettingsSection";
import SettingsRow from "@/components/settings/SettingsRow";
import SegmentedControl from "@/components/settings/SegmentedControl";
import PersonalThemePicker from "@/components/settings/PersonalThemePicker";
import GameDefaultsSection from "@/components/settings/GameDefaultsSection";
import GuidesTab from "@/components/settings/GuidesTab";
import { generatePinSalt, hashPin, isValidPinFormat } from "@/lib/playerPin";

const LANGUAGE_LABEL_KEY: Record<Language, string> = {
  de: "settings.german", en: "settings.english", fr: "settings.french",
  pl: "settings.polish", nl: "settings.dutch", tr: "settings.turkish",
};

type SettingsTab = "appearance" | "game" | "account" | "guides";

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

const IMPRESSUM_INPUT_CLASS = "h-11 rounded-xl bg-background border-border text-base";

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
  const queryClient = useQueryClient();
  const { data: dbPlayers = [] } = usePlayers();
  const myPlayer = dbPlayers.find((p) => p.user_id === user?.id);

  const [impressum, setImpressum] = useState<ImpressumRow | null>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Omit<ImpressumRow, "id">>(EMPTY_IMPRESSUM);
  const [saving, setSaving] = useState(false);

  // "PIN pro Spieler": self-service set/change/remove for your own linked profile — see
  // @/lib/playerPin and the set_player_pin RPC (its own check enforces this is only ever your
  // own row; an admin sets/resets a walk-in profile's PIN from Players.tsx instead).
  const [pinNew, setPinNew] = useState("");
  const [pinConfirm, setPinConfirm] = useState("");
  const [pinSaving, setPinSaving] = useState(false);
  const [pinRemoving, setPinRemoving] = useState(false);

  const savePin = async () => {
    if (!myPlayer) return;
    if (!isValidPinFormat(pinNew)) {
      toast({ title: t("players.pinInvalidFormat"), variant: "destructive" });
      return;
    }
    if (pinNew !== pinConfirm) {
      toast({ title: t("players.pinMismatch"), variant: "destructive" });
      return;
    }
    setPinSaving(true);
    const salt = generatePinSalt();
    const hash = await hashPin(pinNew, salt);
    const { error } = await supabase.rpc("set_player_pin", { p_player_id: myPlayer.id, p_pin_hash: hash, p_pin_salt: salt });
    setPinSaving(false);
    if (error) {
      toast({ title: t("players.pinSaveFailed"), description: error.message, variant: "destructive" });
      return;
    }
    setPinNew(""); setPinConfirm("");
    queryClient.invalidateQueries({ queryKey: PLAYERS_QUERY_KEY });
    toast({ title: t("players.pinSaved") });
  };

  const removePin = async () => {
    if (!myPlayer) return;
    setPinRemoving(true);
    const { error } = await supabase.rpc("set_player_pin", { p_player_id: myPlayer.id, p_pin_hash: null, p_pin_salt: null });
    setPinRemoving(false);
    if (error) {
      toast({ title: t("players.pinSaveFailed"), description: error.message, variant: "destructive" });
      return;
    }
    queryClient.invalidateQueries({ queryKey: PLAYERS_QUERY_KEY });
    toast({ title: t("players.pinRemoved") });
  };

  const [activeTab, setActiveTab] = useState<SettingsTab>("appearance");
  const [usageStatsOn, setUsageStatsOn] = useState(usageTrackingEnabled);

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

  const appearancePanel = (
    <div className="space-y-5">
      <SettingsSection>
        <SettingsRow
          icon={Languages}
          label={t("settings.language")}
          description={t("settings.languageDesc")}
          control={
            <Select value={language} onValueChange={(v) => setLanguage(v as Language)}>
              <SelectTrigger className="h-11 w-[132px] rounded-xl bg-background border-border" aria-label={t("settings.language")}><SelectValue /></SelectTrigger>
              <SelectContent className="bg-card border-border">
                {LANGUAGES.map((lang) => (
                  <SelectItem key={lang} value={lang}>{t(LANGUAGE_LABEL_KEY[lang])}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
        />
        <SettingsRow
          icon={Moon}
          label={t("settings.darkMode")}
          description={t("settings.darkModeDesc")}
          control={
            <Switch
              checked={resolvedTheme === "dark"}
              onCheckedChange={(checked) => setTheme(checked ? "dark" : "light")}
              aria-label={t("settings.darkMode")}
            />
          }
        />
      </SettingsSection>

      <SettingsSection>
        <SettingsRow icon={Palette} label={t("settings.myColor")} description={t("settings.myColorDesc")}>
          <PersonalThemePicker />
        </SettingsRow>
      </SettingsSection>
    </div>
  );

  const accountPanel = (
    <div className="space-y-5">
      <SettingsSection>
        {push.supported && (
          <SettingsRow
            icon={Bell}
            label={t("settings.notifications")}
            description={t("settings.notificationsDesc")}
            control={<Switch checked={push.enabled} onCheckedChange={push.toggle} disabled={push.busy} aria-label={t("settings.notifications")} />}
          />
        )}
        {/* Anonymous usage statistics: on by default, every member can switch it off for this device. */}
        <SettingsRow
          icon={BarChart3}
          label={t("settings.usageStats")}
          description={t("settings.usageStatsDesc")}
          control={
            <Switch
              checked={usageStatsOn}
              onCheckedChange={(on) => { setUsageStatsOn(on); setUsageTrackingEnabled(on); }}
              aria-label={t("settings.usageStats")}
            />
          }
        />
      </SettingsSection>

      {/* "PIN pro Spieler": only meaningful once you have a linked profile at all — a bare
          account with no players row (not yet created one, see Players.tsx) has nothing to
          attach a PIN to. */}
      {myPlayer && (
        <SettingsSection>
          <SettingsRow
            icon={KeyRound}
            label={t("players.pinSectionTitle")}
            description={t("players.pinSectionDescSelf")}
          >
            <p className="text-[13px] text-muted-foreground">
              {myPlayer.pin_hash ? t("players.pinCurrentSet") : t("players.pinNotSet")}
            </p>
            <div className="grid grid-cols-2 gap-2">
              <input type="password" inputMode="numeric" pattern="[0-9]*" maxLength={4}
                value={pinNew} onChange={(e) => setPinNew(e.target.value.replace(/\D/g, "").slice(0, 4))}
                placeholder={t("players.pinNewPlaceholder")}
                aria-label={t("players.pinNewPlaceholder")}
                className="h-11 min-w-0 rounded-xl bg-background border border-border px-3 text-base text-foreground text-center tracking-widest placeholder:tracking-normal placeholder:text-sm" />
              <input type="password" inputMode="numeric" pattern="[0-9]*" maxLength={4}
                value={pinConfirm} onChange={(e) => setPinConfirm(e.target.value.replace(/\D/g, "").slice(0, 4))}
                placeholder={t("players.pinConfirmPlaceholder")}
                aria-label={t("players.pinConfirmPlaceholder")}
                className="h-11 min-w-0 rounded-xl bg-background border border-border px-3 text-base text-foreground text-center tracking-widest placeholder:tracking-normal placeholder:text-sm" />
            </div>
            <div className="flex gap-2">
              <Button className="h-11 flex-1 gap-1.5 rounded-xl font-semibold hover:shadow-none" disabled={pinSaving || pinNew.length !== 4} onClick={savePin}>
                {pinSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                {myPlayer.pin_hash ? t("players.pinChangeButton") : t("players.pinSetButton")}
              </Button>
              {myPlayer.pin_hash && (
                <Button variant="outline" className="h-11 rounded-xl hover:shadow-none" disabled={pinRemoving} onClick={removePin}>
                  {pinRemoving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : t("players.pinRemoveButton")}
                </Button>
              )}
            </div>
          </SettingsRow>
        </SettingsSection>
      )}

      <SettingsSection
        rows={false}
        label={t("settings.impressum")}
        labelAction={isAdmin && impressum && !editing ? (
          <Button size="sm" variant="ghost" className="h-11 gap-1.5 rounded-xl text-sm" onClick={startEdit}>
            <Pencil className="w-3.5 h-3.5" /> {t("common.edit")}
          </Button>
        ) : null}
      >
        {!isComplete && (
          <div className="flex items-start gap-2 mb-3 text-xs text-muted-foreground bg-muted rounded-xl p-3">
            <TriangleAlert className="w-4 h-4 shrink-0 text-accent" />
            <p>{t("settings.impressumWarning")}</p>
          </div>
        )}

        {!impressum ? (
          <div className="flex justify-center py-4"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
        ) : editing ? (
          <div className="space-y-2.5">
            <Input value={form.club_name} onChange={(e) => setForm((f) => ({ ...f, club_name: e.target.value }))} placeholder={t("settings.impressumClubPlaceholder")} className={IMPRESSUM_INPUT_CLASS} />
            <Input value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} placeholder={t("settings.impressumAddressPlaceholder")} className={IMPRESSUM_INPUT_CLASS} />
            <Input value={form.city} onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))} placeholder={t("settings.impressumCityPlaceholder")} className={IMPRESSUM_INPUT_CLASS} />
            <Input value={form.represented_by} onChange={(e) => setForm((f) => ({ ...f, represented_by: e.target.value }))} placeholder={t("settings.impressumRepresentedPlaceholder")} className={IMPRESSUM_INPUT_CLASS} />
            <Input value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} placeholder={t("settings.impressumEmailPlaceholder")} type="email" className={IMPRESSUM_INPUT_CLASS} />
            <Input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} placeholder={t("settings.impressumPhoneOptional")} className={IMPRESSUM_INPUT_CLASS} />
            <Input value={form.register_info} onChange={(e) => setForm((f) => ({ ...f, register_info: e.target.value }))} placeholder={t("settings.impressumRegisterPlaceholder")} className={IMPRESSUM_INPUT_CLASS} />
            <div className="flex gap-2 justify-end pt-1">
              <Button variant="ghost" className="h-11 w-11 rounded-xl p-0" onClick={() => setEditing(false)} disabled={saving} aria-label={t("common.cancel")}><X className="w-4 h-4" /></Button>
              <Button onClick={saveImpressum} disabled={saving} className="h-11 gap-1.5 rounded-xl px-5 font-semibold hover:shadow-none">
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} {t("game.save")}
              </Button>
            </div>
          </div>
        ) : (
          <div className="text-[13px] text-muted-foreground space-y-3 leading-relaxed">
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
      </SettingsSection>
    </div>
  );

  const tabs: { value: SettingsTab; label: string; icon: LucideIcon; content: ReactNode }[] = [
    { value: "appearance", label: t("settings.groupAppearance"), icon: Palette, content: appearancePanel },
    { value: "game", label: t("settings.groupGame"), icon: SlidersHorizontal, content: <GameDefaultsSection /> },
    { value: "account", label: t("settings.groupAccount"), icon: KeyRound, content: accountPanel },
    { value: "guides", label: t("settings.tabGuides"), icon: BookOpen, content: <GuidesTab /> },
  ];
  const activePanel = tabs.find((tab) => tab.value === activeTab) ?? tabs[0];

  return (
    <div className="container py-4 animate-slide-up max-w-2xl mx-auto space-y-4">
      <h1 className="font-display text-[28px] font-bold leading-tight">{t("settings.title")}</h1>

      <SegmentedControl<SettingsTab>
        kind="tabs"
        ariaLabel={t("settings.title")}
        options={tabs}
        value={activePanel.value}
        onChange={setActiveTab}
        columnsClassName="grid-cols-2 md:grid-cols-4"
      />

      <div role="tabpanel" aria-label={activePanel.label}>{activePanel.content}</div>
    </div>
  );
};

export default SettingsPage;
