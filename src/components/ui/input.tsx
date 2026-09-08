import * as React from "react";

import { cn } from "@/lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          // Design-Sprint Runde 3 Rang 3: the generic focus ring alone didn't say "you're now
          // typing into DartSpot" -- a soft primary-hue glow (kept ON TOP of the ring, not instead
          // of it, so keyboard-focus visibility is unchanged) plus a border tint make the same
          // moment feel branded instead of default-browser-ish.
          "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background transition-[border-color,box-shadow] duration-150 ease-press file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:shadow-[0_0_12px_hsl(var(--primary)/0.25)] disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
