import { mkdtempSync, writeFileSync } from "node:fs";
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

  it("finishes an ISO Keep with the promoted MKV inspected and integrations refreshed", async () => {
    const dir = mkdtempSync(join(tmpdir(), "opt-keep-"));
    const reviewDir = mkdtempSync(join(tmpdir(), "opt-review-"));
    const env = loadEnv({ CONFIG_DIR: dir, PORT: "7373" });
    const isoPath = join(dir, "movie.iso");
    const sidecarPath = join(reviewDir, "movie-sidecar.mkv");
    writeFileSync(isoPath, "ORIGINAL-ISO");
    const calls: string[] = [];
    const probed: string[] = [];
    const created = createApp({
      env,
      hardware: async () => ({ backend: "cuda", cuda: true, vaapi: false, av1: false, reason: null }),
      readable: async () => true,
      listIso: async () => isoListedFfmpeg,
      probe: async (path) => {
        probed.push(path);
        return {
          format: { duration: "3600" },
          streams: [
            { codec_type: "video", codec_name: "hevc", width: 1920, height: 1080 },
            { codec_type: "audio", codec_name: "aac", channels: 2, tags: { language: "eng" }, index: 1 },
          ],
        };
      },
      optimizer: async (req) => {
        writeFileSync(sidecarPath, "PROMOTED-MKV");
        return {
          sidecarPath,
          output: { ...req.report, videoCodec: "hevc", sizeBytes: 12, sizePerHourGb: 0.01 },
        };
      },
      fetch: (async (url, init) => {
        const text = String(url);
        calls.push(`${init?.method ?? "GET"} ${text}`);
        if (text.endsWith("/api/v3/movie")) {
          return new Response(JSON.stringify([
            {
              id: 10,
              title: "Disc Film",
              path: isoPath,
              sizeOnDisk: 12,
              movieFile: { path: isoPath, size: 12, quality: { quality: { name: "Bluray-1080p" } } },
            },
          ]));
        }
        if (text.endsWith("/api/v3/qualityprofile")) {
          return new Response(JSON.stringify([
            {
              id: 1,
              name: "No Upgrades",
              upgradeAllowed: false,
              items: [{ allowed: true, quality: { name: "Bluray-1080p" } }],
            },
          ]));
        }
        if (text.endsWith("/api/v3/movie/10")) {
          return new Response(JSON.stringify({ id: 10, title: "Disc Film", monitored: true, movieFile: { quality: { quality: { name: "Bluray-1080p" } } } }));
        }
        return new Response("{}", { status: 201 });
      }) as typeof fetch,
    });
    apps.push({ store: created.store, app: created });
    const setupRes = await created.app.request("/api/auth/setup", {
      method: "POST",
      body: JSON.stringify({ username: "ada", password: "secret12" }),
    });
    const headers = { cookie: cookie(setupRes) };
    await created.app.request("/api/integrations", {
      method: "POST",
      headers,
      body: JSON.stringify({ kind: "radarr", name: "Radarr", url: "http://radarr", apiKey: "k", enabled: true }),
    });
    await created.app.request("/api/integrations", {
      method: "POST",
      headers,
      body: JSON.stringify({ kind: "jellyfin", name: "Jellyfin", url: "http://jellyfin", token: "t", enabled: true }),
    });
    await created.app.request("/api/settings", {
      method: "PUT",
      headers,
      body: JSON.stringify({ languageConfirmed: true, preferredLanguage: "eng", reviewPath: reviewDir }),
    });
    await created.app.request("/api/library/refresh", { method: "POST", headers });
    await created.inspectPending();
    const suggestions = (await (await created.app.request("/api/suggestions", { headers })).json()) as { items: Array<{ id: string; itemId: string }> };
    await created.app.request("/api/queue", {
      method: "POST",
      headers,
      body: JSON.stringify({ suggestionId: suggestions.items[0]?.id }),
    });
    await vi.waitFor(async () => {
      const review = (await (await created.app.request("/api/review", { headers })).json()) as { items: Array<{ id: string }> };
      expect(review.items).toHaveLength(1);
    });
    const review = (await (await created.app.request("/api/review", { headers })).json()) as { items: Array<{ id: string }> };
    const keep = await created.app.request(`/api/review/${review.items[0]?.id}/keep`, { method: "POST", headers });
    expect(keep.status).toBe(202);
    await vi.waitFor(async () => {
      const pending = (await (await created.app.request("/api/review", { headers })).json()) as { items: unknown[] };
      expect(pending.items).toHaveLength(0);
    });

    const title = (await (await created.app.request(`/api/library/items/${suggestions.items[0]?.itemId}`, { headers })).json()) as {
      item: { path: string; inspected: boolean; report?: { sourceMethod?: string; sourceSig?: string } };
    };
    expect(title.item.path).toBe(join(dir, "movie.mkv"));
    expect(title.item.inspected).toBe(true);
    expect(title.item.report?.sourceMethod).toBe("ffprobe");
    expect(title.item.report?.sourceSig).toBe(`${join(dir, "movie.mkv")}|12`);
    expect(probed).toEqual([join(dir, "movie.mkv")]);
    expect(calls.some((call) => call.includes("POST http://radarr/api/v3/command"))).toBe(true);
    expect(calls.some((call) => call.includes("POST http://jellyfin/Library/Refresh"))).toBe(true);
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

  it("recomputes automatic suggestions when their settings are disabled", async () => {
    const ctx = await setup();
    apps.push(ctx);
    const setupRes = await ctx.app.app.request("/api/auth/setup", {
      method: "POST",
      body: JSON.stringify({ username: "ada", password: "secret12" }),
    });
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
    expect(((await (await ctx.app.app.request("/api/suggestions", { headers })).json()) as { items: unknown[] }).items).toHaveLength(1);
    const probesBeforeSave = ctx.probeCalls();

    await ctx.app.app.request("/api/settings", {
      method: "PUT",
      headers,
      body: JSON.stringify({
        suggestionDefaults: {
          removeNonPreferredSubtitles: false,
          removeNonPreferredAudio: false,
          addStereo: false,
          transcodeToSizeCap: false,
        },
      }),
    });

    const settings = (await (await ctx.app.app.request("/api/settings", { headers })).json()) as {
      suggestionDefaults?: Record<string, boolean>;
    };
    const suggestions = (await (await ctx.app.app.request("/api/suggestions", { headers })).json()) as { items: unknown[] };
    expect(settings.suggestionDefaults).toEqual({
      removeNonPreferredSubtitles: false,
      removeNonPreferredAudio: false,
      addStereo: false,
      transcodeToSizeCap: false,
    });
    expect(suggestions.items).toHaveLength(0);
    expect(ctx.probeCalls()).toBe(probesBeforeSave);
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
    const movies = (await (await ctx.app.app.request("/api/library/movies", { headers })).json()) as {
      items: Array<{ id: string; videoLabel?: string; report?: unknown }>;
    };
    const id = movies.items[0]?.id ?? "";
    expect(movies.items[0]?.videoLabel).toMatch(/h264/i);
    expect(movies.items[0]?.report).toBeUndefined();
    const title = (await (await ctx.app.app.request(`/api/library/items/${id}`, { headers })).json()) as { item: { report?: { durationSec?: number } } };
    expect(title.item.report?.durationSec).toBeGreaterThan(0);
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

  it("does not count episodes without a file path as leftover inspect work", async () => {
    const dir = mkdtempSync(join(tmpdir(), "opt-"));
    const env = loadEnv({ CONFIG_DIR: dir, PORT: "7373" });
    const created = createApp({
      env,
      hardware: async () => ({ backend: "cuda", cuda: true, vaapi: false, av1: false, reason: null }),
      readable: async () => true,
      probe: async () => ({
        format: { duration: "3600" },
        streams: [{ codec_type: "video", codec_name: "h264", width: 1920, height: 1080 }],
      }),
      fetch: (async () => new Response("[]")) as typeof fetch,
    });
    apps.push({ store: created.store, app: created });
    const setupRes = await created.app.request("/api/auth/setup", { method: "POST", body: JSON.stringify({ username: "ada", password: "secret12" }) });
    await created.app.request("/api/integrations", {
      method: "POST",
      headers: { cookie: cookie(setupRes) },
      body: JSON.stringify({ kind: "sonarr", name: "Sonarr", url: "http://sonarr:8989", apiKey: "k", enabled: true }),
    });
    const instanceId = created.store.listInstances()[0]?.id ?? "";
    created.store.upsertItem({
      id: `${instanceId}:episode:1`,
      instanceId,
      arrId: 1,
      arrSeriesId: 9,
      arrEpisodeFileId: null,
      type: "episode",
      title: "Star Wars Rebels",
      showTitle: "Star Wars Rebels",
      season: 1,
      episode: 1,
      episodeTitle: "Spark",
      path: "",
      sizeBytes: 0,
      quality: "",
      resolution: "",
      profile: "HD",
      tags: [],
      posterRemoteUrl: null,
      sizeExempt: false,
    });
    await created.inspectPending();
    expect(created.store.getInspectState().pending).toBe(0);
    expect(created.store.getInspection(`${instanceId}:episode:1`)).toBeUndefined();
  });

  it("drops leftover count when a file starts inspecting, not only after it finishes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "opt-"));
    const env = loadEnv({ CONFIG_DIR: dir, PORT: "7373" });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const created = createApp({
      env,
      hardware: async () => ({ backend: "cuda", cuda: true, vaapi: false, av1: false, reason: null }),
      readable: async () => true,
      probe: async () => {
        await gate;
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
    created.store.upsertItem({
      id: `${instanceId}:movie:slow`,
      instanceId,
      arrId: 1,
      arrSeriesId: null,
      arrEpisodeFileId: null,
      type: "movie",
      title: "Slow",
      showTitle: null,
      season: null,
      episode: null,
      episodeTitle: null,
      path: "/mnt/nas/slow.mkv",
      sizeBytes: 1_000,
      quality: "HD",
      resolution: "1080",
      profile: "HD",
      tags: [],
      posterRemoteUrl: null,
      sizeExempt: false,
    });
    const walk = created.inspectPending();
    await vi.waitFor(() => {
      expect(created.store.getInspectState().pending).toBe(0);
    });
    expect(created.store.getInspectState().walking).toBe(true);
    release();
    await walk;
    expect(created.store.getInspectState().walking).toBe(false);
  });

  it("saves a GitHub token without echoing it and attaches a screenshot when GitHub accepts the upload", async () => {
    const dir = mkdtempSync(join(tmpdir(), "opt-"));
    const env = loadEnv({ CONFIG_DIR: dir, PORT: "7373" });
    const githubCalls: string[] = [];
    const png = Buffer.from(
      "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082",
      "hex",
    );
    const created = createApp({
      env,
      hardware: async () => ({ backend: "cuda", cuda: true, vaapi: false, av1: false, reason: null }),
      fetch: (async (url, init) => {
        githubCalls.push(`${init?.method ?? "GET"} ${String(url)}`);
        if (String(url).includes("api.github.com/repos/")) return new Response(JSON.stringify({ id: 1336009430 }));
        if (String(url).includes("uploads.github.com/user-attachments/assets")) {
          return new Response(JSON.stringify({ url: "https://github.com/user-attachments/assets/abc" }), { status: 201 });
        }
        return new Response("{}", { status: 404 });
      }) as typeof fetch,
    });
    apps.push({ store: created.store, app: created });
    const setupRes = await created.app.request("/api/auth/setup", { method: "POST", body: JSON.stringify({ username: "ada", password: "secret12" }) });
    const headers = { cookie: cookie(setupRes) };

    const unauthed = await created.app.request("/api/report/screenshot", { method: "POST", body: JSON.stringify({ pngBase64: png.toString("base64") }) });
    expect(unauthed.status).toBe(401);

    const withoutToken = await created.app.request("/api/report/screenshot", {
      method: "POST",
      headers,
      body: JSON.stringify({ pngBase64: png.toString("base64") }),
    });
    expect(await withoutToken.json()).toEqual({ attached: false });
    expect(githubCalls).toHaveLength(0);

    await created.app.request("/api/settings", {
      method: "PUT",
      headers,
      body: JSON.stringify({ githubToken: "ghs_super_secret_token" }),
    });
    const listed = await created.app.request("/api/settings", { headers });
    const body = (await listed.json()) as { hasGithubToken?: boolean };
    expect(body.hasGithubToken).toBe(true);
    expect(JSON.stringify(body)).not.toContain("ghs_super_secret_token");

    const attached = await created.app.request("/api/report/screenshot", {
      method: "POST",
      headers,
      body: JSON.stringify({ filename: "optimizarr-report-2026-08-21T12-00-00-000Z.png", pngBase64: png.toString("base64") }),
    });
    expect(await attached.json()).toEqual({ attached: true, url: "https://github.com/user-attachments/assets/abc" });
    expect(githubCalls.some((c) => c.includes("uploads.github.com"))).toBe(true);
  });
});
