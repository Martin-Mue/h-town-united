import { forwardRef } from "react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** The one main action of an entry page: full width, 52px, flat (no hover glow). */
const EntryPrimaryButton = forwardRef<HTMLButtonElement, ButtonProps>(({ className, ...props }, ref) => (
  <Button
    ref={ref}
    className={cn("h-[52px] w-full rounded-[14px] text-base font-semibold hover:shadow-none active:shadow-none", className)}
    {...props}
  />
));
EntryPrimaryButton.displayName = "EntryPrimaryButton";

export default EntryPrimaryButton;
