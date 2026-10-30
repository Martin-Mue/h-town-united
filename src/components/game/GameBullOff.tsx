import { useEffect, useRef, useState, type ReactNode } from "react";
import { Camera, Hand, Loader2, RotateCcw, Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/contexts/LanguageContext";
import type { DetectedDart } from "@/components/game/LiveCamera";
import { BULLOFF_ZONES, decideBullOff, distanceFromBullMm, zoneDistanceMm, type BullOffZoneId } from "@/utils/bullOff";

/** What the surrounding screen has to supply: the camera component (lazy, error-bounded in Game.tsx). */
export interface BullOffCameraRequest {
  dartsRemaining: number;
  playerName: string;
  onCommit: (darts: DetectedDart[]) => void;
  onClose: () => void;
}

interface CommonProps {
  /** Display names of the two contenders — players, or the teams in team mode. */
  names: [string, string];
  cameraAvailable: boolean;
  renderCamera: (request: BullOffCameraRequest) => ReactNode;
}

interface LocalProps extends CommonProps {
  mode: "local";
  onResolved: (winner: 0 | 1) => void;
}

interface OnlineProps extends CommonProps {
  mode: "online";
  /** Which contender this device is; null = a teammate who only watches (doubles, slots 2/3). */
  mySlot: 0 | 1 | null;
  /** Shared state (game_state.bullOff). */
  distances: (number | null)[];
  round: number;
  resolved: boolean;
  winner?: number;
  onSubmitDistance: (mm: number) => Promise<void>;
  onContinue: () => void;
}

type Props = LocalProps | OnlineProps;

const ZONE_LABEL_KEY: Record<BullOffZoneId, string> = {
  bullseye: "game.bullOffZoneBullseye",
  bull: "game.bullOffZoneBull",
  near: "game.bullOffZoneNear",
  far: "game.bullOffZoneFar",
  miss: "game.bullOffZoneMiss",
};

/** Bull-off before leg 1: each side throws one dart at the bull, the closer one starts. The camera
 *  measures the distance of the dart from the bull (board coordinates, mm); without a camera (or
 *  without a calibration) it falls back to picking who was closer / a rough zone. */
const GameBullOff = (props: Props) => {
  const { t } = useLanguage();
  const { names, cameraAvailable, renderCamera } = props;
  const [method, setMethod] = useState<"camera" | "manual">(cameraAvailable ? "camera" : "manual");
  const [noMeasure, setNoMeasure] = useState(false);
  const [busy, setBusy] = useState(false);
  // local mode keeps its own distances; online mode reads the shared state
  const [localDistances, setLocalDistances] = useState<(number | null)[]>([null, null]);
  const [tieNotice, setTieNotice] = useState(false);

  const online = props.mode === "online" ? props : null;
  const distances = online ? online.distances : localDistances;
  const outcome = decideBullOff(distances);

  // Online: a tie makes the server bump the round and clear both distances — announce it.
  const lastRound = useRef(online?.round ?? 1);
  useEffect(() => {
    if (!online) return;
    if (online.round > lastRound.current) { setTieNotice(true); setNoMeasure(false); }
    lastRound.current = online.round;
  }, [online]);

  const fmt = (mm: number | null) => (mm === null ? "–" : `${mm.toFixed(1)} mm`);
  const nameLine = (slot: 0 | 1) => names[slot];

  // ---- LOCAL --------------------------------------------------------------------------------
  const localCommitCamera = (darts: DetectedDart[]) => {
    const [a, b] = darts;
    if (a?.boardU === undefined || a?.boardV === undefined || b?.boardU === undefined || b?.boardV === undefined) {
      setNoMeasure(true);
      setMethod("manual");
      return;
    }
    setNoMeasure(false);
    setTieNotice(false);
    setLocalDistances([distanceFromBullMm(a.boardU, a.boardV), distanceFromBullMm(b.boardU, b.boardV)]);
  };
  const localDecide = (winner: 0 | 1) => { if (props.mode === "local") props.onResolved(winner); };
  const localRepeat = () => { setLocalDistances([null, null]); setNoMeasure(false); };

  // ---- ONLINE -------------------------------------------------------------------------------
  const mySlot = online?.mySlot ?? null;
  const mySubmitted = online && mySlot !== null && distances[mySlot] !== null && distances[mySlot] !== undefined;
  const submit = async (mm: number) => {
    if (!online) return;
    setBusy(true);
    setTieNotice(false);
    try { await online.onSubmitDistance(mm); } finally { setBusy(false); }
  };
  const onlineCommitCamera = (darts: DetectedDart[]) => {
    const d = darts[0];
    if (d?.boardU === undefined || d?.boardV === undefined) { setNoMeasure(true); setMethod("manual"); return; }
    setNoMeasure(false);
    void submit(distanceFromBullMm(d.boardU, d.boardV));
  };

  const header = (
    <div className="text-center mb-5">
      <Target className="mx-auto mb-2 h-10 w-10 text-primary" />
      <h2 className="font-display text-2xl uppercase">{t("game.bullOffTitle")}</h2>
      <p className="mt-1 text-xs text-muted-foreground">{t("game.bullOffHint")}</p>
    </div>
  );

  const methodToggle = cameraAvailable && (
    <div className="mb-4 grid grid-cols-2 gap-2">
      {(["camera", "manual"] as const).map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => setMethod(m)}
          className={`flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-display uppercase transition-colors ${method === m ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted/50"}`}
        >
          {m === "camera" ? <Camera className="h-3.5 w-3.5" /> : <Hand className="h-3.5 w-3.5" />}
          {m === "camera" ? t("game.bullOffCamera") : t("game.bullOffManual")}
        </button>
      ))}
    </div>
  );

  const zoneChips = (onPick: (mm: number) => void) => (
    <div className="grid grid-cols-2 gap-2">
      {BULLOFF_ZONES.map((z) => (
        <button key={z.id} type="button" disabled={busy} onClick={() => onPick(zoneDistanceMm(z.id))}
          className="rounded-lg border border-border bg-background px-3 py-2 text-sm hover:border-primary disabled:opacity-50">
          {t(ZONE_LABEL_KEY[z.id])}
        </button>
      ))}
    </div>
  );

  const resultCard = (winner: 0 | 1, closerBy: number | null) => (
    <div className="rounded-2xl border border-primary/40 bg-primary/10 p-4 text-center">
      <div className="grid grid-cols-2 gap-3">
        {([0, 1] as const).map((slot) => (
          <div key={slot} className={`rounded-xl border px-2 py-3 ${winner === slot ? "border-primary bg-card" : "border-border opacity-70"}`}>
            <p className="truncate text-sm font-semibold">{nameLine(slot)}</p>
            <p className="font-display text-xl tabular-nums">{fmt(distances[slot] ?? null)}</p>
          </div>
        ))}
      </div>
      <p className="mt-3 font-display text-lg text-primary">{t("game.bullOffWinnerLine").replace("{name}", names[winner])}</p>
      {closerBy !== null && <p className="text-xs text-muted-foreground">{t("game.bullOffCloserBy").replace("{mm}", closerBy.toFixed(1))}</p>}
    </div>
  );

  // ================================ ONLINE RENDER ================================================
  if (online) {
    if (online.resolved && online.winner !== undefined && (online.winner === 0 || online.winner === 1)) {
      const d0 = distances[0], d1 = distances[1];
      const closerBy = d0 !== null && d1 !== null ? Math.abs((d0 as number) - (d1 as number)) : null;
      return (
        <div className="container mx-auto max-w-sm py-8">
          {header}
          {resultCard(online.winner, closerBy)}
          <Button className="mt-5 w-full font-display uppercase" onClick={online.onContinue}>
            {t("game.bullOffStart").replace("{name}", names[online.winner])}
          </Button>
        </div>
      );
    }

    return (
      <div className="container mx-auto max-w-sm py-8">
        {header}
        {tieNotice && <p className="mb-3 rounded-lg border border-accent/40 bg-accent/10 px-3 py-2 text-center text-sm text-accent">{t("game.bullOffTie")}</p>}
        <p className="mb-4 text-center text-sm text-muted-foreground">{names[0]} · {names[1]} — {t("game.bullOffRound")} {online.round}</p>

        {mySlot === null ? (
          <p className="rounded-lg border border-border bg-muted/30 px-3 py-4 text-center text-sm text-muted-foreground">
            {t("game.bullOffTeamWait").replace("{a}", names[0]).replace("{b}", names[1])}
          </p>
        ) : mySubmitted ? (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">{t("game.bullOffWaiting").replace("{name}", names[mySlot === 0 ? 1 : 0])}</p>
            <p className="text-xs text-muted-foreground">{t("game.bullOffYourDistance")} {fmt(distances[mySlot] ?? null)}</p>
          </div>
        ) : (
          <>
            <p className="mb-3 text-center text-sm font-semibold">{t("game.bullOffYourThrow")}</p>
            {noMeasure && <p className="mb-3 rounded-lg border border-accent/40 bg-accent/10 px-3 py-2 text-xs text-accent">{t("game.bullOffNoMeasure")}</p>}
            {methodToggle}
            {method === "camera" && cameraAvailable ? (
              busy ? <div className="flex justify-center py-6"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div> : renderCamera({
                dartsRemaining: 1,
                playerName: names[mySlot],
                onCommit: onlineCommitCamera,
                onClose: () => setMethod("manual"),
              })
            ) : zoneChips((mm) => void submit(mm))}
          </>
        )}
      </div>
    );
  }

  // ================================ LOCAL RENDER =================================================
  if (outcome.status === "winner") {
    return (
      <div className="container mx-auto max-w-sm py-8">
        {header}
        {resultCard(outcome.winner, outcome.closerByMm)}
        <div className="mt-5 flex gap-2">
          <Button variant="outline" className="gap-1.5" onClick={localRepeat}><RotateCcw className="h-4 w-4" /> {t("game.bullOffRepeat")}</Button>
          <Button className="flex-1 font-display uppercase" onClick={() => localDecide(outcome.winner)}>
            {t("game.bullOffStart").replace("{name}", names[outcome.winner])}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-sm py-8">
      {header}
      {outcome.status === "tie" && (
        <p className="mb-3 rounded-lg border border-accent/40 bg-accent/10 px-3 py-2 text-center text-sm text-accent">{t("game.bullOffTie")}</p>
      )}
      {noMeasure && <p className="mb-3 rounded-lg border border-accent/40 bg-accent/10 px-3 py-2 text-xs text-accent">{t("game.bullOffNoMeasure")}</p>}
      <p className="mb-4 text-center text-sm">{t("game.bullOffOrder").replace("{a}", names[0]).replace("{b}", names[1])}</p>
      {methodToggle}
      {method === "camera" && cameraAvailable ? (
        outcome.status === "tie" ? (
          <Button variant="outline" className="w-full gap-1.5" onClick={localRepeat}><RotateCcw className="h-4 w-4" /> {t("game.bullOffRepeat")}</Button>
        ) : renderCamera({
          dartsRemaining: 2,
          playerName: `${names[0]} → ${names[1]}`,
          onCommit: localCommitCamera,
          onClose: () => setMethod("manual"),
        })
      ) : (
        <div className="space-y-2">
          <p className="text-center text-xs text-muted-foreground">{t("game.bullOffWhoCloser")}</p>
          <div className="grid grid-cols-2 gap-2">
            {([0, 1] as const).map((slot) => (
              <Button key={slot} variant="outline" className="h-auto whitespace-normal py-3 font-display" onClick={() => localDecide(slot)}>
                {t("game.bullOffCloserName").replace("{name}", names[slot])}
              </Button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default GameBullOff;
