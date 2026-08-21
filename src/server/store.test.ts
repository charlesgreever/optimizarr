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
    const path = join(dir, "optimizarr.db");
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
    const path = join(dir, "optimizarr.db");
    const store = new Store(path);
    stores.push(store);
    store.saveSettings({
      preferredLanguage: "eng",
      languageConfirmed: true,
      reviewPath: "/review",
      sizeCaps: { movie1080p: 2.5, movie4kSdr: 6, movie4kHdr: 8, tv1080p: 1, tv4k: 4 },
      videoTarget: "hevc",
      concurrency: 1,
      conservativeMode: false,
      offPeakEnabled: false,
      offPeakStart: "01:00",
      offPeakEnd: "07:00",
      localAuthBypass: false,
      inspectConcurrency: 1,
    } as never);
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
    const path = join(dir, "optimizarr.db");
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
    });
  });

  it("falls back to defaults when the persisted Settings JSON is corrupt", () => {
    const store = new Store(join(mkdtempSync(join(tmpdir(), "opt-corrupt-settings-")), "optimizarr.db"));
    stores.push(store);
    store.db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('app', ?)").run("{broken");
    expect(store.getSettings()).toMatchObject({ writeMode: "sidecar", concurrency: 1, videoTarget: "hevc" });
  });

  it("defaults profile auto-assign on for existing installs and persists an opt-out", () => {
    const dir = mkdtempSync(join(tmpdir(), "opt-profile-settings-"));
    const path = join(dir, "optimizarr.db");
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
    const path = join(dir, "optimizarr.db");
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
    const store = new Store(join(dir, "optimizarr.db"));
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
      status: "queued", phase: "queued", progress: 0, error: "Recovered after Optimizarr restarted.",
    });
  });
});
