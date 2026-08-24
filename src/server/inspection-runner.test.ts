import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createInspectionRunner } from "./inspection-runner.ts";
import { Store } from "./store.ts";

describe("inspection runner", () => {
  it("reinspects the promoted path before reporting success", async () => {
    const dir = mkdtempSync(join(tmpdir(), "opt-reinspect-"));
    const store = new Store(join(dir, "polisharr.db"));
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
    const store = new Store(join(dir, "polisharr.db"));
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

  it("relists an ISO that still has a dummy ffprobe AC3 report at the same path and size", async () => {
    const dir = mkdtempSync(join(tmpdir(), "opt-iso-stale-"));
    const store = new Store(join(dir, "polisharr.db"));
    const instanceId = store.upsertInstance({
      kind: "radarr",
      name: "Radarr",
      url: "http://radarr",
      secret: "packed",
      enabled: true,
    });
    const itemId = `${instanceId}:movie:438`;
    const path = join(dir, "Cars 3 (2017)[BR-DISK].iso");
    store.upsertItem({
      id: itemId,
      instanceId,
      arrId: 438,
      arrSeriesId: null,
      arrEpisodeFileId: null,
      type: "movie",
      title: "Cars 3",
      showTitle: null,
      season: null,
      episode: null,
      episodeTitle: null,
      path,
      sizeBytes: 43,
      quality: "Bluray-1080p",
      resolution: "1080",
      profile: "HD",
      tags: [],
      posterRemoteUrl: null,
      sizeExempt: false,
    });
    store.saveInspection(itemId, {
      sourceSig: `${path}|43`,
      sourceMethod: "ffprobe",
      listingState: "complete",
      durationSec: 10_787_176.448,
      isoPlaylist: null,
      sizeBytes: 43,
      sizePerHourGb: 0.01,
      videoCodec: "unknown",
      width: 0,
      height: 0,
      bitDepth: 8,
      hdr: "none",
      audio: [{ index: 0, language: "und", channels: 2, codec: "ac3", title: "", untagged: true, commentary: false }],
      subtitles: [],
      hasChapters: false,
      hasAttachments: false,
    });
    let listed = 0;
    const runner = createInspectionRunner({
      store,
      ffmpeg: "ffmpeg",
      ffprobe: "ffprobe",
      readable: async () => true,
      probe: async () => {
        throw new Error("ffprobe must not run on an ISO.");
      },
      listIso: async () => {
        listed += 1;
        return [
          "[bluray @ 0x1] playlist 00805.mpls (1:42:25)",
          "  Stream #0:0: Video: h264, 1920x1080",
          "  Stream #0:1(eng): Audio: dts, 48000 Hz, 7.1",
        ].join("\n");
      },
      recomputeSuggestion: () => undefined,
    });

    expect(runner.leftoverCount()).toBe(1);
    await runner.inspectPending();
    expect(listed).toBe(1);
    const report = store.getInspection(itemId);
    expect(report?.sourceMethod).toBe("iso_ffmpeg");
    expect(report?.isoPlaylist).toBe(805);
    expect(report?.width).toBe(1920);
    expect(report?.audio[0]?.codec).toBe("dts");
    expect(runner.leftoverCount()).toBe(0);
    store.close();
  });

  it("does not put a missing path or a failed ISO listing on Errors", async () => {
    const dir = mkdtempSync(join(tmpdir(), "opt-inspect-missing-"));
    const store = new Store(join(dir, "polisharr.db"));
    const instanceId = store.upsertInstance({
      kind: "radarr",
      name: "Radarr",
      url: "http://radarr",
      secret: "packed",
      enabled: true,
    });
    const missingId = `${instanceId}:movie:1`;
    const isoId = `${instanceId}:movie:2`;
    store.upsertItem({
      id: missingId,
      instanceId,
      arrId: 1,
      arrSeriesId: null,
      arrEpisodeFileId: null,
      type: "movie",
      title: "Moana",
      showTitle: null,
      season: null,
      episode: null,
      episodeTitle: null,
      path: join(dir, "Moana (2026)"),
      sizeBytes: 0,
      quality: "",
      resolution: "",
      profile: "HD",
      tags: [],
      posterRemoteUrl: null,
      sizeExempt: false,
    });
    store.upsertItem({
      id: isoId,
      instanceId,
      arrId: 2,
      arrSeriesId: null,
      arrEpisodeFileId: null,
      type: "movie",
      title: "Cars 3",
      showTitle: null,
      season: null,
      episode: null,
      episodeTitle: null,
      path: join(dir, "Cars 3.iso"),
      sizeBytes: 40,
      quality: "Bluray-1080p",
      resolution: "1080",
      profile: "HD",
      tags: [],
      posterRemoteUrl: null,
      sizeExempt: false,
    });
    writeFileSync(join(dir, "Cars 3.iso"), "iso");
    const runner = createInspectionRunner({
      store,
      ffmpeg: "ffmpeg",
      ffprobe: "ffprobe",
      probe: async () => {
        throw new Error("ffprobe must not run on a missing file.");
      },
      listIso: async () => {
        throw new Error("ffmpeg could not list streams on this disc image.");
      },
      recomputeSuggestion: () => undefined,
    });

    await runner.inspectPending();
    expect(store.listErrors()).toEqual([]);
    expect(store.getInspection(isoId)?.listingState).toBe("iso_unlisted");
    store.close();
  });
});
