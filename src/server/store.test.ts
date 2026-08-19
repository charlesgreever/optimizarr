import Database from "better-sqlite3";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Store } from "./store.ts";

describe("store schema migration", () => {
  const stores: Store[] = [];
  afterEach(() => {
    for (const store of stores) store.close();
    stores.length = 0;
  });

  it("adds a missing jobs.position column on an existing database", () => {
    const dir = mkdtempSync(join(tmpdir(), "opt-schema-"));
    const path = join(dir, "optimizarr.db");
    const legacy = new Database(path);
    legacy.exec(`
      CREATE TABLE jobs (
        id TEXT PRIMARY KEY,
        item_id TEXT NOT NULL,
        suggestion_id TEXT,
        status TEXT NOT NULL,
        phase TEXT NOT NULL,
        progress REAL NOT NULL DEFAULT 0,
        error TEXT,
        warning TEXT,
        run_now INTEGER NOT NULL DEFAULT 0,
        plan TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);
    legacy
      .prepare(
        "INSERT INTO jobs (id, item_id, suggestion_id, status, phase, progress, error, warning, run_now, plan, created_at) VALUES (?, ?, NULL, 'queued', 'queued', 0, NULL, NULL, 0, '{}', 1)",
      )
      .run("job-1", "item-1");
    legacy.close();

    const store = new Store(path);
    stores.push(store);
    const jobs = store.listJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.id).toBe("job-1");
  });
});
