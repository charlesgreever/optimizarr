import { describe, expect, it } from "vitest";
import { buildReportIssueBody, buildReportIssueUrl, screenshotFilename, scrubReportText, submitReport, viewportCrop } from "./reportIssue.ts";

describe("report issue", () => {
  it("encodes the route and inspect leftovers in a GitHub new-issue URL", () => {
    const url = buildReportIssueUrl("bug", {
      route: "/queue",
      inspect: { pending: 12, walking: true, failed: 2 },
      running: { displayTitle: "A title", phase: "transcoding", progress: 0.47, status: "running" },
    });
    expect(url.startsWith("https://github.com/charlesgreever/optimizarr/issues/new?")).toBe(true);
    const parsed = new URL(url);
    expect(parsed.searchParams.get("labels")).toBe("bug");
    expect(parsed.searchParams.get("title")).toBe("Bug: Optimizarr");
    const body = parsed.searchParams.get("body") ?? "";
    expect(body).toContain("Route: /queue");
    expect(body).toContain("Inspect leftovers: 12");
    expect(body).toContain("transcoding");
    expect(body).toContain("47%");
  });

  it("uses an enhancement label for a change request", () => {
    const url = buildReportIssueUrl("change", { route: "/settings" });
    expect(new URL(url).searchParams.get("labels")).toBe("enhancement");
    expect(new URL(url).searchParams.get("title")).toBe("Change request: Optimizarr");
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

  it("names the screenshot as a PNG", () => {
    expect(screenshotFilename(new Date("2026-08-21T12:00:00.000Z"))).toBe("optimizarr-report-2026-08-21T12-00-00-000Z.png");
  });

  it("downloads a captured blob then opens GitHub when attach and copy are unavailable", async () => {
    const blob = new Blob(["png"], { type: "image/png" });
    const downloads: Array<{ size: number; name: string }> = [];
    const opened: string[] = [];
    await submitReport(
      "bug",
      { route: "/review" },
      {
        capture: async () => blob,
        download: (file, name) => downloads.push({ size: file.size, name }),
        open: (url) => opened.push(url),
      },
    );
    expect(downloads).toHaveLength(1);
    expect(downloads[0]?.name.endsWith(".png")).toBe(true);
    expect(opened[0]).toContain("github.com/charlesgreever/optimizarr/issues/new");
    expect(opened[0]).toContain("Attach");
  });

  it("embeds an uploaded GitHub attachment and does not download", async () => {
    const blob = new Blob(["png"], { type: "image/png" });
    const downloads: string[] = [];
    const opened: string[] = [];
    await submitReport(
      "bug",
      { route: "/queue" },
      {
        capture: async () => blob,
        attach: async () => ({ attached: true, url: "https://github.com/user-attachments/assets/abc" }),
        copy: async () => {
          throw new Error("should not copy");
        },
        download: () => downloads.push("downloaded"),
        open: (url) => opened.push(url),
      },
    );
    expect(downloads).toHaveLength(0);
    const body = new URL(opened[0] ?? "").searchParams.get("body") ?? "";
    expect(body).toContain("![Optimizarr viewport](https://github.com/user-attachments/assets/abc)");
    expect(body).not.toContain("downloaded");
  });

  it("copies the screenshot when GitHub attach is unavailable", async () => {
    const blob = new Blob(["png"], { type: "image/png" });
    const downloads: string[] = [];
    const opened: string[] = [];
    await submitReport(
      "change",
      { route: "/movies" },
      {
        capture: async () => blob,
        attach: async () => ({ attached: false }),
        copy: async () => true,
        download: () => downloads.push("downloaded"),
        open: (url) => opened.push(url),
      },
    );
    expect(downloads).toHaveLength(0);
    expect(new URL(opened[0] ?? "").searchParams.get("body")).toContain("clipboard");
  });

  it("still opens GitHub when capture fails, and says so in the body", async () => {
    const opened: string[] = [];
    await submitReport(
      "change",
      { route: "/errors" },
      {
        capture: async () => {
          throw new Error("canvas failed");
        },
        download: () => {
          throw new Error("should not download");
        },
        open: (url) => opened.push(url),
      },
    );
    expect(opened).toHaveLength(1);
    expect(new URL(opened[0] ?? "").searchParams.get("body")).toContain("A screenshot could not be captured.");
  });

  it("does not invent inspect or job lines when they are idle", () => {
    const body = buildReportIssueBody({ route: "/" });
    expect(body).toContain("Route: /");
    expect(body).not.toContain("Inspect leftovers");
    expect(body).not.toContain("Running job");
  });

  it("crops the screenshot to the current scroll viewport, not the top of the page", () => {
    expect(viewportCrop({ width: 1200, height: 4000 }, { scrollX: 0, scrollY: 800, width: 1200, height: 900 })).toEqual({
      sx: 0,
      sy: 800,
      sw: 1200,
      sh: 900,
    });
    expect(viewportCrop({ width: 1200, height: 900 }, { scrollX: 0, scrollY: 800, width: 1200, height: 900 })).toEqual({
      sx: 0,
      sy: 0,
      sw: 1200,
      sh: 900,
    });
  });
});
