import { describe, expect, it } from "vitest";
import { mergePage, needsFocusedPage } from "./library-pages.ts";

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
});
