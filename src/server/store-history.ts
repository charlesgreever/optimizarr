import type { DatabaseSync } from "node:sqlite";

export class HistoryStore {
  constructor(private db: DatabaseSync) {}

  add(itemId: number | null, title: string, action: string, detail?: string): void {
    this.db
      .prepare("INSERT INTO history (item_id, title, action, detail, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(itemId, title, action, detail ?? null, new Date().toISOString());
  }

  list(): Array<Record<string, unknown>> {
    return this.db
      .prepare("SELECT id, item_id AS itemId, title, action, detail, created_at AS createdAt FROM history ORDER BY id DESC")
      .all() as Array<Record<string, unknown>>;
  }
}
