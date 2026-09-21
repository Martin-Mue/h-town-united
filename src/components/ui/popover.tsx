import * as React from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";

import { cn } from "@/lib/utils";

const Popover = PopoverPrimitive.Root;

const PopoverTrigger = PopoverPrimitive.Trigger;

const PopoverClose = PopoverPrimitive.Close;

const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, align = "center", sideOffset = 4, ...props }, ref) => (
  <PopoverPrimitive.Portal>
    <PopoverPrimitive.Content
      ref={ref}
      align={align}
      sideOffset={sideOffset}
      // Design-Sprint Runde 4 Rang 3: same floating-panel treatment as SelectContent -- this
      // app's elevation token plus a faint primary-tinted border instead of the generic shadow-md.
      //
      // z-[110], not z-50: Dialog and AlertDialog both sit at z-[100] (the app's "always on top of
      // literally everything" tier), and a popover whose trigger lives inside one of them -- e.g.
      // Game.tsx's throw-correction dialog -- must float above that dialog to be visible at all, or
      // it opens invisibly behind the dialog's own overlay (confirmed live: the trigger worked, the
      // popover was genuinely open in the DOM, just rendered underneath). A popover reachable at
      // all is, by definition, either standalone or inside the topmost surface, so outranking every
      // z-[100] dialog is correct in general, not just for this one caller.
      className={cn(
        "z-[110] w-72 rounded-md border border-primary/10 bg-popover p-4 text-popover-foreground shadow-elevation-md outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
        className,
      )}
      {...props}
    />
  </PopoverPrimitive.Portal>
));
PopoverContent.displayName = PopoverPrimitive.Content.displayName;

export { Popover, PopoverTrigger, PopoverContent, PopoverClose };
