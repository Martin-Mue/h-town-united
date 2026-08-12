const DIGITS = "0123456789".split("");

/** One odometer wheel — shows `value` (0-9) by sliding a stacked 0-9 column so the
 *  right digit sits in the 1-line-tall viewport, animating via CSS transform. */
const OdometerDigit = ({ value }: { value: number }) => (
  <span className="relative inline-block overflow-hidden align-bottom" style={{ height: "1em", width: "0.62em" }}>
    <span
      className="absolute inset-x-0 top-0 flex flex-col transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]"
      style={{ transform: `translateY(-${value * 10}%)` }}
    >
      {DIGITS.map((d) => (
        <span key={d} className="flex items-center justify-center" style={{ height: "1em", lineHeight: "1em" }}>
          {d}
        </span>
      ))}
    </span>
  </span>
);

interface AnimatedScoreProps {
  value: number;
  className?: string;
}

/**
 * Odometer-style rolling digits for the remaining-score tiles — a countdown visibly
 * ticks over digit by digit instead of hard-swapping the text on every throw. Falls back
 * gracefully (still just renders the digits) if the value's digit count changes, e.g.
 * crossing 100 or 10 — that transition isn't animated, only same-length changes are.
 */
const AnimatedScore = ({ value, className }: AnimatedScoreProps) => {
  const safe = Math.max(0, Math.round(value));
  const digits = String(safe).split("").map(Number);
  return (
    <span className={`inline-flex tabular-nums ${className ?? ""}`}>
      {digits.map((d, i) => (
        <OdometerDigit key={digits.length - i} value={d} />
      ))}
    </span>
  );
};

export default AnimatedScore;
