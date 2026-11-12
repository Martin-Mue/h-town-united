import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import EntryHeader from "@/components/entry/EntryHeader";
import EntryIconTile from "@/components/entry/EntryIconTile";
import EntryCard from "@/components/entry/EntryCard";

interface EntryStatusMessageProps {
  icon: LucideIcon;
  tone?: "accent" | "destructive";
  title: string;
  description: string;
  /** Optional single action under the text (e.g. "Zum Login"). */
  action?: ReactNode;
}

/** A dead end or done state of an entry page (link invalid, expired, already used): icon + title
 *  + one explaining card. */
const EntryStatusMessage = ({ icon, tone = "accent", title, description, action }: EntryStatusMessageProps) => (
  <>
    <EntryHeader mark={<EntryIconTile icon={icon} tone={tone} />} title={title} />
    <EntryCard className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">{description}</p>
      {action}
    </EntryCard>
  </>
);

export default EntryStatusMessage;
