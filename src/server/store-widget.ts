import type { DatabaseSync } from "node:sqlite";
import type { ItemType } from "./models.ts";
import { displayTitle } from "./titles.ts";

export class WidgetStore {
  constructor(private db: DatabaseSync) {}

  getTokenHash(): string | null {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = 'widget_token'").get() as
      | { value: string }
      | undefined;
    return row?.value || null;
  }

  setTokenHash(hash: string | null): void {
    if (!hash) {
      this.db.prepare("DELETE FROM settings WHERE key = 'widget_token'").run();
      return;
    }
    this.db
      .prepare("INSERT INTO settings (key, value) VALUES ('widget_token', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(hash);
  }

  countJobs(statuses: string[]): number {
    if (statuses.length === 0) return 0;
    const placeholders = statuses.map(() => "?").join(", ");
    const row = this.db.prepare(`SELECT COUNT(*) AS n FROM jobs WHERE status IN (${placeholders})`).get(...statuses) as { n: number };
    return row.n;
  }

  countReviews(status: string): number {
    return (this.db.prepare("SELECT COUNT(*) AS n FROM reviews WHERE status = ?").get(status) as { n: number }).n;
  }

  countOpenSuggestions(): number {
    return (this.db.prepare("SELECT COUNT(*) AS n FROM suggestions WHERE dismissed = 0 AND (forced = 1 OR actions_json != '[]')").get() as { n: number }).n;
  }

  countLibraryByType(type: ItemType): number {
    return (this.db.prepare("SELECT COUNT(*) AS n FROM library_items WHERE type = ?").get(type) as { n: number }).n;
  }

  lastJobError(): string | null {
    const row = this.db.prepare("SELECT error FROM jobs WHERE status = 'failed' AND error IS NOT NULL ORDER BY id DESC LIMIT 1").get() as { error: string | null } | undefined;
    return row?.error ?? null;
  }

  getRunningJob(): { displayTitle: string; phase: string | null; progress: number } | null {
    const row = this.db.prepare(`SELECT j.phase, j.progress, i.title, i.series_title AS seriesTitle,
      i.season_number AS seasonNumber, i.episode_number AS episodeNumber
      FROM jobs j JOIN library_items i ON i.id = j.item_id
      WHERE j.status = 'running' ORDER BY j.id DESC LIMIT 1`).get() as
      | { phase: string | null; progress: number; title: string; seriesTitle: string | null; seasonNumber: number | null; episodeNumber: number | null }
      | undefined;
    if (!row) return null;
    return { displayTitle: displayTitle(row), phase: row.phase, progress: Number(row.progress ?? 0) };
  }
}
