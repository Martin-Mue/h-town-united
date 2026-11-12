import { Camera } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useLanguage } from "@/contexts/LanguageContext";
import SetupSectionLabel from "./SetupSectionLabel";
import ChoiceChip from "./ChoiceChip";

export interface AutodartsBoardOption {
  id: string;
  boardNumber: number;
  label: string | null;
  status: string;
}

interface InputMethodPickerProps {
  /** Autodarts is offered only when the club has a board and the match fits a Free Game lobby (X01, 2 players, no teams). */
  autodartsOffered: boolean;
  /** Bots can't throw on a real board. */
  autodartsBlockedByBot: boolean;
  autodartsEnabled: boolean;
  onAutodartsEnabledChange: (enabled: boolean) => void;
  boards: AutodartsBoardOption[];
  boardNumber: number | null;
  onBoardNumberChange: (boardNumber: number) => void;
  /** The club's plan includes the camera — it is switched on during the game with the Cam button. */
  cameraAvailable: boolean;
}

const boardName = (b: AutodartsBoardOption) => b.label || `Board ${b.boardNumber}`;

/**
 * How the throws get scored: Manuell (keypad) or, where the club has a connected board, Autodarts. The camera is
 * not chosen here — it is switched on and off during the game, so this block only points to it.
 */
const InputMethodPicker = ({
  autodartsOffered, autodartsBlockedByBot, autodartsEnabled, onAutodartsEnabledChange,
  boards, boardNumber, onBoardNumberChange, cameraAvailable,
}: InputMethodPickerProps) => {
  const { t } = useLanguage();
  const useAutodarts = autodartsOffered && autodartsEnabled;
  const chosenBoard = boards.find((b) => b.boardNumber === boardNumber) ?? boards.find((b) => b.status === "connected") ?? boards[0];
  const tileClass = "flex h-[68px] flex-col items-start justify-center gap-0.5 rounded-2xl px-3 text-left";

  return (
    <section className="space-y-2" aria-labelledby="setup-input-label">
      <SetupSectionLabel id="setup-input-label">{t("game.setupInput")}</SetupSectionLabel>
      <div className={`grid gap-2 ${autodartsOffered ? "grid-cols-2" : "grid-cols-1"}`}>
        <ChoiceChip selected={!useAutodarts} onClick={() => onAutodartsEnabledChange(false)} className={tileClass}>
          <span className="text-[15px] font-semibold">{t("game.inputManual")}</span>
          <span className="text-xs font-normal text-muted-foreground">{t("game.inputManualSub")}</span>
        </ChoiceChip>
        {autodartsOffered && (
          <ChoiceChip selected={useAutodarts} disabled={autodartsBlockedByBot} onClick={() => onAutodartsEnabledChange(true)} className={tileClass}>
            <span className="text-[15px] font-semibold">Autodarts</span>
            <span className="w-full truncate text-xs font-normal text-muted-foreground">
              {autodartsBlockedByBot ? t("game.autodartsBotBlocked") : chosenBoard ? boardName(chosenBoard) : ""}
            </span>
          </ChoiceChip>
        )}
      </div>
      {useAutodarts && (
        <Select value={boardNumber !== null ? String(boardNumber) : undefined} onValueChange={(v) => onBoardNumberChange(parseInt(v))}>
          <SelectTrigger className="h-12 rounded-xl border-border bg-card" aria-label={t("game.autodartsChooseBoard")}>
            <SelectValue placeholder={t("game.autodartsChooseBoard")} />
          </SelectTrigger>
          <SelectContent className="border-border bg-card">
            {boards.map((b) => (
              <SelectItem key={b.id} value={String(b.boardNumber)} disabled={b.status !== "connected"}>
                {boardName(b)}{b.status !== "connected" ? ` (${t("game.autodartsNotConnected")})` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {cameraAvailable && !useAutodarts && (
        <p className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
          <Camera className="h-3.5 w-3.5 shrink-0" /> {t("game.inputCameraHint")}
        </p>
      )}
    </section>
  );
};

export default InputMethodPicker;
