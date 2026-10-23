import { useState } from "react";
import { ChevronDown, ChevronUp, BookOpen, Search } from "lucide-react";
import { GUIDES } from "@/data/guides";
import { SectionCard } from "@/components/stats/StatPrimitives";

/** Settings.tsx's "Anleitungen" tab — simple collapsible guides for club members. Starts fully
 *  collapsed (see feedback_expandable_lists_ux) — a member opens the one guide they actually
 *  need instead of scrolling past four walls of text. */
const GuidesTab = () => {
  const [openId, setOpenId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const visibleGuides = needle === ""
    ? GUIDES
    : GUIDES.filter((guide) =>
        [guide.title, guide.teaser, ...guide.sections.flatMap((s) => [s.heading ?? "", ...s.body, ...(s.bullets ?? [])])]
          .some((text) => text.toLowerCase().includes(needle)));

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2.5 rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
        <BookOpen className="w-4 h-4 shrink-0 mt-0.5 text-primary" />
        <p>Kurze Anleitungen zu den wichtigsten Bereichen der App. Zum Aufklappen einfach auf eine Anleitung tippen.</p>
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="In den Anleitungen suchen …"
          className="w-full rounded-xl border border-border bg-muted/40 py-2.5 pl-9 pr-3 text-sm placeholder:text-muted-foreground focus:border-primary focus:outline-none"
        />
      </div>
      {visibleGuides.length === 0 && (
        <p className="py-6 text-center text-sm text-muted-foreground">Keine Anleitung gefunden.</p>
      )}

      {visibleGuides.map((guide) => {
        // A search that matches only deep inside a guide's text opens nothing by itself — the
        // list just narrows, and the member taps the one they want (same collapsed-by-default rule).
        const isOpen = openId === guide.id;
        return (
          <SectionCard key={guide.id} className="!p-0 overflow-hidden">
            <button
              onClick={() => setOpenId(isOpen ? null : guide.id)}
              className="w-full flex items-center justify-between gap-3 px-4 py-3.5 text-left"
            >
              <div className="min-w-0">
                <p className="font-display text-sm uppercase">{guide.title}</p>
                <p className="text-xs text-muted-foreground truncate">{guide.teaser}</p>
              </div>
              {isOpen ? <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />}
            </button>

            {isOpen && (
              <div className="px-4 pb-4 border-t border-border/60 pt-3 space-y-4">
                {guide.image && (
                  <img
                    src={guide.image}
                    alt={guide.imageAlt ?? guide.title}
                    className="w-full rounded-lg border border-border"
                    loading="lazy"
                  />
                )}
                {guide.sections.map((section, i) => (
                  <div key={i}>
                    {section.heading && (
                      <p className="text-xs font-display uppercase tracking-wide text-primary mb-1">{section.heading}</p>
                    )}
                    {section.body.map((p, pi) => (
                      <p key={pi} className="text-sm text-muted-foreground leading-relaxed">{p}</p>
                    ))}
                    {section.bullets && (
                      <ul className="mt-1.5 space-y-1.5">
                        {section.bullets.map((b, bi) => (
                          <li key={bi} className="flex gap-2 text-sm text-muted-foreground leading-relaxed">
                            <span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary/70" />
                            <span>{b}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    {section.image && (
                      <img
                        src={section.image}
                        alt={section.imageAlt ?? section.heading ?? guide.title}
                        className="w-full rounded-lg border border-border mt-2"
                        loading="lazy"
                      />
                    )}
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
        );
      })}
    </div>
  );
};

export default GuidesTab;
