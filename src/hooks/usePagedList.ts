import { useMemo, useState } from "react";

export interface PagedList<T> {
  visible: T[];
  totalCount: number;
  visibleCount: number;
  page: number;
  pageCount: number;
  setPage: (page: number) => void;
  showingAll: boolean;
  isPaginated: boolean;
  expand: () => void;
}

/**
 * Small-list-friendly windowing, shared by every long list in the app. Default thresholds (5 /
 * 20 / 20-per-page) match the app's standard list treatment — override only for a good reason
 * (e.g. a grid of <video> cards, which is heavier per item than a text row). Three tiers,
 * cheapest first:
 *  - `totalCount <= collapseAt`: everything renders, no controls at all — most lists in a
 *    single-club install never leave this tier.
 *  - `collapseAt < totalCount < paginateAt`: an initial `collapseAt`-sized slice plus a
 *    "mehr anzeigen" button that reveals the rest (up to `paginateAt - 1` items) in one go.
 *  - `totalCount >= paginateAt`: real paged navigation (`pageSize` per page) instead of "show
 *    everything", since that would mean rendering hundreds of rows/cards/videos at once.
 * `page` is clamped against the current page count on every render, so a filter that shrinks
 * `items` can't leave it pointing past the new end — no separate reset-on-filter-change needed.
 */
export function usePagedList<T>(
  items: T[],
  opts?: { collapseAt?: number; paginateAt?: number; pageSize?: number },
): PagedList<T> {
  const collapseAt = opts?.collapseAt ?? 5;
  const paginateAt = opts?.paginateAt ?? 21;
  const pageSize = opts?.pageSize ?? 20;
  const [expanded, setExpanded] = useState(false);
  const [page, setPageState] = useState(1);

  return useMemo((): PagedList<T> => {
    const totalCount = items.length;

    if (totalCount <= collapseAt) {
      return { visible: items, totalCount, visibleCount: totalCount, page: 1, pageCount: 1, setPage: () => {}, showingAll: true, isPaginated: false, expand: () => {} };
    }

    if (totalCount < paginateAt) {
      const visible = expanded ? items : items.slice(0, collapseAt);
      return { visible, totalCount, visibleCount: visible.length, page: 1, pageCount: 1, setPage: () => {}, showingAll: expanded, isPaginated: false, expand: () => setExpanded(true) };
    }

    const pageCount = Math.max(1, Math.ceil(totalCount / pageSize));
    const clampedPage = Math.min(Math.max(1, page), pageCount);
    const visible = items.slice((clampedPage - 1) * pageSize, clampedPage * pageSize);
    return {
      visible, totalCount, visibleCount: visible.length, page: clampedPage, pageCount,
      setPage: (p: number) => setPageState(Math.min(Math.max(1, p), pageCount)),
      showingAll: false, isPaginated: true, expand: () => {},
    };
  }, [items, expanded, page, collapseAt, paginateAt, pageSize]);
}
