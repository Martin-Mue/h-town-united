import { useState } from "react";
import { ChevronDown, ChevronUp, BookOpen } from "lucide-react";
import { GUIDES } from "@/data/guides";
import { SectionCard } from "@/components/stats/StatPrimitives";

/** Settings.tsx's "Anleitungen" tab — simple collapsible guides for club members. Starts fully
 *  collapsed (see feedback_expandable_lists_ux) — a member opens the one guide they actually
 *  need instead of scrolling past four walls of text. */
const GuidesTab = () => {
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2.5 rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
        <BookOpen className="w-4 h-4 shrink-0 mt-0.5 text-primary" />
        <p>Kurze Anleitungen zu den wichtigsten Bereichen der App. Zum Aufklappen einfach auf eine Anleitung tippen.</p>
      </div>

      {GUIDES.map((guide) => {
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
