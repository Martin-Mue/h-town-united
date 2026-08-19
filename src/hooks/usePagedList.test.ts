import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { usePagedList } from "./usePagedList";

describe("usePagedList", () => {
  it("shows everything with no controls under the collapse threshold", () => {
    const items = Array.from({ length: 5 }, (_, i) => i);
    const { result } = renderHook(() => usePagedList(items, { collapseAt: 8, paginateAt: 60 }));
    expect(result.current.visible).toEqual(items);
    expect(result.current.showingAll).toBe(true);
    expect(result.current.isPaginated).toBe(false);
  });

  it("collapses to the initial slice and expands on demand between the two thresholds", () => {
    const items = Array.from({ length: 20 }, (_, i) => i);
    const { result } = renderHook(() => usePagedList(items, { collapseAt: 8, paginateAt: 60 }));
    expect(result.current.visible).toEqual(items.slice(0, 8));
    expect(result.current.showingAll).toBe(false);
    expect(result.current.isPaginated).toBe(false);

    act(() => result.current.expand());
    expect(result.current.visible).toEqual(items);
    expect(result.current.showingAll).toBe(true);
  });

  it("switches to real pagination at/above the paginate threshold", () => {
    const items = Array.from({ length: 100 }, (_, i) => i);
    const { result } = renderHook(() => usePagedList(items, { collapseAt: 8, paginateAt: 60, pageSize: 20 }));
    expect(result.current.isPaginated).toBe(true);
    expect(result.current.pageCount).toBe(5);
    expect(result.current.visible).toEqual(items.slice(0, 20));

    act(() => result.current.setPage(3));
    expect(result.current.page).toBe(3);
    expect(result.current.visible).toEqual(items.slice(40, 60));
  });

  it("clamps page requests to the valid range", () => {
    const items = Array.from({ length: 100 }, (_, i) => i);
    const { result } = renderHook(() => usePagedList(items, { collapseAt: 8, paginateAt: 60, pageSize: 20 }));

    act(() => result.current.setPage(999));
    expect(result.current.page).toBe(5);

    act(() => result.current.setPage(-3));
    expect(result.current.page).toBe(1);
  });

  it("clamps the current page down when the item count shrinks within the paginated tier", () => {
    const { result, rerender } = renderHook(
      ({ items }: { items: number[] }) => usePagedList(items, { collapseAt: 8, paginateAt: 60, pageSize: 20 }),
      { initialProps: { items: Array.from({ length: 100 }, (_, i) => i) } },
    );
    act(() => result.current.setPage(5));
    expect(result.current.page).toBe(5);

    // Still >= paginateAt (60), so this stays in the paginated tier — just with fewer pages.
    rerender({ items: Array.from({ length: 65 }, (_, i) => i) });
    expect(result.current.pageCount).toBe(4);
    expect(result.current.page).toBe(4);
  });
});
