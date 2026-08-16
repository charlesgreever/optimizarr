import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createApp, SESSION_COOKIE } from "./app.ts";
import { Store } from "./store.ts";

function tempStore(): { store: Store; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "optimizarr-"));
  return { store: new Store(dir), dir };
}

function cookieHeader(res: Response): string {
  const headers = res.headers as Headers & { getSetCookie?: () => string[] };
  const parts =
    typeof headers.getSetCookie === "function"
      ? headers.getSetCookie.call(headers)
      : [headers.get("set-cookie") ?? ""];
  return parts
    .map((c) => c.split(";")[0])
    .filter(Boolean)
    .join("; ");
}

describe("phase 1 app", () => {
  const dirs: string[] = [];
  const stores: Store[] = [];

  function appWithStore() {
    const { store, dir } = tempStore();
    dirs.push(dir);
    stores.push(store);
    return { app: createApp(store), store };
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
    const { app, store } = appWithStore();
    const cookie = await setup(app);

    const lan = { "x-forwarded-for": "192.168.1.50" };
    const bypassOff = await app.request("/api/settings", { headers: lan });
    expect(bypassOff.status).toBe(401);

    await app.request("/api/settings", {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ localAuthBypass: true }),
    });

    const bypassOn = await app.request("/api/settings", { headers: lan });
    expect(bypassOn.status).toBe(200);

    const publicIp = await app.request("/api/settings", {
      headers: { "x-forwarded-for": "8.8.8.8" },
    });
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
});
