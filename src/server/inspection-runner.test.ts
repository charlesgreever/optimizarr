import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createInspectionRunner } from "./inspection-runner.ts";
import { Store } from "./store.ts";

describe("inspection runner", () => {
  it("reinspects the promoted path before reporting success", async () => {
    const dir = mkdtempSync(join(tmpdir(), "opt-reinspect-"));
    const store = new Store(join(dir, "optimizarr.db"));
    const instanceId = store.upsertInstance({
      kind: "radarr",
      name: "Radarr",
      url: "http://radarr",
      secret: "packed",
      enabled: true,
    });
    const itemId = `${instanceId}:movie:10`;
    const oldPath = join(dir, "movie.iso");
    const promotedPath = join(dir, "movie.mkv");
    store.upsertItem({
      id: itemId,
      instanceId,
      arrId: 10,
      arrSeriesId: null,
      arrEpisodeFileId: null,
      type: "movie",
      title: "Film",
      showTitle: null,
      season: null,
      episode: null,
      episodeTitle: null,
      path: oldPath,
      sizeBytes: 9,
      quality: "Bluray-1080p",
      resolution: "1080",
      profile: "HD",
      tags: [],
      posterRemoteUrl: null,
      sizeExempt: false,
    });
    store.updateItemFile(itemId, promotedPath, 4);
    const probed: string[] = [];
    const runner = createInspectionRunner({
      store,
      ffmpeg: "ffmpeg",
      ffprobe: "ffprobe",
      readable: async () => true,
      probe: async (path) => {
        probed.push(path);
        return {
          format: { duration: "3600" },
          streams: [{ codec_type: "video", codec_name: "hevc", width: 1920, height: 1080 }],
        };
      },
      recomputeSuggestion: () => undefined,
    });

    const result = await runner.reinspectChangedItem(itemId, oldPath);

    expect(result.ok).toBe(true);
    expect(result.report?.sourceSig).toBe(`${promotedPath}|4`);
    expect(probed).toEqual([promotedPath]);
    store.close();
  });

  it("turns an unexpected readability failure into a visible reinspection warning", async () => {
    const dir = mkdtempSync(join(tmpdir(), "opt-reinspect-error-"));
    const store = new Store(join(dir, "optimizarr.db"));
    const instanceId = store.upsertInstance({
      kind: "radarr",
      name: "Radarr",
      url: "http://radarr",
      secret: "packed",
      enabled: true,
    });
    const itemId = `${instanceId}:movie:10`;
    const promotedPath = join(dir, "movie.mkv");
    store.upsertItem({
      id: itemId,
      instanceId,
      arrId: 10,
      arrSeriesId: null,
      arrEpisodeFileId: null,
      type: "movie",
      title: "Film",
      showTitle: null,
      season: null,
      episode: null,
      episodeTitle: null,
      path: promotedPath,
      sizeBytes: 4,
      quality: "Bluray-1080p",
      resolution: "1080",
      profile: "HD",
      tags: [],
      posterRemoteUrl: null,
      sizeExempt: false,
    });
    const runner = createInspectionRunner({
      store,
      ffmpeg: "ffmpeg",
      ffprobe: "ffprobe",
      readable: async () => {
        throw new Error("The mount disappeared.");
      },
      recomputeSuggestion: () => undefined,
    });

    const result = await runner.reinspectChangedItem(itemId, promotedPath);

    expect(result).toEqual({ ok: false, warning: "The mount disappeared." });
    expect(store.listErrors()).toEqual([
      expect.objectContaining({ itemId, path: promotedPath, reason: "The mount disappeared." }),
    ]);
    store.close();
  });
});
