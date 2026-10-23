import { useEffect, useRef, useState } from "react";
import { computeHomography, type Point } from "@/utils/homography";
import { CANON_BOARD_POINTS } from "@/utils/cameraGeometry";
import { boardOverlayLines } from "@/utils/boardRectify";
import { CALIBRATION_HANDLE_LABELS } from "@/utils/calibrationHandles";

const LOUPE_CSS_SIZE = 104;
const LOUPE_PIXELS = 208;
/** Width of the camera-picture area shown in the loupe, in camera pixels (about 5x magnification). */
const LOUPE_REGION = 56;
const GRAB_RADIUS_PX = 34;

interface BoardCalibratorProps {
  videoRef: React.RefObject<HTMLVideoElement>;
  videoSize: { w: number; h: number };
  taps: Point[];
  onChange: (taps: Point[]) => void;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * Calibration drawn right on the live picture: the board's rings and segment lines are projected from
 * the four handles (D20 top, D3 bottom, D11 left, D6 right — each on the OUTER edge of its double),
 * so how good the calibration is can be judged at a glance — it is right when the drawn rings sit on
 * the real wires — and corrected by dragging. A loupe next to the finger shows the exact spot.
 * Must be placed inside a box whose aspect ratio equals the video's, so overlay coordinates are the
 * video fractions themselves.
 */
const BoardCalibrator = ({ videoRef, videoSize, taps, onChange }: BoardCalibratorProps) => {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const loupeRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<{ index: number; offsetX: number; offsetY: number } | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const homography = computeHomography(CANON_BOARD_POINTS, taps);
  const lines = homography ? boardOverlayLines(homography) : null;

  const pointerToFraction = (e: React.PointerEvent): Point | null => {
    const rect = surfaceRef.current?.getBoundingClientRect();
    if (!rect || !rect.width || !rect.height) return null;
    return { x: (e.clientX - rect.left) / rect.width, y: (e.clientY - rect.top) / rect.height };
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    const rect = surfaceRef.current?.getBoundingClientRect();
    const p = pointerToFraction(e);
    if (!rect || !p) return;
    // Nearest handle, measured in screen pixels. Grabbing close to a handle keeps the finger's offset
    // to it; touching elsewhere makes the nearest handle jump to the touch point.
    let best = 0;
    let bestDist = Infinity;
    taps.forEach((t, i) => {
      const d = Math.hypot((t.x - p.x) * rect.width, (t.y - p.y) * rect.height);
      if (d < bestDist) { bestDist = d; best = i; }
    });
    const grabbed = bestDist <= GRAB_RADIUS_PX;
    dragRef.current = {
      index: best,
      offsetX: grabbed ? taps[best].x - p.x : 0,
      offsetY: grabbed ? taps[best].y - p.y : 0,
    };
    setDragIndex(best);
    e.currentTarget.setPointerCapture(e.pointerId);
    if (!grabbed) moveHandle(best, p.x, p.y);
  };

  const moveHandle = (index: number, x: number, y: number) => {
    onChange(taps.map((t, i) => (i === index ? { x: clamp01(x), y: clamp01(y) } : t)));
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    const p = pointerToFraction(e);
    if (!drag || !p) return;
    moveHandle(drag.index, p.x + drag.offsetX, p.y + drag.offsetY);
  };

  const endDrag = () => {
    dragRef.current = null;
    setDragIndex(null);
  };

  // Loupe: the camera picture around the dragged handle, with the same ring overlay drawn on top.
  useEffect(() => {
    if (dragIndex === null) return;
    const canvas = loupeRef.current;
    const video = videoRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !video || !ctx) return;
    const tap = taps[dragIndex];
    const sx = tap.x * videoSize.w - LOUPE_REGION / 2;
    const sy = tap.y * videoSize.h - LOUPE_REGION / 2;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, LOUPE_PIXELS, LOUPE_PIXELS);
    try {
      ctx.drawImage(video, sx, sy, LOUPE_REGION, LOUPE_REGION, 0, 0, LOUPE_PIXELS, LOUPE_PIXELS);
    } catch {
      /* video not ready — the overlay still draws */
    }
    const toLoupe = (p: Point) => ({
      x: ((p.x * videoSize.w - sx) / LOUPE_REGION) * LOUPE_PIXELS,
      y: ((p.y * videoSize.h - sy) / LOUPE_REGION) * LOUPE_PIXELS,
    });
    if (lines) {
      ctx.lineWidth = 2;
      lines.rings.forEach((ring, i) => {
        ctx.strokeStyle = ringColor(i);
        ctx.beginPath();
        ring.forEach((pt, k) => { const q = toLoupe(pt); if (k === 0) ctx.moveTo(q.x, q.y); else ctx.lineTo(q.x, q.y); });
        ctx.stroke();
      });
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = "rgba(255,255,255,0.6)";
      lines.spokes.forEach(([a, b]) => {
        const qa = toLoupe(a), qb = toLoupe(b);
        ctx.beginPath(); ctx.moveTo(qa.x, qa.y); ctx.lineTo(qb.x, qb.y); ctx.stroke();
      });
    }
    ctx.strokeStyle = "rgba(255,200,0,0.9)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(LOUPE_PIXELS / 2, 0); ctx.lineTo(LOUPE_PIXELS / 2, LOUPE_PIXELS);
    ctx.moveTo(0, LOUPE_PIXELS / 2); ctx.lineTo(LOUPE_PIXELS, LOUPE_PIXELS / 2);
    ctx.stroke();
  }, [dragIndex, taps, lines, videoRef, videoSize.w, videoSize.h]);

  const dragged = dragIndex === null ? null : taps[dragIndex];
  const loupeStyle: React.CSSProperties = dragged
    ? {
        width: LOUPE_CSS_SIZE,
        height: LOUPE_CSS_SIZE,
        ...(dragged.x > 0.5 ? { left: 8 } : { right: 8 }),
        ...(dragged.y > 0.5 ? { top: 8 } : { bottom: 8 }),
      }
    : {};

  return (
    <div
      ref={surfaceRef}
      className="absolute inset-0 z-20 cursor-crosshair select-none touch-none"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      {lines && (
        <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 1 1" preserveAspectRatio="none">
          {lines.rings.map((ring, i) => (
            <polyline
              key={i}
              points={ring.map((p) => `${p.x},${p.y}`).join(" ")}
              fill="none"
              stroke={ringColor(i)}
              strokeWidth={i === 5 ? 2 : 1.3}
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {lines.spokes.map(([a, b], i) => (
            <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="rgba(255,255,255,0.45)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          ))}
        </svg>
      )}

      {taps.map((t, i) => (
        <div
          key={i}
          className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2"
          style={{ left: `${t.x * 100}%`, top: `${t.y * 100}%` }}
        >
          <div className={`h-5 w-5 rounded-full border-2 ${dragIndex === i ? "border-accent bg-accent/40" : "border-primary bg-primary/30"} shadow`} />
          <span className="absolute left-6 top-1/2 -translate-y-1/2 rounded bg-background/85 px-1 text-[10px] font-display text-foreground">
            {CALIBRATION_HANDLE_LABELS[i]}
          </span>
        </div>
      ))}

      {dragged && (
        <canvas
          ref={loupeRef}
          width={LOUPE_PIXELS}
          height={LOUPE_PIXELS}
          className="pointer-events-none absolute z-30 rounded-full border-2 border-accent shadow-lg"
          style={loupeStyle}
        />
      )}
    </div>
  );
};

/** Bull rings yellow, treble rings green, double rings cyan (index follows boardOverlayLines.rings). */
function ringColor(index: number): string {
  if (index <= 1) return "hsl(48 100% 60%)";
  if (index <= 3) return "hsl(150 80% 55%)";
  return "hsl(185 90% 58%)";
}

export default BoardCalibrator;
