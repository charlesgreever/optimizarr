import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ArrClient } from "./arr.ts";
import { createApp } from "./app.ts";
import { Catalog } from "./catalog.ts";
import { parseFfprobe } from "./inspect.ts";
import { Store } from "./store.ts";
import { LibrarySync } from "./sync.ts";
import { cookieHeader, waitForQueue } from "./test-http.ts";
import { ffmpegOptimizer, type RemuxRequest } from "./optimize.ts";

describe("queue phase and progress", () => {
  const dirs: string[] = [];
  const stores: Store[] = [];

  afterEach(() => {
    for (const s of stores.splice(0)) s.close();
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  async function setup(optimize: (req: RemuxRequest) => Promise<{ sidecarPath: string; durationSec: number; sizeBytes: number }>) {
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
    const fetchImpl = async (url: string) => {
      if (url.endsWith("/movie")) {
        return Response.json([
          { id: 9, title: "Cleanup", movieFile: { path: source, size: 40, quality: { quality: { name: "WEBDL-1080p" } } } },
        ]);
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
    const catalog = new Catalog(store, probe);
    const sync = new LibrarySync(store, new ArrClient(fetchImpl), () => true);
    const app = createApp(store, { fetchImpl, pathReadable: () => true, sync, catalog, probe, optimize });
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
    await app.request("/api/library/refresh", { method: "POST", headers: { cookie } });
    await catalog.inspectPending();
    return { app, store, cookie, source };
  }

  async function suggestionId(app: ReturnType<typeof createApp>, cookie: string): Promise<number> {
    const listed = await app.request("/api/suggestions", { headers: { cookie } }).then((r) => r.json());
    return listed.items[0].id as number;
  }

  it("reports a remux phase and progress on GET /api/queue while the job runs", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { app, cookie } = await setup(async (req) => {
      req.onProgress?.({ phase: "remuxing", progress: 0.37, outTimeSec: 37, durationSec: 100 });
      await gate;
      const { mkdir, writeFile } = await import("node:fs/promises");
      const { dirname } = await import("node:path");
      await mkdir(dirname(req.sidecarPath), { recursive: true });
      await writeFile(req.sidecarPath, "SIDECAR");
      return { sidecarPath: req.sidecarPath, durationSec: 3600, sizeBytes: 40 };
    });
    const sid = await suggestionId(app, cookie);
    const pending = app.request("/api/queue", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ suggestionId: sid }),
    });
    let row: Record<string, unknown> | undefined;
    for (let i = 0; i < 40; i += 1) {
      const listed = await app.request("/api/queue", { headers: { cookie } }).then((r) => r.json());
      row = listed.items[0] as Record<string, unknown>;
      if (row?.phase === "remuxing") break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect(row).toMatchObject({
      status: "running",
      phase: "remuxing",
      phaseLabel: "Remuxing tracks",
    });
    expect(Number(row?.progress)).toBeCloseTo(0.37);
    expect(row?.progress).not.toBe(1);
    release();
    expect((await pending).status).toBe(201);
    const doneItems = await waitForQueue(app, cookie, (items) => items[0]?.status === "succeeded");
    const done = { items: doneItems };
    expect(done.items[0].status).toBe("succeeded");
    expect(done.items[0].progress).toBe(1);
    expect(done.items[0].phase).toBe("finishing");
  });

  it("reports real ffmpeg microsecond progress instead of jumping to 99%", async () => {
    const dir = mkdtempSync(join(tmpdir(), "optimizarr-progress-"));
    dirs.push(dir);
    const ffmpeg = join(dir, "ffmpeg");
    const release = join(dir, "release");
    writeFileSync(
      ffmpeg,
      `#!/bin/sh
dest=""
for arg in "$@"; do dest="$arg"; done
printf 'out_time_ms=1800000000\nprogress=continue\n'
while [ ! -f "${release}" ]; do sleep 0.01; done
mkdir -p "$(dirname "$dest")"
printf 'OUTPUT-MEDIA-FILE-CONTENTS-ARE-HERE-1234' > "$dest"
`,
    );
    chmodSync(ffmpeg, 0o755);
    const { app, cookie } = await setup(ffmpegOptimizer(ffmpeg));
    const sid = await suggestionId(app, cookie);

    let running: Array<Record<string, unknown>> = [];
    try {
      await app.request("/api/queue", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ suggestionId: sid }),
      });
      running = await waitForQueue(app, cookie, (items) => Number(items[0]?.progress) > 0);
    } finally {
      writeFileSync(release, "go");
      await waitForQueue(app, cookie, (items) => items[0]?.status === "succeeded");
    }

    expect(running[0].progress).toBeCloseTo(0.5);
  });

  it("keeps enqueue, status pages, and Cancel responsive while optimization is busy", async () => {
    const { app, cookie } = await setup(
      (req) =>
        new Promise((resolve, reject) => {
          req.onProgress?.({ phase: "transcoding", progress: 0.1, durationSec: 100 });
          req.signal?.addEventListener("abort", () => reject(req.signal?.reason), { once: true });
        }),
    );
    const sid = await suggestionId(app, cookie);
    const within = async <T>(promise: Promise<T>): Promise<T> => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("request exceeded 500 ms")), 500);
      });
      try {
        return await Promise.race([promise, timeout]);
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    };

    const queued = await within(
      app.request("/api/queue", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ suggestionId: sid }),
      }),
    );
    expect(queued.status).toBe(201);
    const { jobId } = (await queued.json()) as { jobId: number };

    const statusTimes: number[] = [];
    for (let sample = 0; sample < 20; sample += 1) {
      const started = performance.now();
      expect((await within(app.request("/api/jobs", { headers: { cookie } }))).status).toBe(200);
      statusTimes.push(performance.now() - started);
    }
    statusTimes.sort((a, b) => a - b);
    expect(statusTimes[Math.ceil(statusTimes.length * 0.95) - 1]).toBeLessThan(500);

    for (const path of ["/api/review", "/api/settings", "/api/library/inspect"]) {
      expect((await within(app.request(path, { headers: { cookie } }))).status).toBe(200);
    }

    const cancelled = await within(
      app.request(`/api/queue/${jobId}/cancel`, { method: "POST", headers: { cookie } }),
    );
    expect(cancelled.status).toBe(200);
    await waitForQueue(app, cookie, (items) => items[0]?.status === "cancelled");
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
  });

  it("keeps the failed phase and the original file", async () => {
    const { app, cookie, source } = await setup(async (req) => {
      req.onProgress?.({ phase: "transcoding", progress: 0.2, outTimeSec: 20, durationSec: 100 });
      throw new Error("Hardware encode failed");
    });
    const sid = await suggestionId(app, cookie);
    await app.request("/api/queue", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ suggestionId: sid }),
    });
    const listedItems = await waitForQueue(app, cookie, (items) => items[0]?.status === "failed");
    const listed = { items: listedItems };
    expect(listed.items[0]).toMatchObject({
      status: "failed",
      phase: "transcoding",
      phaseLabel: "Transcoding to HEVC",
      error: "Hardware encode failed",
    });
    expect((await import("node:fs")).readFileSync(source, "utf8")).toContain("ORIGINAL");
  });

  it("marks held jobs as waiting with no encode bar", async () => {
    const { app, cookie, store } = await setup(async () => {
      throw new Error("should not run");
    });
    store.saveSettings({ ...store.getSettings(), offPeakEnabled: true, offPeakStart: "01:00", offPeakEnd: "02:00" });
    const noon = new Date();
    noon.setHours(12, 0, 0, 0);
    const { JobService } = await import("./jobs.ts");
    const jobs = new JobService(store, async () => {
      throw new Error("should not run");
    });
    jobs.now = () => noon;
    const sid = store.listSuggestions()[0].id as number;
    await jobs.enqueue(sid);
    await jobs.processQueue();
    const listed = await app.request("/api/queue", { headers: { cookie } }).then((r) => r.json());
    expect(listed.items[0]).toMatchObject({
      status: "held",
      phase: "held",
      progress: 0,
      phaseLabel: "Waiting for the off-peak window",
    });
  });

  it("reports copy progress from the storage transfer", async () => {
    const { JobService } = await import("./jobs.ts");
    const dir = mkdtempSync(join(tmpdir(), "optimizarr-"));
    dirs.push(dir);
    const store = new Store(dir);
    stores.push(store);
    store.createAdmin("admin", "correct-horse");
    store.saveSettings({ ...store.getSettings(), languageConfirmed: true, reviewPath: join(dir, "review") });
    store.createArrInstance({ kind: "radarr", name: "R", url: "http://r", apiKey: "k" });
    const item = store.upsertLibraryItem({
      instanceId: 1,
      externalId: 1,
      seriesId: null,
      type: "movie",
      title: "Copy Me",
      seriesTitle: null,
      seasonNumber: null,
      episodeNumber: null,
      path: join(dir, "src.mkv"),
      folderPath: null,
      quality: null,
      videoCodec: "hevc",
      resolution: "1080",
      hdr: null,
      size: 100,
      readable: true,
      pathError: null,
      updatedAt: new Date().toISOString(),
    });
    writeFileSync(item.path, "x".repeat(100));
    store.saveInspection(
      item.id,
      {
        path: item.path,
        durationSec: 10,
        sizeBytes: 100,
        videoCodec: "hevc",
        bitDepth: 8,
        width: 1920,
        height: 1080,
        hdr: "sdr",
        audio: [{ type: "audio", language: "eng" }, { type: "audio", language: "spa" }],
        subtitles: [],
        attachments: 0,
      },
      new Date().toISOString(),
      `${item.path}|100`,
    );
    const sugId = store.saveSuggestion({
      itemId: item.id,
      actions: ["remux"],
      warning: null,
      estimatedSavingsBytes: null,
      overCap: false,
      extraTracks: true,
      category: "movie1080p",
      sizePerHourGb: 1,
      plan: { actions: ["remux"], category: "movie1080p" },
    });
    const seen: number[] = [];
    const jobs = new JobService(store, async (req) => {
      req.onProgress?.({ phase: "copying", progress: 0.5, copiedBytes: 50, totalBytes: 100 });
      seen.push(Number(store.getJob(store.listJobs()[0].id as number)?.progress));
      const { mkdir, writeFile } = await import("node:fs/promises");
      const { dirname } = await import("node:path");
      await mkdir(dirname(req.sidecarPath), { recursive: true });
      await writeFile(req.sidecarPath, "OUT");
      return { sidecarPath: req.sidecarPath, durationSec: 10, sizeBytes: 100 };
    });
    await jobs.enqueue(sugId);
    for (let i = 0; i < 50 && store.listJobs()[0]?.status !== "succeeded"; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(seen[0]).toBe(0.5);
    expect(store.listJobs()[0].phase).toBe("finishing");
    expect(store.listJobs()[0].progress).toBe(1);
  });
});
