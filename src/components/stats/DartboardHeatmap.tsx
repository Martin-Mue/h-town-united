import { SEGMENTS_CLOCKWISE, RING } from "@/utils/dartboardGeometry";

/** Per-zone hit counts, keyed the same way every dart is already scored (baseValue × multiplier)
 *  — so, unlike the precise `points` dots below, this works for EVERY throw, manual entries
 *  included, not just camera-scored ones. "single" merges the inner and outer single bands: a
 *  manual "S20" entry doesn't record which of the two it landed in, so splitting them would
 *  fabricate precision the data doesn't have — both bands for a number always shade together. */
export interface ZoneCounts {
  byNumber: Record<number, { single: number; treble: number; double: number }>;
  bull25: number;
  bull50: number;
}

interface DartboardHeatmapProps {
  /** Board-relative unit coordinates (0,0 = bull, radius ~1 = double edge) — see DartThrow.boardU/V. */
  points: { u: number; v: number; points: number }[];
  /** Zone-intensity shading (Design-Sprint Runde 3 Punkt 1, Option B) — combined manual + camera
   *  hit counts per board zone, drawn as choropleth wedge shading underneath the precise camera
   *  dots. Optional so existing callers that only ever had `points` keep compiling/rendering. */
  zoneCounts?: ZoneCounts;
}

const SIZE = 300;
const CENTER = SIZE / 2;
const BOARD_RADIUS = 128; // pixel radius for u/v magnitude 1.0 (the double-ring edge)
const NUMBER_RADIUS = BOARD_RADIUS + 16;

/** Converts a ring-boundary fraction (0-1, RING.* scale) to an SVG path for one wedge's ring band. */
function wedgePath(innerFrac: number, outerFrac: number, startDeg: number, endDeg: number): string {
  const toXY = (deg: number, frac: number) => {
    const rad = ((deg - 90) * Math.PI) / 180;
    return [CENTER + Math.cos(rad) * frac * BOARD_RADIUS, CENTER + Math.sin(rad) * frac * BOARD_RADIUS];
  };
  const [x1, y1] = toXY(startDeg, outerFrac);
  const [x2, y2] = toXY(endDeg, outerFrac);
  const [x3, y3] = toXY(endDeg, innerFrac);
  const [x4, y4] = toXY(startDeg, innerFrac);
  const largeArc = endDeg - startDeg > 180 ? 1 : 0;
  return [
    `M ${x1} ${y1}`,
    `A ${outerFrac * BOARD_RADIUS} ${outerFrac * BOARD_RADIUS} 0 ${largeArc} 1 ${x2} ${y2}`,
    `L ${x3} ${y3}`,
    `A ${innerFrac * BOARD_RADIUS} ${innerFrac * BOARD_RADIUS} 0 ${largeArc} 0 ${x4} ${y4}`,
    "Z",
  ].join(" ");
}

// Heat overlay: a single warm hue (accent gold, the app's "special/highlight" color) whose
// opacity scales with hit count relative to the player's single hottest zone — 0 hits stays fully
// transparent (the plain board shows through unchanged), the hottest zone(s) read clearly "hot"
// without needing a real density-estimation pass, same reasoning as the existing dot-overlap trick.
const HEAT_HUE = "45 100% 58%";
function heatFill(count: number, max: number): string {
  if (count <= 0 || max <= 0) return "transparent";
  const intensity = Math.min(1, count / max);
  const opacity = 0.1 + intensity * 0.75;
  return `hsl(${HEAT_HUE} / ${opacity.toFixed(3)})`;
}

/**
 * Renders a real dartboard face (segments/rings, standard proportions) with two independent
 * layers of "where did this player actually hit" data on top:
 *  - zone-intensity shading (Option B): every recorded throw, manual or camera, buckets into the
 *    zone it was scored in (single/treble/double per number, plus the two bull rings) and tints
 *    that zone's wedge by relative hit frequency — works from day one, camera or no camera.
 *  - precise dots: camera-scored throws additionally carry a real tip position and are still
 *    plotted individually on top, for the extra precision a camera gives when it's in use.
 */
const DartboardHeatmap = ({ points, zoneCounts }: DartboardHeatmapProps) => {
  const segAngle = 360 / 20;

  const maxZoneCount = zoneCounts
    ? Math.max(
        zoneCounts.bull25,
        zoneCounts.bull50,
        ...Object.values(zoneCounts.byNumber).flatMap((z) => [z.single, z.treble, z.double]),
        0,
      )
    : 0;

  return (
    <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="w-full h-auto max-w-sm mx-auto" role="img" aria-label={`Trefferkarte auf dem Dartboard, ${points.length} eingezeichnete Würfe`}>
      <circle cx={CENTER} cy={CENTER} r={BOARD_RADIUS + 2} fill="hsl(222 20% 12%)" />
      {SEGMENTS_CLOCKWISE.map((num, i) => {
        const start = i * segAngle - segAngle / 2;
        const end = start + segAngle;
        const dark = i % 2 === 0;
        const base = dark ? "hsl(222 18% 16%)" : "hsl(40 20% 88%)";
        const accentRing = dark ? "hsl(0 68% 42%)" : "hsl(150 55% 32%)";
        const zone = zoneCounts?.byNumber[num];
        const singleHeat = zone ? heatFill(zone.single, maxZoneCount) : "transparent";
        const trebleHeat = zone ? heatFill(zone.treble, maxZoneCount) : "transparent";
        const doubleHeat = zone ? heatFill(zone.double, maxZoneCount) : "transparent";
        return (
          <g key={num}>
            <path d={wedgePath(RING.bullOuter, RING.trebleInner, start, end)} fill={base} stroke="hsl(222 20% 8%)" strokeWidth={0.5} />
            <path d={wedgePath(RING.trebleInner, RING.trebleOuter, start, end)} fill={accentRing} stroke="hsl(222 20% 8%)" strokeWidth={0.5} />
            <path d={wedgePath(RING.trebleOuter, RING.doubleInner, start, end)} fill={base} stroke="hsl(222 20% 8%)" strokeWidth={0.5} />
            <path d={wedgePath(RING.doubleInner, RING.doubleOuter, start, end)} fill={accentRing} stroke="hsl(222 20% 8%)" strokeWidth={0.5} />
            {/* Heat overlay — separate paths on top so the base board colors/strokes above stay
                untouched; "single" spans both single bands at once (see the ZoneCounts doc comment). */}
            <path d={wedgePath(RING.bullOuter, RING.trebleInner, start, end)} fill={singleHeat} />
            <path d={wedgePath(RING.trebleInner, RING.trebleOuter, start, end)} fill={trebleHeat} />
            <path d={wedgePath(RING.trebleOuter, RING.doubleInner, start, end)} fill={singleHeat} />
            <path d={wedgePath(RING.doubleInner, RING.doubleOuter, start, end)} fill={doubleHeat} />
          </g>
        );
      })}
      <circle cx={CENTER} cy={CENTER} r={RING.bullOuter * BOARD_RADIUS} fill="hsl(150 55% 32%)" stroke="hsl(222 20% 8%)" strokeWidth={0.5} />
      <circle cx={CENTER} cy={CENTER} r={RING.bullOuter * BOARD_RADIUS} fill={zoneCounts ? heatFill(zoneCounts.bull25, maxZoneCount) : "transparent"} />
      <circle cx={CENTER} cy={CENTER} r={RING.bullInner * BOARD_RADIUS} fill="hsl(0 68% 42%)" stroke="hsl(222 20% 8%)" strokeWidth={0.5} />
      <circle cx={CENTER} cy={CENTER} r={RING.bullInner * BOARD_RADIUS} fill={zoneCounts ? heatFill(zoneCounts.bull50, maxZoneCount) : "transparent"} />

      {SEGMENTS_CLOCKWISE.map((num, i) => {
        const deg = i * segAngle;
        const rad = ((deg - 90) * Math.PI) / 180;
        const x = CENTER + Math.cos(rad) * NUMBER_RADIUS;
        const y = CENTER + Math.sin(rad) * NUMBER_RADIUS;
        return (
          <text key={num} x={x} y={y} textAnchor="middle" dominantBaseline="middle" fontSize={11} fontWeight={700} fill="hsl(210 15% 75%)">
            {num}
          </text>
        );
      })}

      {points.map((p, i) => (
        <circle
          key={i}
          cx={CENTER + p.u * BOARD_RADIUS}
          cy={CENTER + p.v * BOARD_RADIUS}
          r={5}
          fill="hsl(var(--primary))"
          fillOpacity={0.16}
          stroke="hsl(var(--primary))"
          strokeOpacity={0.25}
          strokeWidth={0.5}
        />
      ))}
    </svg>
  );
};

export default DartboardHeatmap;
