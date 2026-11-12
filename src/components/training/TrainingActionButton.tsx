import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const VARIANT_CLASSES = {
  /** The one main action of a screen (start, finish). */
  primary: "bg-primary text-primary-foreground",
  /** Everything else (undo, camera, again). */
  outline: "border border-border bg-card text-foreground hover:border-primary/40",
  /** Combo Risk's bank button — a positive, secondary-colored action. */
  secondary: "bg-secondary text-secondary-foreground",
} as const;

const SIZE_CLASSES = {
  lg: "h-14 rounded-[14px] px-5 text-lg",
  md: "h-12 rounded-xl px-4 text-[15px]",
  sm: "h-11 rounded-xl px-3 text-sm",
} as const;

interface TrainingActionButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof VARIANT_CLASSES;
  size?: keyof typeof SIZE_CLASSES;
}

/** Flat redesign button for the Training screens — no hover glow, fixed touch-friendly heights. */
const TrainingActionButton = forwardRef<HTMLButtonElement, TrainingActionButtonProps>(
  ({ variant = "outline", size = "md", className, type = "button", ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(
        "inline-flex items-center justify-center gap-2 whitespace-nowrap font-semibold transition-[transform,border-color,opacity] active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40 [&_svg]:h-[18px] [&_svg]:w-[18px] [&_svg]:shrink-0",
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        className,
      )}
      {...props}
    />
  ),
);
TrainingActionButton.displayName = "TrainingActionButton";

export default TrainingActionButton;
