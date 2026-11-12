import { Check } from "lucide-react";

export interface PickablePlayer {
  id: string;
  name: string;
  emoji: string | null;
}

interface ParticipantPickerProps {
  label: string;
  players: PickablePlayer[];
  selected: Set<string>;
  onToggle: (playerId: string) => void;
  /** Tailwind max-height class of the scroll box, so a big club roster does not push the wizard buttons away. */
  maxHeightClass?: string;
}

/** Multi-select player chips (redesign canvas "Spieler"): tap to pick or unpick, picked chips are outlined in primary. */
const ParticipantPicker = ({ label, players, selected, onToggle, maxHeightClass = "max-h-[40vh]" }: ParticipantPickerProps) => (
  <div>
    <p className="mb-1.5 text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
      {label} <span className="tabular-nums">({selected.size})</span>
    </p>
    <div role="group" aria-label={label} className={`${maxHeightClass} overflow-y-auto -mx-1 px-1`}>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {players.map((p) => {
          const isPicked = selected.has(p.id);
          return (
            <button
              key={p.id}
              type="button"
              aria-pressed={isPicked}
              onClick={() => onToggle(p.id)}
              className={`flex min-h-12 items-center gap-2 rounded-xl border px-2.5 text-left transition-colors ${
                isPicked ? "border-primary bg-primary/15 text-primary" : "border-border bg-card text-foreground hover:bg-muted"
              }`}
            >
              <span aria-hidden="true" className="shrink-0 text-base">{p.emoji}</span>
              <span className="min-w-0 flex-1 truncate text-sm font-semibold">{p.name}</span>
              {isPicked && <Check aria-hidden="true" className="h-4 w-4 shrink-0" />}
            </button>
          );
        })}
      </div>
    </div>
  </div>
);

export default ParticipantPicker;
