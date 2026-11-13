import type { Dispatch, SetStateAction } from "react";
import { UserPlus } from "lucide-react";
import type { BotLevel, GameMode } from "@/types/game";
import type { ClubPlayer } from "@/lib/repositories/players";
import { MAX_PLAYERS } from "@/pages/Game";
import { useLanguage } from "@/contexts/LanguageContext";
import {
  firstFreeSlot, removeSlotAt, slotOfMember, starterAfterRemoval, throwOrderBySlot,
} from "@/utils/playerLineup";
import SetupSectionLabel from "./SetupSectionLabel";
import ClubMemberChips from "./ClubMemberChips";
import PlayerSlotRow from "./PlayerSlotRow";
import BotLevelPicker from "./BotLevelPicker";

type Setter<T> = Dispatch<SetStateAction<T>>;

export interface PlayerLineupSectionProps {
  mode: GameMode;
  teamMode: boolean;
  teamNames: [string, string];
  numPlayers: number;
  setNumPlayers: Setter<number>;
  /** Tournament match: player count is fixed by the bracket. */
  locked: boolean;
  dbPlayers: ClubPlayer[];
  playerNames: string[];
  setPlayerNames: Setter<string[]>;
  playerIsBot: boolean[];
  setPlayerIsBot: Setter<boolean[]>;
  playerBotLevel: BotLevel[];
  setPlayerBotLevel: Setter<BotLevel[]>;
  playerGhostTarget: ("off" | "own-pb")[];
  setPlayerGhostTarget: Setter<("off" | "own-pb")[]>;
  playerDoubleIn: boolean[];
  setPlayerDoubleIn: Setter<boolean[]>;
  playerDoubleOut: boolean[];
  setPlayerDoubleOut: Setter<boolean[]>;
  playerMasterOut: boolean[];
  setPlayerMasterOut: Setter<boolean[]>;
  setPlayerHandicap: Setter<number[]>;
  botDisplayName: (slot: number) => string;
  starterIndex: number;
  setStarterIndex: Setter<number>;
  bullOffEnabled: boolean;
  /** "PIN pro Spieler": a member with a PIN goes through the PIN dialog before landing in a slot. */
  requestPin: (slot: number, member: ClubPlayer) => void;
}

const setAt = <T,>(index: number, value: T) => (prev: T[]) => prev.map((v, i) => (i === index ? value : v));

/**
 * The players block: club members as tap-to-pick tiles, then the lineup in throw order (badge 1, 2, 3 …) with
 * name, bot and remove per slot, then "add player" (or the team size in team mode).
 */
const PlayerLineupSection = (props: PlayerLineupSectionProps) => {
  const {
    mode, teamMode, teamNames, numPlayers, setNumPlayers, locked, dbPlayers,
    playerNames, setPlayerNames, playerIsBot, setPlayerIsBot, playerBotLevel, setPlayerBotLevel,
    playerGhostTarget, setPlayerGhostTarget, playerDoubleIn, setPlayerDoubleIn, playerDoubleOut, setPlayerDoubleOut,
    playerMasterOut, setPlayerMasterOut, setPlayerHandicap, botDisplayName, starterIndex, setStarterIndex, bullOffEnabled, requestPin,
  } = props;
  const { t } = useLanguage();

  const throwOrder = throwOrderBySlot(numPlayers, starterIndex, teamMode);
  const canAddSlot = !teamMode && !locked && numPlayers < MAX_PLAYERS;
  const canRemoveSlot = !teamMode && !locked && numPlayers > 2;

  const putMemberInSlot = (slot: number, member: ClubPlayer) => {
    if (member.pin_hash) requestPin(slot, member);
    else setPlayerNames(setAt(slot, member.name));
  };

  /** Opens the next slot as an empty human player with the same in/out rule as the first player. */
  const addSlot = (): number => {
    const slot = numPlayers;
    setPlayerNames(setAt(slot, ""));
    setPlayerIsBot(setAt(slot, false));
    setPlayerGhostTarget(setAt<"off" | "own-pb">(slot, "off"));
    setPlayerDoubleIn(setAt(slot, playerDoubleIn[0] ?? false));
    setPlayerDoubleOut(setAt(slot, playerDoubleOut[0] ?? true));
    setPlayerMasterOut(setAt(slot, playerMasterOut[0] ?? false));
    setPlayerHandicap(setAt(slot, 0));
    setNumPlayers(numPlayers + 1);
    return slot;
  };

  const removeSlot = (slot: number) => {
    setPlayerNames((prev) => removeSlotAt(prev, slot, ""));
    setPlayerIsBot((prev) => removeSlotAt(prev, slot, false));
    setPlayerBotLevel((prev) => removeSlotAt<BotLevel>(prev, slot, "medium"));
    setPlayerGhostTarget((prev) => removeSlotAt<"off" | "own-pb">(prev, slot, "off"));
    setPlayerDoubleIn((prev) => removeSlotAt(prev, slot, false));
    setPlayerDoubleOut((prev) => removeSlotAt(prev, slot, true));
    setPlayerMasterOut((prev) => removeSlotAt(prev, slot, false));
    setPlayerHandicap((prev) => removeSlotAt(prev, slot, 0));
    setStarterIndex(starterAfterRemoval(starterIndex, slot, numPlayers));
    setNumPlayers(numPlayers - 1);
  };

  const toggleMember = (member: ClubPlayer) => {
    const slot = slotOfMember(member.name, playerNames, playerIsBot, numPlayers);
    if (slot >= 0) {
      if (canRemoveSlot) removeSlot(slot);
      else setPlayerNames(setAt(slot, ""));
      return;
    }
    const free = firstFreeSlot(playerNames, playerIsBot, numPlayers);
    if (free >= 0) putMemberInSlot(free, member);
    else if (canAddSlot) putMemberInSlot(addSlot(), member);
  };

  const positionByMemberId = new Map<string, number>();
  for (const member of dbPlayers) {
    const slot = slotOfMember(member.name, playerNames, playerIsBot, numPlayers);
    if (slot >= 0) positionByMemberId.set(member.id, throwOrder[slot]);
  }
  const canAddMore = canAddSlot || firstFreeSlot(playerNames, playerIsBot, numPlayers) >= 0;
  const teamLabel = (slot: number) => (slot % 2 === 0 ? (teamNames[0].trim() || `${t("game.team")} 1`) : (teamNames[1].trim() || `${t("game.team")} 2`));

  return (
    <section className="space-y-2" aria-labelledby="setup-players-label">
      <SetupSectionLabel id="setup-players-label" aside={`${numPlayers} ${t("game.playersSuffix")}`}>
        {t("game.setupPlayersSection")}
      </SetupSectionLabel>

      {dbPlayers.length > 0 && (
        <ClubMemberChips members={dbPlayers} positionByMemberId={positionByMemberId} canAddMore={canAddMore} onToggleMember={toggleMember} />
      )}

      <ol className="space-y-2">
        {Array.from({ length: numPlayers }, (_, slot) => (
          <PlayerSlotRow
            key={slot}
            throwPosition={throwOrder[slot]}
            team={teamMode ? { label: teamLabel(slot), tone: slot % 2 === 0 ? "primary" : "secondary" } : undefined}
            isBot={playerIsBot[slot]}
            name={playerNames[slot] ?? ""}
            botName={botDisplayName(slot)}
            onNameChange={(name) => setPlayerNames(setAt(slot, name))}
            members={dbPlayers}
            onPickMember={(member) => putMemberInSlot(slot, member)}
            onToggleBot={() => setPlayerIsBot(setAt(slot, !playerIsBot[slot]))}
            onRemove={canRemoveSlot ? () => removeSlot(slot) : undefined}
          >
            <BotLevelPicker
              level={playerBotLevel[slot]}
              ghostTarget={playerGhostTarget[slot]}
              ghostAllowed={mode !== "cricket" && !teamMode}
              onPickLevel={(level) => { setPlayerBotLevel(setAt(slot, level)); setPlayerGhostTarget(setAt<"off" | "own-pb">(slot, "off")); }}
              onPickGhost={() => setPlayerGhostTarget((prev) => prev.map((v, i) => (i === slot && v === "off" ? "own-pb" : v)))}
            />
          </PlayerSlotRow>
        ))}
      </ol>

      {teamMode ? (
        <div className="flex gap-1 rounded-xl bg-muted/50 p-1" role="group" aria-label={t("game.playersPerTeam")}>
          {[4, 6, 8].map((n) => (
            <button key={n} type="button" onClick={() => setNumPlayers(n)} disabled={locked} aria-pressed={numPlayers === n}
              className={`min-h-[44px] flex-1 rounded-lg px-2 font-display text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${numPlayers === n ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
              {n / 2} vs {n / 2}
            </button>
          ))}
        </div>
      ) : canAddSlot && (
        <button type="button" onClick={addSlot}
          className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-border text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
          <UserPlus className="h-4 w-4" /> {t("game.addPlayer")}
        </button>
      )}

      <p className="text-[13px] text-muted-foreground">
        {t("game.throwOrderHint")}{bullOffEnabled ? ` ${t("game.throwOrderBullOffHint")}` : ""}
      </p>
    </section>
  );
};

export default PlayerLineupSection;
