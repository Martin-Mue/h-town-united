import type { GameMode } from "@/types/game";
import type { CheckoutRule } from "@/utils/playerLineup";

export interface SetupSummaryInput {
  mode: GameMode;
  customStartScore: number;
  checkoutRule: CheckoutRule;
  bestOfLegs: number;
  setsEnabled: boolean;
  bestOfSets: number;
  numPlayers: number;
  teamMode: boolean;
  inputLabel: string;
}

export interface SetupSummaryLabels {
  doubleOut: string;
  singleOut: string;
  firstTo: string;
  legs: string;
  sets: string;
  players: string;
}

/**
 * The recap line above "Spiel starten", e.g. "501 · Double Out · First to 3 Legs · 2 Spieler · Manuell".
 * Cricket has no out rule or leg distance on this screen; a mixed per-player out rule is left out.
 */
export function describeSetupSummary(s: SetupSummaryInput, l: SetupSummaryLabels): string {
  const x01 = s.mode !== "cricket";
  const parts: string[] = [s.mode === "custom" ? String(s.customStartScore) : s.mode === "cricket" ? "Cricket" : s.mode];
  if (x01 && s.checkoutRule !== "mixed") parts.push(s.checkoutRule === "double" ? l.doubleOut : l.singleOut);
  if (x01) {
    parts.push(s.setsEnabled
      ? `${l.firstTo} ${Math.ceil(s.bestOfSets / 2)} ${l.sets}`
      : `${l.firstTo} ${Math.ceil(s.bestOfLegs / 2)} ${l.legs}`);
  }
  parts.push(s.teamMode ? `${s.numPlayers / 2} vs ${s.numPlayers / 2}` : `${s.numPlayers} ${l.players}`);
  parts.push(s.inputLabel);
  return parts.join(" · ");
}
