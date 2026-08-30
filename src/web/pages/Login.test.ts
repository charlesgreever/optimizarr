import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LoginPage } from "./Login";

describe("login form", () => {
  it("advertises username and password fields to the browser", () => {
    const html = renderToStaticMarkup(createElement(LoginPage, {
      firstRun: { hasAdmin: true, languageConfirmed: true, hasReviewPath: true, hasArr: true, complete: true },
      onReady: () => undefined,
    }));
    expect(html).toContain("method=\"post\"");
    expect(html).toContain("name=\"username\"");
    expect(html).toContain("name=\"password\"");
    expect(html).toContain("autoComplete=\"username\"");
    expect(html).toContain("autoComplete=\"current-password\"");
    expect(html).toContain("autoCapitalize=\"none\"");
  });
});
