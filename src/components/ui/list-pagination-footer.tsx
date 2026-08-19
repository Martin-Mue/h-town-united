import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PagedList } from "@/hooks/usePagedList";

/** Renders whatever control (if any) a usePagedList result currently needs — nothing once
 *  everything's already showing, a "mehr anzeigen" button in the collapsed tier, or prev/next
 *  paging once the list is large enough to have switched to real pagination. One shared footer
 *  so every long list in the app gets the same look instead of a bespoke control per page. */
export function ListPaginationFooter<T>({ list }: { list: PagedList<T> }) {
  if (list.showingAll && !list.isPaginated) return null;

  if (!list.isPaginated) {
    return (
      <button
        onClick={list.expand}
        className="w-full text-xs text-muted-foreground hover:text-foreground text-center py-2 transition-colors"
      >
        {list.visibleCount} von {list.totalCount} · mehr anzeigen ▾
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
