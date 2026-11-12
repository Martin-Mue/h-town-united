import { useLanguage } from "@/contexts/LanguageContext";
import SettingToggleRow from "./SettingToggleRow";

interface TeamModeOptionsProps {
  teamMode: boolean;
  onTeamModeChange: (on: boolean) => void;
  teamNames: [string, string];
  onTeamNamesChange: (names: [string, string]) => void;
  locked: boolean;
}

/** Team mode on/off and, while on, the two team names. */
const TeamModeOptions = ({ teamMode, onTeamModeChange, teamNames, onTeamNamesChange, locked }: TeamModeOptionsProps) => {
  const { t } = useLanguage();
  const inputClass = "h-11 min-w-0 rounded-xl border border-border bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary";
  return (
    <SettingToggleRow id="team-mode" label={t("game.teamMode")} description={t("game.teamModeDesc")} checked={teamMode} disabled={locked} onCheckedChange={onTeamModeChange}>
      {teamMode && (
        <div className="grid grid-cols-2 gap-2 pt-1">
          <input value={teamNames[0]} onChange={(e) => onTeamNamesChange([e.target.value, teamNames[1]])} placeholder={`${t("game.team")} 1`} aria-label={`${t("game.team")} 1`} className={inputClass} />
          <input value={teamNames[1]} onChange={(e) => onTeamNamesChange([teamNames[0], e.target.value])} placeholder={`${t("game.team")} 2`} aria-label={`${t("game.team")} 2`} className={inputClass} />
        </div>
      )}
    </SettingToggleRow>
  );
};

export default TeamModeOptions;
