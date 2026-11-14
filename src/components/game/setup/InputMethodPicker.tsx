import { useState } from "react";
import { Camera, CheckCircle2, X } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/contexts/LanguageContext";
import SetupSectionLabel from "./SetupSectionLabel";
import ChoiceChip from "./ChoiceChip";
import AutodartsLoginDialog from "./AutodartsLoginDialog";
import { removeAutodartsPlayerLogin, type AutodartsSource, type AutodartsSources } from "@/lib/autodartsClient";
import type { AutodartsPlayerLogins } from "@/lib/autodartsLegPlayers";

export interface AutodartsHumanSlot {
  slot: number;
  name: string;
}

interface InputMethodPickerProps {
  /** Autodarts is offered only when there is a source (own linked account or a club board) and the match fits an
   *  Autodarts X01 lobby (no teams, single or double out, same start score for everyone at the board). */
  autodartsOffered: boolean;
  autodartsEnabled: boolean;
  onAutodartsEnabledChange: (enabled: boolean) => void;
  sources: AutodartsSources;
  source: AutodartsSource | null;
  onSourceChange: (source: AutodartsSource) => void;
  /** The human players (bots left out), in slot order. */
  humans: AutodartsHumanSlot[];
  /** Slot whose Dartspot account owns the chosen source ("Dein Konto"), if that player plays. */
  hostSlot: number | null;
  logins: AutodartsPlayerLogins;
  onLoginsChange: (logins: AutodartsPlayerLogins) => void;
  hasBot: boolean;
  /** The club's plan includes the camera — it is switched on during the game with the Cam button. */
  cameraAvailable: boolean;
  /** Autodarts is in the plan but this member has no own account linked yet. */
  showLinkHint: boolean;
}

const sourceValue = (s: AutodartsSource) => (s.kind === "board" ? `board:${s.boardNumber}` : "account");
const parseSource = (v: string): AutodartsSource => (v.startsWith("board:") ? { kind: "board", boardNumber: parseInt(v.slice(6)) } : { kind: "account" });

/**
 * How the throws get scored: Manuell (keypad) or Autodarts. With Autodarts the member picks the board (their own
 * linked account or a club board), and every other human player can confirm their own Autodarts login so the match
 * also counts in their Autodarts account; without a login they play as a guest on the same board. The camera is
 * not chosen here — it is switched on and off during the game.
 */
const InputMethodPicker = ({
  autodartsOffered, autodartsEnabled, onAutodartsEnabledChange, sources, source, onSourceChange,
  humans, hostSlot, logins, onLoginsChange, hasBot, cameraAvailable, showLinkHint,
}: InputMethodPickerProps) => {
  const { t } = useLanguage();
  const [loginFor, setLoginFor] = useState<AutodartsHumanSlot | null>(null);
  const useAutodarts = autodartsOffered && autodartsEnabled;
  const tileClass = "flex h-[68px] flex-col items-start justify-center gap-0.5 rounded-2xl px-3 text-left";

  const options: { value: string; label: string; disabled: boolean }[] = [
    ...(sources.account ? [{
      value: "account",
      label: `${t("autodarts.sourceMine")}${sources.account.boardName ? ` · ${sources.account.boardName}` : ""}`,
      disabled: sources.account.status !== "connected",
    }] : []),
    ...sources.clubBoards.map((b) => ({
      value: `board:${b.boardNumber}`,
      label: `${b.label || `Board ${b.boardNumber}`}${b.status !== "connected" ? ` (${t("game.autodartsNotConnected")})` : ""}`,
      disabled: b.status !== "connected",
    })),
  ];
  const chosen = source ? options.find((o) => o.value === sourceValue(source)) : undefined;

  const removeLogin = (slot: number) => {
    const login = logins[slot];
    if (login) void removeAutodartsPlayerLogin(login.loginId);
    const next = { ...logins };
    delete next[slot];
    onLoginsChange(next);
  };

  return (
    <section className="space-y-2" aria-labelledby="setup-input-label">
      <SetupSectionLabel id="setup-input-label">{t("game.setupInput")}</SetupSectionLabel>
      <div className={`grid gap-2 ${autodartsOffered ? "grid-cols-2" : "grid-cols-1"}`}>
        <ChoiceChip selected={!useAutodarts} onClick={() => onAutodartsEnabledChange(false)} className={tileClass}>
          <span className="text-[15px] font-semibold">{t("game.inputManual")}</span>
          <span className="text-xs font-normal text-muted-foreground">{t("game.inputManualSub")}</span>
        </ChoiceChip>
        {autodartsOffered && (
          <ChoiceChip selected={useAutodarts} onClick={() => onAutodartsEnabledChange(true)} className={tileClass}>
            <span className="text-[15px] font-semibold">Autodarts</span>
            <span className="w-full truncate text-xs font-normal text-muted-foreground">{chosen?.label ?? ""}</span>
          </ChoiceChip>
        )}
      </div>

      {useAutodarts && (
        <div className="space-y-2">
          {options.length > 1 && (
            <Select value={source ? sourceValue(source) : undefined} onValueChange={(v) => onSourceChange(parseSource(v))}>
              <SelectTrigger className="h-12 rounded-xl border-border bg-card" aria-label={t("game.autodartsChooseBoard")}>
                <SelectValue placeholder={t("game.autodartsChooseBoard")} />
              </SelectTrigger>
              <SelectContent className="border-border bg-card">
                {options.map((o) => (
                  <SelectItem key={o.value} value={o.value} disabled={o.disabled}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {humans.length > 0 && (
            <div className="rounded-2xl border border-border bg-card">
              <p className="px-3 pt-2.5 text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{t("autodarts.playersTitle")}</p>
              <ul className="divide-y divide-border">
                {humans.map((h) => {
                  const login = logins[h.slot]?.playerName === h.name ? logins[h.slot] : undefined;
                  const isHost = h.slot === hostSlot;
                  return (
                    <li key={h.slot} className="flex min-h-[52px] items-center gap-2 px-3 py-2">
                      <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">{h.name}</span>
                      {isHost ? (
                        <span className="flex items-center gap-1 text-[13px] text-secondary"><CheckCircle2 className="h-4 w-4" /> {t("autodarts.yourAccount")}</span>
                      ) : login ? (
                        <>
                          <span className="flex min-w-0 items-center gap-1 truncate text-[13px] text-secondary">
                            <CheckCircle2 className="h-4 w-4 shrink-0" /> {login.username ?? h.name}
                          </span>
                          <Button variant="ghost" size="icon" className="h-11 w-11 shrink-0 rounded-xl" aria-label={t("autodarts.remove")} onClick={() => removeLogin(h.slot)}>
                            <X className="h-4 w-4" />
                          </Button>
                        </>
                      ) : (
                        <>
                          <span className="text-[13px] text-muted-foreground">{t("autodarts.guest")}</span>
                          <Button variant="outline" size="sm" className="h-11 shrink-0 rounded-xl" onClick={() => setLoginFor(h)}>
                            {t("autodarts.confirmLogin")}
                          </Button>
                        </>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          {hasBot && <p className="text-[13px] text-muted-foreground">{t("autodarts.botNote")}</p>}
        </div>
      )}

      {showLinkHint && !useAutodarts && <p className="text-[13px] text-muted-foreground">{t("autodarts.notLinkedHint")}</p>}
      {cameraAvailable && !useAutodarts && (
        <p className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
          <Camera className="h-3.5 w-3.5 shrink-0" /> {t("game.inputCameraHint")}
        </p>
      )}

      <AutodartsLoginDialog
        playerName={loginFor?.name ?? null}
        onClose={() => setLoginFor(null)}
        onConfirmed={(l) => {
          if (loginFor) onLoginsChange({ ...logins, [loginFor.slot]: { loginId: l.loginId, username: l.username, playerName: loginFor.name } });
          setLoginFor(null);
        }}
      />
    </section>
  );
};

export default InputMethodPicker;
