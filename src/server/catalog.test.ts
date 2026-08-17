import { mkdtempSync, rmSync } from "node:fs";
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

const probes: Record<string, Record<string, unknown>> = {
  "/ok.mkv": {
    format: { duration: "3600", size: String(1 * 1024 ** 3) },
    streams: [
      { codec_type: "video", codec_name: "hevc", width: 1920, height: 1080 },
      { codec_type: "audio", codec_name: "aac", channels: 2, tags: { language: "eng" } },
    ],
  },
  "/big.mkv": {
    format: { duration: "3600", size: String(10 * 1024 ** 3) },
    streams: [
      { codec_type: "video", codec_name: "h264", width: 1920, height: 1080 },
      { codec_type: "audio", codec_name: "aac", channels: 2, tags: { language: "eng" } },
      { codec_type: "subtitle", codec_name: "subrip", tags: { language: "spa" } },
    ],
  },
};

describe("phase 3 catalog", () => {
  const dirs: string[] = [];
  const stores: Store[] = [];

  afterEach(() => {
    for (const s of stores.splice(0)) s.close();
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  async function setup() {
    const dir = mkdtempSync(join(tmpdir(), "optimizarr-"));
    dirs.push(dir);
    const store = new Store(dir);
    stores.push(store);
    const fetchImpl = async (url: string) => {
      if (url.endsWith("/status")) return Response.json({ version: "1" });
      return Response.json([
        { id: 1, title: "Healthy", movieFile: { path: "/ok.mkv", size: 1 } },
        { id: 2, title: "Giant AVC", movieFile: { path: "/big.mkv", size: 10 } },
      ]);
    };
    const probe = (path: string) => parseFfprobe(path, probes[path]);
    const catalog = new Catalog(store, probe);
    const sync = new LibrarySync(store, new ArrClient(fetchImpl), () => true);
    sync.catalog = catalog;
    const app = createApp(store, { fetchImpl, pathReadable: () => true, sync, catalog, probe });
    const first = await app.request("/api/setup/first-run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "correct-horse", preferredLanguage: "eng" }),
    });
    await app.request("/api/instances", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: cookieHeader(first) },
      body: JSON.stringify({ kind: "radarr", name: "R", url: "http://r", apiKey: "k" }),
    });
    await app.request("/api/library/refresh", { method: "POST", headers: { cookie: cookieHeader(first) } });
    await catalog.inspectPending();
    return { app, store, catalog, cookie: cookieHeader(first) };
  }

  it("lists only items with work and hides healthy files", async () => {
    const { app, cookie } = await setup();
    const res = await app.request("/api/suggestions", { headers: { cookie } });
    const body = await res.json();
    expect(body.items.map((i: { title: string }) => i.title)).toEqual(["Giant AVC"]);
    expect(body.items[0].actions).toContain("transcode");
    expect(body.items[0].estimatedSavingsBytes).toBeGreaterThan(0);
    expect(body.items[0].reasons.some((line: string) => /H\.264/.test(line) && /HEVC/.test(line))).toBe(true);
    expect(body.items[0].now.codec).toBe("h264");
    expect(body.items[0].after.codec).toBe("hevc");
  });

  it("shows show, season, and episode title on a series suggestion", async () => {
    const { app, store, cookie } = await setup();
    store.createArrInstance({ kind: "sonarr", name: "Sonarr", url: "http://s", apiKey: "k" });
    const sonarr = store.listArrInstances().find((i) => i.kind === "sonarr");
    store.upsertLibraryItem({
      instanceId: sonarr!.id,
      externalId: 11,
      seriesId: 3,
      type: "episode",
      title: "(I Don’t Want to Go to) Chelsea",
      seriesTitle: "Ted Lasso",
      seasonNumber: 3,
      episodeNumber: 2,
      path: "/big.mkv",
      folderPath: null,
      quality: "WEBDL-1080p",
      videoCodec: "h264",
      resolution: "1080",
      hdr: null,
      size: 10,
      readable: true,
      pathError: null,
      updatedAt: new Date().toISOString(),
    });
    const catalog = new Catalog(store, (path) => parseFfprobe(path, probes[path]));
    const episode = store.listLibraryItems("episode")[0];
    await catalog.inspectItem(episode.id);
    const listed = await app.request("/api/suggestions", { headers: { cookie } }).then((r) => r.json());
    const row = listed.items.find((i: { title: string }) => i.title.includes("Chelsea"));
    expect(row.displayTitle).toBe("Ted Lasso / Season 3 / (I Don’t Want to Go to) Chelsea");
    const byShow = await app.request("/api/suggestions?q=ted%20lasso", { headers: { cookie } }).then((r) => r.json());
    expect(byShow.items.some((i: { displayTitle: string }) => i.displayTitle.includes("Chelsea"))).toBe(true);
    const byEp = await app.request("/api/suggestions?q=lasso%20s03e02", { headers: { cookie } }).then((r) => r.json());
    expect(byEp.items.some((i: { title: string }) => i.title.includes("Chelsea"))).toBe(true);
  });

  it("filters by title search", async () => {
    const { app, cookie } = await setup();
    const miss = await app.request("/api/suggestions?q=nope", { headers: { cookie } });
    expect((await miss.json()).items).toHaveLength(0);
    const hit = await app.request("/api/suggestions?q=giant", { headers: { cookie } });
    expect((await hit.json()).items).toHaveLength(1);
  });

  it("dismisses a suggestion and can force a healthy file", async () => {
    const { app, cookie, store } = await setup();
    const listed = await app.request("/api/suggestions", { headers: { cookie } }).then((r) => r.json());
    await app.request(`/api/suggestions/${listed.items[0].id}/dismiss`, { method: "POST", headers: { cookie } });
    const after = await app.request("/api/suggestions", { headers: { cookie } }).then((r) => r.json());
    expect(after.items).toHaveLength(0);

    const healthy = store.listLibraryItems("movie").find((i) => i.title === "Healthy");
    const forceRes = await app.request(`/api/library/items/${healthy!.id}/force`, { method: "POST", headers: { cookie } });
    expect(forceRes.status).toBe(200);
    expect((await forceRes.json()).onSuggestions).toBe(true);
    const forced = await app.request("/api/suggestions", { headers: { cookie } }).then((r) => r.json());
    expect(forced.items.some((i: { title: string }) => i.title === "Healthy")).toBe(true);

    const stereo = await app.request(`/api/library/items/${healthy!.id}/stereo`, { method: "POST", headers: { cookie } });
    expect(stereo.status).toBe(400);
    expect((await stereo.json()).error).toMatch(/stereo/i);
  });

  it("returns refresh before probes finish and lists movies immediately", async () => {
    const dir = mkdtempSync(join(tmpdir(), "optimizarr-"));
    dirs.push(dir);
    const store = new Store(dir);
    stores.push(store);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const probed: string[] = [];
    const probe = async (path: string) => {
      probed.push(path);
      await gate;
      return parseFfprobe(path, probes[path]);
    };
    const fetchImpl = async (url: string) => {
      if (url.endsWith("/status")) return Response.json({ version: "1" });
      return Response.json([
        { id: 1, title: "Healthy", movieFile: { path: "/ok.mkv", size: 1 } },
        { id: 2, title: "Giant AVC", movieFile: { path: "/big.mkv", size: 10 } },
      ]);
    };
    const catalog = new Catalog(store, probe);
    const sync = new LibrarySync(store, new ArrClient(fetchImpl), () => true);
    const app = createApp(store, { fetchImpl, pathReadable: () => true, sync, catalog, probe });
    const first = await app.request("/api/setup/first-run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "correct-horse", preferredLanguage: "eng" }),
    });
    const cookie = cookieHeader(first);
    await app.request("/api/instances", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ kind: "radarr", name: "R", url: "http://r", apiKey: "k" }),
    });
    const refresh = await app.request("/api/library/refresh", { method: "POST", headers: { cookie } });
    expect(refresh.status).toBe(200);
    const refreshBody = await refresh.json();
    expect(refreshBody.movies).toBe(2);
    expect(refreshBody.inspect.walking).toBe(true);
    const movies = await app.request("/api/library/movies", { headers: { cookie } }).then((r) => r.json());
    expect(movies.items).toHaveLength(2);
    expect(movies.items.map((i: { title: string }) => i.title).sort()).toEqual(["Giant AVC", "Healthy"]);
    const before = await app.request("/api/suggestions", { headers: { cookie } }).then((r) => r.json());
    expect(before.items).toHaveLength(0);
    release();
    await catalog.inspectPending();
    const after = await app.request("/api/suggestions", { headers: { cookie } }).then((r) => r.json());
    expect(after.items.map((i: { title: string }) => i.title)).toEqual(["Giant AVC"]);
    expect(probed.sort()).toEqual(["/big.mkv", "/ok.mkv"]);
  });

  it("skips ffprobe when path and size are unchanged and re-probes a size change", async () => {
    const { store, catalog } = await setup();
    const probed: string[] = [];
    const counting = new Catalog(store, (path) => {
      probed.push(path);
      return parseFfprobe(path, probes[path]);
    });
    expect(await counting.inspectPending()).toBe(0);
    expect(probed).toEqual([]);

    const item = store.listLibraryItems("movie").find((row) => row.title === "Giant AVC");
    store.upsertLibraryItem({ ...item!, size: 99 });
    expect(await counting.inspectPending()).toBe(1);
    expect(probed).toEqual(["/big.mkv"]);
  });

  it("reports inspect progress on GET /api/library/inspect", async () => {
    const { app, cookie, catalog } = await setup();
    const progress = await app.request("/api/library/inspect", { headers: { cookie } }).then((r) => r.json());
    expect(progress.pending).toBe(0);
    expect(progress.inspected).toBeGreaterThan(0);
    expect(progress.walking).toBe(false);
    expect(catalog.progress().errors).toBe(0);
  });

  it("records a failed probe once and ends the walk", async () => {
    const { store } = await setup();
    store.createArrInstance({ kind: "radarr", name: "R2", url: "http://r2", apiKey: "k" });
    const inst = store.listArrInstances().find((row) => row.name === "R2");
    store.upsertLibraryItem({
      instanceId: inst!.id,
      externalId: 99,
      seriesId: null,
      type: "movie",
      title: "Broken",
      seriesTitle: null,
      seasonNumber: null,
      episodeNumber: null,
      path: "/bad.mkv",
      folderPath: null,
      quality: null,
      videoCodec: null,
      resolution: null,
      hdr: null,
      size: 1,
      readable: true,
      pathError: null,
      updatedAt: new Date().toISOString(),
    });
    let badProbes = 0;
    const catalog = new Catalog(store, (path) => {
      if (path === "/bad.mkv") {
        badProbes += 1;
        throw new Error("ffprobe failed");
      }
      return parseFfprobe(path, {
        format: { duration: "1", size: "1" },
        streams: [{ codec_type: "video", codec_name: "hevc", width: 1920, height: 1080 }],
      });
    });
    expect(await catalog.inspectPending()).toBeGreaterThan(0);
    const first = catalog.progress();
    expect(first.walking).toBe(false);
    expect(first.errors).toBe(1);
    expect(first.pending).toBe(0);
    expect(first.errors).toBeLessThanOrEqual(first.total);
    expect(badProbes).toBe(1);
    expect(await catalog.inspectPending()).toBe(0);
    expect(badProbes).toBe(1);
    expect(catalog.progress().errors).toBe(1);
  });
});
