import { createElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { activityOutcomeLabel, HomeDashboard } from "./Home";
import type { HomePayload } from "../api";

const data: HomePayload = {
  filesOptimized: 4,
  spaceSavedBytes: 6 * 1024 ** 3,
  suggestions: 2,
  queued: 1,
  review: 3,
  errors: 0,
  status: "Working · Film",
  recent: [
    { id: "h1", displayTitle: "Film", outcome: "kept", bytesSaved: 2 * 1024 ** 3, createdAt: 1 },
  ],
};

describe("Home dashboard", () => {
  it("puts Status in a full-width strip and links work counts", () => {
    const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(HomeDashboard, { data })));
    expect(html).toContain("Working · Film");
    expect(html).toContain("href=\"/suggestions\"");
    expect(html).toContain("href=\"/queue\"");
    expect(html).toContain("href=\"/review\"");
    expect(html).toContain("href=\"/errors\"");
    expect(html).toContain("Kept");
    expect(html).not.toContain("metrics");
  });

  it("names activity outcomes in everyday words", () => {
    expect(activityOutcomeLabel("kept")).toBe("Kept");
    expect(activityOutcomeLabel("flagged")).toBe("Flagged");
  });
});
