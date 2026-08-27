import { useState, useEffect } from "react";
import { Sparkles, X } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { CHANGELOG } from "@/data/changelog";

const LAST_SEEN_KEY = "dart-last-seen-changelog";

/** Dismissible "what's new" strip, shown once per batch of unseen CHANGELOG entries — a user who
 *  hasn't opened the app in a while gets everything that shipped since their last visit bundled
 *  into ONE banner, not one popup per feature. A brand-new user (no stored marker at all) is
 *  silently caught up to the current latest entry instead of being shown the whole history — a
 *  changelog only means something to someone who already knows what came before. */
const WhatsNewBanner = () => {
  const { language, t } = useLanguage();
  const [unseen, setUnseen] = useState<typeof CHANGELOG>([]);

  useEffect(() => {
    if (typeof window === "undefined" || CHANGELOG.length === 0) return;
    const stored = window.localStorage.getItem(LAST_SEEN_KEY);
    const foundIdx = stored ? CHANGELOG.findIndex((e) => e.id === stored) : -1;
    // No marker, or one that no longer matches a real entry — treat as "already caught up to the
    // latest" rather than dumping the entire history on them, and persist that read so it's an
    // explicit fact from here on, not an assumption re-derived every visit.
    const lastSeenIdx = foundIdx === -1 ? CHANGELOG.length - 1 : foundIdx;
    const pending = CHANGELOG.slice(lastSeenIdx + 1);
    if (pending.length === 0) {
      if (!stored) window.localStorage.setItem(LAST_SEEN_KEY, CHANGELOG[CHANGELOG.length - 1].id);
      return;
    }
    setUnseen(pending);
  }, []);

  const dismiss = () => {
    window.localStorage.setItem(LAST_SEEN_KEY, CHANGELOG[CHANGELOG.length - 1].id);
    setUnseen([]);
  };

  if (unseen.length === 0) return null;

  return (
    <div className="mx-3 mt-3 sm:mx-4 sm:mt-4 rounded-xl border border-primary/30 bg-primary/5 p-4 relative">
      <button
        onClick={dismiss}
        title={t("whatsNew.dismiss")}
        aria-label={t("whatsNew.dismiss")}
        className="absolute top-3 right-3 text-muted-foreground hover:text-foreground transition-colors"
      >
        <X className="w-4 h-4" />
      </button>
      <div className="flex items-center gap-2 mb-3 pr-6">
        <Sparkles className="w-4 h-4 text-primary shrink-0" />
        <h2 className="font-display text-sm uppercase tracking-wide text-primary">{t("whatsNew.heading")}</h2>
      </div>
      <div className="space-y-3">
        {unseen.map((entry) => (
          <div key={entry.id}>
            <p className="text-sm font-medium text-foreground">{entry.title[language]}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{entry.description[language]}</p>
          </div>
        ))}
      </div>
      <button
        onClick={dismiss}
        className="mt-3 text-xs text-primary hover:underline"
      >
        {t("whatsNew.gotIt")}
      </button>
    </div>
  );
};

export default WhatsNewBanner;
