import type { Dispatch, SetStateAction, MutableRefObject } from "react";
import { Trophy, Target, Users, Volume2, VolumeX, Mic, MicOff, Bot, ChevronUp, ChevronDown, Settings2, Lock } from "lucide-react";
import { DartLoaderIcon as Loader2 } from "@/components/icons/DartIcons";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger, PopoverClose } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Eyebrow, SectionCard } from "@/components/stats/StatPrimitives";
import OnlineChallengeSetup from "@/components/game/OnlineChallengeSetup";
import { BOT_PROFILES, MAX_PLAYERS } from "@/pages/Game";
import type { GameMode, BotLevel } from "@/types/game";
import type { CallerVoice } from "@/utils/speech";
import type { ClubPlayer } from "@/lib/repositories/players";
import type { TournamentLink } from "@/lib/activeGameSnapshot";
import type { LeagueLink } from "@/hooks/useLeagueLink";
import { useLanguage } from "@/contexts/LanguageContext";

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
  warmupEnabled: boolean;
  setWarmupEnabled: Dispatch<SetStateAction<boolean>>;
  warmupSeconds: number;
  setWarmupSeconds: Dispatch<SetStateAction<number>>;
  walkonEnabled: boolean;
  setWalkonEnabled: Dispatch<SetStateAction<boolean>>;

  // Local-vs-online setup toggle (not persisted, see Game.tsx's own declaration comment)
  setupMode: "local" | "online";
  setSetupMode: Dispatch<SetStateAction<"local" | "online">>;
}

/**
 * The pre-match setup form, extracted verbatim out of Game.tsx's `phase === "setup"` branch
 * (Design-Sprint Phase 3, "Spiel-Screen in eigenständige Teil-Screens aufteilen") — pure JSX
 * relocation, every piece of state still lives in Game.tsx and is threaded through as props here,
 * so this is a file-organization change only, not a behavior change. Covers all three of its
 * sub-views: the board-mode confirmation/countdown card, the "Online spielen" hand-off to
 * OnlineChallengeSetup, and the full local setup form (with its PIN-confirmation dialog).
 */
const GameSetup = (props: GameSetupProps) => {
  const {
    tournamentLinkRef, tournamentLinkName, leagueLinkRef, autoStartCanceled, setAutoStartCanceled,
    boardStartGate, autoStartSecondsLeft, startGame,
    mode, setMode, customStartScore, setCustomStartScore, teamMode, setTeamMode, numPlayers, setNumPlayers,
    teamNames, setTeamNames, bestOfLegs, setBestOfLegs, setsEnabled, setSetsEnabled, bestOfSets, setBestOfSets,
    checkoutSuggestionEnabled, setCheckoutSuggestionEnabled, showAdvancedSetup, revealAdvancedSetup,
    customCricket, setCustomCricket, maxRoundsX01, setMaxRoundsX01,
    playerNames, setPlayerNames, dbPlayers, playerIsBot, setPlayerIsBot, playerBotLevel, setPlayerBotLevel,
    playerGhostTarget, setPlayerGhostTarget, playerDoubleIn, setPlayerDoubleIn, playerDoubleOut, setPlayerDoubleOut,
    playerHandicap, setPlayerHandicap, botDisplayName, getStartScore,
    pinPrompt, setPinPrompt, pinPromptValue, setPinPromptValue, pinPromptError, setPinPromptError,
    pinPromptChecking, submitPinPrompt,
    soundEnabled, setSoundEnabled, speechEnabled, callerVoice, changeCallerVoice,
    starterIndex, setStarterIndex, warmupEnabled, setWarmupEnabled, warmupSeconds, setWarmupSeconds,
    walkonEnabled, setWalkonEnabled, setupMode, setSetupMode,
  } = props;
  const { t } = useLanguage();

  const activePlayerCount = numPlayers;
  // Mode/team-mode/player-count/best-of are exactly the fields the tournament bracket already
  // fixed for this match (see the tid/mid prefill effect above) — editing them here wouldn't
  // just be pointless, it'd silently desync this game from the bracket entry it's supposed to
  // report back to. Locked whenever a match is tournament-linked; everything NOT tracked by the
  // tournament's own data model (double-out, handicap, bot, warmup, who-starts) stays freely
  // editable, same as a casual game.
  const isTournamentMatch = !!tournamentLinkName;

  // Board-mode confirmation: a compact "here's the match, starting in Xs" screen instead of
  // the full form below — mode/players/best-of are already correct from the bracket, so there's
  // nothing to review there; "Bearbeiten" reveals the full form for the rare case something
  // else (handicap, warmup, who-starts) needs a look first.
  if (tournamentLinkRef.current?.board && !autoStartCanceled) {
    // Blocked outcomes never auto-start and never show a countdown — "blocked-mode" (Extern /
    // live play off) offers no start button at all (this device isn't meant to play it live),
    // "blocked-collision" requires an explicit tap, same intent as the flat view's window.confirm
    // adapted to a real button since a countdown screen shouldn't confirm() mid-render.
    if (boardStartGate === "blocked-mode" || boardStartGate === "blocked-collision") {
      return (
        <div className="container py-10 max-w-sm mx-auto text-center animate-slide-up">
          <div className="rounded-lg border border-primary/40 bg-primary/10 px-3 py-2 mb-6">
            <p className="text-xs text-primary font-medium">🏆 {t("game.tournamentMatch")} · {tournamentLinkName}</p>
          </div>
          <p className="text-lg font-display mb-1 truncate">{playerNames[0]}</p>
          <p className="text-xs text-muted-foreground mb-1">vs.</p>
          <p className="text-lg font-display mb-4 truncate">{playerNames[1]}</p>
          <p className="text-sm text-muted-foreground bg-muted/30 border border-border rounded-lg px-3 py-3 mb-6">
            {boardStartGate === "blocked-collision"
              ? `${playerNames[0]} vs. ${playerNames[1]} ${t("tournament.matchAlreadyRunningConfirm")}`
              : t("game.boardStartBlocked")}
          </p>
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setAutoStartCanceled(true)}>{t("common.edit")}</Button>
            {boardStartGate === "blocked-collision" && (
              <Button className="flex-1 font-display uppercase" onClick={startGame}>{t("game.startGame")}</Button>
            )}
          </div>
        </div>
      );
    }
    return (
      <div className="container py-10 max-w-sm mx-auto text-center animate-slide-up">
        <div className="rounded-lg border border-primary/40 bg-primary/10 px-3 py-2 mb-6">
          <p className="text-xs text-primary font-medium">🏆 {t("game.tournamentMatch")} · {tournamentLinkName}</p>
        </div>
        <p className="text-lg font-display mb-1 truncate">{playerNames[0]}</p>
        <p className="text-xs text-muted-foreground mb-1">vs.</p>
        <p className="text-lg font-display mb-4 truncate">{playerNames[1]}</p>
        <p className="text-xs text-muted-foreground mb-8">{mode} · {t("stats.firstTo")} {Math.ceil(bestOfLegs / 2)}</p>
        <div className="font-display text-5xl text-primary tabular-nums mb-2">{boardStartGate === "clear" ? autoStartSecondsLeft : "…"}</div>
        <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-6">{t("game.autoStartingIn")}</p>
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={() => setAutoStartCanceled(true)}>{t("common.edit")}</Button>
          <Button className="flex-1 font-display uppercase" onClick={startGame}>{t("game.startGame")}</Button>
        </div>
      </div>
    );
  }

  // "Online spielen" replaces this whole local-setup form with a challenge-a-member screen —
  // only offered for a genuinely casual game; a tournament/league match's opponent and mode are
  // already fixed by the bracket/fixture, so there's nothing left to challenge someone into.
  if (setupMode === "online" && !tournamentLinkName && !leagueLinkRef.current) {
    return <OnlineChallengeSetup onBack={() => setSetupMode("local")} />;
  }

  return (
    <div className="container py-6 animate-slide-up max-w-lg mx-auto">
      <h2 className="text-2xl font-display uppercase mb-1 text-center">{t("home.newGame")}</h2>
      {!tournamentLinkName && !leagueLinkRef.current && (
        <div className="flex rounded-lg border border-border bg-muted/30 p-1 mb-4 max-w-xs mx-auto">
          <button type="button" onClick={() => setSetupMode("local")}
            className={`flex-1 rounded-md py-1.5 text-xs font-medium uppercase tracking-wide transition-colors ${setupMode === "local" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>
            {t("game.setupLocal")}
          </button>
          <button type="button" onClick={() => setSetupMode("online")}
            className={`flex-1 rounded-md py-1.5 text-xs font-medium uppercase tracking-wide transition-colors ${setupMode === "online" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>
            {t("game.setupOnline")}
          </button>
        </div>
      )}
      {tournamentLinkName && (
        <div className="rounded-lg border border-primary/40 bg-primary/10 px-3 py-2 mb-5 text-center">
          <p className="text-xs text-primary font-medium">
            🏆 {t("game.tournamentMatch")} · {tournamentLinkName}
          </p>
          <p className="text-[10px] text-primary/70 mt-0.5">{t("game.tournamentMatchNote")}</p>
        </div>
      )}
      {!tournamentLinkName && <div className="mb-6" />}
      <div className="space-y-4">
        <SectionCard className="space-y-4">
        <Eyebrow icon={Target}>{t("game.setupModeSection")}</Eyebrow>
        <div>
          <label className="text-sm text-muted-foreground mb-1 block">{t("game.gameMode")}</label>
          <Select value={mode} onValueChange={(v) => setMode(v as GameMode)} disabled={isTournamentMatch}>
            <SelectTrigger className="bg-muted border-border"><SelectValue /></SelectTrigger>
            <SelectContent className="bg-card border-border">
              <SelectItem value="501">501</SelectItem>
              <SelectItem value="301">301</SelectItem>
              <SelectItem value="cricket">Cricket</SelectItem>
              <SelectItem value="custom">{t("game.custom")}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {mode === "custom" && (
          <div>
            <label className="text-sm text-muted-foreground mb-1 block">{t("game.startValue")}</label>
            <input type="number" value={customStartScore} onChange={(e) => setCustomStartScore(parseInt(e.target.value) || 0)}
              className="w-full rounded-lg bg-muted border border-border px-3 py-2 text-sm text-foreground" />
          </div>
        )}

        <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/30 px-4 py-3">
          <div className="min-w-0">
            <Label htmlFor="team-mode" className="text-sm">{t("game.teamMode")}</Label>
            <p className="text-[10px] text-muted-foreground mt-0.5">{t("game.teamModeDesc")}</p>
          </div>
          <Switch id="team-mode" checked={teamMode} disabled={isTournamentMatch} onCheckedChange={(v) => {
            setTeamMode(v);
            if (v && (numPlayers < 4 || numPlayers % 2 !== 0)) setNumPlayers(4);
          }} />
        </div>

        {teamMode && (
          <div className="grid grid-cols-2 gap-2">
            <input value={teamNames[0]} onChange={(e) => setTeamNames([e.target.value, teamNames[1]])}
              placeholder={`${t("game.team")} 1`} className="rounded-lg bg-muted border border-border px-3 py-2 text-sm text-foreground" />
            <input value={teamNames[1]} onChange={(e) => setTeamNames([teamNames[0], e.target.value])}
              placeholder={`${t("game.team")} 2`} className="rounded-lg bg-muted border border-border px-3 py-2 text-sm text-foreground" />
          </div>
        )}

        <div>
          <label className="text-sm text-muted-foreground mb-1 block">{teamMode ? t("game.playersPerTeam") : t("game.numPlayers")}</label>
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
            {(teamMode ? [4, 6, 8] : Array.from({ length: MAX_PLAYERS - 1 }, (_, i) => i + 2)).map((n) => (
              <button key={n} onClick={() => setNumPlayers(n)} disabled={isTournamentMatch}
                className={`rounded-lg border px-3 py-2 text-sm font-display transition-colors ${numPlayers === n ? "bg-primary/15 border-primary text-primary" : "bg-muted border-border text-muted-foreground"} ${isTournamentMatch ? "opacity-50 cursor-not-allowed" : ""}`}>
                {teamMode ? `${n / 2} vs ${n / 2}` : `${n} ${t("game.playersSuffix")}`}
              </button>
            ))}
          </div>
        </div>
        </SectionCard>

        <SectionCard className="space-y-4">
        <Eyebrow icon={Trophy}>{t("game.setupFormatSection")}</Eyebrow>

        {mode !== "cricket" && (
          <div>
            <label className="text-sm text-muted-foreground mb-1 block">{setsEnabled ? t("game.legsPerSet") : t("game.firstToLegs")}</label>
            <Select value={String(bestOfLegs)} onValueChange={(v) => setBestOfLegs(parseInt(v))} disabled={isTournamentMatch}>
              <SelectTrigger className="bg-muted border-border"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-card border-border">
                {[1, 3, 5, 7, 9, 11].map((n) => (
                  <SelectItem key={n} value={String(n)}>{t("stats.firstTo")} {Math.ceil(n / 2)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Sets-Modus (Runde 5, extended to tournaments 2026-09-09): the standard
            professional-darts match structure — "Best of X Sätze, je Satz Best of Y Legs" —
            layered on top of the leg picker above rather than replacing it (that picker's own
            label switches to "Legs pro Satz" the moment this is on). Deliberately not offered
            for Cricket (matching the leg picker's own scope). For a tournament/league-linked
            match the format is fixed by the bracket/fixture, same as bestOfLegs above — the
            switch itself is disabled then, same pattern as that picker — but unlike bestOfLegs
            (always shown, tournaments always have SOME leg count), this row only renders at all
            for a tournament match when the tournament actually turned Sets-Modus on: a
            non-sets tournament (the overwhelming majority, unchanged) must never show a
            disabled, permanently-off toggle here — see useTournamentLink's sets/bestOfSets
            query params for where setsEnabled gets set true for a sets-mode tournament match. */}
        {mode !== "cricket" && (!isTournamentMatch || setsEnabled) && (
          <div className="flex items-center justify-between bg-muted/30 rounded-lg border border-border px-4 py-3">
            <div className="min-w-0">
              <Label className="text-sm font-medium">{t("game.setsMode")}</Label>
              <p className="text-[10px] text-muted-foreground mt-0.5">{t("game.setsModeDesc")}</p>
            </div>
            <Switch checked={setsEnabled} disabled={isTournamentMatch} onCheckedChange={setSetsEnabled} />
          </div>
        )}

        {mode !== "cricket" && setsEnabled && (
          <div>
            <label className="text-sm text-muted-foreground mb-1 block">{t("game.firstToSets")}</label>
            <Select value={String(bestOfSets)} onValueChange={(v) => setBestOfSets(parseInt(v))} disabled={isTournamentMatch}>
              <SelectTrigger className="bg-muted border-border"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-card border-border">
                {[1, 3, 5, 7, 9].map((n) => (
                  <SelectItem key={n} value={String(n)}>{t("stats.firstTo")} {Math.ceil(n / 2)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {mode !== "cricket" && (
          <div className="flex items-center justify-between bg-muted/30 rounded-lg border border-border px-4 py-3">
            <div className="min-w-0">
              <Label className="text-sm font-medium">{t("game.checkoutSuggestions")}</Label>
              <p className="text-[10px] text-muted-foreground mt-0.5">{t("game.checkoutSuggestionsDesc")}</p>
            </div>
            <Switch checked={checkoutSuggestionEnabled} onCheckedChange={setCheckoutSuggestionEnabled} />
          </div>
        )}

        {/* Progressive disclosure (Design Rangliste #16): custom-Cricket numbers and the
            per-leg round limit are real but genuinely optional settings a first-time player
            doesn't need in front of them — collapsed until explicitly opened once. */}
        <button
          type="button"
          onClick={revealAdvancedSetup}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          {showAdvancedSetup ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          {t("game.advancedSettings")}
        </button>

        {showAdvancedSetup && (
          <>
            {mode === "cricket" && (
              <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/30 px-4 py-3">
                <div className="min-w-0">
                  <Label htmlFor="custom-cricket" className="text-sm">{t("game.customCricket")}</Label>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{t("game.customCricketDesc")}</p>
                </div>
                <Switch id="custom-cricket" checked={customCricket} onCheckedChange={setCustomCricket} />
              </div>
            )}

            {mode !== "cricket" && (
              <div>
                <label className="text-sm text-muted-foreground mb-1 block">{t("game.roundLimitPerLeg")}</label>
                <Select value={String(maxRoundsX01)} onValueChange={(v) => setMaxRoundsX01(parseInt(v))}>
                  <SelectTrigger className="bg-muted border-border"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-card border-border">
                    <SelectItem value="0">{t("game.noLimit")}</SelectItem>
                    {[8, 10, 12, 15, 20, 25].map((n) => (
                      <SelectItem key={n} value={String(n)}>{t("game.max")} {n} {t("game.rounds")}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[10px] text-muted-foreground mt-1">{t("game.roundLimitDesc")}</p>
              </div>
            )}
          </>
        )}
        </SectionCard>

        <SectionCard className="space-y-3">
        <Eyebrow icon={Users}>{t("game.setupPlayersSection")}</Eyebrow>

        {/* Player slots: name, double-out, bot toggle */}
        <div className="space-y-3">
          {Array.from({ length: activePlayerCount }, (_, i) => (
            <div key={i} className={`bg-muted/30 rounded-lg border px-4 py-3 space-y-2 ${teamMode ? (i % 2 === 0 ? "border-primary/30" : "border-secondary/30") : "border-border"}`}>
              {teamMode && (
                <p className={`text-[10px] font-display uppercase ${i % 2 === 0 ? "text-primary" : "text-secondary"}`}>
                  {i % 2 === 0 ? (teamNames[0] || "Team 1") : (teamNames[1] || "Team 2")}
                </p>
              )}
              <div className="flex items-center gap-2">
                {playerIsBot[i] ? (
                  <div className="flex-1 rounded-lg bg-secondary/10 border border-secondary/40 px-3 py-2 text-sm text-secondary flex items-center gap-2 min-w-0">
                    <Bot className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">{botDisplayName(i)}</span>
                  </div>
                ) : (
                <>
                  <input
                    value={playerNames[i]}
                    onChange={(e) => setPlayerNames(prev => prev.map((v, idx) => idx === i ? e.target.value : v))}
                    placeholder={t("game.enterName")}
                    className="flex-1 rounded-lg bg-background border border-border px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground min-w-0 focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                  {dbPlayers.length > 0 && (
                    <Popover>
                      <PopoverTrigger asChild>
                        <button className="shrink-0 rounded-lg border border-border px-2.5 py-2 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors" title={t("game.chooseClubMember")}>
                          <Users className="w-3.5 h-3.5" />
                        </button>
                      </PopoverTrigger>
                      <PopoverContent className="w-56 p-2" align="end">
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground px-2 pb-1">{t("game.chooseClubMember")}</p>
                        <div className="space-y-1 max-h-48 overflow-y-auto">
                          {dbPlayers.map((dp) => (
                            <PopoverClose asChild key={dp.id}>
                              <button onClick={() => {
                                  // "PIN pro Spieler": a member who set a PIN must confirm it's really
                                  // them before their name is accepted into this slot; everyone else
                                  // (the overwhelming majority, PIN is opt-in) is picked immediately,
                                  // unchanged from before this feature existed.
                                  if (dp.pin_hash) {
                                    setPinPrompt({ slotIndex: i, player: dp });
                                    setPinPromptValue("");
                                    setPinPromptError(false);
                                  } else {
                                    setPlayerNames(prev => prev.map((v, idx) => idx === i ? dp.name : v));
                                  }
                                }}
                                className={`w-full text-left px-2 py-1.5 rounded text-sm flex items-center gap-2 transition-colors ${playerNames[i] === dp.name ? "bg-primary/15 text-primary" : "hover:bg-muted"}`}>
                                <span>{dp.emoji}</span><span className="flex-1 truncate">{dp.name}</span>
                                {dp.pin_hash && <Lock className="w-3 h-3 shrink-0 text-muted-foreground" />}
                              </button>
                            </PopoverClose>
                          ))}
                        </div>
                      </PopoverContent>
                    </Popover>
                  )}
                </>
                )}
                <button
                  onClick={() => setPlayerIsBot(prev => prev.map((v, idx) => idx === i ? !v : v))}
                  className={`shrink-0 rounded-lg border px-2.5 py-2 flex items-center gap-1 text-xs transition-colors ${playerIsBot[i] ? "bg-secondary/20 border-secondary text-secondary" : "bg-background border-border text-muted-foreground"}`}
                  title={t("game.botOpponent")}>
                  <Bot className="w-3.5 h-3.5" /> {t("game.bot")}
                </button>
              </div>

              {playerIsBot[i] && (
                <>
                  {/* 3 columns fits both cases cleanly: 5 bot levels + Ghost = 6 (two full
                      rows) when Ghost is offered, or 5 alone (a 3+2 last row) when it isn't
                      (cricket/team mode) — no longer needs a mode-conditional column count now
                      that there are 2 more bot levels than Ghost had columns to spare for. */}
                  <div className="grid grid-cols-3 gap-1.5">
                    {(["easy", "medium", "hard", "elite", "legendary"] as BotLevel[]).map((lvl) => (
                      <button key={lvl} onClick={() => {
                        setPlayerBotLevel(prev => prev.map((v, idx) => idx === i ? lvl : v));
                        setPlayerGhostTarget(prev => prev.map((v, idx) => idx === i ? "off" : v));
                      }}
                        className={`rounded px-2 py-1.5 text-center transition-colors ${playerBotLevel[i] === lvl && playerGhostTarget[i] === "off" ? "bg-secondary/25 text-secondary" : "bg-background text-muted-foreground"}`}>
                        <span className="block text-[11px] font-display uppercase">{t(BOT_PROFILES[lvl].nameKey)}</span>
                        <span className="block text-[10px] opacity-70">Ø {BOT_PROFILES[lvl].average}</span>
                      </button>
                    ))}
                    {mode !== "cricket" && !teamMode && (
                      <button
                        onClick={() => setPlayerGhostTarget(prev => prev.map((v, idx) => idx === i ? (v === "off" ? "own-pb" : v) : v))}
                        title={t("game.ghostTooltip")}
                        className={`rounded px-2 py-1.5 text-center transition-colors ${playerGhostTarget[i] !== "off" ? "bg-accent/25 text-accent" : "bg-background text-muted-foreground"}`}>
                        <span className="block text-[11px] font-display uppercase">👻 {t("game.ghost")}</span>
                        <span className="block text-[10px] opacity-70">{t("game.ghostChallenge")}</span>
                      </button>
                    )}
                  </div>
                </>
              )}

              {/* Progressive disclosure (Design Rangliste #16): double-in/out and handicap are
                  real gameplay rules, not cosmetic — but their defaults (straight-in,
                  double-out, no handicap) already match how most casual club games are played,
                  so a first-time player isn't forced to make three rule decisions before their
                  first throw. Same showAdvancedSetup toggle as the Format section above. */}
              {mode !== "cricket" && showAdvancedSetup && (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">{playerDoubleIn[i] ? t("game.doubleIn") : t("game.straightIn")}</span>
                    <Switch checked={playerDoubleIn[i]} onCheckedChange={(v) => setPlayerDoubleIn(prev => prev.map((val, idx) => idx === i ? v : val))} />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">{playerDoubleOut[i] ? t("game.doubleOut") : t("game.singleOut")}</span>
                    <Switch checked={playerDoubleOut[i]} onCheckedChange={(v) => setPlayerDoubleOut(prev => prev.map((val, idx) => idx === i ? v : val))} />
                  </div>
                  {!teamMode && (
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-muted-foreground" title={t("game.handicapTooltip")}>{t("game.handicap")}</span>
                      <div className="flex items-center gap-1.5">
                        <input
                          type="number"
                          min={0}
                          step={10}
                          value={playerHandicap[i] || 0}
                          onChange={(e) => {
                            const v = Math.max(0, parseInt(e.target.value, 10) || 0);
                            setPlayerHandicap(prev => prev.map((val, idx) => idx === i ? v : val));
                          }}
                          className="w-16 rounded-lg bg-background border border-border px-2 py-1 text-sm text-foreground text-right focus:outline-none focus:ring-1 focus:ring-primary"
                        />
                        <span className="text-[10px] text-muted-foreground">{t("game.points")}</span>
                      </div>
                    </div>
                  )}
                  {!teamMode && playerHandicap[i] > 0 && (
                    <p className="text-[10px] text-muted-foreground text-right -mt-1.5">
                      {t("game.startsAt")} {Math.max(2, getStartScore() - playerHandicap[i])} {t("game.insteadOf")} {getStartScore()}
                    </p>
                  )}
                </>
              )}
            </div>
          ))}
        </div>
        </SectionCard>

        <SectionCard className="space-y-4">
        <Eyebrow icon={Settings2}>{t("game.setupExtrasSection")}</Eyebrow>

        {/* Sound toggle */}
        <div className="flex items-center justify-between bg-muted/30 rounded-lg border border-border px-4 py-3">
          <div className="flex items-center gap-2">
            {soundEnabled ? <Volume2 className="w-4 h-4 text-primary" /> : <VolumeX className="w-4 h-4 text-muted-foreground" />}
            <Label className="text-sm font-medium">{t("game.soundHaptics")}</Label>
          </div>
          <Switch checked={soundEnabled} onCheckedChange={setSoundEnabled} />
        </div>

        <div className="bg-muted/30 rounded-lg border border-border px-4 py-3">
          <div className="flex items-center gap-2 mb-2">
            {speechEnabled ? <Mic className="w-4 h-4 text-primary" /> : <MicOff className="w-4 h-4 text-muted-foreground" />}
            <Label className="text-sm font-medium">{t("game.callerVoice")}</Label>
          </div>
          <div className="grid grid-cols-4 gap-1.5">
            {([
              { value: "male", labelKey: "game.voiceMale" },
              { value: "female", labelKey: "game.voiceFemale" },
              { value: "yoda", labelKey: "game.voiceYoda" },
              { value: "off", labelKey: "game.voiceOff" },
            ] as { value: CallerVoice; labelKey: string }[]).map((opt) => (
              <button
                key={opt.value}
                onClick={() => changeCallerVoice(opt.value)}
                className={`py-2 rounded-lg text-xs font-semibold transition-all ${
                  callerVoice === opt.value ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"
                }`}
              >
                {t(opt.labelKey)}
              </button>
            ))}
          </div>
        </div>

        <div className="bg-muted/30 rounded-lg border border-border px-4 py-3 space-y-2">
          <Label className="text-sm">{t("game.whoStarts")}</Label>
          <p className="text-[10px] text-muted-foreground -mt-1">{t("game.whoStartsDesc")}</p>
          <div className="grid grid-cols-2 gap-1.5">
            {(teamMode
              ? [0, 1]
              : Array.from({ length: activePlayerCount }, (_, i) => i)
            ).map((i) => {
              const label = teamMode
                ? (i === 0 ? (teamNames[0].trim() || `${t("game.team")} 1`) : (teamNames[1].trim() || `${t("game.team")} 2`))
                : (playerIsBot[i] ? botDisplayName(i) : (playerNames[i]?.trim() || `${t("stats.player")} ${i + 1}`));
              const isChosen = teamMode ? (starterIndex % 2 === i) : starterIndex === i;
              return (
                <button
                  key={i}
                  onClick={() => setStarterIndex(i)}
                  className={`truncate rounded-lg border px-3 py-2 text-sm font-display transition-colors ${
                    isChosen ? "bg-primary/15 border-primary text-primary" : "bg-background border-border text-muted-foreground"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="bg-muted/30 rounded-lg border border-border px-4 py-3 space-y-2">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <Label htmlFor="warmup-mode" className="text-sm">{t("game.warmupBeforeMatch")}</Label>
              <p className="text-[10px] text-muted-foreground mt-0.5">{t("game.warmupBeforeMatchDesc")}</p>
            </div>
            <Switch id="warmup-mode" checked={warmupEnabled} onCheckedChange={setWarmupEnabled} />
          </div>
          {warmupEnabled && (
            <div className="grid grid-cols-4 gap-1.5 pt-1">
              {[30, 60, 90, 120].map((s) => (
                <button
                  key={s}
                  onClick={() => setWarmupSeconds(s)}
                  className={`rounded-lg py-1.5 text-xs font-display transition-colors ${warmupSeconds === s ? "bg-primary text-primary-foreground" : "bg-background border border-border text-muted-foreground"}`}
                >
                  {s}s
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 bg-muted/30 rounded-lg border border-border px-4 py-3">
          <div className="min-w-0">
            <Label htmlFor="walkon-mode" className="text-sm">{t("game.walkonIntro")}</Label>
            <p className="text-[10px] text-muted-foreground mt-0.5">{t("game.walkonIntroDesc")}</p>
          </div>
          <Switch id="walkon-mode" checked={walkonEnabled} onCheckedChange={setWalkonEnabled} />
        </div>
        </SectionCard>

        <Button onClick={startGame} className="w-full mt-4 font-display uppercase text-lg py-6">
          <Target className="w-5 h-5 mr-2" /> {warmupEnabled ? t("game.startWarmup") : t("game.startGame")}
        </Button>
      </div>

      {/* "PIN pro Spieler": confirms it's really that club member before their name lands in
          the slot — see the roster-picker button above and submitPinPrompt/verifyPin. Purely
          client-side (works offline), and only ever shown for a player who opted in by setting
          a PIN in the first place. */}
      <Dialog open={!!pinPrompt} onOpenChange={(open) => { if (!open) { setPinPrompt(null); setPinPromptValue(""); setPinPromptError(false); } }}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle className="font-display uppercase flex items-center gap-2">
              <Lock className="w-4 h-4" /> {t("game.pinPromptTitle")}
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {t("game.pinPromptDesc").replace("{name}", pinPrompt?.player.name ?? "")}
          </p>
          <input
            type="password"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={4}
            autoFocus
            value={pinPromptValue}
            onChange={(e) => { setPinPromptValue(e.target.value.replace(/\D/g, "").slice(0, 4)); setPinPromptError(false); }}
            onKeyDown={(e) => { if (e.key === "Enter" && pinPromptValue.length === 4) submitPinPrompt(); }}
            placeholder="••••"
            className={`w-full rounded-lg bg-muted border px-3 py-3 text-center text-2xl tracking-[0.5em] text-foreground focus:outline-none focus:ring-1 focus:ring-primary ${pinPromptError ? "border-destructive" : "border-border"}`}
          />
          {pinPromptError && <p className="text-xs text-destructive text-center">{t("game.pinPromptWrong")}</p>}
          <div className="flex gap-2 pt-1">
            <Button variant="outline" className="flex-1" onClick={() => { setPinPrompt(null); setPinPromptValue(""); setPinPromptError(false); }}>
              {t("common.cancel")}
            </Button>
            <Button className="flex-1" disabled={pinPromptValue.length !== 4 || pinPromptChecking} onClick={submitPinPrompt}>
              {pinPromptChecking ? <Loader2 className="w-4 h-4 animate-spin" /> : t("game.pinPromptConfirm")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default GameSetup;
