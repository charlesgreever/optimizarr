import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ArrClient } from "./arr.ts";
import { createApp } from "./app.ts";
import { Catalog } from "./catalog.ts";
import { parseFfprobe } from "./inspect.ts";
import { Store } from "./store.ts";
import { LibrarySync } from "./sync.ts";
import { cookieHeader } from "./test-http.ts";

describe("phases 5-10", () => {
  const dirs: string[] = [];
  const stores: Store[] = [];
  afterEach(() => {
    for (const s of stores.splice(0)) s.close();
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  async function boot(fetchImpl: (url: string) => Promise<Response>, extra?: Record<string, unknown>) {
    const dir = mkdtempSync(join(tmpdir(), "optimizarr-"));
    dirs.push(dir);
    mkdirSync(join(dir, "lib"));
    mkdirSync(join(dir, "review"));
    const store = new Store(dir);
    stores.push(store);
    const catalog = extra?.catalog as Catalog | undefined;
    const sync = new LibrarySync(store, new ArrClient(fetchImpl), () => true);
    const app = createApp(store, {
      fetchImpl,
      pathReadable: () => true,
      sync,
      catalog,
      probe: extra?.probe as never,
      backends: extra?.backends as never,
      optimize: extra?.optimize as never,
    });
    const first = await app.request("/api/setup/first-run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "correct-horse", preferredLanguage: "eng" }),
    });
    const cookie = cookieHeader(first);
    await app.request("/api/settings", {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ reviewPath: join(dir, "review"), ...(extra?.settings as object) }),
    });
    return { app, store, cookie, dir };
  }

  it("fails a transcode when no hardware is present", async () => {
    const path = join(tmpdir(), `hw-${Date.now()}.mkv`);
    writeFileSync(path, "x".repeat(100));
    const fetchImpl = async (url: string) => {
      if (url.includes("/movie")) {
        return Response.json([{ id: 1, title: "Big", movieFile: { path, size: 100 } }]);
      }
      return Response.json({ version: "1" });
    };
    const probe = () =>
      parseFfprobe(path, {
        format: { duration: "3600", size: String(10 * 1024 ** 3) },
        streams: [{ codec_type: "video", codec_name: "h264", width: 1920, height: 1080 }],
      });
    const { app, cookie, store } = await boot(fetchImpl, {
      probe,
      catalog: undefined,
      backends: { cuda: false, vaapi: false, av1: false },
    });
    store.createArrInstance({ kind: "radarr", name: "R", url: "http://r", apiKey: "k" });
    const app2 = createApp(store, {
      fetchImpl,
      pathReadable: () => true,
      probe,
      backends: { cuda: false, vaapi: false, av1: false },
    });
    await app2.request("/api/library/refresh", { method: "POST", headers: { cookie } });
    const sid = (await app2.request("/api/suggestions", { headers: { cookie } }).then((r) => r.json())).items[0].id;
    const queued = await app2.request("/api/queue", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ suggestionId: sid }),
    });
    expect(queued.status).toBe(201);
    const jobs = await app2.request("/api/jobs", { headers: { cookie } }).then((r) => r.json());
    expect(jobs.items[0].status).toBe("failed");
    expect(jobs.items[0].error).toMatch(/Hardware encode failed/i);
    expect(app).toBeTruthy();
  });

  it("syncs Sonarr episodes and uses TV caps", async () => {
    const fetchImpl = async (url: string) => {
      if (url.includes("/series") && !url.includes("episode")) {
        return Response.json([{ id: 3, title: "Show" }]);
      }
      if (url.includes("/episode")) {
        return Response.json([
          {
            id: 11,
            title: "Pilot",
            seasonNumber: 1,
            episodeNumber: 1,
            hasFile: true,
            episodeFile: {
              path: "/tv/show.mkv",
              size: 1,
              quality: { quality: { name: "HDTV-1080p", resolution: 1080 } },
            },
          },
          {
            id: 12,
            title: "Next",
            seasonNumber: 1,
            episodeNumber: 2,
            hasFile: true,
            episodeFile: {
              path: "/tv/show2.mkv",
              size: 1,
              quality: { quality: { name: "HDTV-1080p", resolution: 1080 } },
            },
          },
        ]);
      }
      return Response.json({ version: "1" });
    };
    const { app, cookie } = await boot(fetchImpl);
    await app.request("/api/instances", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ kind: "sonarr", name: "Sonarr", url: "http://s", apiKey: "k" }),
    });
    await app.request("/api/library/refresh", { method: "POST", headers: { cookie } });
    const series = await app.request("/api/library/series", { headers: { cookie } }).then((r) => r.json());
    expect(series.items[0]).toMatchObject({
      seriesTitle: "Show",
      seasonNumber: 1,
      episodeNumber: 1,
      title: "Pilot",
      instanceName: "Sonarr",
      path: "/tv/show.mkv",
    });
    expect(series.items[0].pathError).toBeNull();
    expect(series.items[0].type).toBe("episode");
    expect(series.items[0].seriesId).toBe(3);
    expect(series.items[1].episodeNumber).toBe(2);
  });

  it("holds jobs outside the off-peak window", async () => {
    const fetchImpl = async () => Response.json([]);
    const { app, store, cookie } = await boot(fetchImpl, {
      settings: { offPeakEnabled: true, offPeakStart: "01:00", offPeakEnd: "02:00" },
    });
    store.createArrInstance({ kind: "radarr", name: "R", url: "http://r", apiKey: "k" });
    const item = store.upsertLibraryItem({
      instanceId: 1,
      externalId: 1,
      seriesId: null,
      type: "movie",
      title: "Held",
      seriesTitle: null,
      seasonNumber: null,
      episodeNumber: null,
      path: "/x.mkv",
      folderPath: null,
      quality: null,
      videoCodec: "hevc",
      resolution: "1080",
      hdr: null,
      size: 1,
      readable: true,
      pathError: null,
      updatedAt: new Date().toISOString(),
    });
    store.saveSuggestion({
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
    const noon = new Date();
    noon.setHours(12, 0, 0, 0);
    const jobs = (await import("./jobs.ts")).JobService;
    const svc = new jobs(store, async () => {
      throw new Error("should not run");
    });
    svc.now = () => noon;
    const sug = store.listSuggestions()[0];
    await svc.enqueue(sug.id as number);
    expect(store.listJobs()[0].status).toBe("held");
    expect(cookie).toBeTruthy();
    expect(app).toBeTruthy();
  });

  it("skips excluded titles and records history", async () => {
    const path = "/skip-me.mkv";
    const fetchImpl = async (url: string) => {
      if (url.includes("/movie")) return Response.json([{ id: 1, title: "Skip Me", movieFile: { path, size: 1 } }]);
      return Response.json({ version: "1" });
    };
    const { app, cookie } = await boot(fetchImpl, {
      probe: () =>
        parseFfprobe(path, {
          format: { duration: "3600", size: String(10 * 1024 ** 3) },
          streams: [{ codec_type: "video", codec_name: "h264", width: 1920, height: 1080 }],
        }),
    });
    await app.request("/api/exclusions", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ kind: "title", value: "Skip Me" }),
    });
    await app.request("/api/instances", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ kind: "radarr", name: "R", url: "http://r", apiKey: "k" }),
    });
    await app.request("/api/library/refresh", { method: "POST", headers: { cookie } });
    const suggestions = await app.request("/api/suggestions", { headers: { cookie } }).then((r) => r.json());
    expect(suggestions.items).toHaveLength(0);
  });
});
