import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SetupPage } from "./Setup";

vi.mock("../api", () => ({
  api: {
    settings: async () => ({ preferredLanguage: "eng", languageConfirmed: false, reviewPath: "", instances: [] }),
    saveSettings: async () => undefined,
    saveInstance: async () => ({ ok: true, id: "inst-1" }),
    testInstance: async () => ({ ok: true }),
  },
}));

describe("first-run setup", () => {
  it("collects language, review folder, and Radarr or Sonarr before the library shell", () => {
    const html = renderToStaticMarkup(createElement(SetupPage, {
      firstRun: { hasAdmin: true, languageConfirmed: false, hasReviewPath: false, hasArr: false, complete: false },
      onReady: () => undefined,
    }));
    expect(html).toContain("Finish setup before optimize");
    expect(html).toContain("review folder");
    expect(html).toContain("Radarr or Sonarr");
    expect(html).toContain("Preferred language");
    expect(html).not.toContain("Movies");
  });

  it("asks for a Radarr or Sonarr connection after language and review are set", () => {
    const html = renderToStaticMarkup(createElement(SetupPage, {
      firstRun: { hasAdmin: true, languageConfirmed: true, hasReviewPath: true, hasArr: false, complete: false },
      onReady: () => undefined,
    }));
    expect(html).toContain("Radarr");
    expect(html).toContain("Sonarr");
    expect(html).toContain("Plex (optional)");
    expect(html).toContain("Skip Plex and Jellyfin");
  });
});
