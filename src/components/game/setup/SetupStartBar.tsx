import { Target } from "lucide-react";
import { Button } from "@/components/ui/button";

interface SetupStartBarProps {
  summary: string;
  label: string;
  onStart: () => void;
}

/** The one-line recap of the chosen setup and the big start button under it. */
const SetupStartBar = ({ summary, label, onStart }: SetupStartBarProps) => (
  <div className="space-y-2 pt-2">
    <p className="text-center text-sm text-muted-foreground">{summary}</p>
    <Button onClick={onStart} className="h-14 w-full rounded-2xl text-lg font-semibold">
      <Target className="mr-2 h-5 w-5" /> {label}
    </Button>
  </div>
);

export default SetupStartBar;
