import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PagedList } from "@/hooks/usePagedList";

/** Renders whatever control (if any) a usePagedList result currently needs — nothing for a list
 *  short enough to always show in full, a "mehr anzeigen"/"weniger anzeigen" toggle in the
 *  collapsible tier (whichever direction is currently available — anything that can be opened
 *  must stay closeable too), or prev/next paging once the list is large enough to have switched
 *  to real pagination. One shared footer so every long list in the app gets the same look. */
export function ListPaginationFooter<T>({ list }: { list: PagedList<T> }) {
  if (!list.isPaginated) {
    if (!list.canCollapse) return null;
    return (
      <button
        onClick={list.showingAll ? list.collapse : list.expand}
        className="w-full text-xs text-muted-foreground hover:text-foreground text-center py-2 transition-colors"
      >
        {list.showingAll ? "weniger anzeigen ▴" : `${list.visibleCount} von ${list.totalCount} · mehr anzeigen ▾`}
      </button>
    );
  }

  return (
    <div className="flex items-center justify-center gap-3 py-2">
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
    </div>
  );
}
