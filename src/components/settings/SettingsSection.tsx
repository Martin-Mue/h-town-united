import type { ReactNode } from "react";

interface SettingsSectionProps {
  /** Small uppercase label above the card; omitted for the first, self-explaining group. */
  label?: string;
  /** Optional control at the right end of the label line (e.g. an edit button). */
  labelAction?: ReactNode;
  children: ReactNode;
  /** true = children are SettingsRows, separated by hairlines; false = free content with padding. */
  rows?: boolean;
}

/** One group on the settings page: optional section label + one flat card. */
const SettingsSection = ({ label, labelAction, children, rows = true }: SettingsSectionProps) => (
  <section className="flex flex-col gap-2">
    {(label || labelAction) && (
      <div className="flex min-h-6 items-center justify-between gap-2">
        {label && <h2 className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{label}</h2>}
        {labelAction}
      </div>
    )}
    <div className={`rounded-2xl border border-border bg-card ${rows ? "divide-y divide-border" : "p-4"}`}>{children}</div>
  </section>
);

export default SettingsSection;
