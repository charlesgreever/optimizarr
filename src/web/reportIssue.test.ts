import { describe, expect, it } from "vitest";
import { buildReportIssueBody, buildReportIssueUrl, scrubReportText } from "./reportIssue.ts";

describe("report issue", () => {
  it("encodes the route and inspect leftovers in a GitHub new-issue URL", () => {
    const url = buildReportIssueUrl("bug", {
      route: "/queue",
      inspect: { pending: 12, walking: true, failed: 2 },
      running: { displayTitle: "A title", phase: "transcoding", progress: 0.47, status: "running" },
    });
    expect(url.startsWith("https://github.com/charlesgreever/polisharr/issues/new?")).toBe(true);
    const parsed = new URL(url);
    expect(parsed.searchParams.get("labels")).toBe("bug");
    expect(parsed.searchParams.get("title")).toBe("Bug: Polisharr");
    const body = parsed.searchParams.get("body") ?? "";
    expect(body).toContain("Route: /queue");
    expect(body).toContain("Inspect leftovers: 12");
    expect(body).toContain("transcoding");
    expect(body).toContain("47%");
    expect(body).toContain("Attach a screenshot on GitHub if one would help.");
  });

  it("uses an enhancement label for a change request", () => {
    const url = buildReportIssueUrl("change", { route: "/settings" });
    expect(new URL(url).searchParams.get("labels")).toBe("enhancement");
    expect(new URL(url).searchParams.get("title")).toBe("Change request: Polisharr");
  });

  it("scrubs paths, URLs, and secret-looking assignments out of the report", () => {
    const dirty =
      "failed on /mnt/nas/Movies/secret.mkv apiKey=super-secret-key token: abcdef http://192.168.1.10:7878/api";
    const clean = scrubReportText(dirty);
    expect(clean).not.toContain("/mnt/nas");
    expect(clean).not.toContain("super-secret-key");
    expect(clean).not.toContain("abcdef");
    expect(clean).not.toContain("192.168.1.10");
    const url = buildReportIssueUrl("bug", {
      route: "/movies",
      running: { displayTitle: dirty, phase: "muxing", progress: 0.1, status: "running" },
    });
    expect(url).not.toContain("super-secret-key");
    expect(url).not.toContain("%2Fmnt%2Fnas");
    expect(decodeURIComponent(url)).not.toContain("/mnt/nas");
  });

  it("does not invent inspect or job lines when they are idle", () => {
    const body = buildReportIssueBody({ route: "/" });
    expect(body).toContain("Route: /");
    expect(body).not.toContain("Inspect leftovers");
    expect(body).not.toContain("Running job");
  });
});
