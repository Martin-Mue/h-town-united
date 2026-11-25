/** How tightly the darts of one visit sit together, in mm: the root-mean-square distance from their own middle. */

const DOUBLE_EDGE_MM = 170;

export interface PositionedDart {
  boardU?: number;
  boardV?: number;
}

/** Null below two darts with a position (one dart has no spread). */
export function visitSpreadMm(darts: PositionedDart[]): number | null {
  const points = darts.filter((d): d is { boardU: number; boardV: number } => typeof d.boardU === "number" && typeof d.boardV === "number");
  if (points.length < 2) return null;
  const cu = points.reduce((s, p) => s + p.boardU, 0) / points.length;
  const cv = points.reduce((s, p) => s + p.boardV, 0) / points.length;
  const meanSquare = points.reduce((s, p) => s + (p.boardU - cu) ** 2 + (p.boardV - cv) ** 2, 0) / points.length;
  return Math.sqrt(meanSquare) * DOUBLE_EDGE_MM;
}
