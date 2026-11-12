import { useTheme } from "next-themes";
import { useClubBranding } from "@/contexts/ClubBrandingContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { CLUB_THEME_PRESETS, resolveClubTheme, DEFAULT_CLUB_THEME_PRESET_ID } from "@/lib/clubThemePresets";

const optionClass = (selected: boolean) =>
  `flex min-h-11 items-center gap-2 rounded-xl border px-2.5 py-2 text-left text-[13px] transition-colors ${
    selected ? "border-primary bg-primary/10 font-semibold" : "border-border bg-background hover:border-primary/50"
  }`;

/** "Meine Farbe": personal color override — local to this device only (localStorage, see
 *  ClubBrandingContext), never written anywhere shared. Everyone gets this, not just admins:
 *  only the accent hues are personal, name/logo/tagline stay admin-only. */
const PersonalThemePicker = () => {
  const { t } = useLanguage();
  const { resolvedTheme } = useTheme();
  const { club, personalThemePreset, setPersonalThemePreset } = useClubBranding();
  const mode = resolvedTheme === "light" ? "light" : "dark";
  const clubPresetId = club?.theme_preset ?? DEFAULT_CLUB_THEME_PRESET_ID;

  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
      <button
        type="button"
        aria-pressed={!personalThemePreset}
        onClick={() => setPersonalThemePreset(null)}
        className={optionClass(!personalThemePreset)}
      >
        <span className="flex gap-1 shrink-0">
          {(["--primary", "--secondary", "--accent"] as const).map((key) => {
            const vars = resolveClubTheme(clubPresetId, mode);
            return <span key={key} className="w-3 h-3 rounded-full" style={{ background: `hsl(${vars[key]})` }} />;
          })}
        </span>
        <span className="truncate">{t("settings.myColorClubDefault")}</span>
      </button>
      {/* The preset matching the club's own current theme is skipped here — selecting it
          explicitly would look and behave identically to "Vereinsfarbe" above, since that
          option already resolves to exactly this preset. */}
      {CLUB_THEME_PRESETS.filter((preset) => preset.id !== clubPresetId).map((preset) => {
        const vars = resolveClubTheme(preset.id, mode);
        const selected = personalThemePreset === preset.id;
        return (
          <button
            type="button"
            key={preset.id}
            aria-pressed={selected}
            onClick={() => setPersonalThemePreset(preset.id)}
            className={optionClass(selected)}
          >
            <span className="flex items-center gap-1 shrink-0">
              {/* Preview of a real button: action color with its own text color on it. */}
              <span
                aria-hidden="true"
                className="px-1.5 rounded font-display font-bold text-[11px] leading-4"
                style={{ background: `hsl(${vars["--primary"]})`, color: `hsl(${vars["--primary-foreground"]})` }}
              >
                Aa
              </span>
              <span className="hidden w-3 h-3 rounded-full sm:block" style={{ background: `hsl(${vars["--secondary"]})` }} />
              <span className="hidden w-3 h-3 rounded-full sm:block" style={{ background: `hsl(${vars["--accent"]})` }} />
            </span>
            <span className="truncate">{preset.label}</span>
          </button>
        );
      })}
    </div>
  );
};

export default PersonalThemePicker;
