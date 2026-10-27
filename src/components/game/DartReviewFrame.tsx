import { useEffect, useRef, useState } from "react";
import { choiceLabel, neighbourSegments, type ScoreChoice } from "@/utils/dartCorrection";
import { SEGMENTS_CLOCKWISE } from "@/utils/dartboardGeometry";

export interface ReviewDart {
  /** Tip position as a fraction (0-1) of the frozen frame. */
  x: number;
  y: number;
  baseValue: number;
  multiplier: 1 | 2 | 3;
}

interface DartReviewFrameProps {
  imageUrl: string;
  darts: ReviewDart[];
  selectedIndex: number | null;
  onSelect: (index: number | null) => void;
  /** The player placed the tip of dart `index` here (fractions of the frame). */
  onMove: (index: number, x: number, y: number) => void;
  /** The player picked a different score for the selected dart from the chips. */
  onChoose: (index: number, choice: ScoreChoice) => void;
  /** CSS length capping the picture's width (and so its height); defaults to 62 % of the viewport height. */
  maxSide?: string;
  /** Texts, so this stays free of translation plumbing. */
  labels: { hintPick: string; hintMove: string; miss: string; bullOuter: string; bullInner: string };
}

const HIT_RADIUS_PX = 34;
const LOUPE_CSS_SIZE = 104;
const LOUPE_PIXELS = 208;
/** Width of the frame area shown in the loupe, in frame pixels. */
const LOUPE_REGION = 70;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * The review of a round, on the FROZEN picture taken while the darts were still in the board — not on
 * the live view, where they have been pulled by then. Tap a dart's number to select it, then either
 * pick the right score from the chips (neighbouring segments, single/double/treble, bull, miss — one
 * tap, no precision needed) or drag/tap its tip to the exact spot, with a loupe beside the finger.
 */
const DartReviewFrame = ({ imageUrl, darts, selectedIndex, onSelect, onMove, onChoose, labels, maxSide }: DartReviewFrameProps) => {
  const wrapRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const loupeRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<{ index: number; offsetX: number; offsetY: number } | null>(null);
  const [loupeAt, setLoupeAt] = useState<{ x: number; y: number } | null>(null);
  // The neighbour chips are built around the value the dart had when it was selected (or last dragged to) and stay put
  // while chips are tapped. Rebuilding them around every tapped value shifted the whole row under the finger, so the
  // next tap hit a different number (2026-10-27: a D9 checkout took ~35 s of T1 / T20 / 1 / 20 back and forth).
  const [chipAnchor, setChipAnchor] = useState<{ index: number; baseValue: number } | null>(null);
  const reanchorRef = useRef(false);
  useEffect(() => {
    if (selectedIndex === null) { setChipAnchor(null); return; }
    setChipAnchor({ index: selectedIndex, baseValue: darts[selectedIndex]?.baseValue ?? 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIndex]);
  useEffect(() => {
    if (!reanchorRef.current || selectedIndex === null) return;
    const d = darts[selectedIndex];
    if (d && chipAnchor?.baseValue !== d.baseValue) setChipAnchor({ index: selectedIndex, baseValue: d.baseValue });
  }, [darts, selectedIndex, chipAnchor]);

  const pointerToFraction = (e: React.PointerEvent) => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect || !rect.width || !rect.height) return null;
    return { rect, x: (e.clientX - rect.left) / rect.width, y: (e.clientY - rect.top) / rect.height };
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    const p = pointerToFraction(e);
    if (!p) return;
    let nearest = -1;
    let nearestDist = Infinity;
    darts.forEach((d, i) => {
      const dist = Math.hypot((d.x - p.x) * p.rect.width, (d.y - p.y) * p.rect.height);
      if (dist < nearestDist) { nearestDist = dist; nearest = i; }
    });
    if (nearest >= 0 && nearestDist <= HIT_RADIUS_PX) {
      onSelect(nearest);
      reanchorRef.current = true;
      dragRef.current = { index: nearest, offsetX: darts[nearest].x - p.x, offsetY: darts[nearest].y - p.y };
      setLoupeAt({ x: darts[nearest].x, y: darts[nearest].y });
      e.currentTarget.setPointerCapture(e.pointerId);
    } else if (selectedIndex !== null) {
      reanchorRef.current = true;
      onMove(selectedIndex, clamp01(p.x), clamp01(p.y));
      dragRef.current = { index: selectedIndex, offsetX: 0, offsetY: 0 };
      setLoupeAt({ x: clamp01(p.x), y: clamp01(p.y) });
      e.currentTarget.setPointerCapture(e.pointerId);
    } else {
      onSelect(null);
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    const p = pointerToFraction(e);
    if (!drag || !p) return;
    const x = clamp01(p.x + drag.offsetX);
    const y = clamp01(p.y + drag.offsetY);
    onMove(drag.index, x, y);
    setLoupeAt({ x, y });
  };

  const endDrag = () => {
    dragRef.current = null;
    setLoupeAt(null);
  };

  // Loupe: the frozen picture around the dragged tip, enlarged, with a crosshair on the exact spot.
  useEffect(() => {
    if (!loupeAt) return;
    const canvas = loupeRef.current;
    const img = imgRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !img || !ctx || !img.naturalWidth) return;
    const region = (LOUPE_REGION / 800) * img.naturalWidth;
    const sx = loupeAt.x * img.naturalWidth - region / 2;
    const sy = loupeAt.y * img.naturalHeight - region / 2;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, LOUPE_PIXELS, LOUPE_PIXELS);
    try { ctx.drawImage(img, sx, sy, region, region, 0, 0, LOUPE_PIXELS, LOUPE_PIXELS); } catch { /* not decoded yet */ }
    ctx.strokeStyle = "rgba(255,200,0,0.95)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(LOUPE_PIXELS / 2, 0); ctx.lineTo(LOUPE_PIXELS / 2, LOUPE_PIXELS / 2 - 8);
    ctx.moveTo(LOUPE_PIXELS / 2, LOUPE_PIXELS / 2 + 8); ctx.lineTo(LOUPE_PIXELS / 2, LOUPE_PIXELS);
    ctx.moveTo(0, LOUPE_PIXELS / 2); ctx.lineTo(LOUPE_PIXELS / 2 - 8, LOUPE_PIXELS / 2);
    ctx.moveTo(LOUPE_PIXELS / 2 + 8, LOUPE_PIXELS / 2); ctx.lineTo(LOUPE_PIXELS, LOUPE_PIXELS / 2);
    ctx.stroke();
  }, [loupeAt]);

  const loupeStyle: React.CSSProperties = loupeAt
    ? {
        width: LOUPE_CSS_SIZE,
        height: LOUPE_CSS_SIZE,
        ...(loupeAt.x > 0.5 ? { left: 8 } : { right: 8 }),
        ...(loupeAt.y > 0.5 ? { top: 8 } : { bottom: 8 }),
      }
    : {};

  const selected = selectedIndex !== null ? darts[selectedIndex] : null;

  return (
    <div className="space-y-2">
      <div
        ref={wrapRef}
        className="relative mx-auto aspect-square select-none touch-none overflow-hidden rounded-lg border border-border bg-black"
        style={{ width: `min(100%, ${maxSide ?? "62dvh"})` }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <img ref={imgRef} src={imageUrl} alt="" draggable={false} className="pointer-events-none h-full w-full object-cover" />
        {darts.map((d, i) => {
          const isSelected = i === selectedIndex;
          return (
            <div
              key={i}
              className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2"
              style={{ left: `${d.x * 100}%`, top: `${d.y * 100}%` }}
            >
              <div className={`flex h-6 w-6 items-center justify-center rounded-full border-2 text-[11px] font-bold shadow ${
                isSelected ? "border-primary bg-primary text-primary-foreground ring-4 ring-primary/30" : "border-accent bg-accent text-accent-foreground"
              }`}>
                {i + 1}
              </div>
              <span className="absolute left-1/2 top-7 -translate-x-1/2 whitespace-nowrap rounded bg-background/90 px-1 text-[10px] font-display text-foreground">
                {choiceLabel({ baseValue: d.baseValue, multiplier: d.multiplier })}
              </span>
            </div>
          );
        })}
        {loupeAt && (
          <canvas
            ref={loupeRef}
            width={LOUPE_PIXELS}
            height={LOUPE_PIXELS}
            className="pointer-events-none absolute z-10 rounded-full border-2 border-accent shadow-lg"
            style={loupeStyle}
          />
        )}
      </div>

      <p className="text-center text-[11px] text-muted-foreground">{selected ? labels.hintMove : labels.hintPick}</p>

      {selected && selectedIndex !== null && (
        <CorrectionChips
          dart={selected}
          anchorValue={chipAnchor?.index === selectedIndex ? chipAnchor.baseValue : selected.baseValue}
          onChoose={(choice) => { reanchorRef.current = false; onChoose(selectedIndex, choice); }}
          labels={labels}
        />
      )}
    </div>
  );
};

interface CorrectionChipsProps {
  dart: ReviewDart;
  /** The value the neighbour row is built around — fixed while chips are being tapped. */
  anchorValue: number;
  onChoose: (choice: ScoreChoice) => void;
  labels: DartReviewFrameProps["labels"];
}

/** The few alternatives that cover nearly every misreading: the segment next door, or another ring. */
const CorrectionChips = ({ dart, anchorValue, onChoose, labels }: CorrectionChipsProps) => {
  const isNumbered = dart.baseValue >= 1 && dart.baseValue <= 20;
  const anchorNumbered = anchorValue >= 1 && anchorValue <= 20;
  const segments = anchorNumbered ? neighbourSegments(anchorValue) : SEGMENTS_CLOCKWISE;
  const multiplier = isNumbered ? dart.multiplier : 1;
  const chip = (active: boolean) =>
    `h-9 min-w-9 shrink-0 rounded-lg px-2 text-sm font-display transition-colors ${
      active ? "bg-primary text-primary-foreground" : "bg-muted text-foreground hover:bg-muted/70"
    }`;
  return (
    <div className="space-y-1.5 rounded-lg border border-border bg-card/60 p-2">
      <div className={`flex gap-1.5 ${anchorNumbered ? "justify-center" : "flex-wrap justify-center"}`}>
        {segments.map((seg) => (
          <button
            key={seg}
            type="button"
            className={chip(isNumbered && seg === dart.baseValue)}
            onClick={() => onChoose({ baseValue: seg, multiplier })}
          >
            {seg}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-center gap-1.5">
        {([1, 2, 3] as const).map((m) => (
          <button
            key={m}
            type="button"
            disabled={!isNumbered}
            className={`${chip(isNumbered && dart.multiplier === m)} disabled:opacity-40`}
            onClick={() => onChoose({ baseValue: dart.baseValue, multiplier: m })}
          >
            {m === 1 ? "S" : m === 2 ? "D" : "T"}
          </button>
        ))}
        <span className="mx-1 h-6 w-px bg-border" />
        <button type="button" className={chip(dart.baseValue === 25 && dart.multiplier === 1)} onClick={() => onChoose({ baseValue: 25, multiplier: 1 })}>
          {labels.bullOuter}
        </button>
        <button type="button" className={chip(dart.baseValue === 25 && dart.multiplier === 2)} onClick={() => onChoose({ baseValue: 25, multiplier: 2 })}>
          {labels.bullInner}
        </button>
        <button type="button" className={chip(dart.baseValue === 0)} onClick={() => onChoose({ baseValue: 0, multiplier: 1 })}>
          {labels.miss}
        </button>
      </div>
    </div>
  );
};

export default DartReviewFrame;
