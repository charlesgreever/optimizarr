import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import { JobService } from "./jobs.ts";
import { Store } from "./store.ts";
import { cookieHeader } from "./test-http.ts";

describe("series queue", () => {
  const dirs: string[] = [];
  const stores: Store[] = [];

  afterEach(() => {
    for (const store of stores.splice(0)) store.close();
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  async function setup() {
    const dir = mkdtempSync(join(tmpdir(), "optimizarr-series-"));
    dirs.push(dir);
    const reviewPath = join(dir, "review");
    mkdirSync(reviewPath);
    const store = new Store(dir);
    stores.push(store);
    const jobs = new JobService(store, async () => {
      throw new Error("off-peak jobs must not run in this test");
    });
    const noon = new Date("2026-08-17T12:00:00");
    jobs.now = () => noon;
    const app = createApp(store, { jobs });
    const firstRun = await app.request("/api/setup/first-run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "correct-horse", preferredLanguage: "eng" }),
    });
    const cookie = cookieHeader(firstRun);
    store.saveSettings({
      ...store.getSettings(),
      reviewPath,
      offPeakEnabled: true,
      offPeakStart: "01:00",
      offPeakEnd: "02:00",
    });
    const instance = store.createArrInstance({ kind: "sonarr", name: "Sonarr", url: "http://sonarr", apiKey: "key" });
    return { app, store, cookie, dir, instanceId: instance.id };
  }

  function episode(store: Store, dir: string, instanceId: number, externalId: number, seriesId: number) {
    const path = join(dir, `${externalId}.mkv`);
    writeFileSync(path, "MEDIA");
    return store.upsertLibraryItem({
      instanceId,
      externalId,
      seriesId,
      type: "episode",
      title: `Episode ${externalId}`,
      seriesTitle: "Example Show",
      seasonNumber: 1,
      episodeNumber: externalId,
      path,
      folderPath: dir,
      quality: "WEB-1080p",
      videoCodec: "h264",
      resolution: "1080p",
      hdr: null,
      size: 5,
      readable: true,
      pathError: null,
      updatedAt: new Date().toISOString(),
      tags: [],
    });
  }

  function suggestion(store: Store, itemId: number): number {
    return store.saveSuggestion({
      itemId,
      actions: ["transcode"],
      warning: null,
      estimatedSavingsBytes: 1,
      overCap: true,
      extraTracks: false,
      category: "tv1080p",
      sizePerHourGb: 2,
      plan: { actions: ["transcode"], category: "tv1080p" },
    });
  }

  it("queues only open work for one Sonarr series and reports every skip", async () => {
    const { app, store, cookie, dir, instanceId } = await setup();
    const ready = episode(store, dir, instanceId, 1, 77);
    episode(store, dir, instanceId, 2, 77);
    const pending = episode(store, dir, instanceId, 3, 77);
    const dismissed = episode(store, dir, instanceId, 4, 77);
    suggestion(store, ready.id);
    const pendingSuggestion = suggestion(store, pending.id);
    const dismissedSuggestion = suggestion(store, dismissed.id);
    store.dismissSuggestion(dismissedSuggestion);
    const priorJob = store.createJob(pending.id, pendingSuggestion, { actions: ["transcode"] }, new Date().toISOString());
    store.updateJob(priorJob, { status: "succeeded" });
    store.createReview({
      itemId: pending.id,
      jobId: priorJob,
      sourcePath: pending.path,
      sidecarPath: join(dir, "pending.mkv"),
      compare: {},
    });

    const first = await app.request("/api/queue/series", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ instanceId, seriesId: 77 }),
    });
    expect(first.status).toBe(200);
    await expect(first.json()).resolves.toEqual({
      queued: 1,
      skipped: 3,
      reasons: { noWork: 2, pendingReview: 1, alreadyQueued: 0, errors: 0 },
    });

    const second = await app.request("/api/queue/series", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ instanceId, seriesId: 77 }),
    });
    await expect(second.json()).resolves.toEqual({
      queued: 0,
      skipped: 4,
      reasons: { noWork: 2, pendingReview: 1, alreadyQueued: 1, errors: 0 },
    });
    expect(store.listJobs().filter((job) => job.itemId === ready.id)).toHaveLength(1);
  });

  it("creates no jobs when every episode is healthy", async () => {
    const { app, store, cookie, dir, instanceId } = await setup();
    episode(store, dir, instanceId, 1, 88);
    episode(store, dir, instanceId, 2, 88);

    const response = await app.request("/api/queue/series", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ instanceId, seriesId: 88 }),
    });

    await expect(response.json()).resolves.toMatchObject({ queued: 0, skipped: 2 });
    expect(store.listJobs()).toHaveLength(0);
  });
});
