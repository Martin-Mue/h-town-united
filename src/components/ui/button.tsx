import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

// Design-Sprint Runde 3 Rang 1: this was the unmodified shadcn/ui default (flat colors, generic
// `transition-colors`, no press feedback) despite the app already having its own glow/press-depth
// design tokens (--shadow-glow-*, --ease-press) sitting unused in index.css since Design-Sprint
// Runde 2. Every single button in the app inherits from here, so this is the highest-leverage
// place to make DartSpot feel like a physical arena scoreboard instead of "any shadcn app":
// solid variants get a hue-matched glow on hover (a little "power up" under the cursor) and a
// tactile press-depth (scale + shadow easing off) on tap, using this app's own --ease-press token
// (quick, decisive, no overshoot -- see index.css's doc comment on why that's the right easing
// for a press specifically, as opposed to --ease-spring's arrival bounce). `link` is deliberately
// excluded from the press/glow treatment -- it renders as inline text, not a physical control.
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-[color,background-color,border-color,box-shadow,transform] duration-150 ease-press focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 disabled:active:scale-100 disabled:hover:shadow-none [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground hover:bg-primary/90 hover:shadow-[0_0_18px_hsl(var(--primary)/0.4)] active:scale-[0.97] active:shadow-[0_0_8px_hsl(var(--primary)/0.3)]",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90 hover:shadow-[0_0_16px_hsl(var(--destructive)/0.35)] active:scale-[0.97]",
        outline:
          "border border-input bg-background hover:bg-accent hover:text-accent-foreground hover:border-primary/40 hover:shadow-[0_0_12px_hsl(var(--primary)/0.15)] active:scale-[0.97]",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80 hover:shadow-[0_0_18px_hsl(var(--secondary)/0.35)] active:scale-[0.97]",
        ghost: "hover:bg-accent hover:text-accent-foreground active:scale-[0.97]",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-md px-3",
        lg: "h-11 rounded-md px-8",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
