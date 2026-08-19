import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { usePagedList } from "./usePagedList";

describe("usePagedList", () => {
  it("shows everything with no controls (and nothing to collapse) under the collapse threshold", () => {
    const items = Array.from({ length: 5 }, (_, i) => i);
    const { result } = renderHook(() => usePagedList(items, { collapseAt: 8, pageSize: 20 }));
    expect(result.current.visible).toEqual(items);
    expect(result.current.expanded).toBe(true);
    expect(result.current.canCollapse).toBe(false);
    expect(result.current.isPaginated).toBe(false);
  });

  it("always starts collapsed to the teaser, however large the full list is", () => {
    const items20 = Array.from({ length: 20 }, (_, i) => i);
    const items500 = Array.from({ length: 500 }, (_, i) => i);
    for (const items of [items20, items500]) {
      const { result } = renderHook(() => usePagedList(items, { collapseAt: 8, pageSize: 20 }));
      expect(result.current.visible).toEqual(items.slice(0, 8));
      expect(result.current.expanded).toBe(false);
      expect(result.current.canCollapse).toBe(true);
      expect(result.current.isPaginated).toBe(false);
    }
  });

  it("expanding a list that fits in one page shows everything with no pagination", () => {
    const items = Array.from({ length: 20 }, (_, i) => i);
    const { result } = renderHook(() => usePagedList(items, { collapseAt: 8, pageSize: 20 }));

    act(() => result.current.expand());
    expect(result.current.visible).toEqual(items);
    expect(result.current.expanded).toBe(true);
    expect(result.current.isPaginated).toBe(false);

    // Anything that can be opened must stay closeable — not a one-way trip.
    act(() => result.current.collapse());
    expect(result.current.visible).toEqual(items.slice(0, 8));
    expect(result.current.expanded).toBe(false);
  });

  it("expanding a list larger than one page shows page 1 and turns on pagination", () => {
    const items = Array.from({ length: 100 }, (_, i) => i);
    const { result } = renderHook(() => usePagedList(items, { collapseAt: 8, pageSize: 20 }));

    act(() => result.current.expand());
    expect(result.current.isPaginated).toBe(true);
    expect(result.current.pageCount).toBe(5);
    expect(result.current.page).toBe(1);
    expect(result.current.visible).toEqual(items.slice(0, 20));

    act(() => result.current.setPage(3));
    expect(result.current.page).toBe(3);
    expect(result.current.visible).toEqual(items.slice(40, 60));
  });

  it("collapsing from a deep page resets straight back to the teaser, not one page back", () => {
    const items = Array.from({ length: 100 }, (_, i) => i);
    const { result } = renderHook(() => usePagedList(items, { collapseAt: 8, pageSize: 20 }));
    act(() => result.current.expand());
    act(() => result.current.setPage(4));
    expect(result.current.page).toBe(4);

    act(() => result.current.collapse());
    expect(result.current.expanded).toBe(false);
    expect(result.current.visible).toEqual(items.slice(0, 8));

    // Expanding again starts fresh at page 1, not back at page 4.
    act(() => result.current.expand());
    expect(result.current.page).toBe(1);
  });

  it("clamps page requests to the valid range", () => {
    const items = Array.from({ length: 100 }, (_, i) => i);
    const { result } = renderHook(() => usePagedList(items, { collapseAt: 8, pageSize: 20 }));
    act(() => result.current.expand());

    act(() => result.current.setPage(999));
    expect(result.current.page).toBe(5);

    act(() => result.current.setPage(-3));
    expect(result.current.page).toBe(1);
  });

  it("clamps the current page down when the item count shrinks (e.g. a filter change)", () => {
    const { result, rerender } = renderHook(
      ({ items }: { items: number[] }) => usePagedList(items, { collapseAt: 8, pageSize: 20 }),
      { initialProps: { items: Array.from({ length: 100 }, (_, i) => i) } },
    );
    act(() => result.current.expand());
    act(() => result.current.setPage(5));
    expect(result.current.page).toBe(5);

    rerender({ items: Array.from({ length: 65 }, (_, i) => i) });
    expect(result.current.pageCount).toBe(4);
    expect(result.current.page).toBe(4);
  });
});
