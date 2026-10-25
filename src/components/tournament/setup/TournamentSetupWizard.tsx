import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/contexts/LanguageContext";

export interface WizardStep {
  key: string;
  title: string;
  icon: LucideIcon;
  content: ReactNode;
  /** Already translated reasons why this step is not finished yet (empty = ready to go on). */
  issues: string[];
}

interface TournamentSetupWizardProps {
  /** Banner above the steps ("Turnier erstellen" / "Turnier bearbeiten"). */
  heading: ReactNode;
  steps: WizardStep[];
  current: number;
  onChange: (index: number) => void;
  /** Back to the tournament list. */
  onExit: () => void;
  /** The start/save button of the last step. */
  finalAction: ReactNode;
}

/**
 * The shell of the tournament setup: a progress row of numbered steps, the content of the current step and a bottom
 * bar with "Zurück" / "Weiter" (the last step shows the start button instead). Forward is only possible through
 * "Weiter", which stays disabled while the step still lacks something; going back to an earlier step is free.
 */
const TournamentSetupWizard = ({ heading, steps, current, onChange, onExit, finalAction }: TournamentSetupWizardProps) => {
  const { t } = useLanguage();
  const step = steps[current];
  const isLast = current === steps.length - 1;
  const blocked = step.issues.length > 0;

  return (
    <div className="container max-w-3xl animate-slide-up py-6 mx-auto">
      <Button variant="ghost" onClick={onExit} className="mb-4 text-sm text-muted-foreground">
        <ArrowLeft className="mr-1 h-4 w-4" /> {t("tournament.overview")}
      </Button>
      {heading}

      <nav aria-label={t("tournament.wizardProgress")} className="mb-5">
        <ol className="flex items-center gap-1.5">
          {steps.map((s, i) => {
            const done = i < current;
            const active = i === current;
            const Icon = s.icon;
            return (
              <li key={s.key} className={`flex items-center gap-1.5 ${active ? "min-w-0 flex-1" : "shrink-0"}`}>
                <button
                  type="button"
                  disabled={i > current}
                  onClick={() => onChange(i)}
                  aria-current={active ? "step" : undefined}
                  className={`flex h-10 min-w-0 items-center gap-2 rounded-xl border px-3 text-left text-sm font-display uppercase tracking-wide transition-colors ${
                    active ? "w-full border-primary bg-primary/15 text-primary" : done ? "border-secondary/50 bg-secondary/10 text-secondary" : "border-border bg-muted/20 text-muted-foreground"
                  } disabled:cursor-default`}
                >
                  <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${active ? "bg-primary text-primary-foreground" : done ? "bg-secondary text-secondary-foreground" : "bg-muted text-muted-foreground"}`}>
                    {done ? <Check className="h-3 w-3" /> : i + 1}
                  </span>
                  <Icon className={`h-4 w-4 shrink-0 ${active ? "" : "hidden sm:block"}`} />
                  <span className={`truncate ${active ? "" : "hidden md:inline"}`}>{s.title}</span>
                </button>
                {i < steps.length - 1 && <span aria-hidden className={`h-px w-2 shrink-0 sm:w-4 ${done ? "bg-secondary/60" : "bg-border"}`} />}
              </li>
            );
          })}
        </ol>
        <p className="mt-2 text-[11px] text-muted-foreground">
          {t("tournament.wizardStepOf").replace("{n}", String(current + 1)).replace("{m}", String(steps.length))}
        </p>
      </nav>

      <div className="space-y-4">{step.content}</div>

      <div
        className="sticky bottom-[calc(4.25rem+env(safe-area-inset-bottom))] md:bottom-0 z-10 -mx-4 mt-6 border-t border-border/60 bg-background/95 px-4 pb-9 pt-3 backdrop-blur-sm md:pb-3"
      >
        {blocked && (
          <ul className="mb-2 space-y-0.5 text-xs text-accent" role="status">
            {step.issues.map((issue) => <li key={issue}>• {issue}</li>)}
          </ul>
        )}
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => onChange(current - 1)} disabled={current === 0} className="h-12 gap-1.5 px-4">
            <ArrowLeft className="h-4 w-4" /> {t("common.back")}
          </Button>
          {isLast ? (
            <div className="flex-1">{finalAction}</div>
          ) : (
            <Button onClick={() => onChange(current + 1)} disabled={blocked} className="h-12 flex-1 gap-2 font-display text-base uppercase tracking-wide">
              {t("tournament.wizardNext")} <ArrowRight className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};

export default TournamentSetupWizard;
