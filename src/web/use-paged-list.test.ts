// @vitest-environment happy-dom
import { createElement, StrictMode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { usePagedList } from "./use-paged-list.ts";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("usePagedList", () => {
  it("loads its first page after the Strict Mode effect replay", async () => {
    function List() {
      const list = usePagedList({
        loadPage: async () => ({ items: [{ id: "one" }], nextOffset: null, total: 1 }),
        keyOf: (row) => row.id,
      });
      return createElement("p", null, list.loading ? "Loading" : list.items.map((row) => row.id).join(","));
    }

    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => {
      root.render(createElement(StrictMode, null, createElement(List)));
    });

    expect(container.textContent).toBe("one");
    act(() => root.unmount());
  });
});
