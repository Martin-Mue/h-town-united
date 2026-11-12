import type { ReactNode } from "react";
import { Bot, Lock, Users, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger, PopoverClose } from "@/components/ui/popover";
import type { ClubPlayer } from "@/lib/repositories/players";
import { useLanguage } from "@/contexts/LanguageContext";

interface PlayerSlotRowProps {
  /** 1 = throws first in leg 1. */
  throwPosition: number;
  /** Team mode: which team this slot plays for. */
  team?: { label: string; tone: "primary" | "secondary" };
  isBot: boolean;
  name: string;
  botName: string;
  onNameChange: (name: string) => void;
  members: ClubPlayer[];
  onPickMember: (member: ClubPlayer) => void;
  onToggleBot: () => void;
  /** Missing when the slot can't be removed (2 players left, team mode, tournament match). */
  onRemove?: () => void;
  /** Bot strength picker, shown under the row while this slot is a bot. */
  children?: ReactNode;
}

const iconButton = "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border transition-colors";

/** One player in throw order: position badge, name (typed, or picked from the club), bot switch and remove. */
const PlayerSlotRow = ({
  throwPosition, team, isBot, name, botName, onNameChange, members, onPickMember, onToggleBot, onRemove, children,
}: PlayerSlotRowProps) => {
  const { t } = useLanguage();
  const frame = team ? (team.tone === "primary" ? "border-primary/40" : "border-secondary/40") : "border-border";
  return (
    <li className={`space-y-2 rounded-2xl border bg-card p-2 ${frame}`}>
      {team && (
        <p className={`px-1 font-display text-[11px] uppercase ${team.tone === "primary" ? "text-primary" : "text-secondary"}`}>{team.label}</p>
      )}
      <div className="flex items-center gap-2">
        <span
          aria-label={`${t("game.throwPosition")} ${throwPosition}`}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground"
        >
          {throwPosition}
        </span>
        {isBot ? (
          <div className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-xl border border-secondary/40 bg-secondary/10 px-3 text-sm text-secondary">
            <Bot className="h-4 w-4 shrink-0" />
            <span className="truncate">{botName}</span>
          </div>
        ) : (
          <>
            <input
              value={name}
              onChange={(e) => onNameChange(e.target.value)}
              placeholder={t("game.enterName")}
              aria-label={`${t("stats.player")} ${throwPosition}`}
              className="h-11 min-w-0 flex-1 rounded-xl border border-border bg-background px-3 text-[15px] font-semibold text-foreground placeholder:font-normal placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
            {members.length > 0 && (
              <Popover>
                <PopoverTrigger asChild>
                  <button type="button" className={`${iconButton} border-border text-muted-foreground hover:bg-muted hover:text-foreground`}
                    title={t("game.chooseClubMember")} aria-label={t("game.chooseClubMember")}>
                    <Users className="h-4 w-4" />
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-60 p-2" align="end">
                  <p className="px-2 pb-1 text-[10px] uppercase tracking-wider text-muted-foreground">{t("game.chooseClubMember")}</p>
                  <div className="max-h-56 space-y-1 overflow-y-auto">
                    {members.map((member) => (
                      <PopoverClose asChild key={member.id}>
                        <button type="button" onClick={() => onPickMember(member)}
                          className={`flex min-h-[40px] w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition-colors ${name === member.name ? "bg-primary/15 text-primary" : "hover:bg-muted"}`}>
                          <span>{member.emoji}</span><span className="flex-1 truncate">{member.name}</span>
                          {member.pin_hash && <Lock className="h-3 w-3 shrink-0 text-muted-foreground" />}
                        </button>
                      </PopoverClose>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>
            )}
          </>
        )}
        <button type="button" onClick={onToggleBot} aria-pressed={isBot} title={t("game.botOpponent")} aria-label={t("game.botOpponent")}
          className={`${iconButton} ${isBot ? "border-secondary bg-secondary/20 text-secondary" : "border-border bg-background text-muted-foreground"}`}>
          <Bot className="h-4 w-4" />
        </button>
        {onRemove && (
          <button type="button" onClick={onRemove} aria-label={t("game.removePlayer")} title={t("game.removePlayer")}
            className={`${iconButton} border-transparent text-muted-foreground hover:bg-destructive/15 hover:text-destructive`}>
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      {isBot && children}
    </li>
  );
};

export default PlayerSlotRow;
