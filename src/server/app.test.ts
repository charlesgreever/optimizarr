import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createApp, SESSION_COOKIE } from "./app.ts";
import { Store } from "./store.ts";
import { cookieHeader } from "./test-http.ts";

function tempStore(): { store: Store; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "optimizarr-"));
  return { store: new Store(dir), dir };
}

describe("phase 1 app", () => {
  const dirs: string[] = [];
  const stores: Store[] = [];

  function appWithStore() {
    const { store, dir } = tempStore();
    dirs.push(dir);
    stores.push(store);
    return { app: createApp(store), store, dir };
  }

  afterEach(() => {
    for (const s of stores.splice(0)) s.close();
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it("reports first-run needed when no admin exists", async () => {
    const { app } = appWithStore();
    const res = await app.request("/api/setup/status");
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      needsFirstRun: true,
      languageConfirmed: false,
      setupComplete: false,
      authenticated: false,
    });
  });

  it("completes first-run with account and preferred language", async () => {
    const { app, store } = appWithStore();
    const res = await app.request("/api/setup/first-run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        username: "admin",
        password: "correct-horse",
        preferredLanguage: "eng",
      }),
    });
    expect(res.status).toBe(200);
    expect(store.hasUser()).toBe(true);
    expect(store.getSettings().languageConfirmed).toBe(true);
    expect(store.getSettings().preferredLanguage).toBe("eng");
    expect(cookieHeader(res)).toContain(SESSION_COOKIE);
    const status = await app.request("/api/setup/status", { headers: { cookie: cookieHeader(res) } });
    await expect(status.json()).resolves.toMatchObject({
      onboardingComplete: false,
      hasRadarr: false,
      hasSonarr: false,
      suggestedReviewPath: null,
    });
  });

  it("suggests a review path from Arr library roots after sync", async () => {
    const { app, store } = appWithStore();
    const first = await app.request("/api/setup/first-run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "correct-horse", preferredLanguage: "eng" }),
    });
    const cookie = cookieHeader(first);
    store.createArrInstance({ kind: "radarr", name: "R", url: "http://r", apiKey: "k" });
    store.upsertLibraryItem({
      instanceId: 1,
      externalId: 1,
      seriesId: null,
      type: "movie",
      title: "Up",
      seriesTitle: null,
      seasonNumber: null,
      episodeNumber: null,
      path: "/mnt/nas/Movies/Up/Up.mkv",
      folderPath: "/mnt/nas/Movies/Up",
      quality: null,
      videoCodec: "h264",
      resolution: "1080",
      hdr: null,
      size: 1,
      readable: true,
      pathError: null,
      updatedAt: new Date().toISOString(),
    });
    const suggestion = await app.request("/api/setup/review-suggestion", { headers: { cookie } });
    expect(await suggestion.json()).toEqual({ suggestedReviewPath: "/mnt/nas/optimizarr-review" });
    await app.request("/api/settings", {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ reviewPath: "/mnt/nas/optimizarr-review" }),
    });
    const status = await app.request("/api/setup/status", { headers: { cookie } });
    await expect(status.json()).resolves.toMatchObject({
      onboardingComplete: true,
      hasRadarr: true,
      reviewPath: "/mnt/nas/optimizarr-review",
    });
  });

  it("rejects a second first-run", async () => {
    const { app } = appWithStore();
    const body = {
      username: "admin",
      password: "correct-horse",
      preferredLanguage: "eng",
    };
    await app.request("/api/setup/first-run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const res = await app.request("/api/setup/first-run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(res.status).toBe(409);
  });

  it("rejects short passwords on first-run", async () => {
    const { app } = appWithStore();
    const res = await app.request("/api/setup/first-run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "short", preferredLanguage: "eng" }),
    });
    expect(res.status).toBe(400);
  });

  async function setup(app: ReturnType<typeof createApp>) {
    const res = await app.request("/api/setup/first-run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        username: "admin",
        password: "correct-horse",
        preferredLanguage: "eng",
      }),
    });
    return cookieHeader(res);
  }

  it("logs in and out; bad password uses a generic error", async () => {
    const { app } = appWithStore();
    await setup(app);

    const bad = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "wrong-password" }),
    });
    expect(bad.status).toBe(401);
    const badBody = await bad.json();
    expect(badBody.error).toBe("Invalid username or password");

    const unknown = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "nope", password: "wrong-password" }),
    });
    expect(unknown.status).toBe(401);
    expect((await unknown.json()).error).toBe("Invalid username or password");

    const ok = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "correct-horse" }),
    });
    expect(ok.status).toBe(200);
    const cookie = cookieHeader(ok);
    const session = await app.request("/api/auth/session", { headers: { cookie } });
    expect(session.status).toBe(200);
    expect(await session.json()).toEqual({ username: "admin" });

    const logout = await app.request("/api/auth/logout", { method: "POST", headers: { cookie } });
    expect(logout.status).toBe(200);
    const after = await app.request("/api/auth/session", { headers: { cookie } });
    expect(after.status).toBe(401);
  });

  it("treats an expired session as logged out", async () => {
    const { app, store } = appWithStore();
    const cookie = await setup(app);
    const token = cookie.split("=")[1];
    store.expireSession(token);
    const res = await app.request("/api/auth/session", { headers: { cookie } });
    expect(res.status).toBe(401);
  });

  it("does not echo password hashes from settings", async () => {
    const { app } = appWithStore();
    const cookie = await setup(app);
    const res = await app.request("/api/settings", { headers: { cookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.password).toBeUndefined();
    expect(body.passwordHash).toBeUndefined();
    expect(body.apiKey).toBeUndefined();
    expect(body.preferredLanguage).toBe("eng");
    expect(JSON.stringify(body)).not.toMatch(/argon2id/);
  });

  it("changes username and password when the current password is correct", async () => {
    const { app } = appWithStore();
    const cookie = await setup(app);
    const res = await app.request("/api/auth/credentials", {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        currentPassword: "correct-horse",
        username: "charles",
        password: "new-passphrase",
      }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, username: "charles" });

    const oldLogin = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "correct-horse" }),
    });
    expect(oldLogin.status).toBe(401);

    const newLogin = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "charles", password: "new-passphrase" }),
    });
    expect(newLogin.status).toBe(200);
  });

  it("blocks optimize APIs until language is confirmed", async () => {
    const { app, store } = appWithStore();
    store.createAdmin("admin", "correct-horse");
    const login = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "correct-horse" }),
    });
    const cookie = cookieHeader(login);
    expect(store.getSettings().languageConfirmed).toBe(false);

    const queue = await app.request("/api/queue", { headers: { cookie } });
    expect(queue.status).toBe(403);
    expect((await queue.json()).error).toMatch(/preferred language/i);

    const job = await app.request("/api/jobs", { method: "GET", headers: { cookie } });
    expect(job.status).toBe(403);

    store.saveSettings({ ...store.getSettings(), languageConfirmed: true });
    const ready = await app.request("/api/queue", { headers: { cookie } });
    expect(ready.status).toBe(200);
  });

  it("honors local-address auth bypass only when enabled", async () => {
    const { store, dir } = tempStore();
    dirs.push(dir);
    stores.push(store);
    const lanApp = createApp(store, { remoteAddress: "192.168.1.50" });
    const cookie = await setup(lanApp);

    const bypassOff = await lanApp.request("/api/settings");
    expect(bypassOff.status).toBe(401);

    await lanApp.request("/api/settings", {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ localAuthBypass: true }),
    });

    const bypassOn = await lanApp.request("/api/settings");
    expect(bypassOn.status).toBe(200);

    const publicApp = createApp(store, { remoteAddress: "8.8.8.8" });
    const publicIp = await publicApp.request("/api/settings");
    expect(publicIp.status).toBe(401);
  });

  it("returns empty library states after login", async () => {
    const { app } = appWithStore();
    const cookie = await setup(app);
    const movies = await app.request("/api/library/movies", { headers: { cookie } });
    expect(movies.status).toBe(200);
    const body = await movies.json();
    expect(body.items).toEqual([]);
    expect(body.message).toMatch(/Radarr/i);
  });

  it("saves NAS copy settings without echoing a key", async () => {
    const { app, store } = appWithStore();
    const cookie = await setup(app);
    const saved = await app.request("/api/settings", {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        copyMode: "ssh",
        nasSshHost: "192.168.1.5",
        nasSshUser: "cgreever",
        nasSshPort: 22,
        nasSshIdentityFile: "/config/nas_id_ed25519",
        nasPathMaps: [{ localRoot: "/mnt/nas", remoteRoot: "/volume1/Plex" }],
      }),
    });
    expect(saved.status).toBe(200);
    await expect(saved.json()).resolves.toMatchObject({
      copyMode: "ssh",
      nasSshHost: "192.168.1.5",
      nasSshUser: "cgreever",
      nasPathMaps: [{ localRoot: "/mnt/nas", remoteRoot: "/volume1/Plex" }],
    });
    expect(store.getSettings().copyMode).toBe("ssh");
    const info = await app.request("/api/settings/storage", { headers: { cookie } });
    expect(info.status).toBe(200);
    await expect(info.json()).resolves.toMatchObject({
      copyMode: "ssh",
      sshConfigured: true,
    });
  });

  it("persists the operator's performance mode", async () => {
    const { app, store } = appWithStore();
    const cookie = await setup(app);
    const saved = await app.request("/api/settings", {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ performanceMode: "maximum" }),
    });

    expect(saved.status).toBe(200);
    await expect(saved.json()).resolves.toMatchObject({ performanceMode: "maximum" });
    expect(store.getSettings().performanceMode).toBe("maximum");
  });

  it("reports a copy method when testing storage", async () => {
    const { app, dir } = appWithStore();
    const cookie = await setup(app);
    const review = join(dir, "review");
    await app.request("/api/settings", {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ reviewPath: review, copyMode: "proxy" }),
    });
    const res = await app.request("/api/settings/storage-test", { method: "POST", headers: { cookie } });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      ok: true,
      method: "proxy",
    });
  });

  it("rejects a review path inside a library folder", async () => {
    const { app, store } = appWithStore();
    const cookie = await setup(app);
    store.createArrInstance({ kind: "radarr", name: "R", url: "http://r", apiKey: "k" });
    store.upsertLibraryItem({
      instanceId: 1,
      externalId: 1,
      seriesId: null,
      type: "movie",
      title: "Up",
      seriesTitle: null,
      seasonNumber: null,
      episodeNumber: null,
      path: "/mnt/nas/Movies/Up/Up.mkv",
      folderPath: "/mnt/nas/Movies/Up",
      quality: null,
      videoCodec: "h264",
      resolution: "1080",
      hdr: null,
      size: 1,
      readable: true,
      pathError: null,
      updatedAt: new Date().toISOString(),
    });
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ reviewPath: "/mnt/nas/Movies/review" }),
    });
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: "Review path must sit outside Arr library folders",
    });
  });
});
