import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

export interface ManageTab {
  key: string;
  label: string;
  icon: LucideIcon;
  content: ReactNode;
  /** Not offered at all (for example the participant tab to someone who may not manage participants). */
  hidden?: boolean;
}

interface ManageTabsProps {
  tabs: ManageTab[];
  active: string;
  onChange: (key: string) => void;
  /** The page around it has no container of its own (the bracket view runs edge to edge), so the tab bar brings one. */
  bleed?: boolean;
}

/**
 * The management view of a running tournament: one sticky row of tabs (Spielplan · Teilnehmer · Anzeige & Teilen ·
 * Statistik · Einstellungen) and only the open tab's content below. On a phone only the open tab shows its text, the
 * others are icons (all five labels do not fit), from tablet width on every tab shows its label.
 */
const ManageTabs = ({ tabs, active, onChange, bleed = false }: ManageTabsProps) => {
  const visible = tabs.filter((tab) => !tab.hidden);
  const current = visible.find((tab) => tab.key === active) ?? visible[0];
  if (!current) return null;

  return (
    <div>
      <div className="sticky top-0 z-20 border-b border-border/60 bg-background/95 backdrop-blur-sm">
        <div className={`${bleed ? "container" : ""} flex gap-1 overflow-x-auto py-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden`} role="tablist">
          {visible.map((tab) => {
            const isActive = tab.key === current.key;
            const Icon = tab.icon;
            return (
              <button
                key={tab.key}
                type="button"
                role="tab"
                aria-selected={isActive}
                aria-label={tab.label}
                title={tab.label}
                onClick={() => onChange(tab.key)}
                className={`flex h-10 shrink-0 items-center gap-2 rounded-lg border px-3 text-sm font-display uppercase tracking-wide transition-colors ${
                  isActive ? "border-primary bg-primary/15 text-primary" : "border-transparent text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className={isActive ? "" : "hidden md:inline"}>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>
      <div role="tabpanel" className="pt-3">{current.content}</div>
    </div>
  );
};

export default ManageTabs;
