import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import { Store } from "./store.ts";
import { cookieHeader } from "./test-http.ts";
import { authorizeWidget, widgetStatus } from "./widget.ts";

describe("homepage widget", () => {
  const dirs: string[] = [];
  const stores: Store[] = [];

  afterEach(() => {
    for (const s of stores.splice(0)) s.close();
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  async function boot() {
    const dir = mkdtempSync(join(tmpdir(), "optimizarr-"));
    dirs.push(dir);
    const store = new Store(dir);
    stores.push(store);
    const app = createApp(store, { remoteAddress: "192.168.1.10" });
    const first = await app.request("/api/setup/first-run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "correct-horse", preferredLanguage: "eng" }),
    });
    const cookie = cookieHeader(first);
    store.createArrInstance({ kind: "radarr", name: "R", url: "http://r", apiKey: "secret-arr-key" });
    const movie = store.upsertLibraryItem({
      instanceId: 1,
      externalId: 1,
      seriesId: null,
      type: "movie",
      title: "American Underdog",
      seriesTitle: null,
      seasonNumber: null,
      episodeNumber: null,
      path: "/mnt/nas/Movies/American Underdog/file.mkv",
      folderPath: "/mnt/nas/Movies/American Underdog",
      quality: "Bluray-1080p",
      videoCodec: "h264",
      resolution: "1080",
      hdr: null,
      size: 10,
      readable: true,
      pathError: null,
      updatedAt: new Date().toISOString(),
    });
    const episode = store.upsertLibraryItem({
      instanceId: 1,
      externalId: 2,
      seriesId: 3,
      type: "episode",
      title: "Chelsea",
      seriesTitle: "Ted Lasso",
      seasonNumber: 3,
      episodeNumber: 2,
      path: "/mnt/nas/TV/Ted Lasso/S03E02.mkv",
      folderPath: "/mnt/nas/TV/Ted Lasso",
      quality: "WEBDL-1080p",
      videoCodec: "h264",
      resolution: "1080",
      hdr: null,
      size: 8,
      readable: true,
      pathError: null,
      updatedAt: new Date().toISOString(),
    });
    store.saveSuggestion({
      itemId: movie.id,
      actions: ["transcode"],
      warning: null,
      estimatedSavingsBytes: 1,
      overCap: true,
      extraTracks: false,
      category: "movie1080p",
      sizePerHourGb: 4,
      plan: { actions: ["transcode"] },
    });
    store.saveSuggestion({
      itemId: episode.id,
      actions: ["remux"],
      warning: null,
      estimatedSavingsBytes: 1,
      overCap: false,
      extraTracks: true,
      category: "tv1080p",
      sizePerHourGb: 2,
      plan: { actions: ["remux"] },
    });
    const jobId = store.createJob(movie.id, 1, { actions: ["transcode"] }, new Date().toISOString());
    store.updateJob(jobId, { status: "running", phase: "transcoding", progress: 0.42 });
    store.createReview({
      itemId: episode.id,
      jobId: 99,
      sourcePath: episode.path,
      sidecarPath: "/mnt/nas/optimizarr-review/chelsea.mkv",
      compare: {},
    });
    return { app, store, cookie };
  }

  it("rejects a poll without a session, widget key, or local bypass", async () => {
    const { app } = await boot();
    const res = await app.request("/api/widget");
    expect(res.status).toBe(401);
  });

  it("returns stats for Homepage with X-Api-Key and does not echo secrets or paths", async () => {
    const { app, cookie } = await boot();
    const created = await app.request("/api/settings/widget-token", { method: "POST", headers: { cookie } });
    expect(created.status).toBe(200);
    const { token } = (await created.json()) as { token: string };
    expect(token.length).toBeGreaterThan(16);

    const settings = await app.request("/api/settings", { headers: { cookie } }).then((r) => r.json());
    expect(settings.hasWidgetToken).toBe(true);
    expect(JSON.stringify(settings)).not.toContain(token);

    const res = await app.request("/api/widget", { headers: { "X-Api-Key": token } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      ok: true,
      service: "optimizarr",
      queued: 0,
      review: 1,
      suggestions: 2,
      movies: 1,
      episodes: 1,
      running: {
        title: "American Underdog",
        phase: "transcoding",
        progress: 0.42,
        phaseLabel: "Transcoding to HEVC",
      },
    });
    expect(body.status).toBe("Transcoding to HEVC · American Underdog");
    expect(body.runningTitle).toBe("American Underdog");
    const raw = JSON.stringify(body);
    expect(raw).not.toContain("secret-arr-key");
    expect(raw).not.toContain("correct-horse");
    expect(raw).not.toContain("/mnt/nas");
    expect(raw).not.toContain(token);
  });

  it("accepts Authorization Bearer and the /api/homepage alias", async () => {
    const { app, cookie } = await boot();
    const token = ((await (await app.request("/api/settings/widget-token", { method: "POST", headers: { cookie } })).json()) as { token: string }).token;
    const res = await app.request("/api/homepage", { headers: { authorization: `Bearer ${token}` } });
    expect(res.status).toBe(200);
    expect((await res.json()).suggestions).toBe(2);
  });

  it("lets a LAN client poll when local-address bypass is on", async () => {
    const { app, store } = await boot();
    expect((await app.request("/api/widget")).status).toBe(401);
    store.saveSettings({ ...store.getSettings(), localAuthBypass: true });
    const res = await app.request("/api/widget");
    expect(res.status).toBe(200);
    expect((await res.json()).runningTitle).toBe("American Underdog");
  });
});

describe("widget helpers", () => {
  it("authorizes a session, env key, or stored hash", () => {
    expect(authorizeWidget({ hasSession: true, presentedKey: null, storedHash: null })).toBe(true);
    expect(authorizeWidget({ hasSession: false, presentedKey: null, storedHash: null })).toBe(false);
    expect(
      authorizeWidget({ hasSession: false, presentedKey: "env-key", storedHash: null, envKey: "env-key" }),
    ).toBe(true);
    expect(
      authorizeWidget({ hasSession: false, presentedKey: "wrong", storedHash: null, envKey: "env-key" }),
    ).toBe(false);
  });

  it("names idle and waiting states for a glance", () => {
    expect(widgetStatus(null, 0, 0)).toBe("Idle");
    expect(widgetStatus(null, 3, 1)).toBe("3 waiting");
    expect(widgetStatus(null, 0, 2)).toBe("2 ready to review");
  });
});
