import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PagedList } from "@/hooks/usePagedList";

/** Renders whatever control (if any) a usePagedList result currently needs — nothing for a list
 *  short enough to always show in full, a "mehr anzeigen" teaser, "weniger anzeigen" once
 *  expanded, or prev/next paging (plus a way to collapse straight back to the teaser) once
 *  there's more than one page. One shared footer so every long list in the app matches. */
export function ListPaginationFooter<T>({ list }: { list: PagedList<T> }) {
  if (!list.canCollapse) return null;

  if (!list.expanded) {
    return (
      <button
        onClick={list.expand}
        className="w-full text-xs text-muted-foreground hover:text-foreground text-center py-2 transition-colors"
      >
        {list.visibleCount} von {list.totalCount} · mehr anzeigen ▾
      </button>
    );
  }

  if (!list.isPaginated) {
    return (
      <button
        onClick={list.collapse}
        className="w-full text-xs text-muted-foreground hover:text-foreground text-center py-2 transition-colors"
      >
        weniger anzeigen ▴
      </button>
    );
  }

  return (
    <div className="flex items-center justify-center gap-2 py-2 flex-wrap">
      <Button
        variant="ghost" size="icon" className="h-9 w-9"
        disabled={list.page <= 1}
        onClick={() => list.setPage(list.page - 1)}
        aria-label="Vorherige Seite"
      >
        <ChevronLeft className="w-4 h-4" />
      </Button>
      <span className="text-xs text-muted-foreground">Seite {list.page} / {list.pageCount}</span>
      <Button
        variant="ghost" size="icon" className="h-9 w-9"
        disabled={list.page >= list.pageCount}
        onClick={() => list.setPage(list.page + 1)}
        aria-label="Nächste Seite"
      >
        <ChevronRight className="w-4 h-4" />
      </Button>
      <button onClick={list.collapse} className="text-xs text-muted-foreground hover:text-foreground ml-1">
        weniger anzeigen ▴
      </button>
    </div>
  );
}
