import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ArrClient } from "./arr.ts";
import { createApp, SESSION_COOKIE } from "./app.ts";
import { Store } from "./store.ts";
import { LibrarySync, UNREADABLE, noFileMessage } from "./sync.ts";
import { cookieHeader } from "./test-http.ts";

describe("phase 2 radarr sync", () => {
  const dirs: string[] = [];
  const stores: Store[] = [];
  const syncs: LibrarySync[] = [];

  afterEach(() => {
    for (const s of syncs.splice(0)) s.stop();
    for (const s of stores.splice(0)) s.close();
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  async function setup(
    movies: Record<string, unknown>[],
    opts?: { status?: number; readable?: Set<string> },
  ) {
    const dir = mkdtempSync(join(tmpdir(), "optimizarr-"));
    dirs.push(dir);
    const store = new Store(dir);
    stores.push(store);
    const fetchImpl = async (url: string) => {
      if (url.endsWith("/api/v3/system/status")) {
        if (opts?.status && opts.status >= 400) return new Response("nope", { status: opts.status });
        return Response.json({ version: "5.14.0" });
      }
      if (url.endsWith("/api/v3/movie")) return Response.json(movies);
      return new Response("missing", { status: 404 });
    };
    const readable = opts?.readable;
    const pathReadable = (p: string) => (readable ? readable.has(p) : true);
    const sync = new LibrarySync(store, new ArrClient(fetchImpl), pathReadable);
    syncs.push(sync);
    const app = createApp(store, {
      fetchImpl,
      pathReadable,
      sync,
      probe: async () => {
        throw new Error("unused probe");
      },
    });
    const first = await app.request("/api/setup/first-run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "correct-horse", preferredLanguage: "eng" }),
    });
    return { app, store, sync, cookie: cookieHeader(first) };
  }

  it("saves a Radarr instance without echoing the API key and tests the connection", async () => {
    const { app, store, cookie } = await setup([]);
    const created = await app.request("/api/instances", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        kind: "radarr",
        name: "Radarr",
        url: "http://radarr.local:7878/",
        apiKey: "secret-key",
      }),
    });
    expect(created.status).toBe(201);
    const body = await created.json();
    expect(body.apiKey).toBeUndefined();
    expect(body.hasApiKey).toBe(true);
    expect(body.url).toBe("http://radarr.local:7878");
    expect(JSON.stringify(body)).not.toContain("secret-key");
    const raw = store.db.prepare("SELECT api_key AS apiKey FROM arr_instances WHERE id = 1").get() as {
      apiKey: string;
    };
    expect(raw.apiKey.startsWith("enc:v1:")).toBe(true);
    expect(raw.apiKey).not.toContain("secret-key");
    expect(store.getArrInstance(1)?.apiKey).toBe("secret-key");

    const listed = await app.request("/api/instances", { headers: { cookie } });
    expect((await listed.json()).items[0].apiKey).toBeUndefined();

    const ok = await app.request("/api/instances/1/test", { method: "POST", headers: { cookie } });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true, version: "5.14.0" });
  });

  it("keeps both a Sonarr and a Radarr instance in the list", async () => {
    const { app, cookie } = await setup([]);
    const sonarr = await app.request("/api/instances", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ kind: "sonarr", name: "Sonarr", url: "http://sonarr.local:8989", apiKey: "s-key" }),
    });
    const radarr = await app.request("/api/instances", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ kind: "radarr", name: "Radarr", url: "http://radarr.local:7878", apiKey: "r-key" }),
    });
    expect(sonarr.status).toBe(201);
    expect(radarr.status).toBe(201);
    const a = await sonarr.json();
    const b = await radarr.json();
    expect(a.id).not.toBe(b.id);
    expect(a.kind).toBe("sonarr");
    expect(b.kind).toBe("radarr");
    const listed = await app.request("/api/instances", { headers: { cookie } }).then((r) => r.json());
    expect(listed.items).toHaveLength(2);
    expect(listed.items.map((i: { kind: string }) => i.kind).sort()).toEqual(["radarr", "sonarr"]);
  });

  it("surfaces a rejected API key on test", async () => {
    const { app, cookie } = await setup([], { status: 401 });
    await app.request("/api/instances", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        kind: "radarr",
        name: "Radarr",
        url: "http://radarr.local:7878",
        apiKey: "bad",
      }),
    });
    const test = await app.request("/api/instances/1/test", { method: "POST", headers: { cookie } });
    expect(test.status).toBe(400);
    expect((await test.json()).error).toMatch(/API key/i);
  });

  it("syncs movies with the exact Radarr path and instance name", async () => {
    const path = "/mnt/nas/Movies/Up (2009)/Up.2009.1080p.mkv";
    const { app, cookie } = await setup(
      [
        {
          id: 42,
          title: "Up",
          path: "/mnt/nas/Movies/Up (2009)",
          movieFile: {
            path,
            size: 8_000_000_000,
            quality: { quality: { name: "Bluray-1080p", resolution: 1080 } },
            mediaInfo: { videoCodec: "x264" },
          },
          images: [{ coverType: "poster", url: "/MediaCover/42/poster.jpg" }],
        },
      ],
      { readable: new Set([path]) },
    );
    await app.request("/api/instances", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        kind: "radarr",
        name: "Main Radarr",
        url: "http://radarr.local:7878",
        apiKey: "k",
      }),
    });
    const refresh = await app.request("/api/library/refresh", { method: "POST", headers: { cookie } });
    expect(refresh.status).toBe(200);
    const movies = await app.request("/api/library/movies", { headers: { cookie } });
    const payload = await movies.json();
    expect(payload.items).toHaveLength(1);
    expect(payload.items[0]).toMatchObject({
      title: "Up",
      path,
      videoCodec: "x264",
      quality: "Bluray-1080p",
      instanceName: "Main Radarr",
      readable: true,
      pathError: null,
    });
    expect(payload.items[0].path).toBe(path);
    expect(payload.items[0].hasPoster).toBe(true);
    expect(payload.items[0].posterRemoteUrl).toBeUndefined();
    expect(JSON.stringify(payload)).not.toContain("secret-key");
  });

  it("stores Arr poster URLs and proxies bytes without the API key", async () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9, 0x01, 0x02, 0x03]);
    const posterUrl = "http://radarr.local:7878/MediaCover/8/poster.jpg";
    const dir = mkdtempSync(join(tmpdir(), "optimizarr-"));
    dirs.push(dir);
    const store = new Store(dir);
    stores.push(store);
    const fetchImpl = async (url: string) => {
      if (url.endsWith("/api/v3/system/status")) return Response.json({ version: "5" });
      if (url.endsWith("/api/v3/movie")) {
        return Response.json([
          {
            id: 8,
            title: "Poster Movie",
            movieFile: { path: "/mnt/nas/Movies/Poster/file.mkv", size: 10 },
            images: [{ coverType: "poster", url: "/MediaCover/8/poster.jpg" }],
          },
        ]);
      }
      if (url === posterUrl) {
        return new Response(jpeg, { headers: { "content-type": "image/jpeg" } });
      }
      return new Response("missing", { status: 404 });
    };
    const sync = new LibrarySync(store, new ArrClient(fetchImpl), () => true);
    syncs.push(sync);
    const app = createApp(store, { fetchImpl, pathReadable: () => true, sync });
    const first = await app.request("/api/setup/first-run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "correct-horse", preferredLanguage: "eng" }),
    });
    const cookie = cookieHeader(first);
    await app.request("/api/instances", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        kind: "radarr",
        name: "Radarr",
        url: "http://radarr.local:7878",
        apiKey: "secret-key",
      }),
    });
    await app.request("/api/library/refresh", { method: "POST", headers: { cookie } });
    const item = store.listLibraryItems("movie")[0];
    expect(item.posterRemoteUrl).toBe(posterUrl);
    const poster = await app.request(`/api/library/items/${item.id}/poster`, { headers: { cookie } });
    expect(poster.status).toBe(200);
    expect(poster.headers.get("content-type")).toBe("image/jpeg");
    expect(Buffer.from(await poster.arrayBuffer()).equals(jpeg)).toBe(true);
    expect(poster.headers.get("x-api-key")).toBeNull();
    const listed = await app.request("/api/library/movies", { headers: { cookie } }).then((r) => r.json());
    expect(listed.items[0].hasPoster).toBe(true);
    expect(JSON.stringify(listed)).not.toContain("secret-key");
    expect(JSON.stringify(listed)).not.toContain(posterUrl);
  });

  it("marks an unreadable path as a volume/mount problem", async () => {
    const path = "/mnt/nas/Movies/Missing/file.mkv";
    const { app, cookie } = await setup(
      [
        {
          id: 1,
          title: "Missing",
          path: "/mnt/nas/Movies/Missing",
          movieFile: { path, size: 1, quality: { quality: { name: "HDTV-1080p" } } },
        },
      ],
      { readable: new Set() },
    );
    await app.request("/api/instances", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ kind: "radarr", name: "Radarr", url: "http://r", apiKey: "k" }),
    });
    await app.request("/api/library/refresh", { method: "POST", headers: { cookie } });
    const payload = await app.request("/api/library/movies", { headers: { cookie } }).then((r) => r.json());
    expect(payload.items[0].readable).toBe(false);
    expect(payload.items[0].pathError).toBe(UNREADABLE);
  });

  it("does not wipe movies when Radarr returns an empty list", async () => {
    const path = "/mnt/nas/Movies/Up (2009)/Up.mkv";
    const { store, sync } = await setup(
      [
        {
          id: 42,
          title: "Up",
          movieFile: { path, size: 10, quality: { quality: { name: "Bluray-1080p" } } },
        },
      ],
      { readable: new Set([path]) },
    );
    const inst = store.createArrInstance({ kind: "radarr", name: "R", url: "http://r", apiKey: "k" });
    await sync.refreshKind(inst, "movie");
    expect(store.listLibraryItems("movie")).toHaveLength(1);

    const emptyClient = {
      listMovies: async () => [],
      listEpisodes: async () => [],
    };
    const emptySync = new LibrarySync(store, emptyClient as never, () => true);
    await expect(emptySync.refreshKind(inst, "movie")).rejects.toThrow(/no movies/i);
    expect(store.listLibraryItems("movie")).toHaveLength(1);
  });

  it("names the Arr that is missing a file", () => {
    expect(noFileMessage("radarr")).toBe("Radarr has no file for this title yet.");
    expect(noFileMessage("sonarr")).toBe("Sonarr has no file for this episode yet.");
  });

  it("refreshes on an interval", async () => {
    vi.useFakeTimers();
    const path = "/library/a.mkv";
    writeFileSync(join(tmpdir(), "skip"), "");
    const { store, sync } = await setup(
      [
        {
          id: 7,
          title: "Interval",
          movieFile: { path, size: 10, quality: { quality: { name: "WEBDL-1080p" } } },
        },
      ],
      { readable: new Set([path]) },
    );
    store.createArrInstance({ kind: "radarr", name: "R", url: "http://r", apiKey: "k" });
    sync.start(1000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(store.listLibraryItems("movie")).toHaveLength(1);
    expect(store.listLibraryItems("movie")[0].title).toBe("Interval");
    sync.stop();
    vi.useRealTimers();
  });
});
