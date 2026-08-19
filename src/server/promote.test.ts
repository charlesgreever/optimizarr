import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { promote, replaceLibraryFile } from "./promote.ts";

describe("promotion", () => {
  it("does not overwrite the original until the new file is ready", async () => {
    const dir = mkdtempSync(join(tmpdir(), "opt-promote-"));
    const original = join(dir, "movie.mkv");
    const output = join(dir, "sidecar.mkv");
    writeFileSync(original, "ORIGINAL-BYTES");
    writeFileSync(output, "NEW-SIDECAR-BYTES");
    await replaceLibraryFile(output, original);
    expect(readFileSync(original, "utf8")).toBe("NEW-SIDECAR-BYTES");
  });

  it("keeps the original when the staged copy cannot be created", async () => {
    const dir = mkdtempSync(join(tmpdir(), "opt-promote-fail-"));
    const original = join(dir, "movie.mkv");
    writeFileSync(original, "ORIGINAL-BYTES");
    await expect(replaceLibraryFile(join(dir, "missing.mkv"), original)).rejects.toThrow();
    expect(readFileSync(original, "utf8")).toBe("ORIGINAL-BYTES");
  });

  it("counts a successful replace and does not roll back when Arr refresh fails", async () => {
    const dir = mkdtempSync(join(tmpdir(), "opt-promote-arr-"));
    const original = join(dir, "movie.mkv");
    const output = join(dir, "sidecar.mkv");
    writeFileSync(original, "OLD");
    writeFileSync(output, "NEW");
    const result = await promote({
      item: {
        id: "m1",
        instanceId: "radarr",
        instanceName: "Radarr",
        arrId: 10,
        arrSeriesId: null,
        arrEpisodeFileId: null,
        type: "movie",
        title: "Film",
        showTitle: null,
        season: null,
        episode: null,
        episodeTitle: null,
        path: original,
        sizeBytes: 3,
        quality: "HD",
        resolution: "1080",
        profile: "HD",
        tags: [],
        posterRemoteUrl: null,
        hasPoster: false,
        sizeExempt: false,
      },
      outputPath: output,
      sourceSize: 10,
      outputSize: 4,
      decrypt: () => "key",
      fetch: (async () => new Response("nope", { status: 500 })) as typeof fetch,
      instance: { kind: "radarr", url: "http://radarr", secret: "enc" },
      players: [],
    });
    expect(result.replaced).toBe(true);
    expect(result.savedBytes).toBe(6);
    expect(result.warning).toMatch(/HTTP 500/);
    expect(readFileSync(original, "utf8")).toBe("NEW");
  });
});
