import Database from "better-sqlite3";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Store } from "./store.ts";

describe("store schema migration", () => {
  const stores: Store[] = [];
  afterEach(() => {
    for (const store of stores) store.close();
    stores.length = 0;
  });

  it("adds a missing jobs.position column on an existing database", () => {
    const dir = mkdtempSync(join(tmpdir(), "opt-schema-"));
    const path = join(dir, "polisharr.db");
    const legacy = new Database(path);
    legacy.exec(`
      CREATE TABLE jobs (
        id TEXT PRIMARY KEY,
        item_id TEXT NOT NULL,
        suggestion_id TEXT,
        status TEXT NOT NULL,
        phase TEXT NOT NULL,
        progress REAL NOT NULL DEFAULT 0,
        error TEXT,
        warning TEXT,
        run_now INTEGER NOT NULL DEFAULT 0,
        plan TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);
    legacy
      .prepare(
        "INSERT INTO jobs (id, item_id, suggestion_id, status, phase, progress, error, warning, run_now, plan, created_at) VALUES (?, ?, NULL, 'queued', 'queued', 0, NULL, NULL, 0, '{}', 1)",
      )
      .run("job-1", "item-1");
    legacy.close();

    const store = new Store(path);
    stores.push(store);
    const jobs = store.listJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.id).toBe("job-1");
  });

  it("defaults an existing settings row to sidecar write mode", () => {
    const dir = mkdtempSync(join(tmpdir(), "opt-settings-"));
    const path = join(dir, "polisharr.db");
    const store = new Store(path);
    stores.push(store);
    store.saveSettings({
      ...store.getSettings(),
      preferredLanguage: "eng",
      languageConfirmed: true,
      reviewPath: "/review",
    });
    const reopened = new Store(path);
    stores.push(reopened);
    expect(reopened.getSettings().writeMode).toBe("sidecar");
    reopened.saveSettings({ ...reopened.getSettings(), writeMode: "direct" });
    const again = new Store(path);
    stores.push(again);
    expect(again.getSettings().writeMode).toBe("direct");
  });

  it("fills missing automatic suggestion defaults from older settings", () => {
    const dir = mkdtempSync(join(tmpdir(), "opt-suggestion-settings-"));
    const path = join(dir, "polisharr.db");
    const store = new Store(path);
    stores.push(store);
    store.db
      .prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('app', ?)")
      .run(JSON.stringify({ suggestionDefaults: { addStereo: false } }));

    expect(store.getSettings().suggestionDefaults).toEqual({
      removeNonPreferredSubtitles: true,
      removeNonPreferredAudio: true,
      addStereo: false,
      transcodeToSizeCap: true,
      convertMp4ToMkv: false,
      convertIsoToMkv: false,
      searchPreferredLanguage: false,
    });
  });

  it("falls back to defaults when the persisted Settings JSON is corrupt", () => {
    const store = new Store(join(mkdtempSync(join(tmpdir(), "opt-corrupt-settings-")), "polisharr.db"));
    stores.push(store);
    store.db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('app', ?)").run("{broken");
    expect(store.getSettings()).toMatchObject({ writeMode: "sidecar", concurrency: 1, videoTarget: "hevc" });
  });

  it("defaults profile auto-assign on for existing installs and persists an opt-out", () => {
    const dir = mkdtempSync(join(tmpdir(), "opt-profile-settings-"));
    const path = join(dir, "polisharr.db");
    const store = new Store(path);
    stores.push(store);
    expect(store.getSettings().profileAutoAssign).toBe(true);
    store.saveSettings({ ...store.getSettings(), profileAutoAssign: false });

    const reopened = new Store(path);
    stores.push(reopened);
    expect(reopened.getSettings().profileAutoAssign).toBe(false);
  });

  it("persists a custom executable plan, write mode, and promote error", () => {
    const dir = mkdtempSync(join(tmpdir(), "opt-job-plan-"));
    const path = join(dir, "polisharr.db");
    const store = new Store(path);
    stores.push(store);
    store.insertJob({
      id: "job-custom",
      itemId: "item-1",
      suggestionId: null,
      status: "queued",
      phase: "queued",
      progress: 0,
      error: null,
      warning: null,
      runNow: false,
      createdAt: 1,
      writeMode: "direct",
      promoteError: null,
      plan: {
        origin: "custom",
        video: { kind: "copy" },
        audio: [{ op: "keep", index: 1 }],
        subtitles: [{ op: "remove", index: 2 }],
        container: "mkv",
        writeMode: "direct",
        warning: null,
        reasons: ["Drop Spanish subtitles."],
        estimatedOutputBytes: null,
        category: "movie1080p",
      },
    });
    store.updateJob("job-custom", { promoteError: "Radarr rejected the profile assign." });
    const loaded = store.getJob("job-custom");
    expect(loaded?.suggestionId).toBeNull();
    expect(loaded?.writeMode).toBe("direct");
    expect(loaded?.promoteError).toBe("Radarr rejected the profile assign.");
    expect((loaded?.plan as { origin?: string }).origin).toBe("custom");
  });

  it("returns interrupted running jobs to the queue after restart", () => {
    const dir = mkdtempSync(join(tmpdir(), "opt-recovery-"));
    const store = new Store(join(dir, "polisharr.db"));
    stores.push(store);
    store.insertJob({
      id: "job-running", itemId: "item-1", suggestionId: null, status: "running", phase: "transcoding",
      progress: 0.5, error: null, warning: null, runNow: false, createdAt: 1,
      plan: { id: "suggestion", itemId: "item-1", actions: [], reasons: [], warning: null, category: "movie1080p",
        estimatedSavingsBytes: null, now: { codec: null, quality: null, sizeBytes: null, sizePerHourGb: null },
        after: { codec: null, quality: null, sizeBytes: null, sizePerHourGb: null }, dismissed: false,
        keepAudio: [], stripAudio: [], keepSubs: [], stripSubs: [] },
    });

    expect(store.recoverInterruptedJobs()).toBe(1);
    expect(store.getJob("job-running")).toMatchObject({
      status: "queued", phase: "queued", progress: 0, error: "Recovered after Polisharr restarted.",
    });
  });

  it("does not mark a title unreadable from a file error on an old path", () => {
    const dir = mkdtempSync(join(tmpdir(), "opt-stale-error-"));
    const store = new Store(join(dir, "polisharr.db"));
    stores.push(store);
    const instanceId = store.upsertInstance({
      kind: "radarr",
      name: "Radarr",
      url: "http://radarr",
      secret: null,
      enabled: true,
    });
    const itemId = `${instanceId}:movie:438`;
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
      path: "/mnt/nas/Cars 3 [FGT].iso",
      sizeBytes: 40_000_000_000,
      quality: "BR-DISK",
      resolution: "2160",
      profile: "HD",
      tags: [],
      posterRemoteUrl: null,
      sizeExempt: false,
    });
    store.setFileError("/mnt/nas/Cars 3 [CODEFLiX].iso", itemId, "ffprobe failed.");
    expect(store.librarySnapshot(itemId)?.error).toBeNull();
    expect(store.listErrors().some((row) => row.path.includes("CODEFLiX"))).toBe(false);
    expect(store.workSummary().errors).toBe(0);
    store.setFileError("/mnt/nas/Cars 3 [FGT].iso", itemId, "This path is not readable inside the container.");
    expect(store.librarySnapshot(itemId)?.error).toMatch(/not readable/);
    expect(store.workSummary().errors).toBe(1);
    store.clearFileErrorsForItem(itemId);
    expect(store.librarySnapshot(itemId)?.error).toBeNull();
  });

  it("drops a folder ffprobe error after the title path becomes the media file", () => {
    const dir = mkdtempSync(join(tmpdir(), "opt-folder-error-"));
    const store = new Store(join(dir, "polisharr.db"));
    stores.push(store);
    const instanceId = store.upsertInstance({
      kind: "radarr",
      name: "Radarr",
      url: "http://radarr",
      secret: null,
      enabled: true,
    });
    const itemId = `${instanceId}:movie:241`;
    const folder = "/mnt/nas/Movies/John Wick Chapter 3 - Parabellum (2019)";
    const file = `${folder}/John Wick Chapter 3.mkv`;
    store.upsertItem({
      id: itemId,
      instanceId,
      arrId: 241,
      arrSeriesId: null,
      arrEpisodeFileId: null,
      type: "movie",
      title: "John Wick: Chapter 3 - Parabellum",
      showTitle: null,
      season: null,
      episode: null,
      episodeTitle: null,
      path: folder,
      sizeBytes: 0,
      quality: "",
      resolution: "",
      profile: "HD",
      tags: [],
      posterRemoteUrl: null,
      sizeExempt: false,
    });
    store.setFileError(folder, itemId, "Command failed: ffprobe -v quiet -print_format json -show_format -show_streams " + folder);
    store.upsertItem({
      id: itemId,
      instanceId,
      arrId: 241,
      arrSeriesId: null,
      arrEpisodeFileId: null,
      type: "movie",
      title: "John Wick: Chapter 3 - Parabellum",
      showTitle: null,
      season: null,
      episode: null,
      episodeTitle: null,
      path: file,
      sizeBytes: 74_279_424_501,
      quality: "Bluray-2160p",
      resolution: "2160",
      profile: "HD",
      tags: [],
      posterRemoteUrl: null,
      sizeExempt: false,
    });
    expect(store.listErrors()).toEqual([]);
    expect(store.errorPage(0, 20).items).toEqual([]);
    expect(store.workSummary().errors).toBe(0);
  });

  it("counts healthy movies and open suggestions for the Movies header", () => {
    const dir = mkdtempSync(join(tmpdir(), "opt-movie-health-"));
    const store = new Store(join(dir, "polisharr.db"));
    stores.push(store);
    const instanceId = store.upsertInstance({
      kind: "radarr",
      name: "Radarr",
      url: "http://radarr",
      secret: null,
      enabled: true,
    });
    const movie = (id: string, arrId: number, path: string) =>
      store.upsertItem({
        id,
        instanceId,
        arrId,
        arrSeriesId: null,
        arrEpisodeFileId: null,
        type: "movie",
        title: id,
        showTitle: null,
        season: null,
        episode: null,
        episodeTitle: null,
        path,
        sizeBytes: 1,
        quality: "HD",
        resolution: "1080",
        profile: "HD",
        tags: [],
        posterRemoteUrl: null,
        sizeExempt: false,
      });
    movie("healthy", 1, "/movies/healthy.mkv");
    movie("suggested", 2, "/movies/suggested.mkv");
    movie("unread", 3, "/movies/unread.mkv");
    movie("unreadable", 4, "/movies/unreadable.mkv");
    const inspection = {
      sourceSig: "p|1",
      sourceMethod: "ffprobe" as const,
      listingState: "complete" as const,
      durationSec: 3600,
      isoPlaylist: null,
      sizeBytes: 1,
      sizePerHourGb: 1,
      videoCodec: "hevc",
      width: 1920,
      height: 1080,
      bitDepth: 8,
      hdr: "none" as const,
      audio: [],
      subtitles: [],
      hasChapters: false,
      hasAttachments: false,
    };
    store.saveInspection("healthy", { ...inspection, sourceSig: "/movies/healthy.mkv|1" });
    store.saveInspection("suggested", { ...inspection, sourceSig: "/movies/suggested.mkv|1" });
    store.saveInspection("unreadable", { ...inspection, sourceSig: "/movies/unreadable.mkv|1" });
    store.saveSuggestion("suggested", {
      id: "sug-1",
      itemId: "suggested",
      actions: ["transcode"],
      reasons: ["Over the size cap."],
      warning: null,
      category: "movie1080p",
      estimatedSavingsBytes: 1,
      now: { codec: "h264", quality: "HD", sizeBytes: 1, sizePerHourGb: 1 },
      after: { codec: "hevc", quality: "HD", sizeBytes: 1, sizePerHourGb: 1 },
      dismissed: false,
      keepAudio: [],
      stripAudio: [],
      keepSubs: [],
      stripSubs: [],
    });
    store.setFileError("/movies/unreadable.mkv", "unreadable", "Path is unreadable.");
    expect(store.movieHealth()).toEqual({ total: 4, healthyCount: 1, suggestionCount: 1 });
  });
});
