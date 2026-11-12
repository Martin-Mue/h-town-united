import { CalendarDays, CalendarPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLanguage } from "@/contexts/LanguageContext";

interface LeagueRoundHeaderProps {
  label: string;
  overdue: boolean;
  scheduledDate: string | null;
  /** Already formatted for the viewer's language; shown read-only to non-organizers. */
  formattedDate: string | null;
  /** Only the organizer can set the matchday date. */
  editable: boolean;
  saving: boolean;
  onDateChange: (date: string) => void;
  onExportCalendar: () => void;
}

/** Heading of one matchday: round label, overdue marker, matchday date (editable for the organizer) and calendar export. */
const LeagueRoundHeader = ({ label, overdue, scheduledDate, formattedDate, editable, saving, onDateChange, onExportCalendar }: LeagueRoundHeaderProps) => {
  const { t } = useLanguage();
  return (
    <div className="mb-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
      <h3 className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
        {label}
        {overdue && (
          <span className="rounded-md bg-destructive/15 px-1.5 py-0.5 text-[11px] normal-case tracking-normal text-destructive">{t("league.deadlineOverdue")}</span>
        )}
      </h3>
      <div className="flex items-center gap-1.5">
        {editable ? (
          <label className="flex items-center gap-1.5">
            <CalendarDays aria-hidden="true" className="h-4 w-4 text-muted-foreground" />
            <span className="sr-only">{label}</span>
            <Input
              type="date"
              value={scheduledDate ?? ""}
              disabled={saving}
              onChange={(e) => onDateChange(e.target.value)}
              className="h-11 w-[150px] rounded-[10px] border-border bg-muted px-2 text-sm"
            />
          </label>
        ) : formattedDate ? (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <CalendarDays aria-hidden="true" className="h-4 w-4" /> {formattedDate}
          </p>
        ) : null}
        {scheduledDate && (
          <Button
            size="icon"
            variant="ghost"
            className="h-11 w-11 shrink-0"
            title={t("league.addToCalendar")}
            aria-label={t("league.addToCalendar")}
            onClick={onExportCalendar}
          >
            <CalendarPlus className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
};

export default LeagueRoundHeader;
