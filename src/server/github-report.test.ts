import { describe, expect, it } from "vitest";
import { decodePngBase64, safeScreenshotFilename, uploadGithubIssueScreenshot } from "./github-report.ts";

const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082",
  "hex",
);

describe("github report screenshot upload", () => {
  it("accepts a PNG and rejects other bytes", () => {
    expect(decodePngBase64(PNG.toString("base64")).equals(PNG)).toBe(true);
    expect(decodePngBase64(`data:image/png;base64,${PNG.toString("base64")}`).equals(PNG)).toBe(true);
    expect(() => decodePngBase64(Buffer.from("not-a-png").toString("base64"))).toThrow("Screenshot is not a PNG.");
  });

  it("keeps a generated report filename and drops anything else", () => {
    expect(safeScreenshotFilename("optimizarr-report-2026-08-21T12-00-00-000Z.png")).toBe(
      "optimizarr-report-2026-08-21T12-00-00-000Z.png",
    );
    expect(safeScreenshotFilename("../secret.png")).toBe("optimizarr-report.png");
    expect(safeScreenshotFilename(undefined)).toBe("optimizarr-report.png");
  });

  it("looks up the repo then POSTs the PNG to GitHub attachments", async () => {
    const calls: Array<{ url: string; method: string; hasAuth: boolean; bodyLen: number }> = [];
    const url = await uploadGithubIssueScreenshot({
      token: "ghs_test",
      filename: "optimizarr-report.png",
      png: PNG,
      fetch: (async (input, init) => {
        const target = String(input);
        const body = init?.body;
        calls.push({
          url: target,
          method: init?.method ?? "GET",
          hasAuth: String(init?.headers ? JSON.stringify(init.headers) : "").includes("ghs_test"),
          bodyLen: body instanceof Uint8Array ? body.byteLength : 0,
        });
        if (target.includes("api.github.com/repos/")) {
          return new Response(JSON.stringify({ id: 1336009430 }), { status: 200 });
        }
        if (target.includes("uploads.github.com/user-attachments/assets")) {
          expect(target).toContain("name=optimizarr-report.png");
          expect(target).toContain("repository_id=1336009430");
          return new Response(JSON.stringify({ url: "https://github.com/user-attachments/assets/abc" }), { status: 201 });
        }
        return new Response("{}", { status: 404 });
      }) as typeof fetch,
    });
    expect(url).toBe("https://github.com/user-attachments/assets/abc");
    expect(calls).toHaveLength(2);
    expect(calls[0]?.url).toContain("api.github.com/repos/charlesgreever/optimizarr");
    expect(calls.every((c) => c.hasAuth)).toBe(true);
    expect(calls[1]?.bodyLen).toBe(PNG.length);
  });

  it("fails closed when GitHub omits an attachment URL", async () => {
    await expect(
      uploadGithubIssueScreenshot({
        token: "ghs_test",
        filename: "optimizarr-report.png",
        png: PNG,
        fetch: (async (input) => {
          if (String(input).includes("api.github.com")) return new Response(JSON.stringify({ id: 1 }), { status: 200 });
          return new Response(JSON.stringify({ url: "https://example.com/not-github.png" }), { status: 201 });
        }) as typeof fetch,
      }),
    ).rejects.toThrow("GitHub did not return an attachment URL.");
  });
});
