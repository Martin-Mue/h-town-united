import { memo } from "react";
import { RING, SEGMENTS_CLOCKWISE } from "@/utils/dartboardGeometry";
import type { BoardPoint } from "@/utils/dartMarkerPosition";

export interface SimulatedDart extends BoardPoint {
  /** Colours the dart: the newest one of a round is highlighted. */
  fresh?: boolean;
}

interface SimulatedBoardProps {
  darts: SimulatedDart[];
  className?: string;
}

/** A point of the board's face, board-canonical (radius 1 = outer double edge), as an SVG coordinate. */
const point = (radius: number, angleDeg: number) => {
  const a = (angleDeg * Math.PI) / 180;
  return `${(radius * Math.sin(a)).toFixed(4)} ${(-radius * Math.cos(a)).toFixed(4)}`;
};

/** One ring segment between two radii and two angles (degrees, clockwise from the top). */
const ringSegment = (inner: number, outer: number, from: number, to: number) =>
  `M ${point(outer, from)} A ${outer} ${outer} 0 0 1 ${point(outer, to)} L ${point(inner, to)} A ${inner} ${inner} 0 0 0 ${point(inner, from)} Z`;

// The board keeps the colours of a real one; the dart glyphs and the wire are ours.
const DARK = "hsl(222 22% 11%)";
const CREAM = "hsl(40 38% 80%)";
const RED = "hsl(0 70% 46%)";
const GREEN = "hsl(155 62% 36%)";
const WIRE = "hsl(210 10% 62%)";

const BOARD_SEGMENTS = SEGMENTS_CLOCKWISE.flatMap((value, index) => {
  const from = index * 18 - 9;
  const to = from + 18;
  const dark = index % 2 === 0;
  const single = dark ? DARK : CREAM;
  const ring = dark ? RED : GREEN;
  return [
    { key: `${value}-in`, d: ringSegment(RING.bullOuter, RING.trebleInner, from, to), fill: single },
    { key: `${value}-tr`, d: ringSegment(RING.trebleInner, RING.trebleOuter, from, to), fill: ring },
    { key: `${value}-out`, d: ringSegment(RING.trebleOuter, RING.doubleInner, from, to), fill: single },
    { key: `${value}-db`, d: ringSegment(RING.doubleInner, RING.doubleOuter, from, to), fill: ring },
  ];
});

const WIRE_LINES = SEGMENTS_CLOCKWISE.map((_, index) => {
  const angle = index * 18 + 9;
  return `M ${point(RING.bullOuter, angle)} L ${point(RING.doubleOuter, angle)}`;
}).join(" ");

/** Where a dart's flight trails off from its tip — the same side for every dart, like darts thrown from one spot. */
const FLIGHT_DX = -0.2;
const FLIGHT_DY = 0.31;

/**
 * A drawn dartboard with the darts of the current round stuck in it. Used while a bot plays (its darts have
 * no camera picture, only a field, so each one is drawn somewhere inside that field) so the opponent's
 * turn is something to watch instead of a greyed-out number pad.
 */
const SimulatedBoard = memo(({ darts, className }: SimulatedBoardProps) => (
  <svg viewBox="-1.3 -1.3 2.6 2.6" className={className} role="img" aria-label="Dartscheibe">
    <circle r="1.27" fill="hsl(222 28% 6%)" stroke="hsl(222 18% 18%)" strokeWidth="0.015" />
    {SEGMENTS_CLOCKWISE.map((value, index) => {
      const a = (index * 18 * Math.PI) / 180;
      return (
        <text key={value} x={1.13 * Math.sin(a)} y={-1.13 * Math.cos(a)} fontSize="0.15" fontWeight="700" textAnchor="middle" dominantBaseline="central" fill="hsl(210 15% 85%)" style={{ fontFamily: "inherit" }}>
          {value}
        </text>
      );
    })}
    {BOARD_SEGMENTS.map((s) => (
      <path key={s.key} d={s.d} fill={s.fill} />
    ))}
    <path d={WIRE_LINES} stroke={WIRE} strokeWidth="0.006" fill="none" />
    {[RING.bullOuter, RING.trebleInner, RING.trebleOuter, RING.doubleInner, RING.doubleOuter].map((r) => (
      <circle key={r} r={r} fill="none" stroke={WIRE} strokeWidth="0.006" />
    ))}
    <circle r={RING.bullOuter} fill={GREEN} />
    <circle r={RING.bullInner} fill={RED} />
    <circle r={RING.bullOuter} fill="none" stroke={WIRE} strokeWidth="0.006" />
    {darts.map((d, i) => {
      const colour = d.fresh ? "hsl(45 100% 58%)" : "hsl(185 85% 55%)";
      return (
        <g key={i} className="animate-dart-pop" style={{ transformOrigin: `${d.u}px ${d.v}px`, transformBox: "view-box" }}>
          <line x1={d.u} y1={d.v} x2={d.u + FLIGHT_DX * 0.7} y2={d.v + FLIGHT_DY * 0.7} stroke="hsl(210 15% 90%)" strokeWidth="0.034" strokeLinecap="round" />
          <polygon
            points={`${d.u + FLIGHT_DX * 0.66},${d.v + FLIGHT_DY * 0.66} ${d.u + FLIGHT_DX + 0.1},${d.v + FLIGHT_DY - 0.04} ${d.u + FLIGHT_DX - 0.04},${d.v + FLIGHT_DY + 0.1}`}
            fill={colour}
            stroke="hsl(222 28% 6%)"
            strokeWidth="0.01"
          />
          <circle cx={d.u} cy={d.v} r="0.036" fill="hsl(210 15% 96%)" stroke="hsl(222 28% 6%)" strokeWidth="0.014" />
        </g>
      );
    })}
  </svg>
));
SimulatedBoard.displayName = "SimulatedBoard";

export default SimulatedBoard;
