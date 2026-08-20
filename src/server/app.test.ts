import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app.ts";
import { loadEnv } from "./env.ts";
import { isoListedFfmpeg } from "./fixtures/index.ts";
import type { HardwareInfo } from "./types.ts";

function cookie(res: Response): string {
  const raw = res.headers.get("set-cookie") ?? "";
  return raw.split(";")[0] ?? "";
}

async function setup() {
  const dir = mkdtempSync(join(tmpdir(), "opt-"));
  const env = loadEnv({ CONFIG_DIR: dir, PORT: "7373" });
  let probeCalls = 0;
  const hw: HardwareInfo = { backend: "cuda", cuda: true, vaapi: false, av1: false, reason: null };
  const created = createApp({
    env,
    hardware: async () => hw,
    readable: async () => true,
    probe: async () => {
      probeCalls += 1;
      return {
        format: { duration: "3600" },
        streams: [
          { codec_type: "video", codec_name: "h264", width: 1920, height: 1080 },
          { codec_type: "audio", codec_name: "aac", channels: 6, tags: { language: "eng" }, index: 1 },
          { codec_type: "audio", codec_name: "aac", channels: 2, tags: { language: "spa" }, index: 2 },
        ],
      };
    },
    fetch: (async (url: string) => {
      if (String(url).includes("/movie")) {
        return new Response(
          JSON.stringify([
            {
              id: 10,
              title: "American Underdog",
              path: "/mnt/nas/movies/underdog.mkv",
              sizeOnDisk: 8_000_000_000,
              movieFile: { path: "/mnt/nas/movies/underdog.mkv", size: 8_000_000_000, quality: { quality: { name: "Bluray-1080p" } } },
              images: [{ coverType: "poster", url: "http://radarr/poster.jpg" }],
            },
          ]),
        );
      }
      if (String(url).includes("system/status")) return new Response(JSON.stringify({ appName: "Radarr", version: "5" }));
      return new Response("{}", { status: 404 });
    }) as typeof fetch,
    optimizer: async (req) => ({
      sidecarPath: join(dir, "sidecar.mkv"),
      output: {
        ...req.report,
        videoCodec: "hevc",
        sizeBytes: 3_000_000_000,
        sizePerHourGb: 3,
      },
    }),
  });
  return { app: created, store: created.store, dir, probeCalls: () => probeCalls };
}

describe("public HTTP behavior", () => {
  const apps: Array<{ store: { close: () => void }; app: { jobs: { stop: () => void } } }> = [];
  afterEach(() => {
    for (const a of apps) {
      a.app.jobs.stop();
      a.store.close();
    }
    apps.length = 0;
  });

  it("boots health without secrets", async () => {
    const ctx = await setup();
    apps.push(ctx);
    const res = await ctx.app.app.request("/api/health");
    expect(await res.json()).toEqual({ ok: true, service: "optimizarr" });
  });

  it("rejects a wrong login with one generic error", async () => {
    const ctx = await setup();
    apps.push(ctx);
    await ctx.app.app.request("/api/auth/setup", { method: "POST", body: JSON.stringify({ username: "ada", password: "secret12" }) });
    const res = await ctx.app.app.request("/api/auth/login", { method: "POST", body: JSON.stringify({ username: "ada", password: "nope" }) });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Username or password is wrong." });
  });

  it("gates optimize until language is confirmed and never echoes API keys", async () => {
    const ctx = await setup();
    apps.push(ctx);
    const setupRes = await ctx.app.app.request("/api/auth/setup", { method: "POST", body: JSON.stringify({ username: "ada", password: "secret12" }) });
    const headers = { cookie: cookie(setupRes) };
    const denied = await ctx.app.app.request("/api/queue", { method: "POST", headers, body: JSON.stringify({ itemId: "x" }) });
    expect(denied.status).toBe(403);

    await ctx.app.app.request("/api/integrations", {
      method: "POST",
      headers,
      body: JSON.stringify({ kind: "radarr", name: "Radarr", url: "http://radarr:7878", apiKey: "super-secret-key", enabled: true }),
    });
    const listed = await ctx.app.app.request("/api/settings", { headers });
    const body = (await listed.json()) as { instances: Array<{ hasApiKey: boolean; apiKey?: string }>; writeMode?: string };
    expect(body.instances[0]?.hasApiKey).toBe(true);
    expect(JSON.stringify(body)).not.toContain("super-secret-key");
    expect(body.writeMode ?? "sidecar").toBe("sidecar");

    await ctx.app.app.request("/api/settings", {
      method: "PUT",
      headers,
      body: JSON.stringify({ languageConfirmed: true, preferredLanguage: "eng", reviewPath: join(ctx.dir, "review") }),
    });
    const refresh = await ctx.app.app.request("/api/library/refresh", { method: "POST", headers });
    expect(refresh.status).toBe(200);
    const movies = await ctx.app.app.request("/api/library/movies", { headers });
    const list = (await movies.json()) as { items: Array<{ title: string; path: string; inspected: boolean }> };
    expect(list.items[0]?.title).toBe("American Underdog");
    expect(list.items[0]?.path).toBe("/mnt/nas/movies/underdog.mkv");
  });

  it("accepts enqueue while a runner is still working and rejects a second Keep", async () => {
    const ctx = await setup();
    apps.push(ctx);
    const setupRes = await ctx.app.app.request("/api/auth/setup", { method: "POST", body: JSON.stringify({ username: "ada", password: "secret12" }) });
    const headers = { cookie: cookie(setupRes) };
    await ctx.app.app.request("/api/integrations", {
      method: "POST",
      headers,
      body: JSON.stringify({ kind: "radarr", name: "Radarr", url: "http://radarr:7878", apiKey: "k", enabled: true }),
    });
    await ctx.app.app.request("/api/settings", {
      method: "PUT",
      headers,
      body: JSON.stringify({ languageConfirmed: true, preferredLanguage: "eng", reviewPath: join(ctx.dir, "review") }),
    });
    await ctx.app.app.request("/api/library/refresh", { method: "POST", headers });
    await ctx.app.inspectPending();
    const suggestions = await ctx.app.app.request("/api/suggestions", { headers });
    const sug = (await suggestions.json()) as { items: Array<{ id: string }> };
    expect(sug.items.length).toBeGreaterThan(0);
    const queued = await ctx.app.app.request("/api/queue", { method: "POST", headers, body: JSON.stringify({ suggestionId: sug.items[0].id }) });
    expect(queued.status).toBe(200);
  });

  it("rejects enqueue without a session after first-run is complete", async () => {
    const ctx = await setup();
    apps.push(ctx);
    const setupRes = await ctx.app.app.request("/api/auth/setup", { method: "POST", body: JSON.stringify({ username: "ada", password: "secret12" }) });
    const headers = { cookie: cookie(setupRes) };
    await ctx.app.app.request("/api/integrations", {
      method: "POST",
      headers,
      body: JSON.stringify({ kind: "radarr", name: "Radarr", url: "http://radarr:7878", apiKey: "k", enabled: true }),
    });
    await ctx.app.app.request("/api/settings", {
      method: "PUT",
      headers,
      body: JSON.stringify({ languageConfirmed: true, preferredLanguage: "eng", reviewPath: join(ctx.dir, "review") }),
    });
    const res = await ctx.app.app.request("/api/queue", { method: "POST", body: JSON.stringify({ itemId: "missing" }) });
    expect(res.status).toBe(401);
  });

  it("rejects minting a widget key without a session", async () => {
    const ctx = await setup();
    apps.push(ctx);
    await ctx.app.app.request("/api/auth/setup", { method: "POST", body: JSON.stringify({ username: "ada", password: "secret12" }) });
    const res = await ctx.app.app.request("/api/settings/widget-key", { method: "POST" });
    expect(res.status).toBe(401);
    expect(JSON.stringify(await res.json())).not.toMatch(/[a-f0-9]{32}/);
  });

  it("requires a widget key on a public address", async () => {
    const ctx = await setup();
    apps.push(ctx);
    const res = await ctx.app.app.request("/api/widget", { headers: { "x-real-ip": "8.8.8.8" } });
    expect(res.status).toBe(401);
    expect(JSON.stringify(await res.json())).not.toContain("/mnt/nas");
  });

  it("lists ISO files with ffmpeg and never calls ffprobe", async () => {
    const dir = mkdtempSync(join(tmpdir(), "opt-"));
    const env = loadEnv({ CONFIG_DIR: dir, PORT: "7373" });
    let probeCalls = 0;
    let isoCalls = 0;
    const created = createApp({
      env,
      hardware: async () => ({ backend: "cuda", cuda: true, vaapi: false, av1: false, reason: null }),
      readable: async () => true,
      probe: async () => {
        probeCalls += 1;
        return { format: { duration: "3600" }, streams: [] };
      },
      listIso: async () => {
        isoCalls += 1;
        return isoListedFfmpeg;
      },
      fetch: (async () => new Response("[]")) as typeof fetch,
    });
    apps.push({ store: created.store, app: created });
    const setupRes = await created.app.request("/api/auth/setup", { method: "POST", body: JSON.stringify({ username: "ada", password: "secret12" }) });
    const headers = { cookie: cookie(setupRes) };
    await created.app.request("/api/integrations", {
      method: "POST",
      headers,
      body: JSON.stringify({ kind: "radarr", name: "Radarr", url: "http://radarr:7878", apiKey: "k", enabled: true }),
    });
    const instanceId = created.store.listInstances()[0]?.id ?? "";
    created.store.upsertItem({
      id: `${instanceId}:movie:iso`,
      instanceId,
      arrId: 99,
      arrSeriesId: null,
      arrEpisodeFileId: null,
      type: "movie",
      title: "Disc",
      showTitle: null,
      season: null,
      episode: null,
      episodeTitle: null,
      path: "/mnt/nas/discs/Example.ISO",
      sizeBytes: 19_000_000_000,
      quality: "Bluray-1080p",
      resolution: "1080",
      profile: "HD",
      tags: [],
      posterRemoteUrl: null,
      sizeExempt: false,
    });
    await created.inspectPending();
    expect(isoCalls).toBe(1);
    expect(probeCalls).toBe(0);
    const report = created.store.getInspection(`${instanceId}:movie:iso`);
    expect(report?.sourceMethod).toBe("iso_ffmpeg");
    expect(report?.listingState).toBe("complete");
    expect(created.store.listErrors()).toHaveLength(0);
  });

  it("returns profile previews and sends search to title pages", async () => {
    const ctx = await setup();
    apps.push(ctx);
    const setupRes = await ctx.app.app.request("/api/auth/setup", { method: "POST", body: JSON.stringify({ username: "ada", password: "secret12" }) });
    const headers = { cookie: cookie(setupRes) };
    await ctx.app.app.request("/api/integrations", {
      method: "POST",
      headers,
      body: JSON.stringify({ kind: "radarr", name: "Radarr", url: "http://radarr:7878", apiKey: "k", enabled: true }),
    });
    await ctx.app.app.request("/api/settings", {
      method: "PUT",
      headers,
      body: JSON.stringify({ languageConfirmed: true, preferredLanguage: "eng", reviewPath: join(ctx.dir, "review") }),
    });
    await ctx.app.app.request("/api/library/refresh", { method: "POST", headers });
    const settings = (await (await ctx.app.app.request("/api/settings", { headers })).json()) as { profilePreviews?: Array<{ name: string }>; writeMode?: string };
    expect(settings.writeMode).toBe("sidecar");
    expect(settings.profilePreviews?.[0]?.name).toMatch(/^Optimizarr /);
    const search = (await (await ctx.app.app.request("/api/search?q=underdog", { headers })).json()) as { items: Array<{ href: string }> };
    expect(search.items[0]?.href).toMatch(/^\/movies\//);
  });

  it("rejects a do-nothing custom plan with a field error", async () => {
    const ctx = await setup();
    apps.push(ctx);
    const setupRes = await ctx.app.app.request("/api/auth/setup", { method: "POST", body: JSON.stringify({ username: "ada", password: "secret12" }) });
    const headers = { cookie: cookie(setupRes) };
    await ctx.app.app.request("/api/integrations", {
      method: "POST",
      headers,
      body: JSON.stringify({ kind: "radarr", name: "Radarr", url: "http://radarr:7878", apiKey: "k", enabled: true }),
    });
    await ctx.app.app.request("/api/settings", {
      method: "PUT",
      headers,
      body: JSON.stringify({ languageConfirmed: true, preferredLanguage: "eng", reviewPath: join(ctx.dir, "review") }),
    });
    await ctx.app.app.request("/api/library/refresh", { method: "POST", headers });
    await ctx.app.inspectPending();
    const movies = (await (await ctx.app.app.request("/api/library/movies", { headers })).json()) as { items: Array<{ id: string; videoLabel?: string }> };
    const id = movies.items[0]?.id ?? "";
    expect(movies.items[0]?.videoLabel).toMatch(/h264/i);
    const empty = await ctx.app.app.request(`/api/library/items/${id}/plan`, { method: "POST", headers, body: JSON.stringify({ draft: {} }) });
    expect(empty.status).toBe(400);
    const body = (await empty.json()) as { errors?: Array<{ field: string }> };
    expect(body.errors?.[0]?.field).toBe("plan");
  });

  it("ends inspect after unreadable files and does not leave pending work", async () => {
    const dir = mkdtempSync(join(tmpdir(), "opt-"));
    const env = loadEnv({ CONFIG_DIR: dir, PORT: "7373" });
    let missingReads = 0;
    const created = createApp({
      env,
      hardware: async () => ({ backend: "cuda", cuda: true, vaapi: false, av1: false, reason: null }),
      readable: async (path) => {
        if (path.includes("missing")) missingReads += 1;
        return !path.includes("missing");
      },
      probe: async () => ({
        format: { duration: "3600" },
        streams: [{ codec_type: "video", codec_name: "h264", width: 1920, height: 1080 }],
      }),
      fetch: (async () => new Response("[]")) as typeof fetch,
    });
    apps.push({ store: created.store, app: created });
    const setupRes = await created.app.request("/api/auth/setup", { method: "POST", body: JSON.stringify({ username: "ada", password: "secret12" }) });
    const headers = { cookie: cookie(setupRes) };
    await created.app.request("/api/integrations", {
      method: "POST",
      headers,
      body: JSON.stringify({ kind: "radarr", name: "Radarr", url: "http://radarr:7878", apiKey: "k", enabled: true }),
    });
    const instanceId = created.store.listInstances()[0]?.id ?? "";
    created.store.upsertItem({
      id: `${instanceId}:movie:ok`,
      instanceId,
      arrId: 1,
      arrSeriesId: null,
      arrEpisodeFileId: null,
      type: "movie",
      title: "Ok",
      showTitle: null,
      season: null,
      episode: null,
      episodeTitle: null,
      path: "/mnt/nas/ok.mkv",
      sizeBytes: 1_000,
      quality: "HD",
      resolution: "1080",
      profile: "HD",
      tags: [],
      posterRemoteUrl: null,
      sizeExempt: false,
    });
    created.store.upsertItem({
      id: `${instanceId}:movie:missing`,
      instanceId,
      arrId: 2,
      arrSeriesId: null,
      arrEpisodeFileId: null,
      type: "movie",
      title: "Missing",
      showTitle: null,
      season: null,
      episode: null,
      episodeTitle: null,
      path: "/mnt/nas/missing.mkv",
      sizeBytes: 1_000,
      quality: "HD",
      resolution: "1080",
      profile: "HD",
      tags: [],
      posterRemoteUrl: null,
      sizeExempt: false,
    });
    await created.inspectPending();
    const state = created.store.getInspectState();
    expect(state.walking).toBe(false);
    expect(state.pending).toBe(0);
    expect(state.failed).toBe(1);
    expect(created.store.getInspection(`${instanceId}:movie:ok`)).toBeTruthy();
    expect(created.store.listErrors().some((e) => e.path.includes("missing"))).toBe(true);
    expect(missingReads).toBe(1);
    await created.inspectPending();
    expect(missingReads).toBe(1);
    expect(created.store.getInspectState().pending).toBe(0);
    expect(created.store.getInspectState().walking).toBe(false);
  });

  it("does not reset leftover count when inspect is already walking", async () => {
    const dir = mkdtempSync(join(tmpdir(), "opt-"));
    const env = loadEnv({ CONFIG_DIR: dir, PORT: "7373" });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let probes = 0;
    const created = createApp({
      env,
      hardware: async () => ({ backend: "cuda", cuda: true, vaapi: false, av1: false, reason: null }),
      readable: async () => true,
      probe: async () => {
        probes += 1;
        if (probes === 2) await gate;
        return {
          format: { duration: "3600" },
          streams: [{ codec_type: "video", codec_name: "h264", width: 1920, height: 1080 }],
        };
      },
      fetch: (async () => new Response("[]")) as typeof fetch,
    });
    apps.push({ store: created.store, app: created });
    const setupRes = await created.app.request("/api/auth/setup", { method: "POST", body: JSON.stringify({ username: "ada", password: "secret12" }) });
    const headers = { cookie: cookie(setupRes) };
    await created.app.request("/api/integrations", {
      method: "POST",
      headers,
      body: JSON.stringify({ kind: "radarr", name: "Radarr", url: "http://radarr:7878", apiKey: "k", enabled: true }),
    });
    const instanceId = created.store.listInstances()[0]?.id ?? "";
    for (const name of ["one", "two"] as const) {
      created.store.upsertItem({
        id: `${instanceId}:movie:${name}`,
        instanceId,
        arrId: name === "one" ? 1 : 2,
        arrSeriesId: null,
        arrEpisodeFileId: null,
        type: "movie",
        title: name,
        showTitle: null,
        season: null,
        episode: null,
        episodeTitle: null,
        path: `/mnt/nas/${name}.mkv`,
        sizeBytes: 1_000,
        quality: "HD",
        resolution: "1080",
        profile: "HD",
        tags: [],
        posterRemoteUrl: null,
        sizeExempt: false,
      });
    }
    const first = created.inspectPending();
    await vi.waitFor(() => {
      expect(created.store.getInspectState().pending).toBe(1);
    });
    const during = created.store.getInspectState().pending;
    const second = created.inspectPending();
    expect(created.store.getInspectState().pending).toBe(during);
    release();
    await first;
    await second;
    expect(probes).toBe(2);
    expect(created.store.getInspectState().pending).toBe(0);
    expect(created.store.getInspectState().walking).toBe(false);
  });
});
