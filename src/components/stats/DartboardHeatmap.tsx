import { SEGMENTS_CLOCKWISE, RING } from "@/utils/dartboardGeometry";

interface DartboardHeatmapProps {
  /** Board-relative unit coordinates (0,0 = bull, radius ~1 = double edge) — see DartThrow.boardU/V. */
  points: { u: number; v: number; points: number }[];
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

/**
 * Renders a real dartboard face (segments/rings, standard proportions) with recorded throw
 * tip positions plotted as low-opacity dots — overlapping throws naturally read as "hotter"
 * without needing a real density-estimation pass.
 */
const DartboardHeatmap = ({ points }: DartboardHeatmapProps) => {
  const segAngle = 360 / 20;

  return (
    <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="w-full h-auto max-w-sm mx-auto" role="img" aria-label={`Trefferkarte auf dem Dartboard, ${points.length} eingezeichnete Würfe`}>
      <circle cx={CENTER} cy={CENTER} r={BOARD_RADIUS + 2} fill="hsl(222 20% 12%)" />
      {SEGMENTS_CLOCKWISE.map((num, i) => {
        const start = i * segAngle - segAngle / 2;
        const end = start + segAngle;
        const dark = i % 2 === 0;
        const base = dark ? "hsl(222 18% 16%)" : "hsl(40 20% 88%)";
        const accentRing = dark ? "hsl(0 68% 42%)" : "hsl(150 55% 32%)";
        return (
          <g key={num}>
            <path d={wedgePath(RING.bullOuter, RING.trebleInner, start, end)} fill={base} stroke="hsl(222 20% 8%)" strokeWidth={0.5} />
            <path d={wedgePath(RING.trebleInner, RING.trebleOuter, start, end)} fill={accentRing} stroke="hsl(222 20% 8%)" strokeWidth={0.5} />
            <path d={wedgePath(RING.trebleOuter, RING.doubleInner, start, end)} fill={base} stroke="hsl(222 20% 8%)" strokeWidth={0.5} />
            <path d={wedgePath(RING.doubleInner, RING.doubleOuter, start, end)} fill={accentRing} stroke="hsl(222 20% 8%)" strokeWidth={0.5} />
          </g>
        );
      })}
      <circle cx={CENTER} cy={CENTER} r={RING.bullOuter * BOARD_RADIUS} fill="hsl(150 55% 32%)" stroke="hsl(222 20% 8%)" strokeWidth={0.5} />
      <circle cx={CENTER} cy={CENTER} r={RING.bullInner * BOARD_RADIUS} fill="hsl(0 68% 42%)" stroke="hsl(222 20% 8%)" strokeWidth={0.5} />

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
