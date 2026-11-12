import { useState } from "react";
import type { ClubPlayer } from "@/lib/repositories/players";
import { useLanguage } from "@/contexts/LanguageContext";

interface ClubMemberChipsProps {
  members: ClubPlayer[];
  /** Throw position per member id, for the members already in the lineup. */
  positionByMemberId: Map<string, number>;
  /** False when every slot is taken and no slot can be added: unpicked members are then disabled. */
  canAddMore: boolean;
  onToggleMember: (member: ClubPlayer) => void;
}

const COLLAPSED_COUNT = 6;

/**
 * Club members as tap-to-pick tiles. A picked member shows their throw position in the badge, an unpicked one a "+".
 * Long rosters start with the first six (plus anyone already picked) and can be expanded and collapsed again.
 */
const ClubMemberChips = ({ members, positionByMemberId, canAddMore, onToggleMember }: ClubMemberChipsProps) => {
  const { t } = useLanguage();
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? members : members.filter((m, i) => i < COLLAPSED_COUNT || positionByMemberId.has(m.id));
  const hiddenCount = members.length - visible.length;

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2 min-[360px]:grid-cols-3">
        {visible.map((member) => {
          const position = positionByMemberId.get(member.id);
          const picked = position !== undefined;
          return (
            <button
              key={member.id}
              type="button"
              aria-pressed={picked}
              disabled={!picked && !canAddMore}
              onClick={() => onToggleMember(member)}
              className={`flex h-14 min-w-0 items-center gap-2 rounded-2xl border px-2.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${picked ? "border-primary bg-primary/15" : "border-border bg-card hover:bg-muted"}`}
            >
              <span aria-hidden="true"
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${picked ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                {picked ? position : "+"}
              </span>
              <span className="truncate text-[15px] font-semibold text-foreground">{member.name}</span>
            </button>
          );
        })}
      </div>
      {members.length > COLLAPSED_COUNT && (hiddenCount > 0 || expanded) && (
        <button type="button" onClick={() => setExpanded((v) => !v)} className="min-h-[44px] w-full rounded-xl text-sm text-muted-foreground transition-colors hover:text-foreground">
          {expanded ? t("common.showLess") : `${t("common.showMore")} (${hiddenCount})`}
        </button>
      )}
    </div>
  );
};

export default ClubMemberChips;
