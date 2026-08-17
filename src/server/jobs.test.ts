import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ArrClient } from "./arr.ts";
import { createApp } from "./app.ts";
import { Catalog } from "./catalog.ts";
import { parseFfprobe } from "./inspect.ts";
import { IntegrityError, type Optimizer } from "./optimize.ts";
import { Store } from "./store.ts";
import { LibrarySync } from "./sync.ts";
import { JobService } from "./jobs.ts";
import { cookieHeader, waitForQueue, waitForReview } from "./test-http.ts";

describe("phase 4 remux review keep", () => {
  const dirs: string[] = [];
  const stores: Store[] = [];

  afterEach(() => {
    for (const s of stores.splice(0)) s.close();
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  async function setup(opts?: {
    failIntegrity?: boolean;
    notifyStatus?: number;
    renameError?: string;
    makeJobs?: (store: Store, optimize: Optimizer, fetchImpl: typeof fetch) => JobService;
  }) {
    const dir = mkdtempSync(join(tmpdir(), "optimizarr-"));
    dirs.push(dir);
    const library = join(dir, "library");
    const review = join(dir, "review");
    mkdirSync(library);
    mkdirSync(review);
    const source = join(library, "movie.mkv");
    writeFileSync(source, "ORIGINAL-MEDIA-FILE-CONTENTS-ARE-HERE");
    const store = new Store(dir);
    stores.push(store);
    const calls: string[] = [];
    const fetchImpl = async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (url.endsWith("/movie")) {
        return Response.json([
          { id: 9, title: "Cleanup", movieFile: { path: source, size: 40, quality: { quality: { name: "WEBDL-1080p" } } } },
        ]);
      }
      if (url.includes("/command") || url.includes("/refresh") || url.includes("/Library")) {
        return new Response("x", { status: opts?.notifyStatus ?? 200 });
      }
      if (url.endsWith("/status")) return Response.json({ version: "1" });
      return new Response("no", { status: 404 });
    };
    const probe = () =>
      parseFfprobe(source, {
        format: { duration: "3600", size: "40" },
        streams: [
          { codec_type: "video", codec_name: "hevc", width: 1920, height: 1080 },
          { codec_type: "audio", codec_name: "aac", channels: 2, tags: { language: "eng" } },
          { codec_type: "subtitle", codec_name: "subrip", tags: { language: "spa" } },
        ],
      });
    const optimize = async (req: { sourcePath: string; sidecarPath: string; report: { durationSec: number } }) => {
      if (opts?.failIntegrity) throw new IntegrityError("Duration mismatch");
      const { copyFile, mkdir } = await import("node:fs/promises");
      const { dirname } = await import("node:path");
      await mkdir(dirname(req.sidecarPath), { recursive: true });
      await copyFile(req.sourcePath, req.sidecarPath);
      const { writeFile } = await import("node:fs/promises");
      await writeFile(req.sidecarPath, "SIDECAR-OUTPUT");
      return { sidecarPath: req.sidecarPath, durationSec: req.report.durationSec, sizeBytes: 40 };
    };
    const catalog = new Catalog(store, probe);
    const sync = new LibrarySync(store, new ArrClient(fetchImpl), () => true);
    const jobs = opts?.makeJobs?.(store, optimize, fetchImpl);
    const app = createApp(store, { fetchImpl, pathReadable: () => true, sync, catalog, probe, optimize, jobs });
    const first = await app.request("/api/setup/first-run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "correct-horse", preferredLanguage: "eng" }),
    });
    const cookie = cookieHeader(first);
    await app.request("/api/settings", {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ reviewPath: review }),
    });
    await app.request("/api/instances", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ kind: "radarr", name: "R", url: "http://r", apiKey: "k" }),
    });
    await app.request("/api/players", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ kind: "plex", name: "Plex", url: "http://plex", token: "pt" }),
    });
    await app.request("/api/players", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ kind: "jellyfin", name: "JF", url: "http://jf", token: "jt" }),
    });
    await app.request("/api/library/refresh", { method: "POST", headers: { cookie } });
    await catalog.inspectPending();
    return { app, store, cookie, source, review, library, calls, dir, catalog };
  }

  it("keeps both a Plex and a Jellyfin player in the list", async () => {
    const { app, cookie } = await setup();
    const listed = await app.request("/api/players", { headers: { cookie } }).then((r) => r.json());
    expect(listed.items).toHaveLength(2);
    expect(listed.items.map((p: { kind: string }) => p.kind).sort()).toEqual(["jellyfin", "plex"]);
    expect(listed.items.every((p: { token?: string }) => p.token === undefined)).toBe(true);
    const extra = await app.request("/api/players", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ kind: "plex", name: "Plex 2", url: "http://plex2", token: "t2" }),
    });
    expect(extra.status).toBe(201);
    const again = await app.request("/api/players", { headers: { cookie } }).then((r) => r.json());
    expect(again.items).toHaveLength(3);
    const ids = again.items.map((p: { id: number }) => p.id);
    expect(new Set(ids).size).toBe(3);
  });

  it("writes a sidecar to the review path and leaves the original until Keep", async () => {
    const { app, cookie, source, review } = await setup();
    const suggestions = await app.request("/api/suggestions", { headers: { cookie } }).then((r) => r.json());
    expect(suggestions.items[0].actions).toContain("remux");
    const queued = await app.request("/api/queue", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ suggestionId: suggestions.items[0].id }),
    });
    expect(queued.status).toBe(201);
    await waitForQueue(app, cookie, (items) => items[0]?.status === "succeeded");
    expect(readFileSync(source, "utf8")).toContain("ORIGINAL");
    const reviews = await app.request("/api/review", { headers: { cookie } }).then((r) => r.json());
    expect(reviews.items).toHaveLength(1);
    expect(String(reviews.items[0].sidecarPath).startsWith(review)).toBe(true);
    expect(reviews.items[0].compare.sidecar).toBeTruthy();
  });

  it("Keep replaces the original, Discard deletes only the sidecar", async () => {
    const { app, cookie, source } = await setup();
    const sid = (await app.request("/api/suggestions", { headers: { cookie } }).then((r) => r.json())).items[0].id;
    await app.request("/api/queue", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ suggestionId: sid }),
    });
    await waitForQueue(app, cookie, (items) => items[0]?.status === "succeeded");
    const review = (await app.request("/api/review", { headers: { cookie } }).then((r) => r.json())).items[0];
    const keep = await app.request(`/api/review/${review.id}/keep`, { method: "POST", headers: { cookie } });
    expect(keep.status).toBe(202);
    expect((await keep.json()).accepted).toBe(true);
    await waitForReview(app, cookie, (items) => items.length === 0);
    expect(readFileSync(source, "utf8")).toBe("SIDECAR-OUTPUT");
    expect(existsSync(review.sidecarPath)).toBe(false);
  });

  it("does not undo Keep when a player is down", async () => {
    const { app, cookie, source } = await setup({ notifyStatus: 503 });
    const sid = (await app.request("/api/suggestions", { headers: { cookie } }).then((r) => r.json())).items[0].id;
    await app.request("/api/queue", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ suggestionId: sid }),
    });
    await waitForQueue(app, cookie, (items) => items[0]?.status === "succeeded");
    const review = (await app.request("/api/review", { headers: { cookie } }).then((r) => r.json())).items[0];
    const keep = await app.request(`/api/review/${review.id}/keep`, { method: "POST", headers: { cookie } });
    expect(keep.status).toBe(202);
    await waitForReview(app, cookie, (items) => items.length === 0);
    expect(readFileSync(source, "utf8")).toBeTruthy();
    const history = await app.request("/api/history", { headers: { cookie } }).then((r) => r.json());
    expect(JSON.stringify(history)).toMatch(/HTTP 503/);
  });

  it("keeps later titles in the queue while one job is running", async () => {
    const { store } = await setup();
    const firstItem = store.listLibraryItems("movie")[0];
    const second = store.upsertLibraryItem({
      instanceId: firstItem.instanceId,
      externalId: 10,
      seriesId: null,
      type: "movie",
      title: "Biscuits",
      seriesTitle: "Ted Lasso",
      seasonNumber: 1,
      episodeNumber: 2,
      path: firstItem.path,
      folderPath: firstItem.folderPath,
      quality: firstItem.quality,
      videoCodec: firstItem.videoCodec,
      resolution: firstItem.resolution,
      hdr: firstItem.hdr,
      size: firstItem.size,
      readable: true,
      pathError: null,
      updatedAt: new Date().toISOString(),
    });
    store.saveInspection(second.id, store.getInspection(firstItem.id), new Date().toISOString(), "sig");
    const plan = store.listSuggestions()[0].plan;
    store.saveSuggestion({
      itemId: second.id,
      actions: ["transcode"],
      warning: null,
      estimatedSavingsBytes: 1,
      overCap: true,
      extraTracks: false,
      category: "tv1080p",
      sizePerHourGb: 3,
      plan,
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started = 0;
    const { JobService } = await import("./jobs.ts");
    const jobs = new JobService(store, async (req) => {
      started += 1;
      if (started === 1) await gate;
      const { mkdir, writeFile } = await import("node:fs/promises");
      const { dirname } = await import("node:path");
      await mkdir(dirname(req.sidecarPath), { recursive: true });
      await writeFile(req.sidecarPath, "SIDECAR");
      return { sidecarPath: req.sidecarPath, durationSec: 3600, sizeBytes: 40 };
    });
    const sugs = store.listSuggestions();
    const first = jobs.enqueue(sugs[0].id as number);
    for (let i = 0; i < 50 && !store.listJobs().some((j) => j.status === "running"); i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const firstResult = await first;
    expect("jobId" in firstResult).toBe(true);
    expect(store.listJobs().some((j) => j.status === "running")).toBe(true);
    const secondResult = await jobs.enqueue(sugs[1].id as number);
    expect("jobId" in secondResult).toBe(true);
    const statuses = store
      .listJobs()
      .map((j) => j.status)
      .sort();
    expect(statuses).toContain("queued");
    expect(statuses).toContain("running");
    release();
    await jobs.processQueue();
  });

  it("starts more jobs when concurrency is raised while one is running", async () => {
    const { store } = await setup();
    const firstItem = store.listLibraryItems("movie")[0];
    const plan = store.listSuggestions()[0].plan;
    for (const [externalId, title] of [
      [10, "The Tagger"],
      [11, "The Slump"],
    ] as const) {
      const item = store.upsertLibraryItem({
        instanceId: firstItem.instanceId,
        externalId,
        seriesId: null,
        type: "movie",
        title,
        seriesTitle: "Brooklyn Nine-Nine",
        seasonNumber: 1,
        episodeNumber: externalId - 8,
        path: firstItem.path,
        folderPath: firstItem.folderPath,
        quality: firstItem.quality,
        videoCodec: firstItem.videoCodec,
        resolution: firstItem.resolution,
        hdr: firstItem.hdr,
        size: firstItem.size,
        readable: true,
        pathError: null,
        updatedAt: new Date().toISOString(),
      });
      store.saveInspection(item.id, store.getInspection(firstItem.id), new Date().toISOString(), `sig-${externalId}`);
      store.saveSuggestion({
        itemId: item.id,
        actions: ["transcode"],
        warning: null,
        estimatedSavingsBytes: 1,
        overCap: true,
        extraTracks: false,
        category: "tv1080p",
        sizePerHourGb: 3,
        plan,
      });
    }
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { JobService } = await import("./jobs.ts");
    const jobs = new JobService(store, async (req) => {
      await gate;
      const { mkdir, writeFile } = await import("node:fs/promises");
      const { dirname } = await import("node:path");
      await mkdir(dirname(req.sidecarPath), { recursive: true });
      await writeFile(req.sidecarPath, "SIDECAR");
      return { sidecarPath: req.sidecarPath, durationSec: 3600, sizeBytes: 40 };
    });
    store.saveSettings({ ...store.getSettings(), concurrency: 1 });
    for (const sug of store.listSuggestions()) {
      await jobs.enqueue(sug.id as number);
    }
    for (let i = 0; i < 50 && store.listJobs().filter((j) => j.status === "running").length !== 1; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(store.listJobs().filter((j) => j.status === "running")).toHaveLength(1);
    expect(store.listJobs().filter((j) => j.status === "queued").length).toBeGreaterThanOrEqual(2);
    store.saveSettings({ ...store.getSettings(), concurrency: 4 });
    void jobs.processQueue();
    for (let i = 0; i < 50 && store.listJobs().filter((j) => j.status === "running").length < 3; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(store.listJobs().filter((j) => j.status === "running")).toHaveLength(3);
    release();
    for (let i = 0; i < 50 && store.listJobs().some((j) => j.status === "running"); i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  });

  it("blocks a second job while a sidecar is pending", async () => {
    const { app, cookie } = await setup();
    const sid = (await app.request("/api/suggestions", { headers: { cookie } }).then((r) => r.json())).items[0].id;
    const first = await app.request("/api/queue", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ suggestionId: sid }),
    });
    expect(first.status).toBe(201);
    await waitForQueue(app, cookie, (items) => items[0]?.status === "succeeded");
    const second = await app.request("/api/queue", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ suggestionId: sid }),
    });
    expect(second.status).toBe(409);
  });

  it("cancels a queued job before it starts and leaves the original", async () => {
    const { store, source } = await setup();
    let ran = false;
    const { JobService } = await import("./jobs.ts");
    const jobs = new JobService(store, async () => {
      ran = true;
      return { sidecarPath: "/nope", durationSec: 1, sizeBytes: 1 };
    });
    const item = store.listLibraryItems("movie")[0];
    const suggestion = store.listSuggestions()[0];
    const jobId = store.createJob(item.id, suggestion.id as number, suggestion.plan, new Date().toISOString());
    const cancelled = await jobs.cancel(jobId);
    expect(cancelled).toEqual({ ok: true });
    await jobs.processQueue();
    expect(ran).toBe(false);
    expect(store.getJob(jobId)?.status).toBe("cancelled");
    expect(readFileSync(source, "utf8")).toContain("ORIGINAL");
    expect(store.listReviews("pending")).toHaveLength(0);
  });

  it("cancels a stalled running job without promoting the sidecar", async () => {
    const { store, source } = await setup();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started!: () => void;
    const sawStart = new Promise<void>((resolve) => {
      started = resolve;
    });
    const { JobService } = await import("./jobs.ts");
    const jobs = new JobService(store, async (req) => {
      started();
      await gate;
      writeFileSync(req.sidecarPath, "SHOULD-NOT-KEEP");
      return { sidecarPath: req.sidecarPath, durationSec: 3600, sizeBytes: 40 };
    });
    const suggestion = store.listSuggestions()[0];
    const run = jobs.enqueue(suggestion.id as number);
    await sawStart;
    const listed = store.listJobs();
    const jobId = listed[0].id as number;
    expect(store.getJob(jobId)?.status).toBe("running");
    await expect(jobs.cancel(jobId)).resolves.toEqual({ ok: true });
    release();
    await run;
    expect(store.getJob(jobId)?.status).toBe("cancelled");
    expect(readFileSync(source, "utf8")).toContain("ORIGINAL");
    expect(store.listReviews("pending")).toHaveLength(0);
  });

  it("does not cancel a finished job", async () => {
    const { app, cookie } = await setup();
    const sid = (await app.request("/api/suggestions", { headers: { cookie } }).then((r) => r.json())).items[0].id;
    await app.request("/api/queue", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ suggestionId: sid }),
    });
    await waitForQueue(app, cookie, (items) => items[0]?.status === "succeeded");
    const jobId = (await app.request("/api/queue", { headers: { cookie } }).then((r) => r.json())).items[0].id;
    const res = await app.request(`/api/queue/${jobId}/cancel`, { method: "POST", headers: { cookie } });
    expect(res.status).toBe(409);
    const jobs = await app.request("/api/queue", { headers: { cookie } }).then((r) => r.json());
    expect(jobs.items[0].status).toBe("succeeded");
  });

  it("fails integrity without deleting the original", async () => {
    const { app, cookie, source } = await setup({ failIntegrity: true });
    const sid = (await app.request("/api/suggestions", { headers: { cookie } }).then((r) => r.json())).items[0].id;
    await app.request("/api/queue", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ suggestionId: sid }),
    });
    await waitForQueue(app, cookie, (items) => items[0]?.status === "failed");
    expect(readFileSync(source, "utf8")).toContain("ORIGINAL");
    const jobs = await app.request("/api/jobs", { headers: { cookie } }).then((r) => r.json());
    expect(jobs.items[0].status).toBe("failed");
    const reviews = await app.request("/api/review", { headers: { cookie } }).then((r) => r.json());
    expect(reviews.items).toHaveLength(0);
  });

  it("replaces across devices with a storage-aware move", async () => {
    const { store, source, review } = await setup();
    const item = store.listLibraryItems("movie")[0];
    const sidecar = join(review, "x.mkv");
    writeFileSync(sidecar, "NEW");
    store.createReview({
      itemId: item.id,
      jobId: 1,
      sourcePath: source,
      sidecarPath: sidecar,
      compare: {},
    });
    const { JobService } = await import("./jobs.ts");
    const copied: string[] = [];
    let renames = 0;
    const jobs = new JobService(
      store,
      async () => {
        throw new Error("unused");
      },
      fetch,
      {
        rename: async (src, dest) => {
          renames += 1;
          if (renames === 1) throw Object.assign(new Error("EXDEV"), { code: "EXDEV" });
          writeFileSync(dest, readFileSync(src));
        },
        unlink: async () => undefined,
        mkdir: async () => undefined,
        stat: async () => ({ size: 1 }) as never,
      },
      undefined,
      () => new Date(),
      () => ({
        copy: async (src, dest) => {
          copied.push(`${src} -> ${dest}`);
          writeFileSync(dest, "NEW");
          return { method: "ssh", bytes: 3 };
        },
        move: async () => ({ method: "ssh" as const, bytes: 3 }),
      }),
    );
    const result = await jobs.keep(store.listReviews()[0].id as number);
    expect(result.ok).toBe(true);
    expect(copied).toEqual([`${sidecar} -> ${source}.optimizarr-replacement-1`]);
    expect(readFileSync(source, "utf8")).toBe("NEW");
  });

  it("keeps the original and sidecar when a cross-device copy stops early", async () => {
    const { store, source, review } = await setup();
    const item = store.listLibraryItems("movie")[0];
    const sidecar = join(review, "x.mkv");
    writeFileSync(sidecar, "NEW");
    store.createReview({ itemId: item.id, jobId: 1, sourcePath: source, sidecarPath: sidecar, compare: {} });
    const jobs = new JobService(
      store,
      async () => {
        throw new Error("unused");
      },
      fetch,
      {
        rename: async () => {
          throw Object.assign(new Error("EXDEV"), { code: "EXDEV" });
        },
        unlink: async () => undefined,
        mkdir: async () => undefined,
        stat: async () => ({ size: 1 }) as never,
      },
      undefined,
      () => new Date(),
      () => ({
        copy: async (_src, dest) => {
          writeFileSync(dest, "PARTIAL");
          throw new Error("connection reset");
        },
        move: async () => ({ method: "proxy" as const, bytes: 0 }),
      }),
    );
    const result = await jobs.keep(store.listReviews()[0].id as number);
    expect(result).toMatchObject({ ok: false, error: "connection reset" });
    expect(readFileSync(source, "utf8")).toContain("ORIGINAL");
    expect(readFileSync(sidecar, "utf8")).toBe("NEW");
  });

  it("keeps both files when Keep cannot replace the original", async () => {
    const { store, source, review } = await setup();
    const item = store.listLibraryItems("movie")[0];
    const sidecar = join(review, "x.mkv");
    writeFileSync(sidecar, "NEW");
    store.createReview({
      itemId: item.id,
      jobId: 1,
      sourcePath: source,
      sidecarPath: sidecar,
      compare: {},
    });
    const { JobService } = await import("./jobs.ts");
    const jobs = new JobService(store, async () => {
      throw new Error("unused");
    }, fetch, {
      rename: async () => {
        throw new Error("EACCES");
      },
      unlink: async () => undefined,
      mkdir: async () => undefined,
      stat: async () => ({ size: 1 }) as never,
    });
    const result = await jobs.keep(store.listReviews()[0].id as number);
    expect(result.ok).toBe(false);
    expect(readFileSync(source, "utf8")).toContain("ORIGINAL");
    expect(readFileSync(sidecar, "utf8")).toBe("NEW");
  });

  it("returns a failed Keep to pending with the error on the card", async () => {
    const { app, cookie, source } = await setup({
      makeJobs: (store, optimize, fetchImpl) =>
        new JobService(store, optimize, fetchImpl, {
          rename: async () => {
            throw new Error("EACCES");
          },
          unlink: async () => undefined,
          mkdir: async () => undefined,
          stat: async () => ({ size: 1 }) as never,
        }),
    });
    const sid = (await app.request("/api/suggestions", { headers: { cookie } }).then((r) => r.json())).items[0].id;
    await app.request("/api/queue", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ suggestionId: sid }),
    });
    await waitForQueue(app, cookie, (items) => items[0]?.status === "succeeded");
    const review = (await app.request("/api/review", { headers: { cookie } }).then((r) => r.json())).items[0];
    const keep = await app.request(`/api/review/${review.id}/keep`, { method: "POST", headers: { cookie } });
    expect(keep.status).toBe(202);
    const listed = await waitForReview(app, cookie, (items) => items[0]?.status === "pending" && Boolean(items[0]?.error));
    expect(listed[0].error).toMatch(/EACCES/);
    expect(readFileSync(source, "utf8")).toContain("ORIGINAL");
    expect(existsSync(String(review.sidecarPath))).toBe(true);
  });

  it("Discard leaves the original and removes the sidecar", async () => {
    const { app, cookie, source } = await setup();
    const sid = (await app.request("/api/suggestions", { headers: { cookie } }).then((r) => r.json())).items[0].id;
    await app.request("/api/queue", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ suggestionId: sid }),
    });
    await waitForQueue(app, cookie, (items) => items[0]?.status === "succeeded");
    const review = (await app.request("/api/review", { headers: { cookie } }).then((r) => r.json())).items[0];
    const disc = await app.request(`/api/review/${review.id}/discard`, { method: "POST", headers: { cookie } });
    expect(disc.status).toBe(200);
    expect(readFileSync(source, "utf8")).toContain("ORIGINAL");
    expect(await app.request("/api/review", { headers: { cookie } }).then((r) => r.json())).toMatchObject({
      items: [],
    });
  });

  it("keeps a review pending when Discard cannot delete its sidecar", async () => {
    const { store, source, review } = await setup();
    const item = store.listLibraryItems("movie")[0];
    const sidecar = join(review, "x.mkv");
    writeFileSync(sidecar, "NEW");
    store.createReview({ itemId: item.id, jobId: 1, sourcePath: source, sidecarPath: sidecar, compare: {} });
    const jobs = new JobService(store, async () => {
      throw new Error("unused");
    }, fetch, {
      rename: async () => undefined,
      unlink: async () => {
        throw Object.assign(new Error("permission denied"), { code: "EACCES" });
      },
      mkdir: async () => undefined,
      stat: async () => ({ size: 1 }) as never,
    });
    expect(await jobs.discard(store.listReviews()[0].id as number)).toEqual({ ok: false, error: "permission denied" });
    expect(store.listReviews()).toHaveLength(1);
    expect(readFileSync(sidecar, "utf8")).toBe("NEW");
  });

  it("returns Keep before a slow move finishes and rejects a second Keep", async () => {
    let release!: () => void;
    let keepRenames = 0;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { app, cookie, source } = await setup({
      makeJobs: (store, optimize, fetchImpl) =>
        new JobService(
          store,
          optimize,
          fetchImpl,
          {
            rename: async (src, dest) => {
              keepRenames += 1;
              if (keepRenames === 1) throw Object.assign(new Error("EXDEV"), { code: "EXDEV" });
              writeFileSync(dest, readFileSync(src));
            },
            unlink: async () => undefined,
            mkdir: async () => undefined,
            stat: async () => ({ size: 1 }) as never,
          },
          undefined,
          () => new Date(),
          () => ({
            copy: async (src, dest) => {
              await gate;
              writeFileSync(dest, readFileSync(src));
              return { method: "ssh" as const, bytes: 1 };
            },
            move: async () => ({ method: "ssh" as const, bytes: 1 }),
          }),
        ),
    });
    const sid = (await app.request("/api/suggestions", { headers: { cookie } }).then((r) => r.json())).items[0].id;
    await app.request("/api/queue", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ suggestionId: sid }),
    });
    await waitForQueue(app, cookie, (items) => items[0]?.status === "succeeded");
    const review = (await app.request("/api/review", { headers: { cookie } }).then((r) => r.json())).items[0];
    const keep = await app.request(`/api/review/${review.id}/keep`, { method: "POST", headers: { cookie } });
    expect(keep.status).toBe(202);
    expect(readFileSync(source, "utf8")).toContain("ORIGINAL");
    const listed = await app.request("/api/review", { headers: { cookie } }).then((r) => r.json());
    expect(listed.items[0].status).toBe("keeping");
    expect(listed.items[0].phaseLabel).toMatch(/sidecar/i);
    const second = await app.request(`/api/review/${review.id}/keep`, { method: "POST", headers: { cookie } });
    expect(second.status).toBe(409);
    release();
    await waitForReview(app, cookie, (items) => items.length === 0);
    expect(readFileSync(source, "utf8")).toBe("SIDECAR-OUTPUT");
  });
});
