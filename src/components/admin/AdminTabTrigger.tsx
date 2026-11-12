import type { ComponentPropsWithoutRef } from "react";
import { TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

/** Admin tab as a segment of the redesign segmented strip: 44px, active = action color, no glow. */
const AdminTabTrigger = ({ className, ...props }: ComponentPropsWithoutRef<typeof TabsTrigger>) => (
  <TabsTrigger
    className={cn(
      "min-h-11 rounded-[10px] px-3 font-semibold duration-150 hover:text-foreground data-[state=active]:scale-100 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-none",
      className,
    )}
    {...props}
  />
);

export default AdminTabTrigger;
