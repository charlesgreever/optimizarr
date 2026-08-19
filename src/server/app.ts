import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { serveStatic } from "@hono/node-server/serve-static";
import { createHash, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { access } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import argon2 from "argon2";
import type { Env } from "./env.ts";
import { Store } from "./store.ts";
import { decryptSecret, encryptSecret, loadOrCreateSecret } from "./secrets.ts";
import { detectHardware, type HardwareProbe } from "./hardware.ts";
import { isLocalAddress, requestAddress } from "./net.ts";
import {
  fetchJson,
  parseRadarrMovies,
  parseSonarrEpisodes,
  parseSonarrSeries,
  testRadarr,
  testSonarr,
  trimUrl,
} from "./arr.ts";
import { parseFfprobe } from "./inspect.ts";
import { buildSuggestion } from "./suggest.ts";
import { displayTitle, matchesTitleSearch } from "./titles.ts";
import { JobService, withTitles } from "./jobs.ts";
import { ffmpegOptimizer, type Optimizer } from "./optimize.ts";
import { testJellyfin, testPlex } from "./notify.ts";
import type { ArrKind, HardwareInfo, PlayerKind, Settings, Suggestion } from "./types.ts";
import { DEFAULT_SETTINGS } from "./types.ts";

const SESSION_TTL = 14 * 24 * 60 * 60 * 1000;
const GENERIC_LOGIN = "Username or password is wrong.";

export type AppOptions = {
  env: Env;
  store?: Store;
  fetch?: typeof fetch;
  hardware?: HardwareProbe;
  optimizer?: Optimizer;
  probe?: (path: string, size: number) => Promise<Record<string, unknown>>;
  clock?: () => number;
  readable?: (path: string) => Promise<boolean>;
};

export function createApp(opts: AppOptions) {
  const store = opts.store ?? new Store(opts.env.dbPath);
  const secret = loadOrCreateSecret(opts.env.secretPath);
  const httpFetch = opts.fetch ?? fetch;
  const hardware = opts.hardware ?? detectHardware(opts.env.ffmpeg);
  const jobs = new JobService({
    store,
    optimizer: opts.optimizer ?? ffmpegOptimizer(),
    clock: opts.clock,
    hardware,
    tools: { ffmpeg: opts.env.ffmpeg, ffprobe: opts.env.ffprobe, mkvmerge: opts.env.mkvmerge },
    decrypt: (packed) => decryptSecret(secret, packed),
    fetch: httpFetch,
  });
  jobs.start();

  const app = new Hono();

  const cookieOpts = { httpOnly: true, path: "/", sameSite: "Lax" as const };

  async function currentUser(c: { req: { header: (n: string) => string | undefined; raw?: { headers?: Headers } } }, rawIp?: string) {
    const sid = getCookie(c as never, "optimizarr");
    if (sid) {
      const session = store.getSession(sid, opts.clock?.() ?? Date.now());
      if (session) return { userId: session.userId, sessionId: sid };
    }
    const settings = store.getSettings();
    const ip = requestAddress(rawIp, c.req.header("x-forwarded-for"), opts.env.trustProxy);
    if (settings.localAuthBypass && isLocalAddress(ip) && store.userCount() > 0) {
      const user = store.onlyUser();
      if (user) return { userId: user.id, sessionId: "local" };
    }
    return null;
  }

  function firstRunState() {
    const settings = store.getSettings();
    const arrs = store.listInstances().filter((i) => i.kind === "radarr" || i.kind === "sonarr");
    return {
      hasAdmin: store.userCount() > 0,
      languageConfirmed: settings.languageConfirmed,
      hasReviewPath: Boolean(settings.reviewPath),
      hasArr: arrs.some((i) => i.enabled),
      complete: store.userCount() > 0 && settings.languageConfirmed && Boolean(settings.reviewPath) && arrs.some((i) => i.enabled),
    };
  }

  app.get("/api/health", (c) => c.json({ ok: true, service: "optimizarr" }));

  app.get("/api/ready", (c) => {
    const settings = store.getSettings();
    return c.json({
      ok: true,
      configDir: Boolean(opts.env.configDir),
      timezone: opts.env.tz,
      port: opts.env.port,
      ffmpeg: opts.env.ffmpeg,
      mkvmerge: opts.env.mkvmerge,
      firstRun: firstRunState(),
      languageConfirmed: settings.languageConfirmed,
    });
  });

  app.get("/api/auth/status", async (c) => {
    const user = await currentUser(c, c.req.header("x-real-ip") ?? c.req.header("x-forwarded-for"));
    return c.json({
      authenticated: Boolean(user),
      firstRun: firstRunState(),
    });
  });

  app.post("/api/auth/setup", async (c) => {
    if (store.userCount() > 0) return c.json({ error: "An administrator already exists." }, 409);
    const body = await c.req.json<{ username?: string; password?: string }>();
    if (!body.username || !body.password) return c.json({ error: "Username and password are required." }, 400);
    const hash = await argon2.hash(body.password, { type: argon2.argon2id });
    store.createUser(body.username, hash);
    const sid = store.createSession(store.onlyUser()!.id, SESSION_TTL, opts.clock?.() ?? Date.now());
    setCookie(c, "optimizarr", sid, cookieOpts);
    return c.json({ ok: true });
  });

  app.post("/api/auth/login", async (c) => {
    const body = await c.req.json<{ username?: string; password?: string }>();
    const user = body.username ? store.findUser(body.username) : undefined;
    const ok = user ? await argon2.verify(user.passwordHash, body.password ?? "") : false;
    if (!user || !ok) return c.json({ error: GENERIC_LOGIN }, 401);
    const sid = store.createSession(user.id, SESSION_TTL, opts.clock?.() ?? Date.now());
    setCookie(c, "optimizarr", sid, cookieOpts);
    return c.json({ ok: true });
  });

  app.post("/api/auth/logout", async (c) => {
    const sid = getCookie(c, "optimizarr");
    if (sid) store.deleteSession(sid);
    deleteCookie(c, "optimizarr", { path: "/" });
    return c.json({ ok: true });
  });

  const authed = async (c: { req: { header: (n: string) => string | undefined }; json: (b: unknown, s?: number) => Response }, next: () => Promise<void>) => {
    const user = await currentUser(c, c.req.header("x-real-ip"));
    if (!user) return c.json({ error: "Sign in to continue." }, 401);
    await next();
  };

  app.use("/api/settings", authed);
  app.use("/api/settings/*", authed);
  app.use("/api/integrations/*", authed);
  app.use("/api/library/*", authed);
  app.use("/api/inspect/*", authed);
  app.use("/api/suggestions", authed);
  app.use("/api/suggestions/*", authed);
  app.use("/api/jobs", authed);
  app.use("/api/jobs/*", authed);
  app.use("/api/review", authed);
  app.use("/api/review/*", authed);
  app.use("/api/errors", authed);
  app.use("/api/history", authed);
  app.use("/api/home", authed);
  app.use("/api/search", authed);
  app.use("/api/hardware", authed);
  app.use("/api/auth/password", authed);
  app.use("/api/queue", authed);

  function gateOptimize(): string | null {
    const state = firstRunState();
    if (!state.hasAdmin) return "Create an administrator account first.";
    if (!state.languageConfirmed) return "Confirm your preferred language before optimize work.";
    if (!state.hasReviewPath) return "Set a review folder that is not inside a movie or show library.";
    if (!state.hasArr) return "Connect at least one enabled Radarr or Sonarr instance.";
    return null;
  }

  app.get("/api/hardware", async (c) => c.json(await hardware()));

  app.get("/api/settings", (c) => {
    const settings = store.getSettings();
    return c.json({
      ...settings,
      instances: publicInstances(),
      firstRun: firstRunState(),
    });
  });

  app.put("/api/settings", async (c) => {
    const body = await c.req.json<Partial<Settings>>();
    const current = store.getSettings();
    const next: Settings = {
      ...current,
      ...body,
      sizeCaps: { ...current.sizeCaps, ...(body.sizeCaps ?? {}) },
    };
    if (next.reviewPath && unsafeReviewPath(next.reviewPath, store.listItems().map((i) => i.path))) {
      return c.json({ error: "The review folder cannot sit inside an Arr library folder." }, 400);
    }
    store.saveSettings(next);
    return c.json({ ok: true, settings: next, firstRun: firstRunState() });
  });

  app.post("/api/auth/password", async (c) => {
    const body = await c.req.json<{ username?: string; password?: string }>();
    const user = store.onlyUser();
    if (!user || !body.username || !body.password) return c.json({ error: "Username and password are required." }, 400);
    const hash = await argon2.hash(body.password, { type: argon2.argon2id });
    store.updateUser(user.id, body.username, hash);
    store.deleteUserSessions(user.id);
    const sid = store.createSession(user.id, SESSION_TTL, opts.clock?.() ?? Date.now());
    setCookie(c, "optimizarr", sid, cookieOpts);
    return c.json({ ok: true });
  });

  app.get("/api/integrations", (c) => c.json({ instances: publicInstances() }));

  app.post("/api/integrations", async (c) => {
    const body = await c.req.json<{
      kind?: ArrKind | PlayerKind;
      name?: string;
      url?: string;
      apiKey?: string;
      token?: string;
      enabled?: boolean;
      id?: string;
    }>();
    if (!body.kind || !body.name || !body.url) return c.json({ error: "Kind, name, and URL are required." }, 400);
    const secretPlain = body.apiKey ?? body.token;
    const id = store.upsertInstance({
      id: body.id,
      kind: body.kind,
      name: body.name,
      url: body.url,
      secret: secretPlain ? encryptSecret(secret, secretPlain) : undefined,
      enabled: body.enabled ?? true,
    });
    return c.json({ ok: true, id, instances: publicInstances() });
  });

  app.delete("/api/integrations/:id", (c) => {
    store.deleteInstance(c.req.param("id"));
    return c.json({ ok: true, instances: publicInstances() });
  });

  app.post("/api/integrations/:id/test", async (c) => {
    const inst = store.getInstance(c.req.param("id"));
    if (!inst) return c.json({ error: "That connection does not exist." }, 404);
    const key = inst.secret ? decryptSecret(secret, inst.secret) : "";
    if (inst.kind === "radarr") {
      const result = await testRadarr(inst.url, key, httpFetch);
      return c.json(result, result.ok ? 200 : 400);
    }
    if (inst.kind === "sonarr") {
      const result = await testSonarr(inst.url, key, httpFetch);
      return c.json(result, result.ok ? 200 : 400);
    }
    if (inst.kind === "plex") {
      const result = await testPlex(inst.url, key, httpFetch);
      return c.json(result, result.ok ? 200 : 400);
    }
    const result = await testJellyfin(inst.url, key, httpFetch);
    return c.json(result, result.ok ? 200 : 400);
  });

  app.post("/api/library/refresh", async (c) => {
    const started = Date.now();
    const errors: string[] = [];
    for (const inst of store.listInstances()) {
      if (!inst.enabled) continue;
      const full = store.getInstance(inst.id);
      if (!full?.secret) continue;
      const key = decryptSecret(secret, full.secret);
      try {
        if (inst.kind === "radarr") {
          const movies = parseRadarrMovies(await fetchJson(`${trimUrl(inst.url)}/api/v3/movie`, key, httpFetch));
          for (const movie of movies) {
            store.upsertItem({
              id: `${inst.id}:movie:${movie.id}`,
              instanceId: inst.id,
              arrId: movie.id,
              arrSeriesId: null,
              arrEpisodeFileId: null,
              type: "movie",
              title: movie.title,
              showTitle: null,
              season: null,
              episode: null,
              episodeTitle: null,
              path: movie.path,
              sizeBytes: movie.size,
              quality: movie.quality,
              resolution: movie.resolution,
              profile: movie.profile,
              tags: movie.tags,
              posterRemoteUrl: movie.posterUrl,
              sizeExempt: store.getItem(`${inst.id}:movie:${movie.id}`)?.sizeExempt ?? false,
            });
          }
        }
        if (inst.kind === "sonarr") {
          const series = parseSonarrSeries(await fetchJson(`${trimUrl(inst.url)}/api/v3/series`, key, httpFetch));
          for (const show of series) {
            const episodes = parseSonarrEpisodes(
              await fetchJson(`${trimUrl(inst.url)}/api/v3/episode?seriesId=${show.id}`, key, httpFetch),
              show.title,
              show.posterUrl,
              show.profile,
              show.tags,
            );
            for (const ep of episodes) {
              const id = `${inst.id}:episode:${ep.id}`;
              store.upsertItem({
                id,
                instanceId: inst.id,
                arrId: ep.id,
                arrSeriesId: ep.seriesId,
                arrEpisodeFileId: ep.episodeFileId,
                type: "episode",
                title: ep.seriesTitle,
                showTitle: ep.seriesTitle,
                season: ep.season,
                episode: ep.episode,
                episodeTitle: ep.episodeTitle,
                path: ep.path,
                sizeBytes: ep.size,
                quality: ep.quality,
                resolution: ep.resolution,
                profile: ep.profile,
                tags: ep.tags,
                posterRemoteUrl: ep.posterUrl,
                sizeExempt: store.getItem(id)?.sizeExempt ?? false,
              });
            }
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Sync failed.";
        errors.push(`${inst.name}: ${message}`);
      }
    }
    void started;
    void inspectPending();
    return c.json({ ok: true, errors, inspect: store.getInspectState() });
  });

  async function inspectPending(): Promise<void> {
    const items = store.listItems();
    const pending = items.filter((item) => store.getInspectionSig(item.id) !== `${item.path}|${item.sizeBytes}`);
    store.setInspectState({
      walking: pending.length > 0,
      pending: pending.length,
      inspected: items.length - pending.length,
      failed: store.listErrors().length,
    });
    for (const item of pending) {
      const readable = opts.readable ? await opts.readable(item.path) : await isReadable(item.path);
      if (!readable) {
        store.setFileError(item.path, item.id, "This path is not readable inside the container. Check the volume mount.");
        continue;
      }
      try {
        const raw = opts.probe
          ? await opts.probe(item.path, item.sizeBytes)
          : await defaultProbe(opts.env.ffprobe, item.path);
        const report = parseFfprobe(item.path, item.sizeBytes, raw);
        store.saveInspection(item.id, report);
        store.clearFileError(item.path);
        recomputeSuggestion(item.id);
      } catch (error) {
        const message = error instanceof Error ? error.message : "ffprobe failed.";
        store.setFileError(item.path, item.id, message);
      }
    }
    const left = store.listItems().filter((item) => store.getInspectionSig(item.id) !== `${item.path}|${item.sizeBytes}`);
    store.setInspectState({
      walking: false,
      pending: left.length,
      inspected: store.listItems().length - left.length,
      failed: store.listErrors().length,
    });
  }

  function recomputeSuggestion(itemId: string): Suggestion | null {
    const item = store.getItem(itemId);
    const report = store.getInspection(itemId);
    if (!item || !report) return null;
    const settings = store.getSettings();
    const excluded = isExcluded(item);
    const hw = lastHardware;
    const suggestion = buildSuggestion({
      item,
      report,
      settings,
      sizeExempt: item.sizeExempt,
      excluded,
      videoTarget: settings.videoTarget,
      av1Available: hw.av1,
    });
    return store.saveSuggestion(itemId, suggestion) ?? null;
  }

  let lastHardware: HardwareInfo = { backend: "none", cuda: false, vaapi: false, av1: false, reason: null };
  void hardware().then((h) => {
    lastHardware = h;
  });

  function isExcluded(item: ReturnType<Store["getItem"]>): boolean {
    if (!item) return false;
    return store.listExclusions().some((rule) => {
      if (rule.kind === "path") return item.path.startsWith(rule.value);
      if (rule.kind === "profile") return item.profile === rule.value;
      if (rule.kind === "tag") return item.tags.includes(rule.value);
      return item.title === rule.value || item.showTitle === rule.value;
    });
  }

  app.get("/api/library/movies", (c) => c.json({ items: store.listItems("movie").map(presentItem) }));
  app.get("/api/library/series", (c) => c.json({ items: store.listItems("episode").map(presentItem) }));
  app.get("/api/inspect/status", (c) => c.json(store.getInspectState()));
  app.get("/api/errors", (c) => c.json({ items: store.listErrors() }));

  app.post("/api/library/items/:id/force", async (c) => {
    const blocked = gateOptimize();
    if (blocked) return c.json({ error: blocked }, 403);
    const item = store.getItem(c.req.param("id"));
    if (!item) return c.json({ error: "That title is not in the library." }, 404);
    const report = store.getInspection(item.id);
    if (!report) return c.json({ error: "This file has not been inspected yet, or the path is unreadable." }, 400);
    const settings = store.getSettings();
    const suggestion = buildSuggestion({
      item,
      report,
      settings,
      sizeExempt: false,
      excluded: false,
      forceTranscode: true,
      videoTarget: settings.videoTarget,
      av1Available: lastHardware.av1,
    });
    if (!suggestion) return c.json({ error: "Force did not create work for this title." }, 400);
    const saved = store.saveSuggestion(item.id, suggestion);
    return c.json({ ok: true, onSuggestions: true, suggestion: saved });
  });

  app.post("/api/library/items/:id/stereo", async (c) => {
    const blocked = gateOptimize();
    if (blocked) return c.json({ error: blocked }, 403);
    const item = store.getItem(c.req.param("id"));
    if (!item) return c.json({ error: "That title is not in the library." }, 404);
    const report = store.getInspection(item.id);
    if (!report) return c.json({ error: "This file has not been inspected yet, or the path is unreadable." }, 400);
    if (report.audio.some((t) => t.channels <= 2)) {
      return c.json({ error: "This file already has a stereo track." }, 400);
    }
    const settings = store.getSettings();
    const suggestion = buildSuggestion({
      item,
      report,
      settings,
      sizeExempt: item.sizeExempt,
      excluded: false,
      forceStereo: true,
      videoTarget: settings.videoTarget,
      av1Available: lastHardware.av1,
    });
    if (!suggestion?.actions.includes("add_stereo")) {
      return c.json({ error: "Add stereo did not change the plan." }, 400);
    }
    return c.json({ ok: true, onSuggestions: true, suggestion: store.saveSuggestion(item.id, suggestion) });
  });

  app.post("/api/library/items/:id/exempt", async (c) => {
    const body = await c.req.json<{ exempt?: boolean }>();
    store.setExempt(c.req.param("id"), Boolean(body.exempt));
    recomputeSuggestion(c.req.param("id"));
    return c.json({ ok: true, item: presentItem(store.getItem(c.req.param("id"))!) });
  });

  app.post("/api/library/series/:instanceId/:show/optimize", async (c) => {
    const blocked = gateOptimize();
    if (blocked) return c.json({ error: blocked }, 403);
    const show = decodeURIComponent(c.req.param("show"));
    const episodes = store.listItems("episode").filter((e) => e.instanceId === c.req.param("instanceId") && e.showTitle === show);
    let queued = 0;
    let skipped = 0;
    for (const ep of episodes) {
      const suggestion = store.openSuggestionForItem(ep.id);
      if (!suggestion || store.pendingReviewForItem(ep.id) || store.activeJobForItem(ep.id)) {
        skipped += 1;
        continue;
      }
      const result = jobs.enqueue(ep.id, suggestion);
      if ("id" in result) queued += 1;
      else skipped += 1;
    }
    return c.json({ queued, skipped });
  });

  app.get("/api/suggestions", (c) => {
    const q = c.req.query("q") ?? "";
    const items = store
      .listSuggestions()
      .map((s) => presentSuggestion(s))
      .filter((s) => {
        const item = store.getItem(s.itemId);
        return item ? matchesTitleSearch(q, item) : !q;
      });
    return c.json({ items });
  });

  app.post("/api/suggestions/:id/dismiss", (c) => {
    store.dismissSuggestion(c.req.param("id"));
    return c.json({ ok: true });
  });

  app.post("/api/queue", async (c) => {
    const blocked = gateOptimize();
    if (blocked) return c.json({ error: blocked }, 403);
    const body = await c.req.json<{ suggestionId?: string; itemId?: string; runNow?: boolean }>();
    const suggestion = body.suggestionId ? store.getSuggestion(body.suggestionId) : body.itemId ? store.openSuggestionForItem(body.itemId) : undefined;
    if (!suggestion || suggestion.dismissed) return c.json({ error: "There is no open suggestion to queue." }, 400);
    const result = jobs.enqueue(suggestion.itemId, suggestion, Boolean(body.runNow));
    if ("error" in result) return c.json({ error: result.error }, result.status as 400 | 404 | 409);
    return c.json({ ok: true, id: result.id });
  });

  app.get("/api/jobs", (c) => c.json({ items: withTitles(store.listJobs(), store).map((j) => jobs.decorate(j)) }));

  app.post("/api/jobs/:id/cancel", (c) => {
    const result = jobs.cancel(c.req.param("id"));
    if ("error" in result) return c.json({ error: result.error }, result.status as 400 | 404 | 409);
    return c.json({ ok: true });
  });

  app.post("/api/jobs/:id/run-now", (c) => {
    store.updateJob(c.req.param("id"), { runNow: true, status: "queued", phase: "queued" });
    return c.json({ ok: true });
  });

  app.post("/api/jobs/reorder", async (c) => {
    const body = await c.req.json<{ ids?: string[] }>();
    (body.ids ?? []).forEach((id, index) => store.updateJob(id, { position: index + 1 }));
    return c.json({ ok: true });
  });

  app.post("/api/jobs/:id/pause", (c) => {
    const job = store.getJob(c.req.param("id"));
    if (!job || (job.status !== "queued" && job.status !== "held")) return c.json({ error: "Only waiting jobs can be paused." }, 409);
    store.updateJob(job.id, { status: "paused", phase: "paused" });
    return c.json({ ok: true });
  });

  app.get("/api/review", (c) => {
    return c.json({
      items: store.listReviews().map((r) => {
        const item = store.getItem(r.itemId);
        return { ...r, displayTitle: item ? displayTitle(item) : r.itemId };
      }),
    });
  });

  app.post("/api/review/:id/keep", async (c) => {
    const blocked = gateOptimize();
    if (blocked) return c.json({ error: blocked }, 403);
    const result = await jobs.keep(c.req.param("id"));
    if ("error" in result) return c.json({ error: result.error }, result.status as 400 | 404 | 409);
    return c.json({ ok: true }, 202);
  });

  app.post("/api/review/keep-selected", async (c) => {
    const blocked = gateOptimize();
    if (blocked) return c.json({ error: blocked }, 403);
    const body = await c.req.json<{ ids?: string[] }>();
    let accepted = 0;
    let skipped = 0;
    for (const id of body.ids ?? []) {
      const result = await jobs.keep(id);
      if ("accepted" in result) accepted += 1;
      else skipped += 1;
    }
    return c.json({ accepted, skipped }, 202);
  });

  app.post("/api/review/:id/discard", async (c) => {
    const result = await jobs.discard(c.req.param("id"));
    if ("error" in result) return c.json({ error: result.error }, result.status as 400 | 404 | 409);
    return c.json({ ok: true }, 202);
  });

  app.get("/api/history", (c) => {
    return c.json({
      items: store.listHistory().map((h) => {
        const item = store.getItem(h.itemId);
        return { ...h, displayTitle: item ? displayTitle(item) : h.displayTitle };
      }),
    });
  });

  app.get("/api/home", (c) => {
    const sav = store.savings();
    const running = store.listJobs().find((j) => j.status === "running");
    const queued = store.listJobs().filter((j) => j.status === "queued" || j.status === "held").length;
    return c.json({
      filesOptimized: sav.filesOptimized,
      spaceSavedBytes: sav.spaceSavedBytes,
      suggestions: store.listSuggestions().length,
      queued,
      review: store.listReviews().length,
      errors: store.listErrors().length,
      recent: store.listHistory().slice(0, 8),
      status: running ? `Working · ${jobs.decorate(running).displayTitle}` : queued ? `${queued} waiting` : "Idle",
    });
  });

  app.get("/api/search", (c) => {
    const q = c.req.query("q") ?? "";
    const hits = store
      .listItems()
      .filter((item) => matchesTitleSearch(q, item))
      .slice(0, 20)
      .map((item) => ({
        itemId: item.id,
        type: item.type,
        displayTitle: displayTitle(item),
        instanceName: item.instanceName,
        href: item.type === "movie" ? `/movies?focus=${item.id}` : `/series?focus=${item.id}`,
      }));
    return c.json({ items: hits });
  });

  app.post("/api/settings/widget-key", (c) => {
    const raw = randomBytes(24).toString("hex");
    store.setWidgetKeyHash(createHash("sha256").update(raw).digest("hex"));
    return c.json({ key: raw });
  });

  const widget = async (c: { req: { header: (n: string) => string | undefined }; json: (b: unknown, s?: number) => Response }) => {
    const settings = store.getSettings();
    const ip = requestAddress(c.req.header("x-real-ip"), c.req.header("x-forwarded-for"), opts.env.trustProxy);
    const presented = c.req.header("x-api-key") ?? c.req.header("authorization")?.replace(/^Bearer\s+/i, "");
    const envKey = opts.env.widgetKeyEnv;
    const hash = store.widgetKeyHash();
    const keyOk =
      (envKey && presented === envKey) ||
      (hash && presented && createHash("sha256").update(presented).digest("hex") === hash);
    if (!keyOk && !(settings.localAuthBypass && isLocalAddress(ip))) {
      return c.json({ error: "A widget key is required." }, 401);
    }
    const running = store.listJobs().find((j) => j.status === "running");
    const queued = store.listJobs().filter((j) => j.status === "queued" || j.status === "held").length;
    return c.json({
      status: running ? `Working · ${jobs.decorate(running).displayTitle}` : queued ? `${queued} waiting` : "Idle",
      queued,
      review: store.listReviews().length,
      suggestions: store.listSuggestions().length,
      failed: store.listJobs().filter((j) => j.status === "failed").length,
      runningTitle: running ? jobs.decorate(running).displayTitle : null,
      runningPhase: running?.phase ?? null,
      runningProgress: running?.progress ?? null,
    });
  };

  app.get("/api/widget", widget);
  app.get("/api/homepage", widget);

  app.get("/api/library/:id/poster", async (c) => {
    const user = await currentUser(c, c.req.header("x-real-ip"));
    if (!user) return c.json({ error: "Sign in to continue." }, 401);
    const item = store.getItem(c.req.param("id"));
    if (!item?.posterRemoteUrl) return c.body(null, 404);
    const inst = store.getInstance(item.instanceId);
    if (!inst?.secret) return c.body(null, 404);
    const res = await httpFetch(item.posterRemoteUrl, { headers: { "X-Api-Key": decryptSecret(secret, inst.secret) } });
    if (!res.ok) return c.body(null, 404);
    return new Response(res.body, { headers: { "Content-Type": res.headers.get("content-type") ?? "image/jpeg", "Cache-Control": "private, max-age=86400" } });
  });

  if (opts.env.webRoot && existsSync(opts.env.webRoot)) {
    app.use("/*", serveStatic({ root: opts.env.webRoot }));
    app.get("*", serveStatic({ path: join(opts.env.webRoot, "index.html") }));
  }

  function publicInstances() {
    return store.listInstances().map((i) => {
      const full = store.getInstance(i.id)!;
      const base = { id: full.id, kind: full.kind, name: full.name, url: full.url, enabled: Boolean(full.enabled) };
      if (full.kind === "radarr" || full.kind === "sonarr") return { ...base, hasApiKey: Boolean(full.secret) };
      return { ...base, hasToken: Boolean(full.secret) };
    });
  }

  function presentItem(item: NonNullable<ReturnType<Store["getItem"]>>) {
    const report = store.getInspection(item.id);
    const suggestion = store.openSuggestionForItem(item.id);
    const error = store.listErrors().find((e) => e.itemId === item.id);
    return {
      ...item,
      displayTitle: displayTitle(item),
      inspected: Boolean(report),
      report,
      suggestion,
      error: error?.reason ?? null,
      reasons: suggestion?.reasons ?? [],
    };
  }

  function presentSuggestion(suggestion: Suggestion) {
    const item = store.getItem(suggestion.itemId);
    return {
      ...suggestion,
      displayTitle: item ? displayTitle(item) : suggestion.itemId,
      instanceName: item?.instanceName,
      type: item?.type,
      quality: item?.quality,
      hasPoster: item?.hasPoster ?? false,
    };
  }

  return { app, store, jobs, inspectPending, secret };
}

function unsafeReviewPath(reviewPath: string, libraryPaths: string[]): boolean {
  const review = resolve(reviewPath);
  return libraryPaths.some((p) => {
    if (!p) return false;
    const lib = resolve(dirnameOf(p));
    return review === lib || review.startsWith(`${lib}/`) || lib.startsWith(`${review}/`);
  });
}

function dirnameOf(path: string): string {
  return path.replace(/\/[^/]+$/, "") || "/";
}

async function isReadable(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function defaultProbe(ffprobe: string, path: string): Promise<Record<string, unknown>> {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const run = promisify(execFile);
  const { stdout } = await run(ffprobe, ["-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", path], {
    maxBuffer: 1024 * 512,
  });
  return JSON.parse(stdout) as Record<string, unknown>;
}

void basename;
void DEFAULT_SETTINGS;
