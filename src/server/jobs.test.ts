import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { JobService } from "./jobs.ts";
import { Store } from "./store.ts";
import type { ExecutablePlan, InspectionReport } from "./types.ts";

describe("job promotion follow-up", () => {
  it("keeps a direct transcode when profile assignment fails and exposes the warning", async () => {
    const dir = mkdtempSync(join(tmpdir(), "opt-direct-profile-"));
    const store = new Store(join(dir, "polisharr.db"));
    const instanceId = store.upsertInstance({
      kind: "radarr",
      name: "Radarr",
      url: "http://radarr",
      secret: "encrypted",
      enabled: true,
    });
    const itemId = `${instanceId}:movie:10`;
    const sourcePath = join(dir, "movie.mkv");
    const sidecarPath = join(dir, "sidecar.mkv");
    writeFileSync(sourcePath, "ORIGINAL");
    store.saveSettings({ ...store.getSettings(), reviewPath: dir, profileAutoAssign: true });
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
      path: sourcePath,
      sizeBytes: 8,
      quality: "Bluray-1080p",
      resolution: "1080",
      profile: "HD",
      tags: [],
      posterRemoteUrl: null,
      sizeExempt: false,
    });
    const report: InspectionReport = {
      sourceSig: `${sourcePath}|8`,
      sourceMethod: "ffprobe",
      listingState: "complete",
      durationSec: 3600,
      sizeBytes: 8,
      sizePerHourGb: 1,
      videoCodec: "h264",
      width: 1920,
      height: 1080,
      bitDepth: 8,
      hdr: "none",
      audio: [],
      subtitles: [],
      hasChapters: false,
      hasAttachments: false,
    };
    store.saveInspection(itemId, report);
    const plan: ExecutablePlan = {
      origin: "custom",
      video: { kind: "size", codec: "hevc", targetBytes: 3, downscale1080p: false, bitDepth: 8 },
      audio: [],
      subtitles: [],
      container: "mkv",
      writeMode: "direct",
      warning: null,
      reasons: ["Transcode video."],
      estimatedOutputBytes: 3,
      category: "movie1080p",
    };
    const jobs = new JobService({
      store,
      optimizer: async () => {
        writeFileSync(sidecarPath, "NEW");
        return { sidecarPath, output: { ...report, videoCodec: "hevc", sizeBytes: 3 } };
      },
      hardware: async () => ({ backend: "cuda", cuda: true, vaapi: false, av1: false, reason: null }),
      tools: { ffmpeg: "ffmpeg", ffprobe: "ffprobe", mkvmerge: "mkvmerge" },
      decrypt: () => "key",
      fetch: (async (url) => String(url).endsWith("/qualityprofile")
        ? new Response("nope", { status: 500 })
        : new Response("{}", { status: 201 })) as typeof fetch,
      reinspectChangedItem: async () => ({ ok: true }),
    });
    jobs.start();
    try {
      const queued = jobs.enqueueCustom(itemId, plan);
      expect("id" in queued).toBe(true);
      if (!("id" in queued)) return;
      await vi.waitFor(() => expect(store.getJob(queued.id)?.status).toBe("succeeded"));
      expect(readFileSync(sourcePath, "utf8")).toBe("NEW");
      expect(store.getJob(queued.id)?.promoteError).toMatch(/Could not list quality profiles/);
    } finally {
      jobs.stop();
      store.close();
    }
  });

  it("reinspects a direct-write destination before the job succeeds", async () => {
    const dir = mkdtempSync(join(tmpdir(), "opt-direct-reinspect-"));
    const store = new Store(join(dir, "polisharr.db"));
    const instanceId = store.upsertInstance({
      kind: "radarr",
      name: "Radarr",
      url: "http://radarr",
      secret: null,
      enabled: true,
    });
    const itemId = `${instanceId}:movie:10`;
    const sourcePath = join(dir, "movie.mp4");
    const sidecarPath = join(dir, "sidecar.mkv");
    writeFileSync(sourcePath, "ORIGINAL");
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
      path: sourcePath,
      sizeBytes: 8,
      quality: "HD",
      resolution: "1080",
      profile: "HD",
      tags: [],
      posterRemoteUrl: null,
      sizeExempt: false,
    });
    const report: InspectionReport = {
      sourceSig: `${sourcePath}|8`,
      sourceMethod: "ffprobe",
      listingState: "complete",
      durationSec: 3600,
      isoPlaylist: null,
      sizeBytes: 8,
      sizePerHourGb: 8 / 1024 ** 3,
      videoCodec: "h264",
      width: 1920,
      height: 1080,
      bitDepth: 8,
      hdr: "none",
      audio: [],
      subtitles: [],
      hasChapters: false,
      hasAttachments: false,
    };
    store.saveInspection(itemId, report);
    const plan: ExecutablePlan = {
      origin: "custom",
      video: { kind: "copy" },
      audio: [],
      subtitles: [],
      container: "mkv",
      writeMode: "direct",
      warning: null,
      reasons: ["Write Matroska."],
      estimatedOutputBytes: 3,
      category: "movie1080p",
    };
    const reinspected: Array<{ path: string; sizeBytes: number }> = [];
    const jobs = new JobService({
      store,
      optimizer: async () => {
        writeFileSync(sidecarPath, "NEW");
        return { sidecarPath, output: { ...report, sourceSig: `${sidecarPath}|3`, sizeBytes: 3 } };
      },
      hardware: async () => ({ backend: "none", cuda: false, vaapi: false, av1: false, reason: null }),
      tools: { ffmpeg: "ffmpeg", ffprobe: "ffprobe", mkvmerge: "mkvmerge" },
      decrypt: () => "",
      fetch: (async () => new Response("{}")) as typeof fetch,
      reinspectChangedItem: async (id) => {
        const item = store.getItem(id);
        if (item) reinspected.push({ path: item.path, sizeBytes: item.sizeBytes });
        return { ok: true };
      },
    });
    jobs.start();
    try {
      const queued = jobs.enqueueCustom(itemId, plan);
      expect("id" in queued).toBe(true);
      if (!("id" in queued)) return;
      await vi.waitFor(() => expect(store.getJob(queued.id)?.status).toBe("succeeded"));
      expect(reinspected).toEqual([{ path: join(dir, "movie.mkv"), sizeBytes: 3 }]);
      expect(store.getItem(itemId)?.keptSizeBytes).toBe(3);
    } finally {
      jobs.stop();
      store.close();
    }
  });

  it("requeues a flagged sidecar as a smaller size-mode job", async () => {
    const dir = mkdtempSync(join(tmpdir(), "opt-requeue-"));
    const store = new Store(join(dir, "polisharr.db"));
    const instanceId = store.upsertInstance({ kind: "radarr", name: "Radarr", url: "http://radarr", secret: null, enabled: true });
    const itemId = `${instanceId}:movie:1`;
    const sourcePath = join(dir, "movie.mkv");
    const sidecarPath = join(dir, "sidecar.mkv");
    writeFileSync(sourcePath, "ORIGINAL");
    writeFileSync(sidecarPath, "SIDECAR");
    store.upsertItem({
      id: itemId,
      instanceId,
      arrId: 1,
      arrSeriesId: null,
      arrEpisodeFileId: null,
      type: "movie",
      title: "Film",
      showTitle: null,
      season: null,
      episode: null,
      episodeTitle: null,
      path: sourcePath,
      sizeBytes: 10,
      quality: "HD",
      resolution: "1080",
      profile: "HD",
      tags: [],
      posterRemoteUrl: null,
      sizeExempt: false,
    });
    const plan: ExecutablePlan = {
      origin: "custom",
      video: { kind: "size", codec: "hevc", targetBytes: 5_000, downscale1080p: false, bitDepth: 8 },
      audio: [],
      subtitles: [],
      container: "mkv",
      writeMode: "sidecar",
      warning: null,
      reasons: ["Target size"],
      estimatedOutputBytes: 5_000,
      category: "movie1080p",
    };
    store.insertJob({
      id: "job-1",
      itemId,
      suggestionId: null,
      status: "succeeded",
      phase: "idle",
      progress: 1,
      error: null,
      warning: null,
      runNow: false,
      createdAt: 1,
      writeMode: "sidecar",
      plan,
    });
    store.insertReview({
      id: "rev-1",
      jobId: "job-1",
      itemId,
      displayTitle: "Film",
      status: "pending",
      flagged: true,
      flagReason: "The sidecar missed the size target or is larger than the original.",
      sourcePath,
      sidecarPath,
      source: { codec: "h264", quality: "HD", sizeBytes: 10, sizePerHourGb: 1, durationSec: 60, tracks: "" },
      sidecar: { codec: "hevc", quality: "HD", sizeBytes: 8, sizePerHourGb: 0.8, durationSec: 60, tracks: "" },
      error: null,
    });
    const jobs = new JobService({
      store,
      optimizer: async () => {
        throw new Error("should not run");
      },
      hardware: async () => ({ backend: "cuda", cuda: true, vaapi: false, av1: false, reason: null }),
      tools: { ffmpeg: "ffmpeg", ffprobe: "ffprobe", mkvmerge: "mkvmerge" },
      decrypt: () => "",
      fetch: (async () => new Response("{}")) as typeof fetch,
      reinspectChangedItem: async () => ({ ok: true }),
    });
    const result = await jobs.requeueFlagged("rev-1");
    expect(result).toMatchObject({ id: expect.any(String) });
    expect(store.getReview("rev-1")).toBeUndefined();
    if (!("id" in result)) return;
    expect(store.getJob(result.id)?.plan).toMatchObject({
      video: { kind: "size", targetBytes: 4_000 },
      reasons: ["Smaller encode after a missed size target."],
    });
    store.close();
  });
});
