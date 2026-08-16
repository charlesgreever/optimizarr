import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ArrClient } from "./arr.ts";
import { createApp } from "./app.ts";
import { Catalog } from "./catalog.ts";
import { parseFfprobe } from "./inspect.ts";
import { IntegrityError } from "./optimize.ts";
import { Store } from "./store.ts";
import { LibrarySync } from "./sync.ts";

function cookieHeader(res: Response): string {
  const headers = res.headers as Headers & { getSetCookie?: () => string[] };
  const parts =
    typeof headers.getSetCookie === "function"
      ? headers.getSetCookie.call(headers)
      : [headers.get("set-cookie") ?? ""];
  return parts.map((c) => c.split(";")[0]).filter(Boolean).join("; ");
}

describe("phase 4 remux review keep", () => {
  const dirs: string[] = [];
  const stores: Store[] = [];

  afterEach(() => {
    for (const s of stores.splice(0)) s.close();
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  async function setup(opts?: { failIntegrity?: boolean; notifyStatus?: number; renameError?: string }) {
    const dir = mkdtempSync(join(tmpdir(), "optimizarr-"));
    dirs.push(dir);
    const library = join(dir, "library");
    const review = join(dir, "review");
    mkdirSync(library);
    mkdirSync(review);
    const source = join(library, "movie.mkv");
    writeFileSync(source, "ORIGINAL-MEDIA-FILE-CONTENTS-ARE-HERE");
    const store = new Store(dir);
    stores.push(store);
    const calls: string[] = [];
    const fetchImpl = async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (url.endsWith("/movie")) {
        return Response.json([
          { id: 9, title: "Cleanup", movieFile: { path: source, size: 40, quality: { quality: { name: "WEBDL-1080p" } } } },
        ]);
      }
      if (url.includes("/command") || url.includes("/refresh") || url.includes("/Library")) {
        return new Response("x", { status: opts?.notifyStatus ?? 200 });
      }
      if (url.endsWith("/status")) return Response.json({ version: "1" });
      return new Response("no", { status: 404 });
    };
    const probe = () =>
      parseFfprobe(source, {
        format: { duration: "3600", size: "40" },
        streams: [
          { codec_type: "video", codec_name: "hevc", width: 1920, height: 1080 },
          { codec_type: "audio", codec_name: "aac", channels: 2, tags: { language: "eng" } },
          { codec_type: "subtitle", codec_name: "subrip", tags: { language: "spa" } },
        ],
      });
    const optimize = async (req: { sourcePath: string; sidecarPath: string; report: { durationSec: number } }) => {
      if (opts?.failIntegrity) throw new IntegrityError("Duration mismatch");
      const { copyFile, mkdir } = await import("node:fs/promises");
      const { dirname } = await import("node:path");
      await mkdir(dirname(req.sidecarPath), { recursive: true });
      await copyFile(req.sourcePath, req.sidecarPath);
      return { sidecarPath: req.sidecarPath, durationSec: req.report.durationSec, sizeBytes: 40 };
    };
    const catalog = new Catalog(store, probe);
    const sync = new LibrarySync(store, new ArrClient(fetchImpl), () => true);
    const app = createApp(store, { fetchImpl, pathReadable: () => true, sync, catalog, probe, optimize });
    const first = await app.request("/api/setup/first-run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "correct-horse", preferredLanguage: "eng" }),
    });
    const cookie = cookieHeader(first);
    await app.request("/api/settings", {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ reviewPath: review }),
    });
    await app.request("/api/instances", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ kind: "radarr", name: "R", url: "http://r", apiKey: "k" }),
    });
    await app.request("/api/players", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ kind: "plex", name: "Plex", url: "http://plex", token: "pt" }),
    });
    await app.request("/api/players", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ kind: "jellyfin", name: "JF", url: "http://jf", token: "jt" }),
    });
    await app.request("/api/library/refresh", { method: "POST", headers: { cookie } });
    return { app, store, cookie, source, review, library, calls, dir };
  }

  it("keeps both a Plex and a Jellyfin player in the list", async () => {
    const { app, cookie } = await setup();
    const listed = await app.request("/api/players", { headers: { cookie } }).then((r) => r.json());
    expect(listed.items).toHaveLength(2);
    expect(listed.items.map((p: { kind: string }) => p.kind).sort()).toEqual(["jellyfin", "plex"]);
    expect(listed.items.every((p: { token?: string }) => p.token === undefined)).toBe(true);
    const extra = await app.request("/api/players", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ kind: "plex", name: "Plex 2", url: "http://plex2", token: "t2" }),
    });
    expect(extra.status).toBe(201);
    const again = await app.request("/api/players", { headers: { cookie } }).then((r) => r.json());
    expect(again.items).toHaveLength(3);
    const ids = again.items.map((p: { id: number }) => p.id);
    expect(new Set(ids).size).toBe(3);
  });

  it("writes a sidecar to the review path and leaves the original until Keep", async () => {
    const { app, cookie, source, review } = await setup();
    const suggestions = await app.request("/api/suggestions", { headers: { cookie } }).then((r) => r.json());
    expect(suggestions.items[0].actions).toContain("remux");
    const queued = await app.request("/api/queue", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ suggestionId: suggestions.items[0].id }),
    });
    expect(queued.status).toBe(201);
    expect(readFileSync(source, "utf8")).toContain("ORIGINAL");
    const reviews = await app.request("/api/review", { headers: { cookie } }).then((r) => r.json());
    expect(reviews.items).toHaveLength(1);
    expect(String(reviews.items[0].sidecarPath).startsWith(review)).toBe(true);
    expect(reviews.items[0].compare.sidecar).toBeTruthy();
  });

  it("Keep replaces the original, Discard deletes only the sidecar", async () => {
    const { app, cookie, source } = await setup();
    const sid = (await app.request("/api/suggestions", { headers: { cookie } }).then((r) => r.json())).items[0].id;
    await app.request("/api/queue", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ suggestionId: sid }),
    });
    const review = (await app.request("/api/review", { headers: { cookie } }).then((r) => r.json())).items[0];
    const keep = await app.request(`/api/review/${review.id}/keep`, { method: "POST", headers: { cookie } });
    expect(keep.status).toBe(200);
    expect(readFileSync(source, "utf8")).toContain("ORIGINAL");
    expect(keep.json).toBeTypeOf("function");
    const body = await keep.json();
    expect(body.notify.some((n: { target: string }) => n.target === "Plex")).toBe(true);
    expect(body.notify.some((n: { target: string }) => n.target === "JF")).toBe(true);
    expect(body.notify.some((n: { target: string }) => n.target === "R")).toBe(true);
  });

  it("does not undo Keep when a player is down", async () => {
    const { app, cookie, source } = await setup({ notifyStatus: 503 });
    const sid = (await app.request("/api/suggestions", { headers: { cookie } }).then((r) => r.json())).items[0].id;
    await app.request("/api/queue", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ suggestionId: sid }),
    });
    const review = (await app.request("/api/review", { headers: { cookie } }).then((r) => r.json())).items[0];
    const keep = await app.request(`/api/review/${review.id}/keep`, { method: "POST", headers: { cookie } });
    const body = await keep.json();
    expect(keep.status).toBe(200);
    expect(body.error).toMatch(/HTTP 503/);
    expect(readFileSync(source, "utf8")).toBeTruthy();
  });

  it("blocks a second job while a sidecar is pending", async () => {
    const { app, cookie } = await setup();
    const sid = (await app.request("/api/suggestions", { headers: { cookie } }).then((r) => r.json())).items[0].id;
    const first = await app.request("/api/queue", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ suggestionId: sid }),
    });
    expect(first.status).toBe(201);
    const second = await app.request("/api/queue", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ suggestionId: sid }),
    });
    expect(second.status).toBe(409);
  });

  it("fails integrity without deleting the original", async () => {
    const { app, cookie, source } = await setup({ failIntegrity: true });
    const sid = (await app.request("/api/suggestions", { headers: { cookie } }).then((r) => r.json())).items[0].id;
    await app.request("/api/queue", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ suggestionId: sid }),
    });
    expect(readFileSync(source, "utf8")).toContain("ORIGINAL");
    const jobs = await app.request("/api/jobs", { headers: { cookie } }).then((r) => r.json());
    expect(jobs.items[0].status).toBe("failed");
    const reviews = await app.request("/api/review", { headers: { cookie } }).then((r) => r.json());
    expect(reviews.items).toHaveLength(0);
  });

  it("replaces across devices with a storage-aware move", async () => {
    const { store, source, review } = await setup();
    const item = store.listLibraryItems("movie")[0];
    const sidecar = join(review, "x.mkv");
    writeFileSync(sidecar, "NEW");
    store.createReview({
      itemId: item.id,
      jobId: 1,
      sourcePath: source,
      sidecarPath: sidecar,
      compare: {},
    });
    const { JobService } = await import("./jobs.ts");
    const moved: string[] = [];
    const jobs = new JobService(
      store,
      async () => {
        throw new Error("unused");
      },
      fetch,
      {
        rename: async () => {
          throw Object.assign(new Error("EXDEV"), { code: "EXDEV" });
        },
        unlink: async () => undefined,
        mkdir: async () => undefined,
        stat: async () => ({ size: 1 }) as never,
      },
      undefined,
      () => new Date(),
      () => ({
        copy: async () => ({ method: "ssh" as const, bytes: 3 }),
        move: async (src, dest) => {
          moved.push(`${src} -> ${dest}`);
          writeFileSync(dest, "NEW");
          return { method: "ssh", bytes: 3 };
        },
      }),
    );
    const result = await jobs.keep(store.listReviews()[0].id as number);
    expect(result.ok).toBe(true);
    expect(moved).toEqual([`${sidecar} -> ${source}`]);
    expect(readFileSync(source, "utf8")).toBe("NEW");
  });

  it("keeps both files when Keep cannot replace the original", async () => {
    const { store, source, review } = await setup();
    const item = store.listLibraryItems("movie")[0];
    const sidecar = join(review, "x.mkv");
    writeFileSync(sidecar, "NEW");
    store.createReview({
      itemId: item.id,
      jobId: 1,
      sourcePath: source,
      sidecarPath: sidecar,
      compare: {},
    });
    const { JobService } = await import("./jobs.ts");
    const jobs = new JobService(store, async () => {
      throw new Error("unused");
    }, fetch, {
      rename: async () => {
        throw new Error("EACCES");
      },
      unlink: async () => undefined,
      mkdir: async () => undefined,
      stat: async () => ({ size: 1 }) as never,
    });
    const result = await jobs.keep(store.listReviews()[0].id as number);
    expect(result.ok).toBe(false);
    expect(readFileSync(source, "utf8")).toContain("ORIGINAL");
    expect(readFileSync(sidecar, "utf8")).toBe("NEW");
  });

  it("Discard leaves the original and removes the sidecar", async () => {
    const { app, cookie, source } = await setup();
    const sid = (await app.request("/api/suggestions", { headers: { cookie } }).then((r) => r.json())).items[0].id;
    await app.request("/api/queue", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ suggestionId: sid }),
    });
    const review = (await app.request("/api/review", { headers: { cookie } }).then((r) => r.json())).items[0];
    const disc = await app.request(`/api/review/${review.id}/discard`, { method: "POST", headers: { cookie } });
    expect(disc.status).toBe(200);
    expect(readFileSync(source, "utf8")).toContain("ORIGINAL");
    expect(await app.request("/api/review", { headers: { cookie } }).then((r) => r.json())).toMatchObject({
      items: [],
    });
  });
});
