import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

// Design-Sprint Runde 3 Rang 4: each variant now gets a faint hue-matched glow at rest (not just
// on hover) -- consistent with this file's semantic roles (primary=action, secondary=win/success,
// destructive=a separate red) already documented in index.css. Subtle on purpose: a badge sits
// inline with text constantly, so this is a soft ambient glow, not the punchier hover-glow Button
// uses for a discrete action.
const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground shadow-[0_0_8px_hsl(var(--primary)/0.35)] hover:bg-primary/80",
        secondary: "border-transparent bg-secondary text-secondary-foreground shadow-[0_0_8px_hsl(var(--secondary)/0.3)] hover:bg-secondary/80",
        destructive: "border-transparent bg-destructive text-destructive-foreground shadow-[0_0_8px_hsl(var(--destructive)/0.3)] hover:bg-destructive/80",
        outline: "text-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
