import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { DartLoaderIcon as Loader2 } from "@/components/icons/DartIcons";
import { supabase } from "@/integrations/supabase/client";
import {
  CLOSE_TIP_MM,
  NEAR_TIP_MM,
  evaluateLegacy,
  evaluateRecorded,
  groupByModel,
  groupByPeriod,
  meanOf,
  parseDetectionRecord,
  share,
  shareWithin,
  type QualityFigures,
  type QualitySample,
} from "@/utils/detectionQuality";

const SAMPLE_LIMIT = 5000;

const percent = (value: number | null) => (value === null ? "–" : `${Math.round(value * 100)} %`);
const millimetres = (value: number | null) => (value === null ? "–" : `${value.toFixed(1).replace(".", ",")} mm`);
const dayLabel = (iso: string) => new Date(iso).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });

const Tile = ({ value, label, note }: { value: string; label: string; note: string }) => (
  <div className="rounded-xl border border-border p-3">
    <p className="text-2xl font-display tabular-nums">{value}</p>
    <p className="text-xs">{label}</p>
    <p className="text-[11px] text-muted-foreground">{note}</p>
  </div>
);

/** Admin view: how often did the player have to correct the camera, and how far off was it? */
const AdminDetectionQuality = () => {
  const [samples, setSamples] = useState<QualitySample[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [by, setBy] = useState<"day" | "week">("week");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase
        .from("training_samples")
        .select("created_at, labels, calibration_meta")
        .order("created_at", { ascending: true })
        .limit(SAMPLE_LIMIT);
      if (cancelled) return;
      if (error) {
        setFailed(true);
        return;
      }
      setSamples(
        (data ?? []).map((r) => ({
          createdAt: r.created_at,
          labels: Array.isArray(r.labels) ? (r.labels as QualitySample["labels"]) : [],
          detection: parseDetectionRecord(r.calibration_meta),
        })),
      );
    })();
    return () => { cancelled = true; };
  }, []);

  const recorded = useMemo(() => (samples ? evaluateRecorded(samples) : null), [samples]);
  const legacy = useMemo(() => (samples ? evaluateLegacy(samples) : null), [samples]);
  const periods = useMemo(() => (samples ? groupByPeriod(samples, by) : []), [samples, by]);
  const models = useMemo(() => (samples ? groupByModel(samples) : []), [samples]);

  if (failed) return <p className="text-xs text-muted-foreground">Erkennungsqualität konnte nicht geladen werden.</p>;
  if (!samples || !recorded || !legacy) {
    return <div className="flex justify-center py-4"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>;
  }

  const c = recorded.counts;
  const handled = recorded.darts;
  const meanDistance = meanOf(recorded.distances);

  return (
    <Card className="p-4 space-y-4">
      <div>
        <h3 className="font-display uppercase text-sm">Erkennungsqualität</h3>
        <p className="text-xs text-muted-foreground">
          Was die Kamera zuerst erkannt hat – verglichen mit dem, was der Spieler bestätigt hat. Aufgezeichnet seit der Version, die
          die Roh-Erkennung mitspeichert; ältere Samples siehe unten.
        </p>
      </div>

      {recorded.rounds === 0 ? (
        <p className="text-sm text-muted-foreground">Noch keine Runde mit aufgezeichneter Roh-Erkennung. Sobald mit der Kamera gespielt wird, füllt sich das hier.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Tile value={String(recorded.rounds)} label="Runden" note={`${handled} Darts`} />
            <Tile
              value={percent(share(recorded.untouchedRounds, recorded.rounds))}
              label="Runden ohne Korrektur"
              note={`${recorded.untouchedRounds} von ${recorded.rounds}`}
            />
            <Tile value={percent(share(c.unchanged, handled))} label="Darts unverändert" note={`${c.unchanged} von ${handled}`} />
            <Tile value={millimetres(meanDistance)} label="Mittlere Abweichung" note={`n = ${recorded.distances.length} Darts mit Position`} />
            <Tile value={percent(share(c.moved, handled))} label="Verschoben" note={`${c.moved} von ${handled}`} />
            <Tile value={percent(share(c.valueChanged, handled))} label="Wert geändert" note={`${c.valueChanged} von ${handled}`} />
            <Tile value={String(c.removed)} label="Entfernt" note="vom Modell erkannt, gelöscht" />
            <Tile value={String(c.added + c.addedMiss)} label="Ergänzt" note={`davon ${c.addedMiss} als Fehlwurf`} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Tile
              value={percent(shareWithin(recorded.distances, NEAR_TIP_MM))}
              label={`Innerhalb ${String(NEAR_TIP_MM).replace(".", ",")} mm`}
              note={`n = ${recorded.distances.length}`}
            />
            <Tile
              value={percent(shareWithin(recorded.distances, CLOSE_TIP_MM))}
              label={`Innerhalb ${CLOSE_TIP_MM} mm`}
              note={`n = ${recorded.distances.length}`}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-semibold uppercase text-muted-foreground">Verlauf</h4>
              <div className="flex gap-1">
                {(["week", "day"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setBy(mode)}
                    className={`rounded-md px-2 py-0.5 text-xs ${by === mode ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted"}`}
                  >
                    {mode === "week" ? "Woche" : "Tag"}
                  </button>
                ))}
              </div>
            </div>
            <FiguresTable rows={periods.map((p) => ({ key: p.period, label: by === "week" ? `ab ${dayLabel(p.period)}` : dayLabel(p.period), figures: p.figures }))} />
          </div>

          <div className="space-y-2">
            <h4 className="text-xs font-semibold uppercase text-muted-foreground">Nach Modellversion</h4>
            <FiguresTable rows={models.map((m) => ({ key: m.model, label: m.model, figures: m.figures }))} />
          </div>
        </>
      )}

      <div className="space-y-1 border-t border-border pt-3">
        <h4 className="text-xs font-semibold uppercase text-muted-foreground">Ältere Samples (ohne Roh-Erkennung)</h4>
        {legacy.unusableRounds > 0 && (
          <p className="text-[11px] text-muted-foreground">
            {legacy.unusableRounds} noch ältere Runden (vor dem 19.10.) sind nicht auswertbar: dort steht fast überall Konfidenz 1, egal ob ein Mensch eingegriffen hat.
          </p>
        )}
        {legacy.rounds === 0 ? (
          <p className="text-xs text-muted-foreground">Keine.</p>
        ) : (
          <>
            <p className="text-xs">
              {legacy.rounds} Runden, {legacy.darts} Darts. Darts, bei denen ein Mensch eingegriffen hat:{" "}
              <strong>{legacy.valueCorrected + legacy.handPlaced}</strong> ({percent(share(legacy.valueCorrected + legacy.handPlaced, legacy.darts))}),
              davon {legacy.valueCorrected} mit gewähltem Wert und {legacy.handPlaced} von Hand gesetzt oder ergänzt. Runden ganz ohne Eingriff:{" "}
              {legacy.untouchedRounds} von {legacy.rounds} ({percent(share(legacy.untouchedRounds, legacy.rounds))}).
            </p>
            <p className="text-[11px] text-muted-foreground">
              Nur eine Näherung: gespeichert ist bei diesen Samples nur das Endergebnis. Nicht bekannt sind der Abstand zur ursprünglichen
              Erkennung, gelöschte Darts, die Modellversion und ob ein verschobener Dart zufällig im selben Feld blieb – echte Zahlen gibt es erst für neue Runden.
            </p>
          </>
        )}
      </div>
    </Card>
  );
};

const FiguresTable = ({ rows }: { rows: { key: string; label: string; figures: QualityFigures }[] }) => (
  <div className="overflow-x-auto">
    <table className="w-full text-xs">
      <thead>
        <tr className="text-left text-muted-foreground">
          <th className="py-1 pr-2 font-normal">&nbsp;</th>
          <th className="py-1 pr-2 font-normal">Runden</th>
          <th className="py-1 pr-2 font-normal">ohne Korrektur</th>
          <th className="py-1 pr-2 font-normal">Darts</th>
          <th className="py-1 pr-2 font-normal">unverändert</th>
          <th className="py-1 font-normal">Ø mm</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(({ key, label, figures }) => (
          <tr key={key} className="border-t border-border/60 tabular-nums">
            <td className="py-1 pr-2">{label}</td>
            <td className="py-1 pr-2">{figures.rounds}</td>
            <td className="py-1 pr-2">{percent(share(figures.untouchedRounds, figures.rounds))}</td>
            <td className="py-1 pr-2">{figures.darts}</td>
            <td className="py-1 pr-2">{percent(share(figures.counts.unchanged, figures.darts))}</td>
            <td className="py-1">{millimetres(meanOf(figures.distances))}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

export default AdminDetectionQuality;
