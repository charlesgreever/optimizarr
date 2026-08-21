import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { LibraryMediaHeaders } from "./LibraryMediaCells";

describe("library media headers", () => {
  it("renders sortable columns as keyboard-accessible buttons", () => {
    const html = renderToStaticMarkup(createElement(
      "table",
      null,
      createElement("thead", null, createElement(
        "tr",
        null,
        createElement(LibraryMediaHeaders, { onQuality: vi.fn(), onSize: vi.fn() }),
      )),
    ));

    expect(html).toContain("<button type=\"button\">Quality</button>");
    expect(html).toContain("<button type=\"button\">Size</button>");
  });
});
