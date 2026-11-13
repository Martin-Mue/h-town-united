import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Heart, Minus, Plus, Skull, Trophy, Undo2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import DartScoreInput from "@/components/game/DartScoreInput";
import ChoiceChip from "@/components/game/setup/ChoiceChip";
import { useLanguage } from "@/contexts/LanguageContext";
import { usePlayers } from "@/hooks/usePlayers";
import { useScreenWakeLock } from "@/hooks/useScreenWakeLock";
import {
  applyPartyDart, createPartyGame, currentPartyTarget, passPartyTurn, totalRounds,
  CLOCK_TARGETS, DARTS_PER_TURN, DEFAULT_PARTY_OPTIONS, PARTY_MODES,
  type PartyDart, type PartyMode, type PartyOptions, type PartyPlayer, type PartyState,
} from "@/utils/partyGames";

const MIN_PLAYERS = 2;
const MAX_PLAYERS = 8;
/** Undo steps kept; each one is a copy of the small game state. */
const UNDO_STEPS_KEPT = 90;

const dartLabel = (dart: PartyDart, missLabel: string): string =>
  dart.number === 0 ? missLabel : dart.number === 25 ? (dart.multiplier === 2 ? "Bull" : "25") : `${dart.multiplier === 3 ? "T" : dart.multiplier === 2 ? "D" : ""}${dart.number}`;

/** One player's line on the play screen: name, and what counts in this game (points, progress or lives). */
const PlayerRow = ({ player, mode, active, won, labels }: {
  player: PartyPlayer; mode: PartyMode; active: boolean; won: boolean; labels: { killer: string; out: string };
}) => (
  <li className={`flex items-center gap-3 rounded-xl border px-3 py-2 ${
    won ? "border-accent bg-accent/15" : active ? "border-primary bg-primary/10" : "border-border bg-card"
  } ${player.out ? "opacity-50" : ""}`}>
    <div className="min-w-0 flex-1">
      <p className="truncate text-[15px] font-semibold">{player.name}</p>
      {mode === "killer" && (
        <p className="text-xs text-muted-foreground">
          <span className="font-display text-sm font-bold tabular-nums text-foreground">{player.number}</span>
          {player.out ? ` · ${labels.out}` : player.isKiller ? ` · ${labels.killer}` : ""}
        </p>
      )}
    </div>
    {mode === "killer" ? (
      <div className="flex shrink-0 items-center gap-1" aria-label={`${player.lives}`}>
        {player.isKiller && !player.out && <Skull className="mr-1 h-4 w-4 text-destructive" aria-hidden="true" />}
        {Array.from({ length: player.lives }, (_, i) => <Heart key={i} className="h-4 w-4 fill-destructive text-destructive" aria-hidden="true" />)}
      </div>
    ) : mode === "clock" ? (
      <span className="shrink-0 font-display text-xl font-bold tabular-nums">{player.progress}<span className="text-sm text-muted-foreground">/{CLOCK_TARGETS.length}</span></span>
    ) : (
      <span className="shrink-0 font-display text-2xl font-bold tabular-nums">{player.score}</span>
    )}
  </li>
);

/**
 * Party games for the whole group: Killer, Shanghai, Halve-It and Around the Clock.
 * They are played for fun and scored differently from X01 and Cricket, so nothing here is saved to the
 * statistics or the Elo ranking. The rules live in utils/partyGames; this page only shows and feeds them.
 */
const PartyGame = () => {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const { data: clubPlayers = [] } = usePlayers();

  const [mode, setMode] = useState<PartyMode>("killer");
  const [names, setNames] = useState<string[]>(["", ""]);
  const [options, setOptions] = useState<PartyOptions>(DEFAULT_PARTY_OPTIONS);
  const [game, setGame] = useState<PartyState | null>(null);
  const [history, setHistory] = useState<PartyState[]>([]);
  useScreenWakeLock(!!game && !game.finished);

  const playerName = (name: string, slot: number) => name.trim() || `${t("stats.player")} ${slot + 1}`;
  const start = () => {
    setGame(createPartyGame(mode, names.map(playerName), options));
    setHistory([]);
  };
  const advance = (next: PartyState) => {
    if (!game || next === game) return;
    setHistory((prev) => [...prev.slice(-(UNDO_STEPS_KEPT - 1)), game]);
    setGame(next);
  };
  const undo = () => {
    if (history.length === 0) return;
    setGame(history[history.length - 1]);
    setHistory((prev) => prev.slice(0, -1));
  };

  if (!game) {
    return (
      <div className="container mx-auto max-w-xl animate-slide-up space-y-5 py-4">
        <header>
          <h1 className="font-display text-[28px] font-bold leading-tight">{t("party.title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("party.subtitle")}</p>
        </header>

        <section className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            {PARTY_MODES.map((m) => (
              <ChoiceChip key={m} selected={mode === m} onClick={() => setMode(m)} className="h-[56px] rounded-2xl font-display text-lg font-bold">
                {t(`party.mode.${m}`)}
              </ChoiceChip>
            ))}
          </div>
          <p className="rounded-2xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground">{t(`party.rules.${mode}`)}</p>
        </section>

        {mode === "killer" && (
          <section className="space-y-3 rounded-2xl border border-border bg-card px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium">{t("party.lives")}</span>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="icon" className="h-10 w-10" aria-label="−" disabled={options.lives <= 1} onClick={() => setOptions((o) => ({ ...o, lives: o.lives - 1 }))}><Minus className="h-4 w-4" /></Button>
                <span className="w-6 text-center font-display text-xl font-bold tabular-nums">{options.lives}</span>
                <Button variant="outline" size="icon" className="h-10 w-10" aria-label="+" disabled={options.lives >= 9} onClick={() => setOptions((o) => ({ ...o, lives: o.lives + 1 }))}><Plus className="h-4 w-4" /></Button>
              </div>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium">{t("party.killerZone")}</span>
              <div className="flex gap-2">
                {(["double", "any"] as const).map((zone) => (
                  <ChoiceChip key={zone} selected={options.killerZone === zone} onClick={() => setOptions((o) => ({ ...o, killerZone: zone }))} className="min-h-[40px] text-sm">
                    {t(zone === "double" ? "party.zoneDouble" : "party.zoneAny")}
                  </ChoiceChip>
                ))}
              </div>
            </div>
          </section>
        )}

        <section className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{t("party.players")}</h2>
          <datalist id="party-club-players">
            {clubPlayers.map((p) => <option key={p.id} value={p.name} />)}
          </datalist>
          {names.map((name, slot) => (
            <div key={slot} className="flex items-center gap-2">
              <input
                value={name}
                list="party-club-players"
                maxLength={30}
                placeholder={`${t("stats.player")} ${slot + 1}`}
                aria-label={`${t("stats.player")} ${slot + 1}`}
                onChange={(e) => setNames((prev) => prev.map((v, i) => (i === slot ? e.target.value : v)))}
                className="h-12 min-w-0 flex-1 rounded-xl border border-border bg-card px-3 text-base text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
              {names.length > MIN_PLAYERS && (
                <Button variant="outline" size="icon" className="h-12 w-12 shrink-0" aria-label={t("party.removePlayer")} onClick={() => setNames((prev) => prev.filter((_, i) => i !== slot))}>
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
          ))}
          {names.length < MAX_PLAYERS && (
            <Button variant="outline" className="h-12 w-full gap-1.5 rounded-xl" onClick={() => setNames((prev) => [...prev, ""])}>
              <Plus className="h-4 w-4" /> {t("party.addPlayer")}
            </Button>
          )}
        </section>

        <Button className="h-[52px] w-full rounded-[14px] text-base font-semibold" onClick={start}>{t("game.startGame")}</Button>
      </div>
    );
  }

  const player = game.players[game.current];
  const target = currentPartyTarget(game);
  const rounds = totalRounds(game.mode);
  const targetText =
    target.kind === "number" ? `${t("party.target")} ${target.value}` :
    target.kind === "bull" ? `${t("party.target")} Bull` :
    target.kind === "double" ? t("party.targetDouble") :
    target.kind === "triple" ? t("party.targetTriple") :
    target.kind === "ownNumber" ? `${t(game.options.killerZone === "double" ? "party.targetOwnDouble" : "party.targetOwnNumber")} ${target.value}` :
    t("party.targetOthers");
  const turnDarts = game.dartsThisTurn > 0 ? player.turnDarts : [];
  const rowLabels = { killer: t("party.killerBadge"), out: t("party.out") };

  return (
    <div className="fixed inset-0 z-[60] flex select-none flex-col overflow-hidden bg-background" style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)", WebkitTouchCallout: "none" }}>
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-lg font-bold leading-tight">{t(`party.mode.${game.mode}`)}</p>
          {rounds !== null && !game.finished && (
            <p className="text-xs text-muted-foreground">{t("party.round")} {game.round + 1}/{rounds}</p>
          )}
        </div>
        <Button variant="outline" size="icon" className="h-11 w-11 shrink-0" disabled={history.length === 0} onClick={undo} aria-label={t("game.undo")} title={t("game.undo")}>
          <Undo2 className="h-5 w-5" />
        </Button>
        <Button variant="outline" size="icon" className="h-11 w-11 shrink-0" onClick={() => { if (game.finished || window.confirm(t("party.quitConfirm"))) setGame(null); }} aria-label={t("party.quit")} title={t("party.quit")}>
          <X className="h-5 w-5" />
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-3 py-3">
        <div className="mx-auto max-w-xl space-y-3">
          {game.finished ? (
            <section className="rounded-2xl border border-border bg-card p-5 text-center">
              <span aria-hidden="true" className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/15 text-accent">
                <Trophy className="h-8 w-8" />
              </span>
              <h2 className="break-words font-display text-[28px] font-bold leading-tight">{game.winners.map((i) => game.players[i].name).join(" & ")}</h2>
              <p className="mt-1 text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                {game.winners.length > 1 ? t("party.draw") : game.wonByShanghai ? t("party.shanghaiWin") : t("game.wins")}
              </p>
            </section>
          ) : (
            <section className="rounded-2xl border border-primary/40 bg-primary/10 px-4 py-3" aria-live="polite">
              <p className="truncate text-xs font-semibold uppercase tracking-[0.12em] text-primary">{player.name}</p>
              <p className="font-display text-2xl font-bold leading-tight">{targetText}</p>
              <div className="mt-2 flex items-center gap-2">
                {Array.from({ length: DARTS_PER_TURN }, (_, i) => (
                  <span key={i} className={`flex h-9 min-w-[3.25rem] items-center justify-center rounded-lg border px-2 font-display text-base font-bold tabular-nums ${
                    turnDarts[i] ? "border-border bg-card text-foreground" : "border-dashed border-border text-muted-foreground"
                  }`}>
                    {turnDarts[i] ? dartLabel(turnDarts[i], t("game.miss")) : "–"}
                  </span>
                ))}
                {game.lastTurnHalved && game.dartsThisTurn === 0 && <span className="ml-auto text-sm font-semibold text-destructive">{t("party.halved")}</span>}
              </div>
            </section>
          )}

          <ul className="space-y-1.5">
            {game.players.map((p, i) => (
              <PlayerRow key={i} player={p} mode={game.mode} active={!game.finished && i === game.current} won={game.finished && game.winners.includes(i)} labels={rowLabels} />
            ))}
          </ul>

          {game.finished && (
            <div className="flex gap-2">
              <Button variant="outline" className="h-[52px] flex-1 rounded-[14px]" onClick={() => setGame(null)}>{t("party.otherGame")}</Button>
              <Button className="h-[52px] flex-1 rounded-[14px] text-base font-semibold" onClick={start}>{t("party.playAgain")}</Button>
            </div>
          )}
          {game.finished && (
            <Button variant="ghost" className="w-full" onClick={() => navigate("/")}>{t("common.backToHome")}</Button>
          )}
        </div>
      </div>

      {!game.finished && (
        <div className="shrink-0 border-t border-border px-3 pb-2 pt-2">
          <div className="mx-auto max-w-xl space-y-2">
            <DartScoreInput isDisabled={false} onThrow={(value, multiplier) => advance(applyPartyDart(game, value, multiplier))} dartsThisRound={game.dartsThisTurn} />
            <Button variant="outline" className="h-11 w-full rounded-xl" onClick={() => advance(passPartyTurn(game))}>{t("game.nextPlayer")}</Button>
          </div>
        </div>
      )}
    </div>
  );
};

export default PartyGame;
