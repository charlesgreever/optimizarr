import { describe, expect, it } from "vitest";
import { loadRetainedPages, mergePage, needsFocusedPage, refreshFirstPage, retainedNextOffset } from "./library-pages.ts";

describe("progressive library pages", () => {
  it("appends new rows without duplicating a row returned after refresh", () => {
    expect(mergePage([{ id: "a", title: "old" }], [{ id: "a", title: "new" }, { id: "b", title: "two" }])).toEqual([
      { id: "a", title: "new" },
      { id: "b", title: "two" },
    ]);
  });

  it("continues paging until a focused row is loaded or pages end", () => {
    expect(needsFocusedPage("episode-75", [{ id: "episode-1" }], 50)).toBe(true);
    expect(needsFocusedPage("episode-75", [{ id: "episode-75" }], 100)).toBe(false);
    expect(needsFocusedPage("episode-75", [{ id: "episode-1" }], null)).toBe(false);
    expect(needsFocusedPage(null, [{ id: "episode-1" }], 50)).toBe(false);
  });

  it("refreshes a polled first page without discarding already loaded pages", () => {
    expect(
      refreshFirstPage(
        [{ id: "a", value: "old" }, { id: "b", value: "old" }, { id: "c", value: "loaded" }],
        [{ id: "b", value: "new" }, { id: "d", value: "new" }],
        2,
        3,
      ),
    ).toEqual([{ id: "b", value: "new" }, { id: "d", value: "new" }, { id: "c", value: "loaded" }]);
    expect(retainedNextOffset(100, 150)).toBe(100);
    expect(retainedNextOffset(100, 100)).toBeNull();
  });

  it("reloads already opened pages after a row action without dropping later pages", async () => {
    const offsets: number[] = [];
    const pages: Record<number, Array<{ id: string; plan: string }>> = {
      0: Array.from({ length: 50 }, (_, i) => ({ id: `e${i + 1}`, plan: "old" })),
      50: Array.from({ length: 50 }, (_, i) => ({ id: `e${i + 51}`, plan: i === 0 ? "queued" : "old" })),
      100: Array.from({ length: 50 }, (_, i) => ({ id: `e${i + 101}`, plan: "old" })),
    };
    const result = await loadRetainedPages(async (offset) => {
      offsets.push(offset);
      const items = pages[offset] ?? [];
      return { items, nextOffset: offset + 50 < 200 ? offset + 50 : null };
    }, 150);
    expect(offsets).toEqual([0, 50, 100]);
    expect(result.items).toHaveLength(150);
    expect(result.items[0]?.id).toBe("e1");
    expect(result.items[50]).toEqual({ id: "e51", plan: "queued" });
    expect(result.items[149]?.id).toBe("e150");
    expect(result.nextOffset).toBe(150);
  });

  it("stops after one page when the show has no further episodes", async () => {
    const offsets: number[] = [];
    const result = await loadRetainedPages(async (offset) => {
      offsets.push(offset);
      return { items: [{ id: "only" }], nextOffset: null };
    }, 50);
    expect(offsets).toEqual([0]);
    expect(result).toEqual({ items: [{ id: "only" }], nextOffset: null });
  });
});
