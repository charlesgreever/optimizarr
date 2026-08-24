import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type {
  ActivityOutcome,
  ExclusionKind,
  ExecutablePlan,
  FileError,
  HistoryRow,
  InspectionReport,
  Job,
  JobPhase,
  JobStatus,
  LibraryItem,
  ReviewItem,
  ReviewStatus,
  Settings,
  Suggestion,
} from "./types.ts";
import { normalizeInspection } from "./inspect.ts";
import { displayTitle, tokenize } from "./titles.ts";
import { parseStoredSettings } from "./settings.ts";
import type { SuggestionFilters } from "./suggestion-filters.ts";
import { suggestionTrackComparison } from "./tracks.ts";

export type Page<T> = { items: T[]; nextOffset: number | null; total: number; pendingCount?: number };

export type LibrarySnapshot = {
  item: LibraryItem;
  report: InspectionReport | null;
  suggestion: Suggestion | null;
  error: string | null;
};

type JobPlan = Suggestion | ExecutablePlan;

export type SeriesSummaryRecord = {
  instanceId: string;
  instanceName: string;
  arrSeriesId: number;
  showTitle: string;
  episodeCount: number;
  healthyCount: number;
  suggestionCount: number;
};

export type StoredInstance = {
  id: string;
  kind: "radarr" | "sonarr" | "plex" | "jellyfin";
  name: string;
  url: string;
  secret: string | null;
  enabled: boolean;
};

export class Store {
  readonly db: Database.Database;

  constructor(path: string) {
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS instances (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        name TEXT NOT NULL,
        url TEXT NOT NULL,
        secret TEXT,
        enabled INTEGER NOT NULL DEFAULT 1
      );
      CREATE TABLE IF NOT EXISTS library_items (
        id TEXT PRIMARY KEY,
        instance_id TEXT NOT NULL,
        arr_id INTEGER NOT NULL,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        show_title TEXT,
        season INTEGER,
        episode INTEGER,
        episode_title TEXT,
        path TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        quality TEXT NOT NULL DEFAULT '',
        resolution TEXT NOT NULL DEFAULT '',
        profile TEXT NOT NULL DEFAULT '',
        tags TEXT NOT NULL DEFAULT '[]',
        poster_remote TEXT,
        poster_bytes BLOB,
        size_exempt INTEGER NOT NULL DEFAULT 0,
        UNIQUE(instance_id, type, arr_id)
      );
      CREATE TABLE IF NOT EXISTS inspections (
        item_id TEXT PRIMARY KEY,
        source_sig TEXT NOT NULL,
        report TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS suggestions (
        id TEXT PRIMARY KEY,
        item_id TEXT NOT NULL,
        payload TEXT NOT NULL,
        dismissed INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        item_id TEXT NOT NULL,
        suggestion_id TEXT,
        status TEXT NOT NULL,
        phase TEXT NOT NULL,
        progress REAL NOT NULL DEFAULT 0,
        error TEXT,
        warning TEXT,
        run_now INTEGER NOT NULL DEFAULT 0,
        position INTEGER NOT NULL,
        plan TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS reviews (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL,
        item_id TEXT NOT NULL,
        status TEXT NOT NULL,
        flagged INTEGER NOT NULL DEFAULT 0,
        flag_reason TEXT,
        source_path TEXT NOT NULL,
        sidecar_path TEXT NOT NULL,
        compare TEXT NOT NULL,
        error TEXT
      );
      CREATE TABLE IF NOT EXISTS file_errors (
        path TEXT PRIMARY KEY,
        item_id TEXT,
        reason TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS history (
        id TEXT PRIMARY KEY,
        item_id TEXT NOT NULL,
        outcome TEXT NOT NULL,
        bytes_saved INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS exclusions (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS library_roots (
        instance_id TEXT NOT NULL,
        path TEXT NOT NULL,
        PRIMARY KEY (instance_id, path)
      );
      CREATE TABLE IF NOT EXISTS inspect_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        walking INTEGER NOT NULL DEFAULT 0,
        pending INTEGER NOT NULL DEFAULT 0,
        inspected INTEGER NOT NULL DEFAULT 0,
        failed INTEGER NOT NULL DEFAULT 0
      );
      INSERT OR IGNORE INTO inspect_state (id, walking, pending, inspected, failed) VALUES (1, 0, 0, 0, 0);
    `);
    this.ensureColumn("jobs", "position", "INTEGER NOT NULL DEFAULT 0");
    this.ensureColumn("jobs", "phase", "TEXT NOT NULL DEFAULT 'queued'");
    this.ensureColumn("jobs", "progress", "REAL NOT NULL DEFAULT 0");
    this.ensureColumn("jobs", "warning", "TEXT");
    this.ensureColumn("jobs", "run_now", "INTEGER NOT NULL DEFAULT 0");
    this.ensureColumn("jobs", "plan", "TEXT NOT NULL DEFAULT '{}'");
    this.ensureColumn("jobs", "suggestion_id", "TEXT");
    this.ensureColumn("jobs", "error", "TEXT");
    this.ensureColumn("jobs", "created_at", "INTEGER NOT NULL DEFAULT 0");
    this.ensureColumn("jobs", "write_mode", "TEXT NOT NULL DEFAULT 'sidecar'");
    this.ensureColumn("jobs", "promote_error", "TEXT");
    this.ensureColumn("jobs", "queue_visible", "INTEGER NOT NULL DEFAULT 1");
    this.ensureColumn("jobs", "log", "TEXT");
    this.ensureColumn("library_items", "arr_series_id", "INTEGER");
    this.ensureColumn("library_items", "arr_episode_file_id", "INTEGER");
    this.db.prepare("DELETE FROM settings WHERE key = 'github_token'").run();
  }

  private ensureColumn(table: string, column: string, definition: string): void {
    const columns = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (columns.some((row) => row.name === column)) return;
    this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }

  probeWrite(value: string): void {
    this.db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('probe', ?)").run(value);
  }

  probeRead(): string | undefined {
    const row = this.db.prepare("SELECT value FROM meta WHERE key = 'probe'").get() as { value: string } | undefined;
    return row?.value;
  }

  getSettings(): Settings {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = 'app'").get() as { value: string } | undefined;
    if (!row) return parseStoredSettings({});
    try {
      return parseStoredSettings(JSON.parse(row.value));
    } catch {
      return parseStoredSettings({});
    }
  }

  saveSettings(next: Settings): void {
    this.db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('app', ?)").run(JSON.stringify(next));
  }

  userCount(): number {
    return (this.db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n;
  }

  createUser(username: string, passwordHash: string): void {
    this.db.prepare("INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)").run(randomUUID(), username, passwordHash);
  }

  findUser(username: string): { id: string; username: string; passwordHash: string } | undefined {
    const row = this.db.prepare("SELECT id, username, password_hash FROM users WHERE username = ?").get(username) as
      | { id: string; username: string; password_hash: string }
      | undefined;
    return row ? { id: row.id, username: row.username, passwordHash: row.password_hash } : undefined;
  }

  onlyUser(): { id: string; username: string; passwordHash: string } | undefined {
    const row = this.db.prepare("SELECT id, username, password_hash FROM users LIMIT 1").get() as
      | { id: string; username: string; password_hash: string }
      | undefined;
    return row ? { id: row.id, username: row.username, passwordHash: row.password_hash } : undefined;
  }

  updateUser(id: string, username: string, passwordHash: string): void {
    this.db.prepare("UPDATE users SET username = ?, password_hash = ? WHERE id = ?").run(username, passwordHash, id);
  }

  createSession(userId: string, ttlMs: number, now = Date.now()): string {
    const id = randomUUID();
    this.db.prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)").run(id, userId, now + ttlMs);
    return id;
  }

  getSession(id: string, now = Date.now()): { userId: string } | undefined {
    const row = this.db.prepare("SELECT user_id, expires_at FROM sessions WHERE id = ?").get(id) as
      | { user_id: string; expires_at: number }
      | undefined;
    if (!row || row.expires_at <= now) return undefined;
    return { userId: row.user_id };
  }

  deleteSession(id: string): void {
    this.db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
  }

  deleteUserSessions(userId: string): void {
    this.db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
  }

  upsertInstance(row: {
    id?: string;
    kind: StoredInstance["kind"];
    name: string;
    url: string;
    secret?: string | null;
    enabled: boolean;
  }): string {
    const id = row.id ?? randomUUID();
    const existing = this.db.prepare("SELECT secret FROM instances WHERE id = ?").get(id) as { secret: string | null } | undefined;
    const secret = row.secret === undefined ? existing?.secret ?? null : row.secret;
    this.db
      .prepare(
        `INSERT INTO instances (id, kind, name, url, secret, enabled) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET kind=excluded.kind, name=excluded.name, url=excluded.url, secret=excluded.secret, enabled=excluded.enabled`,
      )
      .run(id, row.kind, row.name, row.url, secret, row.enabled ? 1 : 0);
    return id;
  }

  listInstances(): StoredInstance[] {
    return (this.db.prepare("SELECT * FROM instances").all() as Record<string, unknown>[]).map(mapInstance);
  }

  getInstance(id: string): StoredInstance | undefined {
    const row = this.db.prepare("SELECT * FROM instances WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? mapInstance(row) : undefined;
  }

  deleteInstance(id: string): void {
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM library_roots WHERE instance_id = ?").run(id);
      this.db.prepare("DELETE FROM instances WHERE id = ?").run(id);
    })();
  }

  replaceLibraryRoots(instanceId: string, paths: string[]): void {
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM library_roots WHERE instance_id = ?").run(instanceId);
      const insert = this.db.prepare("INSERT INTO library_roots (instance_id, path) VALUES (?, ?)");
      for (const path of new Set(paths)) insert.run(instanceId, path);
    })();
  }

  listLibraryRoots(instanceId?: string): string[] {
    const rows = instanceId
      ? this.db.prepare("SELECT path FROM library_roots WHERE instance_id = ? ORDER BY path").all(instanceId)
      : this.db.prepare("SELECT path FROM library_roots ORDER BY path").all();
    return (rows as Array<{ path: string }>).map((row) => row.path);
  }

  upsertItem(item: Omit<LibraryItem, "hasPoster" | "instanceName"> & { posterBytes?: Buffer | null }): string {
    this.db
      .prepare(
        `INSERT INTO library_items (id, instance_id, arr_id, arr_series_id, arr_episode_file_id, type, title, show_title, season, episode, episode_title, path, size_bytes, quality, resolution, profile, tags, poster_remote, poster_bytes, size_exempt)
         VALUES (@id, @instanceId, @arrId, @arrSeriesId, @arrEpisodeFileId, @type, @title, @showTitle, @season, @episode, @episodeTitle, @path, @sizeBytes, @quality, @resolution, @profile, @tags, @posterRemoteUrl, @posterBytes, @sizeExempt)
         ON CONFLICT(instance_id, type, arr_id) DO UPDATE SET
           title=excluded.title, show_title=excluded.show_title, season=excluded.season, episode=excluded.episode,
           episode_title=excluded.episode_title, path=excluded.path, size_bytes=excluded.size_bytes, quality=excluded.quality,
           resolution=excluded.resolution, profile=excluded.profile, tags=excluded.tags, poster_remote=excluded.poster_remote,
           poster_bytes=COALESCE(excluded.poster_bytes, poster_bytes),
           arr_series_id=excluded.arr_series_id, arr_episode_file_id=excluded.arr_episode_file_id`,
      )
      .run({
        ...item,
        tags: JSON.stringify(item.tags),
        sizeExempt: item.sizeExempt ? 1 : 0,
        posterBytes: item.posterBytes ?? null,
      });
    return item.id;
  }

  getItem(id: string): LibraryItem | undefined {
    const row = this.db.prepare(
      `SELECT i.*, inst.name AS instance_name FROM library_items i JOIN instances inst ON inst.id = i.instance_id WHERE i.id = ?`,
    ).get(id) as Record<string, unknown> | undefined;
    return row ? mapItem(row) : undefined;
  }

  listItems(type?: "movie" | "episode"): LibraryItem[] {
    const sql = type
      ? `SELECT i.*, inst.name AS instance_name FROM library_items i JOIN instances inst ON inst.id = i.instance_id WHERE i.type = ?`
      : `SELECT i.*, inst.name AS instance_name FROM library_items i JOIN instances inst ON inst.id = i.instance_id`;
    const rows = type ? this.db.prepare(sql).all(type) : this.db.prepare(sql).all();
    return (rows as Record<string, unknown>[]).map(mapItem);
  }

  libraryPage(opts: {
    type: "movie" | "episode";
    offset: number;
    limit: number;
    sort?: "title" | "size" | "quality";
    instanceId?: string;
    arrSeriesId?: number;
  }): { rows: LibrarySnapshot[]; total: number } {
    const where = ["i.type = @type"];
    if (opts.instanceId !== undefined) where.push("i.instance_id = @instanceId");
    if (opts.arrSeriesId !== undefined) where.push("i.arr_series_id = @arrSeriesId");
    const params = {
      type: opts.type,
      offset: opts.offset,
      limit: opts.limit,
      instanceId: opts.instanceId ?? "",
      arrSeriesId: opts.arrSeriesId ?? -1,
    };
    const clause = where.join(" AND ");
    const movieOrder = opts.sort === "size"
      ? "i.size_bytes DESC, LOWER(i.title), i.id"
      : opts.sort === "quality"
        ? "LOWER(i.quality), LOWER(i.title), i.id"
        : "LOWER(i.title), i.id";
    const order = opts.type === "movie" ? movieOrder : "i.season, i.episode, i.id";
    const rows = this.db.prepare(
      `SELECT i.*, inst.name AS instance_name, ins.report AS inspection_report,
              sug.payload AS suggestion_payload,
              (SELECT err.reason FROM file_errors err WHERE err.item_id = i.id
               ORDER BY CASE WHEN err.path = i.path THEN 0 ELSE 1 END, err.path LIMIT 1) AS error_reason
       FROM library_items i
       JOIN instances inst ON inst.id = i.instance_id
       LEFT JOIN inspections ins ON ins.item_id = i.id
       LEFT JOIN suggestions sug ON sug.item_id = i.id AND sug.dismissed = 0
       WHERE ${clause}
       ORDER BY ${order}
       LIMIT @limit OFFSET @offset`,
    ).all(params) as Record<string, unknown>[];
    const total = Number(
      (this.db.prepare(`SELECT COUNT(*) AS n FROM library_items i WHERE ${clause}`).get(params) as { n: number }).n,
    );
    return { rows: rows.map(mapLibrarySnapshot), total };
  }

  librarySnapshot(id: string): LibrarySnapshot | undefined {
    const row = this.db.prepare(
      `SELECT i.*, inst.name AS instance_name, ins.report AS inspection_report,
              sug.payload AS suggestion_payload,
              (SELECT err.reason FROM file_errors err WHERE err.item_id = i.id
               ORDER BY CASE WHEN err.path = i.path THEN 0 ELSE 1 END, err.path LIMIT 1) AS error_reason
       FROM library_items i
       JOIN instances inst ON inst.id = i.instance_id
       LEFT JOIN inspections ins ON ins.item_id = i.id
       LEFT JOIN suggestions sug ON sug.item_id = i.id AND sug.dismissed = 0
       WHERE i.id = ?`,
    ).get(id) as Record<string, unknown> | undefined;
    return row ? mapLibrarySnapshot(row) : undefined;
  }

  seriesPage(offset: number, limit: number): { rows: SeriesSummaryRecord[]; total: number } {
    const rows = this.db.prepare(
      `SELECT i.instance_id, inst.name AS instance_name, i.arr_series_id, i.show_title,
              COUNT(*) AS episode_count,
              SUM(CASE WHEN EXISTS (
                    SELECT 1 FROM suggestions s WHERE s.item_id = i.id AND s.dismissed = 0
                  ) THEN 1 ELSE 0 END) AS suggestion_count,
              SUM(CASE WHEN EXISTS (SELECT 1 FROM inspections ins WHERE ins.item_id = i.id)
                    AND NOT EXISTS (SELECT 1 FROM suggestions s WHERE s.item_id = i.id AND s.dismissed = 0)
                    AND NOT EXISTS (SELECT 1 FROM file_errors err WHERE err.item_id = i.id)
                  THEN 1 ELSE 0 END) AS healthy_count
       FROM library_items i
       JOIN instances inst ON inst.id = i.instance_id
       WHERE i.type = 'episode' AND i.arr_series_id IS NOT NULL
       GROUP BY i.instance_id, inst.name, i.arr_series_id, i.show_title
       ORDER BY LOWER(i.show_title), i.instance_id, i.arr_series_id
       LIMIT ? OFFSET ?`,
    ).all(limit, offset) as Record<string, unknown>[];
    const total = Number((this.db.prepare(
      `SELECT COUNT(*) AS n FROM (
         SELECT 1 FROM library_items
         WHERE type = 'episode' AND arr_series_id IS NOT NULL
         GROUP BY instance_id, arr_series_id, show_title
       )`,
    ).get() as { n: number }).n);
    return {
      rows: rows.map((row) => ({
        instanceId: String(row.instance_id),
        instanceName: String(row.instance_name),
        arrSeriesId: Number(row.arr_series_id),
        showTitle: String(row.show_title ?? "Untitled series"),
        episodeCount: Number(row.episode_count),
        healthyCount: Number(row.healthy_count),
        suggestionCount: Number(row.suggestion_count),
      })),
      total,
    };
  }

  setExempt(id: string, exempt: boolean): void {
    this.db.prepare("UPDATE library_items SET size_exempt = ? WHERE id = ?").run(exempt ? 1 : 0, id);
  }

  updateItemFile(id: string, path: string, sizeBytes: number): void {
    this.db.prepare("UPDATE library_items SET path = ?, size_bytes = ? WHERE id = ?").run(path, sizeBytes, id);
  }

  deleteInspection(itemId: string): void {
    this.db.prepare("DELETE FROM inspections WHERE item_id = ?").run(itemId);
  }

  saveInspection(itemId: string, report: InspectionReport): void {
    this.db
      .prepare("INSERT OR REPLACE INTO inspections (item_id, source_sig, report) VALUES (?, ?, ?)")
      .run(itemId, report.sourceSig, JSON.stringify(report));
  }

  getInspection(itemId: string): InspectionReport | undefined {
    const row = this.db.prepare("SELECT report FROM inspections WHERE item_id = ?").get(itemId) as { report: string } | undefined;
    return row ? normalizeInspection(JSON.parse(row.report) as Record<string, unknown>) : undefined;
  }

  getInspectionSig(itemId: string): string | undefined {
    const row = this.db.prepare("SELECT source_sig FROM inspections WHERE item_id = ?").get(itemId) as { source_sig: string } | undefined;
    return row?.source_sig;
  }

  saveSuggestion(itemId: string, suggestion: Suggestion | null): Suggestion | undefined {
    this.db.prepare("DELETE FROM suggestions WHERE item_id = ? AND dismissed = 0").run(itemId);
    if (!suggestion) return undefined;
    const id = suggestion.id || randomUUID();
    const stored = { ...suggestion, id, itemId };
    this.db.prepare("INSERT INTO suggestions (id, item_id, payload, dismissed) VALUES (?, ?, ?, 0)").run(id, itemId, JSON.stringify(stored));
    return stored;
  }

  dismissSuggestion(id: string): void {
    this.db.prepare("UPDATE suggestions SET dismissed = 1 WHERE id = ?").run(id);
  }

  getSuggestion(id: string): Suggestion | undefined {
    const row = this.db.prepare("SELECT payload, dismissed FROM suggestions WHERE id = ?").get(id) as
      | { payload: string; dismissed: number }
      | undefined;
    if (!row) return undefined;
    return { ...(JSON.parse(row.payload) as Suggestion), dismissed: row.dismissed === 1 };
  }

  openSuggestionForItem(itemId: string): Suggestion | undefined {
    const row = this.db.prepare("SELECT payload FROM suggestions WHERE item_id = ? AND dismissed = 0").get(itemId) as
      | { payload: string }
      | undefined;
    return row ? (JSON.parse(row.payload) as Suggestion) : undefined;
  }

  listSuggestions(): Suggestion[] {
    return (this.db.prepare("SELECT payload FROM suggestions WHERE dismissed = 0").all() as { payload: string }[]).map(
      (r) => JSON.parse(r.payload) as Suggestion,
    );
  }

  suggestionPage(offset: number, limit: number, query = "", filters: SuggestionFilters = {}): Page<Suggestion & { displayTitle: string; instanceName?: string; type?: LibraryItem["type"]; quality?: string; hasPoster: boolean }> {
    const filtered = suggestionWhere(query, filters, this.getSettings());
    const joins = "FROM suggestions s LEFT JOIN library_items i ON i.id = s.item_id LEFT JOIN instances n ON n.id = i.instance_id LEFT JOIN inspections ins ON ins.item_id = i.id";
    const total = Number((this.db.prepare(`SELECT COUNT(*) AS n ${joins} WHERE ${filtered.where}`).get(...filtered.params) as { n: number }).n);
    const rows = this.db.prepare(
      `SELECT s.payload, i.type AS item_type, i.title AS item_title, i.show_title AS item_show_title,
              i.season AS item_season, i.episode AS item_episode, i.episode_title AS item_episode_title,
              i.quality AS item_quality, i.poster_bytes AS item_poster_bytes, i.poster_remote AS item_poster_remote,
              n.name AS item_instance_name, ins.report AS inspection_report
       ${joins}
       WHERE ${filtered.where}
       ORDER BY LOWER(COALESCE(i.show_title, i.title, s.item_id)), i.season, i.episode, s.id
       LIMIT ? OFFSET ?`,
    ).all(...filtered.params, limit, offset) as Record<string, unknown>[];
    return page(rows.map((row) => {
      const suggestion = JSON.parse(String(row.payload)) as Suggestion;
      const report = row.inspection_report == null
        ? null
        : normalizeInspection(JSON.parse(String(row.inspection_report)) as Record<string, unknown>);
      const tracks = suggestionTrackComparison(report, suggestion);
      return {
        ...suggestion,
        now: { ...suggestion.now, tracks: tracks.nowTracks },
        after: { ...suggestion.after, tracks: tracks.afterTracks },
        displayTitle: joinedDisplayTitle(row, suggestion.itemId),
        instanceName: row.item_instance_name == null ? undefined : String(row.item_instance_name),
        type: row.item_type === "episode" ? "episode" : row.item_type === "movie" ? "movie" : undefined,
        href: itemHref(row.item_type, suggestion.itemId),
        quality: row.item_quality == null ? undefined : String(row.item_quality),
        hasPoster: Boolean(row.item_poster_bytes || row.item_poster_remote),
      };
    }), total, offset, limit);
  }

  suggestionIds(query = "", filters: SuggestionFilters = {}): string[] {
    const filtered = suggestionWhere(query, filters, this.getSettings());
    const rows = this.db.prepare(
      `SELECT s.id FROM suggestions s
       LEFT JOIN library_items i ON i.id = s.item_id
       LEFT JOIN instances n ON n.id = i.instance_id
       LEFT JOIN inspections ins ON ins.item_id = i.id
       WHERE ${filtered.where}
       ORDER BY s.id`,
    ).all(...filtered.params) as Array<{ id: string }>;
    return rows.map((row) => row.id);
  }

  setFileError(path: string, itemId: string | null, reason: string): void {
    this.db.prepare("INSERT OR REPLACE INTO file_errors (path, item_id, reason) VALUES (?, ?, ?)").run(path, itemId, reason);
  }

  clearFileError(path: string): void {
    this.db.prepare("DELETE FROM file_errors WHERE path = ?").run(path);
  }

  listErrors(): FileError[] {
    const rows = this.db.prepare("SELECT path, item_id, reason FROM file_errors").all() as Array<{
      path: string;
      item_id: string | null;
      reason: string;
    }>;
    return rows.map((r) => {
      const item = r.item_id ? this.getItem(r.item_id) : undefined;
      const fileName = r.path.split("/").pop() || r.path;
      return {
        itemId: r.item_id,
        path: r.path,
        fileName,
        displayTitle: item ? `${item.title}` : fileName,
        reason: r.reason,
        type: item?.type,
        href: item ? itemHref(item.type, item.id) : undefined,
      };
    });
  }

  errorPage(offset: number, limit: number): Page<FileError> {
    const total = Number((this.db.prepare("SELECT COUNT(*) AS n FROM file_errors").get() as { n: number }).n);
    const rows = this.db.prepare(
      `SELECT e.path, e.item_id, e.reason, i.type AS item_type, i.title AS item_title,
              i.show_title AS item_show_title, i.season AS item_season, i.episode AS item_episode,
              i.episode_title AS item_episode_title
       FROM file_errors e LEFT JOIN library_items i ON i.id = e.item_id
       ORDER BY e.path LIMIT ? OFFSET ?`,
    ).all(limit, offset) as Record<string, unknown>[];
    return page(rows.map((row) => {
      const itemId = row.item_id == null ? null : String(row.item_id);
      const fileName = String(row.path).split("/").pop() || String(row.path);
      const type = row.item_type === "episode" ? "episode" as const : row.item_type === "movie" ? "movie" as const : undefined;
      return {
        itemId,
        path: String(row.path),
        fileName,
        displayTitle: joinedDisplayTitle(row, fileName),
        reason: String(row.reason),
        type,
        href: itemId == null ? undefined : itemHref(row.item_type, itemId),
      };
    }), total, offset, limit);
  }

  setInspectState(state: { walking: boolean; pending: number; inspected: number; failed: number }): void {
    this.db
      .prepare("UPDATE inspect_state SET walking=?, pending=?, inspected=?, failed=? WHERE id=1")
      .run(state.walking ? 1 : 0, state.pending, state.inspected, state.failed);
  }

  getInspectState(): { walking: boolean; pending: number; inspected: number; failed: number } {
    const row = this.db.prepare("SELECT * FROM inspect_state WHERE id=1").get() as {
      walking: number;
      pending: number;
      inspected: number;
      failed: number;
    };
    return { walking: row.walking === 1, pending: row.pending, inspected: row.inspected, failed: row.failed };
  }

  insertJob(job: Omit<Job, "displayTitle" | "writeMode" | "promoteError"> & { plan: unknown; position?: number; writeMode?: "sidecar" | "direct"; promoteError?: string | null }): string {
    const position =
      job.position ??
      ((this.db.prepare("SELECT COALESCE(MAX(position), 0) + 1 AS n FROM jobs").get() as { n: number }).n);
    this.db
      .prepare(
        `INSERT INTO jobs (id, item_id, suggestion_id, status, phase, progress, error, warning, run_now, position, plan, created_at, write_mode, promote_error)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        job.id,
        job.itemId,
        job.suggestionId,
        job.status,
        job.phase,
        job.progress,
        job.error,
        job.warning,
        job.runNow ? 1 : 0,
        position,
        JSON.stringify(job.plan),
        job.createdAt,
        job.writeMode === "direct" ? "direct" : "sidecar",
        job.promoteError ?? null,
      );
    return job.id;
  }

  updateJob(id: string, patch: Partial<{ status: JobStatus; phase: JobPhase; progress: number; error: string | null; runNow: boolean; position: number; promoteError: string | null; writeMode: "sidecar" | "direct" }>): void {
    const current = this.db.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    if (!current) return;
    this.db
      .prepare(
        "UPDATE jobs SET status=?, phase=?, progress=?, error=?, run_now=?, position=?, write_mode=?, promote_error=? WHERE id=?",
      )
      .run(
        patch.status ?? current.status,
        patch.phase ?? current.phase,
        patch.progress ?? current.progress,
        patch.error === undefined ? current.error : patch.error,
        (patch.runNow ?? current.run_now === 1) ? 1 : 0,
        patch.position ?? current.position,
        patch.writeMode ?? current.write_mode ?? "sidecar",
        patch.promoteError === undefined ? current.promote_error : patch.promoteError,
        id,
      );
  }

  appendJobLog(id: string, chunk: string): void {
    const row = this.db.prepare("SELECT log FROM jobs WHERE id = ?").get(id) as { log: string | null } | undefined;
    if (!row) return;
    const next = `${row.log ?? ""}${chunk}`.slice(-32_768);
    this.db.prepare("UPDATE jobs SET log = ? WHERE id = ?").run(next, id);
  }

  jobLog(id: string): string | null {
    const row = this.db.prepare("SELECT log FROM jobs WHERE id = ?").get(id) as { log: string | null } | undefined;
    return row ? (row.log ?? "") : null;
  }

  listJobs(): Array<Job & { plan: JobPlan }> {
    return (this.db.prepare("SELECT * FROM jobs WHERE queue_visible = 1 ORDER BY position ASC").all() as Record<string, unknown>[]).map(mapJob);
  }

  jobPage(offset: number, limit: number): Page<Job & { plan: JobPlan }> {
    const total = Number((this.db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE queue_visible = 1").get() as { n: number }).n);
    const rows = this.db.prepare(
      `SELECT j.*, i.type AS item_type, i.title AS item_title, i.show_title AS item_show_title,
              i.season AS item_season, i.episode AS item_episode, i.episode_title AS item_episode_title
       FROM jobs j LEFT JOIN library_items i ON i.id = j.item_id
       WHERE j.queue_visible = 1 ORDER BY j.position ASC LIMIT ? OFFSET ?`,
    ).all(limit, offset) as Record<string, unknown>[];
    return page(rows.map((row) => ({ ...mapJob(row), displayTitle: joinedDisplayTitle(row, String(row.item_id)) })), total, offset, limit);
  }

  getJob(id: string): (Job & { plan: JobPlan }) | undefined {
    const row = this.db.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? mapJob(row) : undefined;
  }

  activeJobForItem(itemId: string): (Job & { plan: JobPlan }) | undefined {
    const row = this.db
      .prepare("SELECT * FROM jobs WHERE item_id = ? AND status IN ('queued','held','paused','running')")
      .get(itemId) as Record<string, unknown> | undefined;
    return row ? mapJob(row) : undefined;
  }

  cancelActiveJobs(now = Date.now()): string[] {
    const cancel = this.db.transaction(() => {
      const rows = this.db.prepare(
        "SELECT id, item_id FROM jobs WHERE status IN ('queued','held','paused','running') ORDER BY position",
      ).all() as Array<{ id: string; item_id: string }>;
      this.db.prepare(
        "UPDATE jobs SET status = 'cancelled', phase = 'idle', error = 'Cancelled.' WHERE status IN ('queued','held','paused','running')",
      ).run();
      const history = this.db.prepare(
        "INSERT INTO history (id, item_id, outcome, bytes_saved, created_at) VALUES (?, ?, 'cancelled', 0, ?)",
      );
      for (const row of rows) history.run(randomUUID(), row.item_id, now);
      return rows.map((row) => row.id);
    });
    return cancel();
  }

  recoverInterruptedJobs(): number {
    return this.db.prepare(
      "UPDATE jobs SET status = 'queued', phase = 'queued', progress = 0, error = 'Recovered after Polisharr restarted.' WHERE status = 'running'",
    ).run().changes;
  }

  removeFinishedJob(id: string): "removed" | "active" | "missing" {
    const row = this.db.prepare("SELECT status FROM jobs WHERE id = ?").get(id) as { status: JobStatus } | undefined;
    if (!row) return "missing";
    if (row.status === "queued" || row.status === "held" || row.status === "paused" || row.status === "running") {
      return "active";
    }
    this.db.prepare("UPDATE jobs SET queue_visible = 0 WHERE id = ?").run(id);
    return "removed";
  }

  clearFinishedJobs(): number {
    return this.db.prepare(
      "UPDATE jobs SET queue_visible = 0 WHERE queue_visible = 1 AND status IN ('succeeded','failed','cancelled')",
    ).run().changes;
  }

  insertReview(row: ReviewItem): void {
    this.db
      .prepare(
        `INSERT INTO reviews (id, job_id, item_id, status, flagged, flag_reason, source_path, sidecar_path, compare, error)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.id,
        row.jobId,
        row.itemId,
        row.status,
        row.flagged ? 1 : 0,
        row.flagReason,
        row.sourcePath,
        row.sidecarPath,
        JSON.stringify({ source: row.source, sidecar: row.sidecar }),
        row.error,
      );
  }

  listReviews(): ReviewItem[] {
    return (this.db.prepare("SELECT * FROM reviews").all() as Record<string, unknown>[]).map(mapReview);
  }

  reviewPage(offset: number, limit: number): Page<ReviewItem> {
    const total = Number((this.db.prepare("SELECT COUNT(*) AS n FROM reviews").get() as { n: number }).n);
    const rows = this.db.prepare(
      `SELECT r.*, i.type AS item_type, i.title AS item_title, i.show_title AS item_show_title,
              i.season AS item_season, i.episode AS item_episode, i.episode_title AS item_episode_title
       FROM reviews r LEFT JOIN library_items i ON i.id = r.item_id
       ORDER BY r.id LIMIT ? OFFSET ?`,
    ).all(limit, offset) as Record<string, unknown>[];
    return {
      ...page(rows.map((row) => ({ ...mapReview(row), displayTitle: joinedDisplayTitle(row, String(row.item_id)) })), total, offset, limit),
      pendingCount: this.pendingReviewCount(),
    };
  }

  pendingReviewIds(): string[] {
    return (this.db.prepare("SELECT id FROM reviews WHERE status = 'pending'").all() as Array<{ id: string }>).map((row) => row.id);
  }

  pendingReviewCount(): number {
    return Number((this.db.prepare("SELECT COUNT(*) AS n FROM reviews WHERE status = 'pending'").get() as { n: number }).n);
  }

  getReview(id: string): ReviewItem | undefined {
    const row = this.db.prepare("SELECT * FROM reviews WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? mapReview(row) : undefined;
  }

  pendingReviewForItem(itemId: string): ReviewItem | undefined {
    const row = this.db.prepare("SELECT * FROM reviews WHERE item_id = ?").get(itemId) as Record<string, unknown> | undefined;
    return row ? mapReview(row) : undefined;
  }

  updateReview(id: string, patch: Partial<{ status: ReviewStatus; error: string | null }>): void {
    const current = this.getReview(id);
    if (!current) return;
    this.db
      .prepare("UPDATE reviews SET status=?, error=? WHERE id=?")
      .run(patch.status ?? current.status, patch.error === undefined ? current.error : patch.error, id);
  }

  deleteReview(id: string): void {
    this.db.prepare("DELETE FROM reviews WHERE id = ?").run(id);
  }

  addHistory(itemId: string, outcome: ActivityOutcome, bytesSaved: number, now = Date.now()): void {
    this.db
      .prepare("INSERT INTO history (id, item_id, outcome, bytes_saved, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(randomUUID(), itemId, outcome, bytesSaved, now);
  }

  listHistory(): HistoryRow[] {
    return (this.db.prepare("SELECT * FROM history ORDER BY created_at DESC").all() as Record<string, unknown>[]).map((r) => ({
      id: String(r.id),
      itemId: String(r.item_id),
      displayTitle: this.getItem(String(r.item_id))?.title ?? String(r.item_id),
      outcome: activityOutcome(r.outcome),
      bytesSaved: Number(r.bytes_saved),
      createdAt: Number(r.created_at),
    }));
  }

  historyPage(offset: number, limit: number): Page<HistoryRow> {
    const total = Number((this.db.prepare("SELECT COUNT(*) AS n FROM history").get() as { n: number }).n);
    const rows = this.db.prepare(
      `SELECT h.*, i.type AS item_type, i.title AS item_title, i.show_title AS item_show_title,
              i.season AS item_season, i.episode AS item_episode, i.episode_title AS item_episode_title
       FROM history h LEFT JOIN library_items i ON i.id = h.item_id
       ORDER BY h.created_at DESC, h.id LIMIT ? OFFSET ?`,
    ).all(limit, offset) as Record<string, unknown>[];
    return page(rows.map((row) => ({
      id: String(row.id),
      itemId: String(row.item_id),
      displayTitle: joinedDisplayTitle(row, String(row.item_id)),
      outcome: activityOutcome(row.outcome),
      bytesSaved: Number(row.bytes_saved),
      createdAt: Number(row.created_at),
    })), total, offset, limit);
  }

  workSummary(): {
    suggestions: number;
    queued: number;
    review: number;
    errors: number;
    failed: number;
    running: (Job & { plan: JobPlan }) | null;
  } {
    const counts = this.db.prepare(
      `SELECT
         (SELECT COUNT(*) FROM suggestions WHERE dismissed = 0) AS suggestions,
         (SELECT COUNT(*) FROM jobs WHERE queue_visible = 1 AND status IN ('queued', 'held')) AS queued,
         (SELECT COUNT(*) FROM reviews) AS review,
         (SELECT COUNT(*) FROM file_errors) AS errors,
         (SELECT COUNT(*) FROM jobs WHERE queue_visible = 1 AND status = 'failed') AS failed`,
    ).get() as Record<string, number>;
    const row = this.db.prepare(
      `SELECT j.*, i.type AS item_type, i.title AS item_title, i.show_title AS item_show_title,
              i.season AS item_season, i.episode AS item_episode, i.episode_title AS item_episode_title
       FROM jobs j LEFT JOIN library_items i ON i.id = j.item_id
       WHERE j.queue_visible = 1 AND j.status = 'running' ORDER BY j.position LIMIT 1`,
    ).get() as Record<string, unknown> | undefined;
    return {
      suggestions: Number(counts.suggestions),
      queued: Number(counts.queued),
      review: Number(counts.review),
      errors: Number(counts.errors),
      failed: Number(counts.failed),
      running: row ? { ...mapJob(row), displayTitle: joinedDisplayTitle(row, String(row.item_id)) } : null,
    };
  }

  savings(): { filesOptimized: number; spaceSavedBytes: number } {
    const row = this.db
      .prepare("SELECT COUNT(*) AS n, COALESCE(SUM(bytes_saved), 0) AS b FROM history WHERE outcome = 'kept'")
      .get() as { n: number; b: number };
    return { filesOptimized: row.n, spaceSavedBytes: row.b };
  }

  addExclusion(kind: ExclusionKind, value: string): string {
    const id = randomUUID();
    this.db.prepare("INSERT INTO exclusions (id, kind, value) VALUES (?, ?, ?)").run(id, kind, value);
    return id;
  }

  listExclusions(): Array<{ id: string; kind: ExclusionKind; value: string }> {
    return this.db.prepare("SELECT * FROM exclusions").all() as Array<{ id: string; kind: ExclusionKind; value: string }>;
  }

  deleteExclusion(id: string): void {
    this.db.prepare("DELETE FROM exclusions WHERE id = ?").run(id);
  }

  widgetKeyHash(): string | null {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = 'widget'").get() as { value: string } | undefined;
    return row?.value ?? null;
  }

  setWidgetKeyHash(hash: string): void {
    this.db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('widget', ?)").run(hash);
  }

  webhookTokenHash(): string | null {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = 'webhook'").get() as { value: string } | undefined;
    return row?.value ?? null;
  }

  setWebhookTokenHash(hash: string): void {
    this.db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('webhook', ?)").run(hash);
  }

  close(): void {
    this.db.close();
  }
}

function mapItem(row: Record<string, unknown>): LibraryItem {
  return {
    id: String(row.id),
    instanceId: String(row.instance_id),
    instanceName: String(row.instance_name ?? ""),
    arrId: Number(row.arr_id),
    arrSeriesId: row.arr_series_id == null ? null : Number(row.arr_series_id),
    arrEpisodeFileId: row.arr_episode_file_id == null ? null : Number(row.arr_episode_file_id),
    type: mediaType(row.type),
    title: String(row.title),
    showTitle: row.show_title == null ? null : String(row.show_title),
    season: row.season == null ? null : Number(row.season),
    episode: row.episode == null ? null : Number(row.episode),
    episodeTitle: row.episode_title == null ? null : String(row.episode_title),
    path: String(row.path),
    sizeBytes: Number(row.size_bytes),
    quality: String(row.quality ?? ""),
    resolution: String(row.resolution ?? ""),
    profile: String(row.profile ?? ""),
    tags: stringList(JSON.parse(String(row.tags ?? "[]"))),
    posterRemoteUrl: row.poster_remote == null ? null : String(row.poster_remote),
    hasPoster: Boolean(row.poster_bytes || row.poster_remote),
    sizeExempt: Number(row.size_exempt) === 1,
  };
}

function mapLibrarySnapshot(row: Record<string, unknown>): LibrarySnapshot {
  return {
    item: mapItem(row),
    report: row.inspection_report == null
      ? null
      : normalizeInspection(JSON.parse(String(row.inspection_report)) as Record<string, unknown>),
    suggestion: row.suggestion_payload == null
      ? null
      : (JSON.parse(String(row.suggestion_payload)) as Suggestion),
    error: row.error_reason == null ? null : String(row.error_reason),
  };
}

function mapJob(row: Record<string, unknown>): Job & { plan: JobPlan } {
  return {
    id: String(row.id),
    itemId: String(row.item_id),
    suggestionId: row.suggestion_id == null ? null : String(row.suggestion_id),
    displayTitle: "",
    status: jobStatus(row.status),
    phase: jobPhase(row.phase),
    progress: Number(row.progress),
    error: row.error == null ? null : String(row.error),
    warning: row.warning == null ? null : String(row.warning),
    runNow: Number(row.run_now) === 1,
    createdAt: Number(row.created_at),
    writeMode: row.write_mode === "direct" ? "direct" : "sidecar",
    promoteError: row.promote_error == null ? null : String(row.promote_error),
    plan: JSON.parse(String(row.plan)) as JobPlan,
  };
}

function mapReview(row: Record<string, unknown>): ReviewItem {
  const compare = JSON.parse(String(row.compare)) as { source: ReviewItem["source"]; sidecar: ReviewItem["sidecar"] };
  return {
    id: String(row.id),
    jobId: String(row.job_id),
    itemId: String(row.item_id),
    displayTitle: "",
    status: reviewStatus(row.status),
    flagged: Number(row.flagged) === 1,
    flagReason: row.flag_reason == null ? null : String(row.flag_reason),
    sourcePath: String(row.source_path),
    sidecarPath: String(row.sidecar_path),
    source: compare.source,
    sidecar: compare.sidecar,
    error: row.error == null ? null : String(row.error),
  };
}

function mapInstance(row: Record<string, unknown>): StoredInstance {
  const kind = row.kind;
  if (kind !== "radarr" && kind !== "sonarr" && kind !== "plex" && kind !== "jellyfin") {
    throw new Error(`The saved integration kind ${String(kind)} is invalid.`);
  }
  return {
    id: String(row.id),
    kind,
    name: String(row.name),
    url: String(row.url),
    secret: row.secret == null ? null : String(row.secret),
    enabled: Number(row.enabled) === 1,
  };
}

function mediaType(value: unknown): LibraryItem["type"] {
  if (value === "movie" || value === "episode") return value;
  throw new Error(`The saved media type ${String(value)} is invalid.`);
}

function jobStatus(value: unknown): JobStatus {
  if (value === "queued" || value === "held" || value === "paused" || value === "running" || value === "succeeded" || value === "failed" || value === "cancelled") return value;
  throw new Error(`The saved job status ${String(value)} is invalid.`);
}

function jobPhase(value: unknown): JobPhase {
  if (value === "queued" || value === "held" || value === "paused" || value === "copying" || value === "muxing" || value === "creating_stereo" || value === "transcoding" || value === "finishing" || value === "idle") return value;
  throw new Error(`The saved job phase ${String(value)} is invalid.`);
}

function reviewStatus(value: unknown): ReviewStatus {
  if (value === "pending" || value === "keeping" || value === "discarding") return value;
  throw new Error(`The saved review status ${String(value)} is invalid.`);
}

function activityOutcome(value: unknown): ActivityOutcome {
  if (value === "kept" || value === "discarded" || value === "flagged" || value === "failed" || value === "cancelled") return value;
  throw new Error(`The saved activity outcome ${String(value)} is invalid.`);
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function page<T>(items: T[], total: number, offset: number, limit: number): Page<T> {
  const consumed = offset + items.length;
  return { items, total, nextOffset: consumed < total && items.length === limit ? consumed : null };
}

function itemHref(itemType: unknown, itemId: string): string {
  return itemType === "episode" ? `/series/episodes/${itemId}` : `/movies/${itemId}`;
}

function joinedDisplayTitle(row: Record<string, unknown>, fallback: string): string {
  if (row.item_title == null) return fallback;
  return displayTitle({
    type: row.item_type === "episode" ? "episode" : "movie",
    title: String(row.item_title),
    showTitle: row.item_show_title == null ? null : String(row.item_show_title),
    season: row.item_season == null ? null : Number(row.item_season),
    episode: row.item_episode == null ? null : Number(row.item_episode),
    episodeTitle: row.item_episode_title == null ? null : String(row.item_episode_title),
  });
}

function suggestionWhere(query: string, filters: SuggestionFilters, settings: Settings): { where: string; params: unknown[] } {
  const conditions = ["s.dismissed = 0"];
  const params: unknown[] = [];
  for (const token of tokenize(query)) {
    conditions.push(`LOWER(COALESCE(i.title, '') || ' ' || COALESCE(i.show_title, '') || ' ' || COALESCE(i.episode_title, '') || ' ' || COALESCE(i.quality, '') || ' ' || COALESCE(n.name, '') || ' ' || CASE WHEN i.type = 'episode' THEN printf('s%02de%02d %dx%d', i.season, i.episode, i.season, i.episode) ELSE '' END) LIKE ?`);
    params.push(`%${token}%`);
  }
  if (filters.type) {
    conditions.push("i.type = ?");
    params.push(filters.type);
  }
  if (filters.resolution === "4k") {
    conditions.push("(LOWER(i.resolution) LIKE '%2160%' OR LOWER(i.resolution) LIKE '%4k%' OR CAST(json_extract(ins.report, '$.height') AS INTEGER) >= 2160)");
  }
  if (filters.resolution === "1080p") {
    conditions.push("(LOWER(i.resolution) LIKE '%1080%' OR CAST(json_extract(ins.report, '$.height') AS INTEGER) BETWEEN 1000 AND 2159)");
  }
  if (filters.hdr === "hdr") conditions.push("json_extract(ins.report, '$.hdr') <> 'none'");
  if (filters.hdr === "sdr") conditions.push("json_extract(ins.report, '$.hdr') = 'none'");
  if (filters.codec) {
    const codecCondition = filters.codec === "hevc"
      ? "(LOWER(json_extract(ins.report, '$.videoCodec')) LIKE '%hevc%' OR LOWER(json_extract(ins.report, '$.videoCodec')) LIKE '%h265%')"
      : `LOWER(json_extract(ins.report, '$.videoCodec')) LIKE ?`;
    conditions.push(codecCondition);
    if (filters.codec !== "hevc") params.push(`%${filters.codec}%`);
  }
  if (filters.overCap !== undefined) {
    const comparison = filters.overCap ? ">" : "<=";
    conditions.push(`CAST(json_extract(ins.report, '$.sizePerHourGb') AS REAL) ${comparison} CASE json_extract(s.payload, '$.category')
      WHEN 'movie1080p' THEN ? WHEN 'movie4kSdr' THEN ? WHEN 'movie4kHdr' THEN ? WHEN 'tv1080p' THEN ? WHEN 'tv4k' THEN ? END`);
    params.push(
      settings.sizeCaps.movie1080p,
      settings.sizeCaps.movie4kSdr,
      settings.sizeCaps.movie4kHdr,
      settings.sizeCaps.tv1080p,
      settings.sizeCaps.tv4k,
    );
  }
  if (filters.extraTracks !== undefined) {
    conditions.push(`${filters.extraTracks ? "" : "NOT "}EXISTS (SELECT 1 FROM json_each(s.payload, '$.actions') WHERE value = 'tracks')`);
  }
  if (filters.exempt !== undefined) conditions.push(`i.size_exempt = ${filters.exempt ? 1 : 0}`);
  if (filters.hardwareWarning !== undefined) {
    conditions.push(`${filters.hardwareWarning ? "" : "NOT "}COALESCE(json_extract(s.payload, '$.warning'), '') LIKE 'Hardware encode is unavailable.%'`);
  }
  return { where: conditions.join(" AND "), params };
}
