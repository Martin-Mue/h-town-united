import type { ReactNode } from "react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

interface SettingToggleRowProps {
  id: string;
  label: ReactNode;
  description?: ReactNode;
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (checked: boolean) => void;
  children?: ReactNode;
}

/** A labelled on/off setting with an optional one-line explanation; `children` render below it (e.g. the warm-up seconds). */
const SettingToggleRow = ({ id, label, description, checked, disabled, onCheckedChange, children }: SettingToggleRowProps) => (
  <div className="space-y-2 rounded-xl border border-border bg-muted/40 px-4 py-3">
    <div className="flex min-h-[28px] items-center justify-between gap-3">
      <div className="min-w-0">
        <Label htmlFor={id} className="text-sm">{label}</Label>
        {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
      </div>
      <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onCheckedChange} />
    </div>
    {children}
  </div>
);

export default SettingToggleRow;
