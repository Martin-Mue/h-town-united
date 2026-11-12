import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

interface SettingsRowProps {
  icon?: LucideIcon;
  label: string;
  description?: string;
  /** Control at the right end of the row (switch, select). */
  control?: ReactNode;
  /** Content under the label line spanning the full row width (segmented choice, inputs). */
  children?: ReactNode;
}

/** One settings row, at least 52px: icon + label + short description, control on the right. */
const SettingsRow = ({ icon: Icon, label, description, control, children }: SettingsRowProps) => (
  <div className="flex flex-col gap-3 px-4 py-3">
    <div className="flex min-h-[28px] items-center gap-3">
      {Icon && <Icon aria-hidden="true" className="h-5 w-5 shrink-0 text-muted-foreground" />}
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-semibold leading-snug">{label}</p>
        {description && <p className="text-[13px] leading-snug text-muted-foreground">{description}</p>}
      </div>
      {control && <div className="shrink-0">{control}</div>}
    </div>
    {children}
  </div>
);

export default SettingsRow;
