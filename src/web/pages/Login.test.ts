import { createElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LoginPage } from "./Login";

describe("login form", () => {
  it("is a native POST form 1Password can fill and save", () => {
    const html = renderToStaticMarkup(
      createElement(MemoryRouter, null, createElement(LoginPage, {
        firstRun: { hasAdmin: true, languageConfirmed: true, hasReviewPath: true, hasArr: true, complete: true },
      })),
    );
    expect(html).toContain("id=\"polisharr-login\"");
    expect(html).toContain("method=\"post\"");
    expect(html).toContain("action=\"/api/auth/login\"");
    expect(html).toContain("name=\"username\"");
    expect(html).toContain("name=\"password\"");
    expect(html).toContain("id=\"username\"");
    expect(html).toContain("id=\"password\"");
    expect(html).toContain("for=\"username\"");
    expect(html).toContain("for=\"password\"");
    expect(html).toContain("autoComplete=\"username\"");
    expect(html).toContain("autoComplete=\"current-password\"");
    expect(html).toContain("type=\"password\"");
    expect(html).toContain("type=\"submit\"");
  });
});

