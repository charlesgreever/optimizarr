import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { serveStatic } from "@hono/node-server/serve-static";
import type { HttpBindings } from "@hono/node-server";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { ArrClient, ArrError } from "./arr.ts";
import { loadOrFetchPoster, sniffImageType } from "./art.ts";
import type { ArrKind } from "./models.ts";
import { clientIp, isPrivateIp } from "./net.ts";
import { Store, publicSettings } from "./store.ts";
import { Catalog, type ProbeFn } from "./catalog.ts";
import { detectBackends, type EncodeBackends } from "./hardware.ts";
import { JobService } from "./jobs.ts";
import { publicArrInstance, publicPlayerInstance, type PlayerKind } from "./models.ts";
import { testPlayer } from "./notify.ts";
import { ffmpegOptimizer, type Optimizer } from "./optimize.ts";
import { reviewPathInsideLibrary, suggestReviewPath } from "./paths.ts";
import {
  createStorage,
  parseNetworkMounts,
  storageConfigFromSettings,
  suggestPathMaps,
} from "./storage.ts";
import { LibrarySync, defaultPathReadable, libraryListPayload, type PathCheck } from "./sync.ts";
import type { CopyMode, PathMap, Settings } from "./types.ts";
import type { FetchLike } from "./arr.ts";
import { authorizeWidget, hashWidgetToken, widgetKeyFromHeaders, widgetPayload } from "./widget.ts";

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

function onboardingComplete(store: Store): boolean {
  if (!firstRunComplete(store)) return false;
  const settings = store.getSettings();
  if (!settings.reviewPath.trim()) return false;
  return store.listArrInstances().some((i) => i.enabled);
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
  if (body.copyMode === "auto" || body.copyMode === "ssh" || body.copyMode === "mount" || body.copyMode === "proxy") {
    next.copyMode = body.copyMode as CopyMode;
  }
  if (typeof body.nasSshHost === "string") next.nasSshHost = body.nasSshHost.trim();
  if (typeof body.nasSshUser === "string") next.nasSshUser = body.nasSshUser.trim();
  if (typeof body.nasSshPort === "number" && Number.isFinite(body.nasSshPort)) {
    next.nasSshPort = Math.min(65535, Math.max(1, Math.floor(body.nasSshPort)));
  }
  if (typeof body.nasSshIdentityFile === "string") next.nasSshIdentityFile = body.nasSshIdentityFile.trim();
  if (Array.isArray(body.nasPathMaps)) {
    next.nasPathMaps = (body.nasPathMaps as unknown[])
      .map((row): PathMap | null => {
        if (!row || typeof row !== "object") return null;
        const rec = row as Record<string, unknown>;
        const localRoot = typeof rec.localRoot === "string" ? rec.localRoot.trim() : "";
        const remoteRoot = typeof rec.remoteRoot === "string" ? rec.remoteRoot.trim() : "";
        if (!localRoot || !remoteRoot) return null;
        return { localRoot, remoteRoot };
      })
      .filter((row): row is PathMap => Boolean(row));
  }
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

export type AppOpts = {
  webRoot?: string;
  remoteAddress?: string;
  fetchImpl?: FetchLike;
  pathReadable?: PathCheck;
  now?: () => Date;
  sync?: LibrarySync;
  probe?: ProbeFn;
  catalog?: Catalog;
  optimize?: Optimizer;
  jobs?: JobService;
  backends?: EncodeBackends;
};

export function createApp(store: Store, opts?: AppOpts): App {
  const client = new ArrClient(opts?.fetchImpl);
  const catalog = opts?.catalog ?? new Catalog(store, opts?.probe);
  const sync =
    opts?.sync ??
    new LibrarySync(store, client, opts?.pathReadable ?? defaultPathReadable, opts?.now ?? (() => new Date()));
  const backends = opts?.backends ?? detectBackends();
  const jobs = opts?.jobs ?? new JobService(store, opts?.optimize ?? ffmpegOptimizer(), opts?.fetchImpl);
  jobs.backends = backends;
  jobs.recoverInterruptedJobs();
  sync.catalog = catalog;
  sync.jobs = jobs;
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

  app.get("/api/widget", (c) => {
    const allowed = authorizeWidget({
      hasSession: Boolean(c.get("userId")),
      presentedKey: widgetKeyFromHeaders(c.req.raw.headers),
      storedHash: store.getWidgetTokenHash(),
      envKey: process.env.OPTIMIZARR_WIDGET_KEY,
    });
    if (!allowed) return c.json({ error: "Not authenticated" }, 401);
    return c.json(widgetPayload(store));
  });
  app.get("/api/homepage", (c) => {
    const allowed = authorizeWidget({
      hasSession: Boolean(c.get("userId")),
      presentedKey: widgetKeyFromHeaders(c.req.raw.headers),
      storedHash: store.getWidgetTokenHash(),
      envKey: process.env.OPTIMIZARR_WIDGET_KEY,
    });
    if (!allowed) return c.json({ error: "Not authenticated" }, 401);
    return c.json(widgetPayload(store));
  });

  app.get("/api/setup/status", (c) => {
    const settings = store.getSettings();
    const instances = store.listArrInstances();
    const players = store.listPlayers();
    return c.json({
      needsFirstRun: !store.hasUser(),
      languageConfirmed: settings.languageConfirmed,
      setupComplete: firstRunComplete(store),
      onboardingComplete: onboardingComplete(store),
      authenticated: Boolean(c.get("userId")),
      username: c.get("username") ?? null,
      reviewPath: settings.reviewPath,
      suggestedReviewPath: suggestReviewPath(
        store.listLibraryItems().flatMap((i) => [i.path, i.folderPath ?? ""]),
      ),
      hasRadarr: instances.some((i) => i.kind === "radarr" && i.enabled),
      hasSonarr: instances.some((i) => i.kind === "sonarr" && i.enabled),
      hasPlex: players.some((p) => p.kind === "plex" && p.enabled),
      hasJellyfin: players.some((p) => p.kind === "jellyfin" && p.enabled),
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

  app.get("/api/hardware", requireAuth, (c) => c.json(backends));
  app.get("/api/setup/review-suggestion", requireAuth, (c) => {
    const suggested = suggestReviewPath(
      store.listLibraryItems().flatMap((i) => [i.path, i.folderPath ?? ""]),
    );
    return c.json({ suggestedReviewPath: suggested });
  });

  app.get("/api/settings", requireAuth, (c) => {
    return c.json(settingsPayload(store));
  });

  app.put("/api/settings", requireAuth, async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    if ("password" in body || "passwordHash" in body || "apiKey" in body || "token" in body) {
      // ignore secrets if a client tries to write them here
    }
    const next = pickSettings(body, store.getSettings());
    if (typeof body.reviewPath === "string") {
      const libraries = store.listLibraryItems().flatMap((i) => [i.path, i.folderPath ?? ""]);
      if (reviewPathInsideLibrary(next.reviewPath, libraries)) {
        return c.json({ error: "Review path must sit outside Arr library folders" }, 400);
      }
    }
    store.saveSettings(next);
    return c.json(settingsPayload(store));
  });

  app.post("/api/settings/widget-token", requireAuth, (c) => {
    const token = randomBytes(24).toString("base64url");
    store.setWidgetTokenHash(hashWidgetToken(token));
    return c.json({ token, hasWidgetToken: true });
  });

  app.delete("/api/settings/widget-token", requireAuth, (c) => {
    store.setWidgetTokenHash(null);
    return c.json({ ok: true, hasWidgetToken: false });
  });

  app.get("/api/settings/storage", requireAuth, (c) => {
    const settings = store.getSettings();
    const config = storageConfigFromSettings(settings);
    let mountsText = "";
    try {
      mountsText = readFileSync("/proc/mounts", "utf8");
    } catch {
      mountsText = "";
    }
    const detectedMounts = parseNetworkMounts(mountsText);
    const identityFile = config.nasSshIdentityFile;
    const localPaths = [
      settings.reviewPath,
      ...store.listLibraryItems().flatMap((i) => [i.path, i.folderPath ?? ""]),
    ];
    return c.json({
      copyMode: config.copyMode,
      detectedMounts,
      suggestedMaps: suggestPathMaps(detectedMounts, localPaths),
      suggestedHost: config.nasSshHost || detectedMounts[0]?.host || "",
      sshConfigured: Boolean(config.nasSshHost && config.nasSshUser),
      identityFilePresent: Boolean(identityFile && existsSync(identityFile)),
    });
  });

  app.post("/api/settings/storage-test", requireAuth, async (c) => {
    const settings = store.getSettings();
    const reviewPath = settings.reviewPath.trim();
    if (!reviewPath) return c.json({ error: "Set a review path first" }, 400);
    await mkdir(reviewPath, { recursive: true });
    const src = join(reviewPath, ".optimizarr-storage-probe");
    const dest = join(reviewPath, ".optimizarr-storage-probe.copy");
    writeFileSync(src, "optimizarr-storage-probe\n");
    try {
      const result = await createStorage(storageConfigFromSettings(settings)).copy(src, dest);
      return c.json({
        ok: true,
        method: result.method,
        bytes: result.bytes,
        detail: storageTestDetail(result.method),
      });
    } catch (err) {
      return c.json(
        { ok: false, error: err instanceof Error ? err.message : "Storage test failed" },
        400,
      );
    } finally {
      try {
        unlinkSync(src);
      } catch {
        /* ignore */
      }
      try {
        unlinkSync(dest);
      } catch {
        /* ignore */
      }
    }
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

  app.get("/api/instances", requireAuth, (c) => {
    return c.json({ items: store.listArrInstances().map(publicArrInstance) });
  });

  app.post("/api/instances", requireAuth, async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const kind = body.kind === "sonarr" ? "sonarr" : body.kind === "radarr" ? "radarr" : "";
    if (kind !== "radarr" && kind !== "sonarr") return c.json({ error: "kind must be radarr or sonarr" }, 400);
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const url = typeof body.url === "string" ? body.url.trim() : "";
    const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
    if (!name || !url || !apiKey) return c.json({ error: "name, url, and apiKey are required" }, 400);
    const created = store.createArrInstance({
      kind: kind as ArrKind,
      name,
      url,
      apiKey,
      enabled: body.enabled === false ? false : true,
    });
    return c.json(publicArrInstance(created), 201);
  });

  app.put("/api/instances/:id", requireAuth, async (c) => {
    const id = Number(c.req.param("id"));
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const patch: Parameters<Store["updateArrInstance"]>[1] = {};
    if (typeof body.name === "string") patch.name = body.name.trim();
    if (typeof body.url === "string") patch.url = body.url.trim();
    if (typeof body.apiKey === "string") patch.apiKey = body.apiKey;
    if (typeof body.enabled === "boolean") patch.enabled = body.enabled;
    if (body.kind === "radarr" || body.kind === "sonarr") patch.kind = body.kind;
    const updated = store.updateArrInstance(id, patch);
    if (!updated) return c.json({ error: "Instance not found" }, 404);
    return c.json(publicArrInstance(updated));
  });

  app.delete("/api/instances/:id", requireAuth, async (c) => {
    store.deleteArrInstance(Number(c.req.param("id")));
    return c.json({ ok: true });
  });

  app.post("/api/instances/:id/test", requireAuth, async (c) => {
    const instance = store.getArrInstance(Number(c.req.param("id")));
    if (!instance) return c.json({ error: "Instance not found" }, 404);
    try {
      const result = await client.test(instance.url, instance.apiKey);
      return c.json({ ok: true, version: result.version });
    } catch (err) {
      const message = err instanceof ArrError ? err.message : "Connection failed";
      return c.json({ ok: false, error: message }, 400);
    }
  });

  app.post("/api/library/refresh", requireAuth, async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { inspect?: string };
    const inspect = body.inspect === "none" ? "none" : "pending";
    const result = await sync.refreshAll({ inspect });
    return c.json({
      ...result,
      lastSyncAt: sync.lastSyncAt,
      inspect: catalog.progress(),
      suggestedReviewPath: suggestReviewPath(
        store.listLibraryItems().flatMap((i) => [i.path, i.folderPath ?? ""]),
      ),
    });
  });

  app.get("/api/library/inspect", requireAuth, (c) => c.json(catalog.progress()));

  app.get("/api/library/items/:id/poster", requireAuth, async (c) => {
    const item = store.getLibraryItem(Number(c.req.param("id")));
    if (!item?.posterRemoteUrl) return c.body(null, 404);
    const instance = store.getArrInstance(item.instanceId);
    if (!instance) return c.body(null, 404);
    const bytes = await loadOrFetchPoster(store.dataDir, item, instance.apiKey, opts?.fetchImpl ?? fetch);
    if (!bytes) return c.body(null, 404);
    c.header("Content-Type", sniffImageType(bytes));
    c.header("Cache-Control", "private, max-age=86400");
    return c.body(new Uint8Array(bytes));
  });

  app.get("/api/library/movies", requireAuth, (c) => {
    return c.json(
      libraryListPayload(store.listLibraryItems("movie"), sync.lastSyncAt, "Connect Radarr in Settings to sync your library."),
    );
  });
  app.get("/api/library/series", requireAuth, (c) => {
    return c.json(
      libraryListPayload(
        store.listLibraryItems("episode"),
        sync.lastSyncAt,
        "Connect Sonarr in Settings to sync your library.",
      ),
    );
  });
  app.get("/api/suggestions", requireAuth, (c) => {
    const q = c.req.query("q") ?? undefined;
    const codec = c.req.query("codec") ?? undefined;
    const type = c.req.query("type") === "episode" ? "episode" : c.req.query("type") === "movie" ? "movie" : undefined;
    const overCap = c.req.query("overCap") === "1";
    const extraTracks = c.req.query("extraTracks") === "1";
    const items = store.listSuggestions({ q, codec, type, overCap: overCap || undefined, extraTracks: extraTracks || undefined });
    return c.json({
      items,
      message: items.length ? undefined : "After the library syncs, this page lists files that need a remux or encode.",
    });
  });

  app.post("/api/suggestions/:id/dismiss", requireAuth, (c) => {
    store.dismissSuggestion(Number(c.req.param("id")));
    return c.json({ ok: true });
  });

  app.post("/api/library/items/:id/force", requireAuth, async (c) => {
    await catalog.inspectItem(Number(c.req.param("id")), { force: true });
    return c.json({ ok: true });
  });
  app.post("/api/library/items/:id/stereo", requireAuth, async (c) => {
    await catalog.inspectItem(Number(c.req.param("id")), { addStereo: true });
    return c.json({ ok: true });
  });
  app.get("/api/review", requireAuth, (c) => {
    const items = store.listReviews("pending");
    return c.json({
      items,
      message: items.length ? undefined : "Sidecars wait here until you Keep them into the library or Discard them.",
    });
  });
  app.get("/api/history", requireAuth, (c) => {
    const items = store.listHistory();
    return c.json({ items, message: items.length ? undefined : "Kept, discarded, flagged, and failed jobs appear here." });
  });
  app.get("/api/exclusions", requireAuth, (c) => c.json({ items: store.listExclusions() }));
  app.post("/api/exclusions", requireAuth, async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { kind?: string; value?: string };
    if (!body.kind || !body.value) return c.json({ error: "kind and value required" }, 400);
    store.addExclusion(body.kind, body.value);
    return c.json({ ok: true }, 201);
  });
  app.post("/api/queue/:id/cancel", requireReady, async (c) => {
    const result = await jobs.cancel(Number(c.req.param("id")));
    if (!result.ok) return c.json({ error: result.error }, result.status);
    return c.json({ ok: true });
  });
  app.post("/api/review/:id/requeue", requireReady, async (c) => {
    const review = store.getReview(Number(c.req.param("id")));
    if (!review) return c.json({ error: "Review not found" }, 404);
    const sug = store.listSuggestions({ includeDismissed: true }).find((s) => s.itemId === review.itemId);
    if (!sug) return c.json({ error: "No suggestion to requeue" }, 400);
    store.setReviewStatus(review.id, "discarded");
    const result = await jobs.enqueue(sug.id as number);
    if ("error" in result) return c.json({ error: result.error }, result.status);
    return c.json(result);
  });

  app.get("/api/queue", requireReady, (c) => {
    const items = store.listJobs();
    return c.json({ items, message: items.length ? undefined : "Jobs you approve from Suggestions appear here." });
  });
  app.post("/api/queue", requireReady, async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { suggestionId?: number };
    if (!body.suggestionId) return c.json({ error: "suggestionId is required" }, 400);
    const result = await jobs.enqueue(body.suggestionId);
    if ("error" in result) return c.json({ error: result.error }, result.status);
    return c.json(result, 201);
  });
  app.get("/api/jobs", requireReady, (c) => c.json({ items: store.listJobs() }));
  app.post("/api/review/:id/keep", requireReady, async (c) => {
    const result = await jobs.keep(Number(c.req.param("id")));
    if (!result.ok) return c.json(result, 400);
    return c.json(result);
  });
  app.post("/api/review/:id/discard", requireReady, async (c) => {
    const result = await jobs.discard(Number(c.req.param("id")));
    if (!result.ok) return c.json(result, 400);
    return c.json(result);
  });

  app.get("/api/players", requireAuth, (c) => {
    return c.json({
      items: store.listPlayers().map(publicPlayerInstance),
    });
  });
  app.post("/api/players", requireAuth, async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const kind = body.kind as PlayerKind;
    if (kind !== "plex" && kind !== "jellyfin" && kind !== "other") {
      return c.json({ error: "kind must be plex, jellyfin, or other" }, 400);
    }
    const name = String(body.name ?? "").trim();
    const url = String(body.url ?? "").trim();
    const token = String(body.token ?? "").trim();
    if (!name || !url || !token) return c.json({ error: "name, url, and token are required" }, 400);
    const created = store.createPlayer({ kind, name, url, token });
    return c.json(publicPlayerInstance(created), 201);
  });
  app.post("/api/players/:id/test", requireAuth, async (c) => {
    const player = store.listPlayers().find((p) => p.id === Number(c.req.param("id")));
    if (!player) return c.json({ error: "Player not found" }, 404);
    const result = await testPlayer(opts?.fetchImpl ?? fetch, player);
    if (!result.ok) return c.json({ ok: false, error: result.error }, 400);
    return c.json({ ok: true, version: result.version });
  });
  app.put("/api/players/:id", requireAuth, async (c) => {
    const id = Number(c.req.param("id"));
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const patch: Parameters<Store["updatePlayer"]>[1] = {};
    if (typeof body.name === "string") patch.name = body.name.trim();
    if (typeof body.url === "string") patch.url = body.url.trim();
    if (typeof body.token === "string") patch.token = body.token;
    if (typeof body.enabled === "boolean") patch.enabled = body.enabled;
    if (body.kind === "plex" || body.kind === "jellyfin" || body.kind === "other") patch.kind = body.kind;
    const updated = store.updatePlayer(id, patch);
    if (!updated) return c.json({ error: "Player not found" }, 404);
    return c.json(publicPlayerInstance(updated));
  });
  app.delete("/api/players/:id", requireAuth, (c) => {
    store.deletePlayer(Number(c.req.param("id")));
    return c.json({ ok: true });
  });

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

function settingsPayload(store: Store) {
  return publicSettings(store.getSettings(), { hasWidgetToken: Boolean(store.getWidgetTokenHash()) });
}

function cookieOpts(expires: Date) {
  return {
    path: "/",
    httpOnly: true,
    sameSite: "Lax" as const,
    expires,
  };
}

function storageTestDetail(method: string): string {
  if (method === "ssh") return "Copied on the NAS over SSH (the file never crossed this host).";
  if (method === "clone") return "Cloned on the same filesystem (no extra bytes written).";
  if (method === "server") return "Kernel server-side copy (SMB/NFS COPYCHUNK or copy_file_range).";
  return "Copied through this host. Configure NAS SSH to keep the bytes on the NAS.";
}


