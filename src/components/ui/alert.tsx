import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

// Design-Sprint Runde 4 Rang 1: Alert is the app's most-used ui primitive (7 files) yet the most
// generic-looking -- a flat bordered box, identical for a routine hint and a hard error. A
// hue-matched left accent bar (a broadcast-lower-third convention: the color strip that tells you
// at a glance what kind of message this is) plus this app's own elevation token turns it into a
// panel instead of a plain box; destructive additionally gets its own soft red glow so an error
// reads as urgent without shouting via color alone.
const alertVariants = cva(
  "relative w-full rounded-lg border border-l-4 p-4 shadow-elevation-sm [&>svg~*]:pl-7 [&>svg+div]:translate-y-[-3px] [&>svg]:absolute [&>svg]:left-4 [&>svg]:top-4 [&>svg]:text-foreground",
  {
    variants: {
      variant: {
        default: "border-border border-l-primary/60 bg-background text-foreground",
        destructive:
          "border-destructive/50 border-l-destructive text-destructive dark:border-destructive shadow-[0_0_16px_hsl(var(--destructive)/0.12)] [&>svg]:text-destructive",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

const Alert = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants>
>(({ className, variant, ...props }, ref) => (
  <div ref={ref} role="alert" className={cn(alertVariants({ variant }), className)} {...props} />
));
Alert.displayName = "Alert";

const AlertTitle = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h5 ref={ref} className={cn("mb-1 font-medium leading-none tracking-tight", className)} {...props} />
  ),
);
AlertTitle.displayName = "AlertTitle";

const AlertDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("text-sm [&_p]:leading-relaxed", className)} {...props} />
  ),
);
AlertDescription.displayName = "AlertDescription";

export { Alert, AlertTitle, AlertDescription };
