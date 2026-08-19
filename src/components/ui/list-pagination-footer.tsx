import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PagedList } from "@/hooks/usePagedList";
import { useLanguage } from "@/contexts/LanguageContext";

/** Renders whatever control (if any) a usePagedList result currently needs — nothing for a list
 *  short enough to always show in full, a "mehr anzeigen" teaser, "weniger anzeigen" once
 *  expanded, or prev/next paging (plus a way to collapse straight back to the teaser) once
 *  there's more than one page. One shared footer so every long list in the app matches — and,
 *  since this is the ONE place all of them render through, translating it here fixes pagination
 *  text on every list at once rather than needing 15 separate call sites updated. */
export function ListPaginationFooter<T>({ list }: { list: PagedList<T> }) {
  const { t } = useLanguage();
  if (!list.canCollapse) return null;

  if (!list.expanded) {
    return (
      <button
        onClick={list.expand}
        className="w-full text-xs text-muted-foreground hover:text-foreground text-center py-2 transition-colors"
      >
        {list.visibleCount} {t("stats.of")} {list.totalCount} · {t("common.showMore")}
      </button>
    );
  }

  if (!list.isPaginated) {
    return (
      <button
        onClick={list.collapse}
        className="w-full text-xs text-muted-foreground hover:text-foreground text-center py-2 transition-colors"
      >
        {t("common.showLess")}
      </button>
    );
  }

  return (
    <div className="flex items-center justify-center gap-2 py-2 flex-wrap">
      <Button
        variant="ghost" size="icon" className="h-9 w-9"
        disabled={list.page <= 1}
        onClick={() => list.setPage(list.page - 1)}
        aria-label={t("common.previousPage")}
      >
        <ChevronLeft className="w-4 h-4" />
      </Button>
      <span className="text-xs text-muted-foreground">{t("common.page")} {list.page} / {list.pageCount}</span>
      <Button
        variant="ghost" size="icon" className="h-9 w-9"
        disabled={list.page >= list.pageCount}
        onClick={() => list.setPage(list.page + 1)}
        aria-label={t("common.nextPage")}
      >
        <ChevronRight className="w-4 h-4" />
      </Button>
      <button onClick={list.collapse} className="text-xs text-muted-foreground hover:text-foreground ml-1">
        {t("common.showLess")}
      </button>
    </div>
  );
}
