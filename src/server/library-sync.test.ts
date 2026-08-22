import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { LibrarySync } from "./library-sync.ts";
import { Store } from "./store.ts";

describe("LibrarySync", () => {
  it("uses one Arr request when startup and a manual refresh overlap", async () => {
    const store = new Store(join(mkdtempSync(join(tmpdir(), "opt-sync-")), "polisharr.db"));
    store.upsertInstance({ kind: "radarr", name: "Radarr", url: "http://radarr", secret: "packed", enabled: true });
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let movieRequests = 0;
    const sync = new LibrarySync({
      store,
      decrypt: () => "key",
      inspectPending: async () => undefined,
      intervalMs: 0,
      fetch: (async (input) => {
        if (String(input).endsWith("/rootfolder")) return new Response("[]");
        movieRequests += 1;
        await gate;
        return new Response("[]");
      }) as typeof fetch,
    });
    try {
      sync.start();
      const manual = sync.refresh();
      await vi.waitFor(() => expect(movieRequests).toBe(1));
      release?.();
      await manual;
      expect(movieRequests).toBe(1);
    } finally {
      sync.stop();
      store.close();
    }
  });

  it("refreshes enabled Arr instances on the background interval", async () => {
    const store = new Store(join(mkdtempSync(join(tmpdir(), "opt-sync-timer-")), "polisharr.db"));
    store.upsertInstance({ kind: "radarr", name: "Radarr", url: "http://radarr", secret: "packed", enabled: true });
    let movieRequests = 0;
    const sync = new LibrarySync({
      store,
      decrypt: () => "key",
      inspectPending: async () => undefined,
      intervalMs: 10,
      fetch: (async (input) => {
        if (String(input).endsWith("/movie")) movieRequests += 1;
        return new Response("[]");
      }) as typeof fetch,
    });
    try {
      sync.start();
      await vi.waitFor(() => expect(movieRequests).toBeGreaterThanOrEqual(2));
    } finally {
      sync.stop();
      store.close();
    }
  });

  it("stores Arr roots and blocks sync into an overlapping review folder", async () => {
    const store = new Store(join(mkdtempSync(join(tmpdir(), "opt-sync-roots-")), "polisharr.db"));
    store.upsertInstance({ kind: "radarr", name: "Radarr", url: "http://radarr", secret: "packed", enabled: true });
    store.saveSettings({ ...store.getSettings(), reviewPath: "/media/review" });
    let movieRequests = 0;
    const sync = new LibrarySync({
      store,
      decrypt: () => "key",
      inspectPending: async () => undefined,
      intervalMs: 0,
      fetch: (async (input) => {
        if (String(input).endsWith("/rootfolder")) return new Response(JSON.stringify([{ path: "/media" }]));
        movieRequests += 1;
        return new Response("[]");
      }) as typeof fetch,
    });
    try {
      const result = await sync.refresh();
      expect(store.listLibraryRoots()).toEqual(["/media"]);
      expect(result.errors).toEqual(["Radarr: The review folder overlaps this Arr library."]);
      expect(movieRequests).toBe(0);
    } finally {
      sync.stop();
      store.close();
    }
  });

  it("imports one Radarr movie from a Download webhook and ignores Test", async () => {
    const store = new Store(join(mkdtempSync(join(tmpdir(), "opt-sync-hook-")), "polisharr.db"));
    store.upsertInstance({ kind: "radarr", name: "Radarr", url: "http://radarr", secret: "packed", enabled: true });
    const urls: string[] = [];
    const sync = new LibrarySync({
      store,
      decrypt: () => "key",
      inspectPending: async () => undefined,
      intervalMs: 0,
      fetch: (async (input) => {
        const url = String(input);
        urls.push(url);
        if (url.endsWith("/movie/10")) {
          return new Response(JSON.stringify({
            id: 10,
            title: "Imported",
            movieFile: { path: "/media/imported.mkv", size: 2, quality: { quality: { name: "WEBDL-1080p" } } },
          }));
        }
        return new Response("[]");
      }) as typeof fetch,
    });
    try {
      await sync.notifyFromWebhook({ eventType: "Test" });
      expect(urls).toEqual([]);
      await sync.notifyFromWebhook({ eventType: "Download", movie: { id: 10 } });
      expect(urls.some((url) => url.endsWith("/movie/10"))).toBe(true);
      expect(urls.some((url) => url.endsWith("/movie"))).toBe(false);
      expect(store.listItems("movie")[0]?.title).toBe("Imported");
    } finally {
      sync.stop();
      store.close();
    }
  });
});
