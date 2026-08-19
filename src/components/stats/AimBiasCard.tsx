import { Crosshair, Lightbulb } from "lucide-react";
import { RING } from "@/utils/dartboardGeometry";
import { describeAimTip, type AimBiasResult } from "@/utils/aimBias";

interface AimBiasCardProps {
  bias: AimBiasResult;
}

const SIZE = 200;
const CENTER = SIZE / 2;
const BOARD_RADIUS = 85;
/** Real offsets are a few mm out of a 170mm board — invisible at true scale, so the arrow
 *  exaggerates the (radial, tangential) delta only, not the reference point itself. Purely
 *  illustrative; the mm figures in the text below are the real, unscaled numbers. */
const MAGNIFY = 6;

/** Projects the pooled (radial, tangential) bias onto a single concrete reference point — the
 *  Treble 20 center, the most commonly thrown-at target in normal play — purely so it can be
 *  drawn as one arrow. The underlying stat itself has no single wedge; see aimBias.ts. */
function project(radial: number, tangential: number) {
  const idealR = (RING.trebleInner + RING.trebleOuter) / 2;
  const idealU = 0;
  const idealV = -idealR;
  return {
    idealU, idealV,
    actualU: idealU + tangential * MAGNIFY,
    actualV: idealV - radial * MAGNIFY,
  };
}

const fmtMm = (mm: number) => `${Math.abs(mm) < 0.5 ? "~0" : (mm > 0 ? "+" : "") + mm.toFixed(1)} mm`;

/** Rough, unverified descriptive bands for the grouping radius — not a measured benchmark
 *  against real player data, just something more readable than a bare millimeter figure. A
 *  treble bed is only ~6mm wide, which is the intuition behind the "eng" cutoff. */
const groupingWord = (mm: number) => (mm < 8 ? "eng gruppiert" : mm < 18 ? "normal gestreut" : "weit gestreut");

/** Shows a player's pooled aim bias (see aimBias.ts) as one arrow on a reference board, from
 *  where a dart aimed at Treble 20 should land to where this player's darts land on average —
 *  exaggerated for visibility — plus the real, unscaled offset in millimeters. */
const AimBiasCard = ({ bias }: AimBiasCardProps) => {
  const { idealU, idealV, actualU, actualV } = project(bias.avgRadialOffset, bias.avgTangentialOffset);
  const toXY = (u: number, v: number) => [CENTER + u * BOARD_RADIUS, CENTER + v * BOARD_RADIUS];
  const [ix, iy] = toXY(idealU, idealV);
  const [ax, ay] = toXY(actualU, actualV);

  const radialWord = bias.radialOffsetMm > 0.5 ? "zu weit außen" : bias.radialOffsetMm < -0.5 ? "zu weit innen" : "gut getroffen (radial)";
  const tangentialWord = bias.tangentialOffsetMm > 0.5 ? "im Uhrzeigersinn versetzt" : bias.tangentialOffsetMm < -0.5 ? "gegen den Uhrzeigersinn versetzt" : "gut getroffen (seitlich)";

  return (
    <div className="bg-card rounded-xl border border-border p-4 mb-4">
      <h3 className="font-display text-sm uppercase mb-1 text-muted-foreground flex items-center gap-2">
        <Crosshair className="w-4 h-4" /> Wurf-Tendenz
      </h3>
      <p className="text-[10px] text-muted-foreground mb-3">
        Aus {bias.sampleSize} per Kamera erfassten Würfen · Pfeil stark übertrieben, damit er überhaupt sichtbar ist
      </p>
      <div className="flex items-center gap-4">
        <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="w-28 h-28 shrink-0" role="img" aria-label="Wurf-Tendenz relativ zum Ziel">
          <circle cx={CENTER} cy={CENTER} r={RING.doubleOuter * BOARD_RADIUS} fill="hsl(222 20% 12%)" stroke="hsl(222 18% 22%)" strokeWidth={1} />
          <circle cx={CENTER} cy={CENTER} r={RING.doubleInner * BOARD_RADIUS} fill="none" stroke="hsl(222 18% 22%)" strokeWidth={0.5} strokeDasharray="2 2" />
          <circle cx={CENTER} cy={CENTER} r={RING.trebleOuter * BOARD_RADIUS} fill="none" stroke="hsl(185 85% 48%)" strokeOpacity={0.35} strokeWidth={0.5} />
          <circle cx={CENTER} cy={CENTER} r={RING.trebleInner * BOARD_RADIUS} fill="none" stroke="hsl(185 85% 48%)" strokeOpacity={0.35} strokeWidth={0.5} />
          <circle cx={CENTER} cy={CENTER} r={RING.bullOuter * BOARD_RADIUS} fill="hsl(150 55% 32%)" fillOpacity={0.4} />
          <defs>
            <marker id="aimArrow" markerWidth={6} markerHeight={6} refX={5} refY={3} orient="auto">
              <path d="M0,0 L6,3 L0,6 Z" fill="hsl(0 75% 58%)" />
            </marker>
          </defs>
          <circle cx={ix} cy={iy} r={3} fill="hsl(185 85% 48%)" />
          <line x1={ix} y1={iy} x2={ax} y2={ay} stroke="hsl(0 75% 58%)" strokeWidth={2} markerEnd="url(#aimArrow)" />
          {/* Grouping radius — same MAGNIFY scale as the arrow, so the circle and the offset it's
              drawn around stay visually consistent with each other. */}
          <circle cx={ax} cy={ay} r={bias.groupingRadius * MAGNIFY * BOARD_RADIUS} fill="hsl(45 100% 58%)" fillOpacity={0.12} stroke="hsl(45 100% 58%)" strokeOpacity={0.6} strokeWidth={1} strokeDasharray="3 2" />
        </svg>
        <div className="flex-1 space-y-1.5 text-xs">
          <p><span className="text-muted-foreground">Radial: </span><span className="font-semibold">{fmtMm(bias.radialOffsetMm)}</span> <span className="text-muted-foreground">({radialWord})</span></p>
          <p><span className="text-muted-foreground">Seitlich: </span><span className="font-semibold">{fmtMm(bias.tangentialOffsetMm)}</span> <span className="text-muted-foreground">({tangentialWord})</span></p>
          <p><span className="text-muted-foreground">Gruppierung: </span><span className="font-semibold">±{bias.groupingRadiusMm.toFixed(1)} mm</span> <span className="text-muted-foreground">({groupingWord(bias.groupingRadiusMm)})</span></p>
          <p className="text-[10px] text-muted-foreground pt-1">Bezogen auf ein Ziel oben am Board (z. B. T20) — bei Zielen weiter unten am Board dreht sich die seitliche Richtung entsprechend mit. Die gestrichelte Fläche zeigt, wie eng deine Darts um deinen eigenen Schnitt streuen, unabhängig von der Tendenz.</p>
        </div>
      </div>
      <div className="mt-3 pt-3 border-t border-border/60 flex items-start gap-2">
        <Lightbulb className="w-3.5 h-3.5 text-accent shrink-0 mt-0.5" />
        <p className="text-xs text-accent">{describeAimTip(bias)}</p>
      </div>
    </div>
  );
};

export default AimBiasCard;
