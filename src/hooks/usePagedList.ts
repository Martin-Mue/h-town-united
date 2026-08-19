import { useCallback, useMemo, useState } from "react";

export interface PagedList<T> {
  visible: T[];
  totalCount: number;
  visibleCount: number;
  page: number;
  pageCount: number;
  setPage: (page: number) => void;
  /** False = still collapsed to the initial `collapseAt`-sized teaser. */
  expanded: boolean;
  /** True whenever there's an actual shorter view to collapse back to — false for a list short
   *  enough that it always renders in full, so "weniger anzeigen" never appears with nothing to
   *  hide. Stays true even once paginated, so a deep page can still collapse straight back to 5. */
  canCollapse: boolean;
  /** True only once expanded AND there's more than one page — gates the prev/next controls. */
  isPaginated: boolean;
  expand: () => void;
  /** Collapses all the way back to the initial teaser, resetting to page 1 too — not just "go
   *  back one page". Anything that can be opened needs a way back to where it started. */
  collapse: () => void;
}

/**
 * Small-list-friendly windowing, shared by every long list in the app. Default thresholds
 * (collapse at 5, page at 20) match the app's standard list treatment — override only for a
 * good reason (e.g. a grid of <video> cards, which is heavier per item than a text row).
 * One progressive flow, not three independent size brackets:
 *  - `totalCount <= collapseAt`: everything renders, no controls at all — most lists in a
 *    single-club install never leave this tier.
 *  - Otherwise it STARTS collapsed to `collapseAt` items regardless of how large the full list
 *    is, with a "mehr anzeigen" button.
 *  - Expanding reveals up to `pageSize` items (page 1) — if that's everything, a "weniger
 *    anzeigen" button collapses back. If there's more than `pageSize` total, prev/next paging
 *    (plus a way to collapse straight back to the teaser) takes over instead of rendering
 *    hundreds of rows/cards/videos at once.
 * `page` is clamped against the current page count on every render, so a filter that shrinks
 * `items` can't leave it pointing past the new end — no separate reset-on-filter-change needed.
 */
export function usePagedList<T>(
  items: T[],
  opts?: { collapseAt?: number; pageSize?: number },
): PagedList<T> {
  const collapseAt = opts?.collapseAt ?? 5;
  const pageSize = opts?.pageSize ?? 20;
  const [expanded, setExpanded] = useState(false);
  const [page, setPageState] = useState(1);
  const collapse = useCallback(() => { setExpanded(false); setPageState(1); }, []);

  return useMemo((): PagedList<T> => {
    const totalCount = items.length;

    if (totalCount <= collapseAt) {
      return {
        visible: items, totalCount, visibleCount: totalCount, page: 1, pageCount: 1, setPage: () => {},
        expanded: true, canCollapse: false, isPaginated: false, expand: () => {}, collapse: () => {},
      };
    }

    if (!expanded) {
      const visible = items.slice(0, collapseAt);
      return {
        visible, totalCount, visibleCount: visible.length, page: 1, pageCount: 1, setPage: () => {},
        expanded: false, canCollapse: true, isPaginated: false, expand: () => setExpanded(true), collapse,
      };
    }

    const pageCount = Math.max(1, Math.ceil(totalCount / pageSize));
    const clampedPage = Math.min(Math.max(1, page), pageCount);
    const visible = items.slice((clampedPage - 1) * pageSize, clampedPage * pageSize);
    return {
      visible, totalCount, visibleCount: visible.length, page: clampedPage, pageCount,
      setPage: (p: number) => setPageState(Math.min(Math.max(1, p), pageCount)),
      expanded: true, canCollapse: true, isPaginated: pageCount > 1, expand: () => {}, collapse,
    };
  }, [items, expanded, page, collapseAt, pageSize, collapse]);
}
