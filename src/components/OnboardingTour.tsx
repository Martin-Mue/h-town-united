import { useEffect, useState } from "react";
import { Sparkles, Target, Dumbbell, Trophy } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";

const SEEN_KEY_PREFIX = "dart-onboarding-seen-";

interface Step {
  icon: typeof Target;
  titleKey: string;
  bodyKey: string;
}

const STEPS: Step[] = [
  { icon: Sparkles, titleKey: "onboarding.step1Title", bodyKey: "onboarding.step1Body" },
  { icon: Target, titleKey: "onboarding.step2Title", bodyKey: "onboarding.step2Body" },
  { icon: Dumbbell, titleKey: "onboarding.step3Title", bodyKey: "onboarding.step3Body" },
  { icon: Trophy, titleKey: "onboarding.step4Title", bodyKey: "onboarding.step4Body" },
];

/**
 * First-login coach-mark sequence: a short, skippable 4-step walkthrough of the app's main areas
 * for new, not-necessarily tech-affine club members — the biggest lever against feature overload
 * now that the app has seven roughly equal-weight core sections (Spiel/Statistik/Training/
 * Turnier/Verein/Season + Admin).
 *
 * Shown once per USER, not once per device: the "seen" flag is a localStorage entry keyed by the
 * signed-in user's id, the same lightweight pattern WhatsNewBanner already uses for its changelog
 * marker (see LAST_SEEN_KEY there) — just per-account rather than per-device, since a club's
 * shared clubhouse tablet/PC can see several different members sign in on it, and a per-device
 * flag would only ever show this once, to whichever member happened to sign in first.
 *
 * Deliberately a plain centered step-through dialog rather than tooltips anchored to the real
 * bottom-nav/quick-action DOM elements: true anchored coach-marks need per-breakpoint position
 * math (the mobile bottom nav and the desktop top nav in Layout.tsx are structurally different
 * layouts, and Game/Index also reflow at various widths) that's easy to get subtly wrong without
 * a real browser to verify it in. A centered dialog needs none of that and degrades to nothing
 * worse than "a modal appears" on any screen size.
 */
const OnboardingTour = () => {
  const { user } = useAuth();
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (!user || typeof window === "undefined") return;
    const seen = window.localStorage.getItem(SEEN_KEY_PREFIX + user.id);
    if (!seen) {
      setStep(0);
      setOpen(true);
    }
  }, [user]);

  const finish = () => {
    if (user && typeof window !== "undefined") {
      window.localStorage.setItem(SEEN_KEY_PREFIX + user.id, "1");
    }
    setOpen(false);
  };

  if (!user) return null;

  const isLast = step === STEPS.length - 1;
  const current = STEPS[step];
  const Icon = current.icon;

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) finish(); }}>
      <DialogContent className="max-w-sm text-center">
        <div className="flex flex-col items-center gap-3 pt-2">
          <div className="w-12 h-12 rounded-full bg-primary/10 text-primary flex items-center justify-center">
            <Icon className="w-6 h-6" />
          </div>
          <h2 className="font-display uppercase text-base tracking-wide">{t(current.titleKey)}</h2>
          <p className="text-sm text-muted-foreground">{t(current.bodyKey)}</p>
          <div className="flex items-center gap-1.5 mt-1" aria-hidden="true">
            {STEPS.map((_, i) => (
              <span
                key={i}
                className={`w-1.5 h-1.5 rounded-full transition-colors ${i === step ? "bg-primary" : "bg-muted"}`}
              />
            ))}
          </div>
        </div>
        <div className="flex items-center justify-between gap-2 mt-2">
          <Button variant="ghost" size="sm" onClick={finish}>
            {t("onboarding.skip")}
          </Button>
          <Button size="sm" onClick={() => (isLast ? finish() : setStep((s) => s + 1))}>
            {isLast ? t("onboarding.getStarted") : t("onboarding.next")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default OnboardingTour;
