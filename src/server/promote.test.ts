import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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

  it("writes an ISO Keep as MKV and removes the original disc image", async () => {
    const dir = mkdtempSync(join(tmpdir(), "opt-promote-iso-"));
    const iso = join(dir, "movie.iso");
    const sidecar = join(dir, "sidecar.mkv");
    writeFileSync(iso, "ISO-BYTES");
    writeFileSync(sidecar, "MKV-BYTES");
    const commands: Array<{ url: string; method?: string }> = [];
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
        path: iso,
        sizeBytes: 9,
        quality: "Bluray-2160p",
        resolution: "2160",
        profile: "HD",
        tags: [],
        posterRemoteUrl: null,
        hasPoster: false,
        sizeExempt: false,
      },
      outputPath: sidecar,
      sourceSize: 9,
      outputSize: 4,
      plan: {
        origin: "custom",
        video: { kind: "copy" },
        audio: [],
        subtitles: [],
        container: "mkv",
        writeMode: "sidecar",
        warning: null,
        reasons: ["Remux"],
        estimatedOutputBytes: 4,
        category: "movie4kHdr",
      },
      decrypt: () => "key",
      fetch: (async (url, init) => {
        commands.push({ url: String(url), method: init?.method });
        return new Response("{}", { status: 201 });
      }) as typeof fetch,
      instance: { kind: "radarr", url: "http://radarr:7878", secret: "enc" },
      players: [{ kind: "jellyfin", url: "http://jellyfin:8096", token: "t" }],
    });
    expect(result.replaced).toBe(true);
    expect(result.destPath).toBe(join(dir, "movie.mkv"));
    expect(readFileSync(result.destPath, "utf8")).toBe("MKV-BYTES");
    expect(iso).not.toBe(result.destPath);
    expect(existsSync(iso)).toBe(false);
    expect(commands.some((c) => c.url.includes("/api/v3/command") && c.method === "POST")).toBe(true);
    expect(commands.some((c) => c.url.includes("/Library/Refresh") && c.method === "POST")).toBe(true);
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
