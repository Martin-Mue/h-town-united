import { useRef, type Dispatch, type SetStateAction, type MutableRefObject } from "react";
import OnlineChallengeSetup from "@/components/game/OnlineChallengeSetup";
import GamePresets from "@/components/game/GamePresets";
import BoardModeStartCard from "@/components/game/setup/BoardModeStartCard";
import RepeatLastGameButton from "@/components/game/setup/RepeatLastGameButton";
import GameModePicker from "@/components/game/setup/GameModePicker";
import CheckoutRulePicker from "@/components/game/setup/CheckoutRulePicker";
import MatchDistanceCard from "@/components/game/setup/MatchDistanceCard";
import PlayerLineupSection from "@/components/game/setup/PlayerLineupSection";
import InputMethodPicker from "@/components/game/setup/InputMethodPicker";
import MoreOptionsSection, { MoreOptionsGroup } from "@/components/game/setup/MoreOptionsSection";
import TeamModeOptions from "@/components/game/setup/TeamModeOptions";
import FormatOptions from "@/components/game/setup/FormatOptions";
import PerPlayerRulesOptions from "@/components/game/setup/PerPlayerRulesOptions";
import MatchStartOptions from "@/components/game/setup/MatchStartOptions";
import AtmosphereOptions from "@/components/game/setup/AtmosphereOptions";
import SaveGamePresetForm from "@/components/game/setup/SaveGamePresetForm";
import PinConfirmDialog from "@/components/game/setup/PinConfirmDialog";
import SetupStartBar from "@/components/game/setup/SetupStartBar";
import type { GameMode, BotLevel } from "@/types/game";
import type { CallerVoice } from "@/utils/speech";
import type { ClubPlayer } from "@/lib/repositories/players";
import type { TournamentLink } from "@/lib/activeGameSnapshot";
import type { LeagueLink } from "@/hooks/useLeagueLink";
import { useLanguage } from "@/contexts/LanguageContext";
import { useAuth } from "@/contexts/AuthContext";
import { useClubBranding } from "@/contexts/ClubBrandingContext";
import { clubHasFeature } from "@/lib/planFeatures";
import { overlaySlots, saveLastGameSetup, type GamePresetConfig } from "@/utils/gamePreset";
import { sharedCheckoutRule } from "@/utils/playerLineup";
import { describeSetupSummary } from "@/utils/setupSummary";

interface GameSetupProps {
  // Tournament/league linkage + board-mode auto-start (state/effects stay in Game.tsx — see
  // useTournamentLink's own doc comment for why the board-mode machinery wasn't moved there either)
  tournamentLinkRef: MutableRefObject<TournamentLink | null>;
  tournamentLinkName: string | null;
  leagueLinkRef: MutableRefObject<LeagueLink | null>;
  autoStartCanceled: boolean;
  setAutoStartCanceled: Dispatch<SetStateAction<boolean>>;
  boardStartGate: "checking" | "clear" | "blocked-mode" | "blocked-collision";
  autoStartSecondsLeft: number;
  startGame: () => void;

  // Mode/format
  mode: GameMode;
  setMode: Dispatch<SetStateAction<GameMode>>;
  customStartScore: number;
  setCustomStartScore: Dispatch<SetStateAction<number>>;
  teamMode: boolean;
  setTeamMode: Dispatch<SetStateAction<boolean>>;
  numPlayers: number;
  setNumPlayers: Dispatch<SetStateAction<number>>;
  teamNames: [string, string];
  setTeamNames: Dispatch<SetStateAction<[string, string]>>;
  bestOfLegs: number;
  setBestOfLegs: Dispatch<SetStateAction<number>>;
  setsEnabled: boolean;
  setSetsEnabled: Dispatch<SetStateAction<boolean>>;
  bestOfSets: number;
  setBestOfSets: Dispatch<SetStateAction<number>>;
  checkoutSuggestionEnabled: boolean;
  setCheckoutSuggestionEnabled: Dispatch<SetStateAction<boolean>>;
  showAdvancedSetup: boolean;
  revealAdvancedSetup: () => void;
  customCricket: boolean;
  setCustomCricket: Dispatch<SetStateAction<boolean>>;
  maxRoundsX01: number;
  setMaxRoundsX01: Dispatch<SetStateAction<number>>;

  // Players
  playerNames: string[];
  setPlayerNames: Dispatch<SetStateAction<string[]>>;
  dbPlayers: ClubPlayer[];
  playerIsBot: boolean[];
  setPlayerIsBot: Dispatch<SetStateAction<boolean[]>>;
  playerBotLevel: BotLevel[];
  setPlayerBotLevel: Dispatch<SetStateAction<BotLevel[]>>;
  playerGhostTarget: ("off" | "own-pb")[];
  setPlayerGhostTarget: Dispatch<SetStateAction<("off" | "own-pb")[]>>;
  playerDoubleIn: boolean[];
  setPlayerDoubleIn: Dispatch<SetStateAction<boolean[]>>;
  playerDoubleOut: boolean[];
  setPlayerDoubleOut: Dispatch<SetStateAction<boolean[]>>;
  playerHandicap: number[];
  setPlayerHandicap: Dispatch<SetStateAction<number[]>>;
  botDisplayName: (i: number) => string;
  getStartScore: () => number;

  // PIN dialog ("PIN pro Spieler" — see submitPinPrompt's own doc comment in Game.tsx)
  pinPrompt: { slotIndex: number; player: ClubPlayer } | null;
  setPinPrompt: Dispatch<SetStateAction<{ slotIndex: number; player: ClubPlayer } | null>>;
  pinPromptValue: string;
  setPinPromptValue: Dispatch<SetStateAction<string>>;
  pinPromptError: boolean;
  setPinPromptError: Dispatch<SetStateAction<boolean>>;
  pinPromptChecking: boolean;
  submitPinPrompt: () => Promise<void>;

  // Extras
  soundEnabled: boolean;
  setSoundEnabled: Dispatch<SetStateAction<boolean>>;
  speechEnabled: boolean;
  callerVoice: CallerVoice;
  changeCallerVoice: (v: CallerVoice) => void;
  starterIndex: number;
  setStarterIndex: Dispatch<SetStateAction<number>>;
  bullOffEnabled: boolean;
  setBullOffEnabled: (on: boolean) => void;
  warmupEnabled: boolean;
  setWarmupEnabled: Dispatch<SetStateAction<boolean>>;
  warmupSeconds: number;
  setWarmupSeconds: Dispatch<SetStateAction<number>>;
  walkonEnabled: boolean;
  setWalkonEnabled: Dispatch<SetStateAction<boolean>>;

  // Local-vs-online setup toggle (not persisted, see Game.tsx's own declaration comment)
  setupMode: "local" | "online";
  setSetupMode: Dispatch<SetStateAction<"local" | "online">>;

  // Autodarts scoring source (see AutodartsLiveScore.tsx / AdminAutodarts.tsx). Deliberately its
  // own on/off flag rather than folded into a single "camera vs autodarts vs manual" enum: the
  // camera's own enable/disable button (live inside Game.tsx's playing phase) stays completely
  // untouched by this -- unlike the camera, Autodarts can't be freely toggled mid-leg (starting a
  // Free Game lobby is a real action against Autodarts' own platform for the whole match, not a
  // per-turn option), so it's fixed once at setup instead of living next to the "Cam" button.
  autodartsAvailable: boolean;
  autodartsBoards: { id: string; boardNumber: number; label: string | null; status: string }[];
  autodartsEnabled: boolean;
  setAutodartsEnabled: Dispatch<SetStateAction<boolean>>;
  autodartsBoardNumber: number | null;
  setAutodartsBoardNumber: Dispatch<SetStateAction<number | null>>;
}

/**
 * The pre-match setup ("Neues Spiel"). Every piece of state still lives in Game.tsx and is threaded through as props;
 * this file only arranges it. Three sub-views: the board-mode countdown card, the "Online spielen" hand-off to
 * OnlineChallengeSetup, and the one-screen local setup: mode, out rule, distance, players in throw order, input
 * method, "Spiel starten" — with the rarely changed settings folded into "Mehr Optionen".
 */
const GameSetup = (props: GameSetupProps) => {
  const { session } = useAuth();
  const { club } = useClubBranding();
  const {
    tournamentLinkRef, tournamentLinkName, leagueLinkRef, autoStartCanceled, setAutoStartCanceled,
    boardStartGate, autoStartSecondsLeft, startGame,
    mode, setMode, customStartScore, setCustomStartScore, teamMode, setTeamMode, numPlayers, setNumPlayers,
    teamNames, setTeamNames, bestOfLegs, setBestOfLegs, setsEnabled, setSetsEnabled, bestOfSets, setBestOfSets,
    checkoutSuggestionEnabled, setCheckoutSuggestionEnabled,
    customCricket, setCustomCricket, maxRoundsX01, setMaxRoundsX01,
    playerNames, setPlayerNames, dbPlayers, playerIsBot, setPlayerIsBot, playerBotLevel, setPlayerBotLevel,
    playerGhostTarget, setPlayerGhostTarget, playerDoubleIn, setPlayerDoubleIn, playerDoubleOut, setPlayerDoubleOut,
    playerHandicap, setPlayerHandicap, botDisplayName, getStartScore,
    pinPrompt, setPinPrompt, pinPromptValue, setPinPromptValue, pinPromptError, setPinPromptError,
    pinPromptChecking, submitPinPrompt,
    soundEnabled, setSoundEnabled, speechEnabled, callerVoice, changeCallerVoice,
    starterIndex, setStarterIndex, bullOffEnabled, setBullOffEnabled, warmupEnabled, setWarmupEnabled, warmupSeconds, setWarmupSeconds,
    walkonEnabled, setWalkonEnabled, setupMode, setSetupMode,
    autodartsAvailable, autodartsBoards, autodartsEnabled, setAutodartsEnabled, autodartsBoardNumber, setAutodartsBoardNumber,
  } = props;
  const { t } = useLanguage();
  // How many players were set before teams were switched on, to go back to when they are switched off again.
  const playersBeforeTeamsRef = useRef<number | null>(null);
  const changeTeamMode = (on: boolean) => {
    setTeamMode(on);
    if (on) {
      playersBeforeTeamsRef.current = numPlayers;
      if (numPlayers < 4 || numPlayers % 2 !== 0) setNumPlayers(4);
      return;
    }
    const restored = playersBeforeTeamsRef.current ?? numPlayers;
    playersBeforeTeamsRef.current = null;
    setNumPlayers(restored);
    // with teams the starter is a team (0 or 1); as a player index it must still exist
    if (starterIndex >= restored) setStarterIndex(0);
  };

  // Mode/team-mode/player-count/best-of are exactly the fields the tournament bracket already fixed for this match —
  // editing them here would silently desync this game from the bracket entry it reports back to. Everything the
  // tournament doesn't track (double-out, handicap, bot, warmup, who-starts) stays editable, same as a casual game.
  const isTournamentMatch = !!tournamentLinkName;
  const isCasualGame = !tournamentLinkName && !leagueLinkRef.current;

  if (tournamentLinkRef.current?.board && !autoStartCanceled) {
    return (
      <BoardModeStartCard
        tournamentName={tournamentLinkName ?? ""}
        playerNames={playerNames}
        mode={mode}
        bestOfLegs={bestOfLegs}
        gate={boardStartGate}
        secondsLeft={autoStartSecondsLeft}
        onEdit={() => setAutoStartCanceled(true)}
        onStart={startGame}
      />
    );
  }

  const currentPreset: GamePresetConfig = {
    mode, customStartScore, teamMode, numPlayers, bestOfLegs, setsEnabled, bestOfSets, checkoutSuggestionEnabled,
    maxRoundsX01, customCricket, warmupEnabled, walkonEnabled,
    playerNames: playerNames.slice(0, numPlayers), playerIsBot: playerIsBot.slice(0, numPlayers),
    playerBotLevel: playerBotLevel.slice(0, numPlayers), playerDoubleIn: playerDoubleIn.slice(0, numPlayers),
    playerDoubleOut: playerDoubleOut.slice(0, numPlayers), playerHandicap: playerHandicap.slice(0, numPlayers),
  };
  const applyPreset = (p: GamePresetConfig) => {
    setMode(p.mode); setCustomStartScore(p.customStartScore); setTeamMode(p.teamMode); setNumPlayers(p.numPlayers);
    setBestOfLegs(p.bestOfLegs); setSetsEnabled(p.setsEnabled); setBestOfSets(p.bestOfSets);
    setCheckoutSuggestionEnabled(p.checkoutSuggestionEnabled); setMaxRoundsX01(p.maxRoundsX01); setCustomCricket(p.customCricket);
    setWarmupEnabled(p.warmupEnabled); setWalkonEnabled(p.walkonEnabled);
    setPlayerNames((prev) => overlaySlots(prev, p.playerNames));
    setPlayerIsBot((prev) => overlaySlots(prev, p.playerIsBot));
    setPlayerBotLevel((prev) => overlaySlots(prev, p.playerBotLevel));
    setPlayerDoubleIn((prev) => overlaySlots(prev, p.playerDoubleIn));
    setPlayerDoubleOut((prev) => overlaySlots(prev, p.playerDoubleOut));
    setPlayerHandicap((prev) => overlaySlots(prev, p.playerHandicap));
  };

  // "Online spielen" replaces this whole form with a challenge-a-member screen — only for a casual game; a
  // tournament/league match's opponent and mode are already fixed by the bracket/fixture.
  if (setupMode === "online" && isCasualGame) {
    return <OnlineChallengeSetup onBack={() => setSetupMode("local")} />;
  }

  const slotLabel = (slot: number) => (playerIsBot[slot] ? botDisplayName(slot) : (playerNames[slot]?.trim() || `${t("stats.player")} ${slot + 1}`));
  const hasBot = playerIsBot.slice(0, numPlayers).some(Boolean);
  const bullOffPossible = (teamMode || numPlayers === 2) && !playerIsBot[0] && !playerIsBot[1];
  const checkoutRule = sharedCheckoutRule(playerDoubleOut, numPlayers);

  // Autodarts only where a Free Game lobby can represent the match today (see AutodartsLiveScore.tsx: X01, no teams,
  // exactly 2 players). Its on/off flag stays separate from the camera, which is toggled during the game.
  const autodartsOffered = autodartsAvailable && autodartsBoards.length > 0 && !teamMode && numPlayers === 2 && (mode === "501" || mode === "301");
  const enableAutodarts = (on: boolean) => {
    setAutodartsEnabled(on);
    if (on && autodartsBoardNumber === null) {
      const firstConnected = autodartsBoards.find((b) => b.status === "connected") ?? autodartsBoards[0];
      if (firstConnected) setAutodartsBoardNumber(firstConnected.boardNumber);
    }
  };
  const inputLabel = autodartsOffered && autodartsEnabled ? "Autodarts" : t("game.inputManual");

  const starterChoices = (teamMode ? [0, 1] : Array.from({ length: numPlayers }, (_, i) => i)).map((i) => ({
    index: i,
    label: teamMode ? (teamNames[i].trim() || `${t("game.team")} ${i + 1}`) : slotLabel(i),
    chosen: teamMode ? starterIndex % 2 === i : starterIndex === i,
  }));

  const summary = describeSetupSummary(
    { mode, customStartScore, checkoutRule, bestOfLegs, setsEnabled, bestOfSets, numPlayers, teamMode, inputLabel },
    { doubleOut: t("game.doubleOut"), singleOut: t("game.singleOut"), firstTo: t("stats.firstTo"), legs: t("game.legsWord"), sets: t("game.setsWord"), players: t("game.playersSuffix") },
  );

  const closePinPrompt = () => { setPinPrompt(null); setPinPromptValue(""); setPinPromptError(false); };

  return (
    <div className="container mx-auto max-w-xl animate-slide-up space-y-5 py-4">
      <header className="flex flex-wrap items-center gap-2">
        <h1 className="min-w-0 flex-1 font-display text-[28px] font-bold leading-tight">{t("home.newGame")}</h1>
        {isCasualGame && <RepeatLastGameButton userId={session?.user?.id} onApply={applyPreset} />}
      </header>

      {isCasualGame && (
        <div className="flex rounded-xl border border-border bg-card p-1" role="group" aria-label={t("home.newGame")}>
          {(["local", "online"] as const).map((m) => (
            <button key={m} type="button" aria-pressed={setupMode === m} onClick={() => setSetupMode(m)}
              className={`min-h-[40px] flex-1 rounded-lg text-sm font-medium transition-colors ${setupMode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
              {m === "local" ? t("game.setupLocal") : t("game.setupOnline")}
            </button>
          ))}
        </div>
      )}

      {tournamentLinkName && (
        <div className="rounded-2xl border border-primary/40 bg-primary/10 px-3 py-2 text-center">
          <p className="text-xs font-medium text-primary">🏆 {t("game.tournamentMatch")} · {tournamentLinkName}</p>
          <p className="mt-0.5 text-[11px] text-primary/80">{t("game.tournamentMatchNote")}</p>
        </div>
      )}

      {isCasualGame && <GamePresets onApply={applyPreset} />}

      <GameModePicker mode={mode} onModeChange={setMode} customStartScore={customStartScore} onCustomStartScoreChange={setCustomStartScore} locked={isTournamentMatch} />

      {mode !== "cricket" && (
        <>
          <CheckoutRulePicker rule={checkoutRule} onRuleChange={(on) => setPlayerDoubleOut((prev) => prev.map(() => on))} />
          <MatchDistanceCard
            bestOfLegs={bestOfLegs}
            onBestOfLegsChange={setBestOfLegs}
            setsEnabled={setsEnabled}
            bestOfSets={bestOfSets}
            onBestOfSetsChange={setBestOfSets}
            locked={isTournamentMatch}
          />
        </>
      )}

      <PlayerLineupSection
        mode={mode}
        teamMode={teamMode}
        teamNames={teamNames}
        numPlayers={numPlayers}
        setNumPlayers={setNumPlayers}
        locked={isTournamentMatch}
        dbPlayers={dbPlayers}
        playerNames={playerNames}
        setPlayerNames={setPlayerNames}
        playerIsBot={playerIsBot}
        setPlayerIsBot={setPlayerIsBot}
        playerBotLevel={playerBotLevel}
        setPlayerBotLevel={setPlayerBotLevel}
        playerGhostTarget={playerGhostTarget}
        setPlayerGhostTarget={setPlayerGhostTarget}
        playerDoubleIn={playerDoubleIn}
        setPlayerDoubleIn={setPlayerDoubleIn}
        playerDoubleOut={playerDoubleOut}
        setPlayerDoubleOut={setPlayerDoubleOut}
        setPlayerHandicap={setPlayerHandicap}
        botDisplayName={botDisplayName}
        starterIndex={starterIndex}
        setStarterIndex={setStarterIndex}
        bullOffEnabled={bullOffEnabled && bullOffPossible}
        requestPin={(slot, member) => { setPinPrompt({ slotIndex: slot, player: member }); setPinPromptValue(""); setPinPromptError(false); }}
      />

      <InputMethodPicker
        autodartsOffered={autodartsOffered}
        autodartsBlockedByBot={hasBot}
        autodartsEnabled={autodartsEnabled}
        onAutodartsEnabledChange={enableAutodarts}
        boards={autodartsBoards}
        boardNumber={autodartsBoardNumber}
        onBoardNumberChange={setAutodartsBoardNumber}
        cameraAvailable={clubHasFeature(club?.plan_tier, "camera")}
      />

      <MoreOptionsSection>
        <MoreOptionsGroup title={t("game.setupFormatSection")}>
          <TeamModeOptions
            teamMode={teamMode}
            onTeamModeChange={changeTeamMode}
            teamNames={teamNames}
            onTeamNamesChange={setTeamNames}
            locked={isTournamentMatch}
          />
          <FormatOptions
            mode={mode}
            isTournamentMatch={isTournamentMatch}
            setsEnabled={setsEnabled}
            onSetsEnabledChange={setSetsEnabled}
            checkoutSuggestionEnabled={checkoutSuggestionEnabled}
            onCheckoutSuggestionChange={setCheckoutSuggestionEnabled}
            customCricket={customCricket}
            onCustomCricketChange={setCustomCricket}
            maxRoundsX01={maxRoundsX01}
            onMaxRoundsChange={setMaxRoundsX01}
          />
        </MoreOptionsGroup>

        {mode !== "cricket" && (
          <MoreOptionsGroup title={t("game.perPlayerRules")}>
            <PerPlayerRulesOptions
              numPlayers={numPlayers}
              teamMode={teamMode}
              slotLabel={slotLabel}
              playerDoubleIn={playerDoubleIn}
              onDoubleInChange={(slot, on) => setPlayerDoubleIn((prev) => prev.map((v, i) => (i === slot ? on : v)))}
              playerDoubleOut={playerDoubleOut}
              onDoubleOutChange={(slot, on) => setPlayerDoubleOut((prev) => prev.map((v, i) => (i === slot ? on : v)))}
              playerHandicap={playerHandicap}
              onHandicapChange={(slot, points) => setPlayerHandicap((prev) => prev.map((v, i) => (i === slot ? points : v)))}
              startScore={getStartScore()}
            />
          </MoreOptionsGroup>
        )}

        <MoreOptionsGroup title={t("game.whoStarts")}>
          <MatchStartOptions
            bullOffPossible={bullOffPossible}
            bullOffEnabled={bullOffEnabled}
            onBullOffChange={setBullOffEnabled}
            starterChoices={starterChoices}
            onPickStarter={setStarterIndex}
          />
        </MoreOptionsGroup>

        <MoreOptionsGroup title={t("game.setupExtrasSection")}>
          <AtmosphereOptions
            soundEnabled={soundEnabled}
            onSoundChange={setSoundEnabled}
            speechEnabled={speechEnabled}
            callerVoice={callerVoice}
            onCallerVoiceChange={changeCallerVoice}
            warmupEnabled={warmupEnabled}
            onWarmupChange={setWarmupEnabled}
            warmupSeconds={warmupSeconds}
            onWarmupSecondsChange={setWarmupSeconds}
            walkonEnabled={walkonEnabled}
            onWalkonChange={setWalkonEnabled}
          />
        </MoreOptionsGroup>

        {isCasualGame && <SaveGamePresetForm current={currentPreset} />}
      </MoreOptionsSection>

      <SetupStartBar
        summary={summary}
        label={warmupEnabled ? t("game.startWarmup") : t("game.startGame")}
        onStart={() => { if (isCasualGame) saveLastGameSetup(session?.user?.id, currentPreset); startGame(); }}
      />

      <PinConfirmDialog
        memberName={pinPrompt?.player.name ?? null}
        value={pinPromptValue}
        onValueChange={(v) => { setPinPromptValue(v); setPinPromptError(false); }}
        wrong={pinPromptError}
        checking={pinPromptChecking}
        onSubmit={submitPinPrompt}
        onClose={closePinPrompt}
      />
    </div>
  );
};

export default GameSetup;
