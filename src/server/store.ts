import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type {
  ActivityOutcome,
  ArrInstance,
  ExclusionKind,
  FileError,
  HistoryRow,
  InspectionReport,
  Job,
  JobPhase,
  JobStatus,
  LibraryItem,
  PlayerInstance,
  ReviewItem,
  ReviewStatus,
  Settings,
  Suggestion,
} from "./types.ts";
import { DEFAULT_SETTINGS } from "./types.ts";

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
      CREATE TABLE IF NOT EXISTS inspect_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        walking INTEGER NOT NULL DEFAULT 0,
        pending INTEGER NOT NULL DEFAULT 0,
        inspected INTEGER NOT NULL DEFAULT 0,
        failed INTEGER NOT NULL DEFAULT 0
      );
      INSERT OR IGNORE INTO inspect_state (id, walking, pending, inspected, failed) VALUES (1, 0, 0, 0, 0);
    `);
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
    if (!row) return { ...DEFAULT_SETTINGS, sizeCaps: { ...DEFAULT_SETTINGS.sizeCaps } };
    return { ...DEFAULT_SETTINGS, ...JSON.parse(row.value), sizeCaps: { ...DEFAULT_SETTINGS.sizeCaps, ...(JSON.parse(row.value).sizeCaps ?? {}) } };
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
    kind: string;
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

  listInstances(): Array<ArrInstance | PlayerInstance & { secret: string | null; kind: string }> {
    return this.db.prepare("SELECT * FROM instances").all() as Array<ArrInstance | PlayerInstance & { secret: string | null; kind: string }>;
  }

  getInstance(id: string): { id: string; kind: string; name: string; url: string; secret: string | null; enabled: number } | undefined {
    return this.db.prepare("SELECT * FROM instances WHERE id = ?").get(id) as
      | { id: string; kind: string; name: string; url: string; secret: string | null; enabled: number }
      | undefined;
  }

  deleteInstance(id: string): void {
    this.db.prepare("DELETE FROM instances WHERE id = ?").run(id);
  }

  upsertItem(item: Omit<LibraryItem, "hasPoster" | "instanceName"> & { posterBytes?: Buffer | null }): string {
    this.db
      .prepare(
        `INSERT INTO library_items (id, instance_id, arr_id, type, title, show_title, season, episode, episode_title, path, size_bytes, quality, resolution, profile, tags, poster_remote, poster_bytes, size_exempt)
         VALUES (@id, @instanceId, @arrId, @type, @title, @showTitle, @season, @episode, @episodeTitle, @path, @sizeBytes, @quality, @resolution, @profile, @tags, @posterRemoteUrl, @posterBytes, @sizeExempt)
         ON CONFLICT(instance_id, type, arr_id) DO UPDATE SET
           title=excluded.title, show_title=excluded.show_title, season=excluded.season, episode=excluded.episode,
           episode_title=excluded.episode_title, path=excluded.path, size_bytes=excluded.size_bytes, quality=excluded.quality,
           resolution=excluded.resolution, profile=excluded.profile, tags=excluded.tags, poster_remote=excluded.poster_remote,
           poster_bytes=COALESCE(excluded.poster_bytes, poster_bytes)`,
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

  setExempt(id: string, exempt: boolean): void {
    this.db.prepare("UPDATE library_items SET size_exempt = ? WHERE id = ?").run(exempt ? 1 : 0, id);
  }

  saveInspection(itemId: string, report: InspectionReport): void {
    this.db
      .prepare("INSERT OR REPLACE INTO inspections (item_id, source_sig, report) VALUES (?, ?, ?)")
      .run(itemId, report.sourceSig, JSON.stringify(report));
  }

  getInspection(itemId: string): InspectionReport | undefined {
    const row = this.db.prepare("SELECT report FROM inspections WHERE item_id = ?").get(itemId) as { report: string } | undefined;
    return row ? (JSON.parse(row.report) as InspectionReport) : undefined;
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
      return {
        itemId: r.item_id,
        path: r.path,
        fileName: r.path.split("/").pop() || r.path,
        displayTitle: item ? `${item.title}` : r.path.split("/").pop() || r.path,
        reason: r.reason,
      };
    });
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

  insertJob(job: Omit<Job, "displayTitle"> & { plan: unknown; position?: number }): string {
    const position =
      job.position ??
      ((this.db.prepare("SELECT COALESCE(MAX(position), 0) + 1 AS n FROM jobs").get() as { n: number }).n);
    this.db
      .prepare(
        `INSERT INTO jobs (id, item_id, suggestion_id, status, phase, progress, error, warning, run_now, position, plan, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      );
    return job.id;
  }

  updateJob(id: string, patch: Partial<{ status: JobStatus; phase: JobPhase; progress: number; error: string | null; runNow: boolean; position: number }>): void {
    const current = this.db.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    if (!current) return;
    this.db
      .prepare(
        "UPDATE jobs SET status=?, phase=?, progress=?, error=?, run_now=?, position=? WHERE id=?",
      )
      .run(
        patch.status ?? current.status,
        patch.phase ?? current.phase,
        patch.progress ?? current.progress,
        patch.error === undefined ? current.error : patch.error,
        (patch.runNow ?? current.run_now === 1) ? 1 : 0,
        patch.position ?? current.position,
        id,
      );
  }

  listJobs(): Array<Job & { plan: Suggestion }> {
    return (this.db.prepare("SELECT * FROM jobs ORDER BY position ASC").all() as Record<string, unknown>[]).map(mapJob);
  }

  getJob(id: string): (Job & { plan: Suggestion }) | undefined {
    const row = this.db.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? mapJob(row) : undefined;
  }

  activeJobForItem(itemId: string): (Job & { plan: Suggestion }) | undefined {
    const row = this.db
      .prepare("SELECT * FROM jobs WHERE item_id = ? AND status IN ('queued','held','paused','running')")
      .get(itemId) as Record<string, unknown> | undefined;
    return row ? mapJob(row) : undefined;
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
      outcome: r.outcome as ActivityOutcome,
      bytesSaved: Number(r.bytes_saved),
      createdAt: Number(r.created_at),
    }));
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
    type: row.type === "episode" ? "episode" : "movie",
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
    tags: JSON.parse(String(row.tags ?? "[]")) as string[],
    posterRemoteUrl: row.poster_remote == null ? null : String(row.poster_remote),
    hasPoster: Boolean(row.poster_bytes || row.poster_remote),
    sizeExempt: Number(row.size_exempt) === 1,
  };
}

function mapJob(row: Record<string, unknown>): Job & { plan: Suggestion } {
  return {
    id: String(row.id),
    itemId: String(row.item_id),
    suggestionId: row.suggestion_id == null ? null : String(row.suggestion_id),
    displayTitle: "",
    status: row.status as JobStatus,
    phase: row.phase as JobPhase,
    progress: Number(row.progress),
    error: row.error == null ? null : String(row.error),
    warning: row.warning == null ? null : String(row.warning),
    runNow: Number(row.run_now) === 1,
    createdAt: Number(row.created_at),
    plan: JSON.parse(String(row.plan)) as Suggestion,
  };
}

function mapReview(row: Record<string, unknown>): ReviewItem {
  const compare = JSON.parse(String(row.compare)) as { source: ReviewItem["source"]; sidecar: ReviewItem["sidecar"] };
  return {
    id: String(row.id),
    jobId: String(row.job_id),
    itemId: String(row.item_id),
    displayTitle: "",
    status: row.status as ReviewStatus,
    flagged: Number(row.flagged) === 1,
    flagReason: row.flag_reason == null ? null : String(row.flag_reason),
    sourcePath: String(row.source_path),
    sidecarPath: String(row.sidecar_path),
    source: compare.source,
    sidecar: compare.sidecar,
    error: row.error == null ? null : String(row.error),
  };
}
