import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { serveStatic } from "@hono/node-server/serve-static";
import type { HttpBindings } from "@hono/node-server";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { clientIp, isPrivateIp } from "./net.ts";
import { Store, publicSettings } from "./store.ts";
import type { Settings } from "./types.ts";

export const SESSION_COOKIE = "optimizarr_session";
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MIN_PASSWORD = 8;

type Variables = {
  store: Store;
  username?: string;
  userId?: number;
  remoteAddress?: string;
};

type Env = { Variables: Variables; Bindings: HttpBindings };

export type App = Hono<Env>;

const INVALID_LOGIN = "Invalid username or password";

function firstRunComplete(store: Store): boolean {
  return store.hasUser() && store.getSettings().languageConfirmed;
}

function pickSettings(body: Record<string, unknown>, current: Settings): Settings {
  const next = { ...current };
  if (typeof body.preferredLanguage === "string" && body.preferredLanguage.trim()) {
    next.preferredLanguage = body.preferredLanguage.trim().toLowerCase();
  }
  if (typeof body.languageConfirmed === "boolean") next.languageConfirmed = body.languageConfirmed;
  if (typeof body.localAuthBypass === "boolean") next.localAuthBypass = body.localAuthBypass;
  if (body.targetCodec === "hevc" || body.targetCodec === "av1") next.targetCodec = body.targetCodec;
  if (typeof body.concurrency === "number" && Number.isFinite(body.concurrency)) {
    next.concurrency = Math.max(1, Math.floor(body.concurrency));
  }
  if (typeof body.multiSegment === "boolean") next.multiSegment = body.multiSegment;
  if (typeof body.offPeakEnabled === "boolean") next.offPeakEnabled = body.offPeakEnabled;
  if (typeof body.offPeakStart === "string") next.offPeakStart = body.offPeakStart;
  if (typeof body.offPeakEnd === "string") next.offPeakEnd = body.offPeakEnd;
  if (typeof body.workOnNas === "boolean") next.workOnNas = body.workOnNas;
  if (typeof body.localCopy === "boolean") next.localCopy = body.localCopy;
  if (typeof body.autoOptimize === "boolean") next.autoOptimize = body.autoOptimize;
  if (typeof body.reviewPath === "string") next.reviewPath = body.reviewPath;
  if (body.sizeCapsGbPerHour && typeof body.sizeCapsGbPerHour === "object") {
    const caps = body.sizeCapsGbPerHour as Record<string, unknown>;
    const merged = { ...current.sizeCapsGbPerHour };
    for (const key of Object.keys(merged) as (keyof typeof merged)[]) {
      const v = caps[key];
      if (typeof v === "number" && Number.isFinite(v) && v > 0) merged[key] = v;
    }
    next.sizeCapsGbPerHour = merged;
  }
  return next;
}

export function createApp(store: Store, opts?: { webRoot?: string; remoteAddress?: string }): App {
  const app = new Hono<Env>();

  app.use("*", async (c, next) => {
    c.set("store", store);
    if (opts?.remoteAddress) c.set("remoteAddress", opts.remoteAddress);
    await next();
  });

  app.use("/api/*", async (c, next) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (token) {
      const session = store.getSession(token);
      if (session) {
        c.set("userId", session.user.id);
        c.set("username", session.user.username);
      }
    }
    if (!c.get("userId") && store.hasUser()) {
      const settings = store.getSettings();
      const socketIp = c.env?.incoming?.socket?.remoteAddress;
      const ip = clientIp(c.req.raw.headers, socketIp || c.get("remoteAddress"));
      if (settings.localAuthBypass && isPrivateIp(ip)) {
        const user = store.getUserById(1);
        if (user) {
          c.set("userId", user.id);
          c.set("username", user.username);
        }
      }
    }
    await next();
  });

  app.get("/api/health", (c) => c.json({ ok: true, service: "optimizarr" }));

  app.get("/api/setup/status", (c) => {
    const settings = store.getSettings();
    return c.json({
      needsFirstRun: !store.hasUser(),
      languageConfirmed: settings.languageConfirmed,
      setupComplete: firstRunComplete(store),
      authenticated: Boolean(c.get("userId")),
      username: c.get("username") ?? null,
    });
  });

  app.post("/api/setup/first-run", async (c) => {
    if (store.hasUser()) return c.json({ error: "Already set up" }, 409);
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const username = typeof body.username === "string" ? body.username.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const preferredLanguage =
      typeof body.preferredLanguage === "string" ? body.preferredLanguage.trim().toLowerCase() : "";
    if (!username) return c.json({ error: "Username is required" }, 400);
    if (password.length < MIN_PASSWORD) {
      return c.json({ error: `Password must be at least ${MIN_PASSWORD} characters` }, 400);
    }
    if (!preferredLanguage) return c.json({ error: "Preferred language is required" }, 400);

    const user = store.createAdmin(username, password);
    const settings = store.getSettings();
    store.saveSettings({
      ...settings,
      preferredLanguage,
      languageConfirmed: true,
    });
    const session = store.createSession(user.id, SESSION_TTL_MS);
    setCookie(c, SESSION_COOKIE, session.id, cookieOpts(session.expiresAt));
    return c.json({ ok: true, username: user.username });
  });

  app.post("/api/auth/login", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const username = typeof body.username === "string" ? body.username : "";
    const password = typeof body.password === "string" ? body.password : "";
    const user = store.verifyLogin(username, password);
    if (!user) return c.json({ error: INVALID_LOGIN }, 401);
    const session = store.createSession(user.id, SESSION_TTL_MS);
    setCookie(c, SESSION_COOKIE, session.id, cookieOpts(session.expiresAt));
    return c.json({ ok: true, username: user.username });
  });

  app.post("/api/auth/logout", (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (token) store.deleteSession(token);
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return c.json({ ok: true });
  });

  app.get("/api/auth/session", (c) => {
    if (!c.get("userId")) return c.json({ error: "Not authenticated" }, 401);
    return c.json({ username: c.get("username") });
  });

  const requireAuth: Parameters<App["use"]>[1] = async (c, next) => {
    if (!c.get("userId")) return c.json({ error: "Not authenticated" }, 401);
    await next();
  };

  const requireReady: Parameters<App["use"]>[1] = async (c, next) => {
    if (!c.get("userId")) return c.json({ error: "Not authenticated" }, 401);
    if (!firstRunComplete(store)) {
      return c.json({ error: "Setup incomplete. Confirm preferred language before optimizing." }, 403);
    }
    await next();
  };

  app.get("/api/settings", requireAuth, (c) => {
    return c.json(publicSettings(store.getSettings()));
  });

  app.put("/api/settings", requireAuth, async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    if ("password" in body || "passwordHash" in body || "apiKey" in body || "token" in body) {
      // ignore secrets if a client tries to write them here
    }
    const saved = store.saveSettings(pickSettings(body, store.getSettings()));
    return c.json(publicSettings(saved));
  });

  app.put("/api/auth/credentials", requireAuth, async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : "";
    const username = typeof body.username === "string" ? body.username.trim() : c.get("username") ?? "";
    const password = typeof body.password === "string" ? body.password : undefined;
    const userId = c.get("userId");
    if (!userId) return c.json({ error: "Not authenticated" }, 401);
    const user = store.getUserById(userId);
    if (!user || !store.verifyLogin(user.username, currentPassword)) {
      return c.json({ error: INVALID_LOGIN }, 401);
    }
    if (password !== undefined && password.length < MIN_PASSWORD) {
      return c.json({ error: `Password must be at least ${MIN_PASSWORD} characters` }, 400);
    }
    if (!username) return c.json({ error: "Username is required" }, 400);
    const updated = store.updateCredentials(userId, username, password);
    return c.json({ ok: true, username: updated.username });
  });

  app.get("/api/library/movies", requireAuth, (c) => {
    return c.json({ items: [], message: "Connect Radarr in Settings to sync your library." });
  });
  app.get("/api/library/series", requireAuth, (c) => {
    return c.json({ items: [], message: "Connect Sonarr in Settings to sync your library." });
  });
  app.get("/api/suggestions", requireAuth, (c) => {
    return c.json({
      items: [],
      message: "After your library syncs, suggested optimizations will show up here.",
    });
  });
  app.get("/api/review", requireAuth, (c) => {
    return c.json({
      items: [],
      message: "Finished sidecars wait here for Keep or Discard.",
    });
  });
  app.get("/api/history", requireAuth, (c) => {
    return c.json({ items: [], message: "Completed jobs will be listed here." });
  });

  app.get("/api/queue", requireReady, (c) => {
    return c.json({ items: [], message: "Approved work will appear here." });
  });
  app.post("/api/queue", requireReady, (c) => c.json({ error: "Not implemented" }, 501));
  app.get("/api/jobs", requireReady, (c) => c.json({ items: [] }));
  app.post("/api/jobs", requireReady, (c) => c.json({ error: "Not implemented" }, 501));
  app.post("/api/review/keep", requireReady, (c) => c.json({ error: "Not implemented" }, 501));
  app.post("/api/review/discard", requireReady, (c) => c.json({ error: "Not implemented" }, 501));

  const webRoot = opts?.webRoot;
  if (webRoot && existsSync(webRoot)) {
    app.use("/*", serveStatic({ root: webRoot }));
    app.get("*", (c) => {
      const index = join(webRoot, "index.html");
      if (!existsSync(index)) return c.text("UI not built", 500);
      return c.html(readFileSync(index, "utf8"));
    });
  }

  return app;
}

function cookieOpts(expires: Date) {
  return {
    path: "/",
    httpOnly: true,
    sameSite: "Lax" as const,
    expires,
  };
}


