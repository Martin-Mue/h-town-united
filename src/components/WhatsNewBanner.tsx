import { useState, useEffect } from "react";
import { Sparkles, X } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { CHANGELOG } from "@/data/changelog";

const LAST_SEEN_KEY = "dart-last-seen-changelog";

/** Dismissible "what's new" strip, shown once per batch of unseen CHANGELOG entries — a user who
 *  hasn't opened the app in a while gets everything that shipped since their last visit bundled
 *  into ONE banner, not one popup per feature.
 *  No stored marker at all shows the CURRENT full list, not nothing — this used to silently mark
 *  a missing marker as "already caught up", on the theory that a brand-new signup has no baseline
 *  to compare against. That reasoning only actually applies to a genuinely fresh signup; every
 *  EXISTING user also has no marker the first time this feature itself ships (it never asked
 *  before), and silently catching them up hid the whole announcement from every one of them on
 *  this app's real, small, rarely-growing user base. Trading a one-time short list for a future
 *  new signup is the right side of that tradeoff here. A marker that no longer matches any known
 *  entry (should only happen if an id were ever removed, which this file's own contract forbids)
 *  is still treated as caught up rather than guessing at history. */
const WhatsNewBanner = () => {
  const { language, t } = useLanguage();
  const [unseen, setUnseen] = useState<typeof CHANGELOG>([]);

  useEffect(() => {
    if (typeof window === "undefined" || CHANGELOG.length === 0) return;
    const stored = window.localStorage.getItem(LAST_SEEN_KEY);
    if (!stored) {
      setUnseen(CHANGELOG);
      return;
    }
    const foundIdx = CHANGELOG.findIndex((e) => e.id === stored);
    if (foundIdx === -1) return;
    const pending = CHANGELOG.slice(foundIdx + 1);
    if (pending.length > 0) setUnseen(pending);
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
