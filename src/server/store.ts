import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { displayTitle, matchesTitleSearch } from "./titles.ts";
import { defaultSettings, type Settings, type User } from "./types.ts";
import { hashPassword, verifyPassword } from "./passwords.ts";
import { decryptSecret, encryptSecret, loadSecretKey } from "./secrets.ts";
import type { ArrInstance, ArrKind, ItemType, LibraryItem, PlayerInstance, PlayerKind } from "./models.ts";
import { isJobPhase, jobPhaseLabel, type JobPhase } from "./progress.ts";

export class Store {
  readonly db: DatabaseSync;
  readonly dataDir: string;
  private readonly secretKey: Buffer;

  constructor(dataDir: string) {
    this.dataDir = dataDir;
    mkdirSync(dataDir, { recursive: true });
    this.secretKey = loadSecretKey(dataDir);
    this.db = new DatabaseSync(join(dataDir, "optimizarr.db"));
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA foreign_keys = ON");
    this.migrate();
  }

  close(): void {
    this.db.close();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY,
        username TEXT NOT NULL UNIQUE COLLATE NOCASE,
        password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS arr_instances (
        id INTEGER PRIMARY KEY,
        kind TEXT NOT NULL,
        name TEXT NOT NULL,
        url TEXT NOT NULL,
        api_key TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1
      );
      CREATE TABLE IF NOT EXISTS library_items (
        id INTEGER PRIMARY KEY,
        instance_id INTEGER NOT NULL REFERENCES arr_instances(id) ON DELETE CASCADE,
        external_id INTEGER NOT NULL,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        series_title TEXT,
        path TEXT NOT NULL,
        folder_path TEXT,
        quality TEXT,
        video_codec TEXT,
        resolution TEXT,
        hdr TEXT,
        size INTEGER,
        readable INTEGER NOT NULL DEFAULT 0,
        path_error TEXT,
        updated_at TEXT NOT NULL,
        season_number INTEGER,
        episode_number INTEGER,
        UNIQUE(instance_id, type, external_id)
      );
      CREATE TABLE IF NOT EXISTS inspections (
        item_id INTEGER PRIMARY KEY REFERENCES library_items(id) ON DELETE CASCADE,
        report_json TEXT NOT NULL,
        inspected_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS suggestions (
        id INTEGER PRIMARY KEY,
        item_id INTEGER NOT NULL UNIQUE REFERENCES library_items(id) ON DELETE CASCADE,
        actions_json TEXT NOT NULL,
        warning TEXT,
        estimated_savings_bytes INTEGER,
        dismissed INTEGER NOT NULL DEFAULT 0,
        forced INTEGER NOT NULL DEFAULT 0,
        over_cap INTEGER NOT NULL DEFAULT 0,
        extra_tracks INTEGER NOT NULL DEFAULT 0,
        category TEXT,
        size_per_hour REAL,
        plan_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS player_instances (
        id INTEGER PRIMARY KEY,
        kind TEXT NOT NULL,
        name TEXT NOT NULL,
        url TEXT NOT NULL,
        token TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1
      );
      CREATE TABLE IF NOT EXISTS jobs (
        id INTEGER PRIMARY KEY,
        item_id INTEGER NOT NULL,
        suggestion_id INTEGER,
        status TEXT NOT NULL,
        plan_json TEXT NOT NULL,
        progress REAL NOT NULL DEFAULT 0,
        error TEXT,
        log TEXT,
        created_at TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT
      );
      CREATE TABLE IF NOT EXISTS exclusions (
        id INTEGER PRIMARY KEY,
        kind TEXT NOT NULL,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS history (
        id INTEGER PRIMARY KEY,
        item_id INTEGER,
        title TEXT,
        action TEXT NOT NULL,
        detail TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS reviews (
        id INTEGER PRIMARY KEY,
        item_id INTEGER NOT NULL UNIQUE,
        job_id INTEGER,
        source_path TEXT NOT NULL,
        sidecar_path TEXT NOT NULL,
        compare_json TEXT,
        flagged INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL
      );
    `);
    const row = this.db.prepare("SELECT value FROM settings WHERE key = 'app'").get() as
      | { value: string }
      | undefined;
    if (!row) {
      this.db
        .prepare("INSERT INTO settings (key, value) VALUES ('app', ?)")
        .run(JSON.stringify(defaultSettings()));
    }
    this.ensureColumn("library_items", "season_number", "INTEGER");
    this.ensureColumn("library_items", "episode_number", "INTEGER");
    this.ensureColumn("library_items", "series_id", "INTEGER");
    this.ensureColumn("library_items", "poster_remote_url", "TEXT");
    this.ensureColumn("inspections", "source_sig", "TEXT");
    this.ensureColumn("jobs", "phase", "TEXT");
    this.ensureColumn("jobs", "eta_sec", "REAL");
  }

  private ensureColumn(table: string, column: string, spec: string): void {
    const cols = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (cols.some((c) => c.name === column)) return;
    this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${spec}`);
  }

  getSettings(): Settings {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = 'app'").get() as {
      value: string;
    };
    return { ...defaultSettings(), ...JSON.parse(row.value) };
  }

  saveSettings(next: Settings): Settings {
    const merged: Settings = { ...defaultSettings(), ...next };
    this.db
      .prepare("INSERT INTO settings (key, value) VALUES ('app', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(JSON.stringify(merged));
    return merged;
  }

  hasUser(): boolean {
    const row = this.db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number };
    return row.n > 0;
  }

  getUserById(id: number): User | undefined {
    const row = this.db
      .prepare("SELECT id, username, password_hash AS passwordHash, created_at AS createdAt FROM users WHERE id = ?")
      .get(id) as User | undefined;
    return row;
  }

  getUserByUsername(username: string): User | undefined {
    return this.db
      .prepare(
        "SELECT id, username, password_hash AS passwordHash, created_at AS createdAt FROM users WHERE username = ? COLLATE NOCASE",
      )
      .get(username) as User | undefined;
  }

  createAdmin(username: string, password: string): User {
    if (this.hasUser()) throw new Error("admin already exists");
    const now = new Date().toISOString();
    const hash = hashPassword(password);
    this.db
      .prepare("INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)")
      .run(username.trim(), hash, now);
    const user = this.getUserByUsername(username);
    if (!user) throw new Error("failed to create admin");
    return user;
  }

  updateCredentials(userId: number, username: string, password?: string): User {
    const current = this.getUserById(userId);
    if (!current) throw new Error("user not found");
    const nextName = username.trim();
    if (password) {
      this.db
        .prepare("UPDATE users SET username = ?, password_hash = ? WHERE id = ?")
        .run(nextName, hashPassword(password), userId);
    } else {
      this.db.prepare("UPDATE users SET username = ? WHERE id = ?").run(nextName, userId);
    }
    const user = this.getUserById(userId);
    if (!user) throw new Error("user not found");
    return user;
  }

  verifyLogin(username: string, password: string): User | undefined {
    const user = this.getUserByUsername(username);
    if (!user) return undefined;
    if (!verifyPassword(password, user.passwordHash)) return undefined;
    return user;
  }

  createSession(userId: number, ttlMs: number): { id: string; expiresAt: Date } {
    const id = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + ttlMs);
    this.db
      .prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)")
      .run(id, userId, expiresAt.toISOString());
    return { id, expiresAt };
  }

  getSession(id: string): { user: User; expiresAt: Date } | undefined {
    if (!id) return undefined;
    const row = this.db
      .prepare("SELECT user_id AS userId, expires_at AS expiresAt FROM sessions WHERE id = ?")
      .get(id) as { userId: number; expiresAt: string } | undefined;
    if (!row) return undefined;
    const expiresAt = new Date(row.expiresAt);
    if (expiresAt.getTime() <= Date.now()) {
      this.deleteSession(id);
      return undefined;
    }
    const user = this.getUserById(row.userId);
    if (!user) return undefined;
    return { user, expiresAt };
  }

  deleteSession(id: string): void {
    this.db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
  }

  expireSession(id: string): void {
    this.db
      .prepare("UPDATE sessions SET expires_at = ? WHERE id = ?")
      .run(new Date(0).toISOString(), id);
  }

  listArrInstances(): ArrInstance[] {
    const rows = this.db
      .prepare(
        "SELECT id, kind, name, url, api_key AS apiKey, enabled FROM arr_instances ORDER BY id",
      )
      .all() as Array<ArrInstance & { enabled: number | boolean }>;
    return rows.map((row) => this.revealInstance(row));
  }

  getArrInstance(id: number): ArrInstance | undefined {
    const row = this.db
      .prepare("SELECT id, kind, name, url, api_key AS apiKey, enabled FROM arr_instances WHERE id = ?")
      .get(id) as (ArrInstance & { enabled: number | boolean }) | undefined;
    return row ? this.revealInstance(row) : undefined;
  }

  createArrInstance(input: {
    kind: ArrKind;
    name: string;
    url: string;
    apiKey: string;
    enabled?: boolean;
  }): ArrInstance {
    const inserted = this.db
      .prepare("INSERT INTO arr_instances (kind, name, url, api_key, enabled) VALUES (?, ?, ?, ?, ?)")
      .run(
        input.kind,
        input.name,
        normalizeUrl(input.url),
        encryptSecret(input.apiKey, this.secretKey),
        input.enabled === false ? 0 : 1,
      );
    const id = Number(inserted.lastInsertRowid);
    const created = this.getArrInstance(id);
    if (!created) throw new Error("failed to create instance");
    return created;
  }

  updateArrInstance(
    id: number,
    patch: Partial<Pick<ArrInstance, "name" | "url" | "apiKey" | "enabled" | "kind">>,
  ): ArrInstance | undefined {
    const current = this.getArrInstance(id);
    if (!current) return undefined;
    const next = {
      ...current,
      ...patch,
      url: patch.url ? normalizeUrl(patch.url) : current.url,
      apiKey: patch.apiKey && patch.apiKey.length > 0 ? patch.apiKey : current.apiKey,
    };
    this.db
      .prepare("UPDATE arr_instances SET kind = ?, name = ?, url = ?, api_key = ?, enabled = ? WHERE id = ?")
      .run(next.kind, next.name, next.url, encryptSecret(next.apiKey, this.secretKey), next.enabled ? 1 : 0, id);
    return this.getArrInstance(id);
  }

  deleteArrInstance(id: number): void {
    this.db.prepare("DELETE FROM library_items WHERE instance_id = ?").run(id);
    this.db.prepare("DELETE FROM arr_instances WHERE id = ?").run(id);
  }

  upsertLibraryItem(item: Omit<LibraryItem, "id" | "instanceName" | "instanceKind">): LibraryItem {
    this.db
      .prepare(
        `INSERT INTO library_items (
          instance_id, external_id, type, title, series_title, path, folder_path,
          quality, video_codec, resolution, hdr, size, readable, path_error, updated_at,
          season_number, episode_number, series_id, poster_remote_url
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(instance_id, type, external_id) DO UPDATE SET
          title = excluded.title,
          series_title = excluded.series_title,
          path = excluded.path,
          folder_path = excluded.folder_path,
          quality = excluded.quality,
          video_codec = excluded.video_codec,
          resolution = excluded.resolution,
          hdr = excluded.hdr,
          size = excluded.size,
          readable = excluded.readable,
          path_error = excluded.path_error,
          updated_at = excluded.updated_at,
          season_number = excluded.season_number,
          episode_number = excluded.episode_number,
          series_id = excluded.series_id,
          poster_remote_url = excluded.poster_remote_url`,
      )
      .run(
        item.instanceId,
        item.externalId,
        item.type,
        item.title,
        item.seriesTitle,
        item.path,
        item.folderPath,
        item.quality,
        item.videoCodec,
        item.resolution,
        item.hdr,
        item.size,
        item.readable ? 1 : 0,
        item.pathError,
        item.updatedAt,
        item.seasonNumber,
        item.episodeNumber,
        item.seriesId,
        item.posterRemoteUrl ?? null,
      );
    const saved = this.getLibraryItemByExternal(item.instanceId, item.type, item.externalId);
    if (!saved) throw new Error("failed to upsert library item");
    return saved;
  }

  getLibraryItemByExternal(instanceId: number, type: ItemType, externalId: number): LibraryItem | undefined {
    const row = this.db
      .prepare(
        `SELECT ${LIBRARY_ITEM_SQL}
         FROM library_items i
         JOIN arr_instances a ON a.id = i.instance_id
         WHERE i.instance_id = ? AND i.type = ? AND i.external_id = ?`,
      )
      .get(instanceId, type, externalId) as (LibraryItem & { readable: number | boolean }) | undefined;
    return row ? asLibraryItem(row) : undefined;
  }

  listLibraryItems(type?: ItemType): LibraryItem[] {
    const rows = this.db
      .prepare(
        `SELECT ${LIBRARY_ITEM_SQL}
         FROM library_items i
         JOIN arr_instances a ON a.id = i.instance_id
         ${type ? "WHERE i.type = ?" : ""}
         ORDER BY i.series_title COLLATE NOCASE, i.season_number, i.episode_number, i.title COLLATE NOCASE`,
      )
      .all(...(type ? [type] : [])) as Array<LibraryItem & { readable: number | boolean }>;
    return rows.map(asLibraryItem);
  }

  getLibraryItem(id: number): LibraryItem | undefined {
    const row = this.db
      .prepare(
        `SELECT ${LIBRARY_ITEM_SQL}
         FROM library_items i
         JOIN arr_instances a ON a.id = i.instance_id
         WHERE i.id = ?`,
      )
      .get(id) as (LibraryItem & { readable: number | boolean }) | undefined;
    return row ? asLibraryItem(row) : undefined;
  }

  saveInspection(itemId: number, report: unknown, inspectedAt: string, sourceSig?: string): void {
    this.db
      .prepare(
        `INSERT INTO inspections (item_id, report_json, inspected_at, source_sig) VALUES (?, ?, ?, ?)
         ON CONFLICT(item_id) DO UPDATE SET
           report_json = excluded.report_json,
           inspected_at = excluded.inspected_at,
           source_sig = excluded.source_sig`,
      )
      .run(itemId, JSON.stringify(report), inspectedAt, sourceSig ?? null);
  }

  getInspection(itemId: number): unknown | undefined {
    const row = this.db.prepare("SELECT report_json FROM inspections WHERE item_id = ?").get(itemId) as
      | { report_json: string }
      | undefined;
    return row ? JSON.parse(row.report_json) : undefined;
  }

  getInspectionSig(itemId: number): string | null {
    const row = this.db.prepare("SELECT source_sig FROM inspections WHERE item_id = ?").get(itemId) as
      | { source_sig: string | null }
      | undefined;
    return row?.source_sig ?? null;
  }

  saveSuggestion(row: {
    itemId: number;
    actions: string[];
    warning: string | null;
    estimatedSavingsBytes: number | null;
    dismissed?: boolean;
    forced?: boolean;
    overCap: boolean;
    extraTracks: boolean;
    category: string;
    sizePerHourGb: number | null;
    plan: unknown;
  }): number {
    this.db
      .prepare(
        `INSERT INTO suggestions (
          item_id, actions_json, warning, estimated_savings_bytes, dismissed, forced,
          over_cap, extra_tracks, category, size_per_hour, plan_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(item_id) DO UPDATE SET
          actions_json = excluded.actions_json,
          warning = excluded.warning,
          estimated_savings_bytes = excluded.estimated_savings_bytes,
          forced = excluded.forced,
          over_cap = excluded.over_cap,
          extra_tracks = excluded.extra_tracks,
          category = excluded.category,
          size_per_hour = excluded.size_per_hour,
          plan_json = excluded.plan_json`,
      )
      .run(
        row.itemId,
        JSON.stringify(row.actions),
        row.warning,
        row.estimatedSavingsBytes,
        row.dismissed ? 1 : 0,
        row.forced ? 1 : 0,
        row.overCap ? 1 : 0,
        row.extraTracks ? 1 : 0,
        row.category,
        row.sizePerHourGb,
        JSON.stringify(row.plan),
      );
    const saved = this.db.prepare("SELECT id FROM suggestions WHERE item_id = ?").get(row.itemId) as { id: number };
    return saved.id;
  }

  dismissSuggestion(id: number): void {
    this.db.prepare("UPDATE suggestions SET dismissed = 1 WHERE id = ?").run(id);
  }

  listSuggestions(filters?: {
    q?: string;
    includeDismissed?: boolean;
    overCap?: boolean;
    extraTracks?: boolean;
    codec?: string;
    type?: ItemType;
  }): Array<Record<string, unknown>> {
    const rows = this.db
      .prepare(
        `SELECT s.id, s.item_id AS itemId, s.actions_json AS actionsJson, s.warning,
                s.estimated_savings_bytes AS estimatedSavingsBytes, s.dismissed, s.forced,
                s.over_cap AS overCap, s.extra_tracks AS extraTracks, s.category,
                s.size_per_hour AS sizePerHourGb, s.plan_json AS planJson,
                i.title, i.series_title AS seriesTitle, i.season_number AS seasonNumber,
                i.episode_number AS episodeNumber, i.type, i.path, i.video_codec AS videoCodec,
                i.resolution, i.hdr, i.instance_id AS instanceId, a.name AS instanceName,
                i.poster_remote_url AS posterRemoteUrl, i.size, i.quality
         FROM suggestions s
         JOIN library_items i ON i.id = s.item_id
         JOIN arr_instances a ON a.id = i.instance_id
         ORDER BY i.series_title COLLATE NOCASE, i.season_number, i.episode_number, i.title COLLATE NOCASE`,
      )
      .all() as Array<Record<string, unknown> & { actionsJson: string; planJson: string; dismissed: number; forced: number; overCap: number; extraTracks: number }>;
    return rows
      .map((r) => {
        const { posterRemoteUrl, actionsJson, planJson, ...rest } = r;
        return {
          ...rest,
          actions: JSON.parse(actionsJson) as string[],
          plan: JSON.parse(planJson),
          dismissed: Boolean(r.dismissed),
          forced: Boolean(r.forced),
          overCap: Boolean(r.overCap),
          extraTracks: Boolean(r.extraTracks),
          displayTitle: displayTitle({
            title: String(r.title),
            seriesTitle: (r.seriesTitle as string | null) ?? null,
            seasonNumber: (r.seasonNumber as number | null) ?? null,
            episodeNumber: (r.episodeNumber as number | null) ?? null,
          }),
          hasPoster: Boolean(posterRemoteUrl),
        };
      })
      .filter((r) => {
        const actions = r.actions as string[];
        if (!r.forced && actions.length === 0) return false;
        if (!filters?.includeDismissed && r.dismissed) return false;
        if (filters?.overCap && !r.overCap) return false;
        if (filters?.extraTracks && !r.extraTracks) return false;
        if (filters?.type && r.type !== filters.type) return false;
        if (filters?.codec && String(r.videoCodec ?? "").toLowerCase() !== filters.codec.toLowerCase()) return false;
        if (
          filters?.q &&
          !matchesTitleSearch(
            {
              title: String(r.title),
              seriesTitle: (r.seriesTitle as string | null) ?? null,
              seasonNumber: (r.seasonNumber as number | null) ?? null,
              episodeNumber: (r.episodeNumber as number | null) ?? null,
            },
            filters.q,
            [String(r.instanceName ?? ""), String(r.videoCodec ?? "")],
          )
        ) {
          return false;
        }
        return true;
      });
  }

  getSuggestion(id: number): { id: number; itemId: number; plan: unknown; actions: string[] } | undefined {
    const row = this.db
      .prepare("SELECT id, item_id AS itemId, plan_json AS planJson, actions_json AS actionsJson FROM suggestions WHERE id = ?")
      .get(id) as { id: number; itemId: number; planJson: string; actionsJson: string } | undefined;
    if (!row) return undefined;
    return { id: row.id, itemId: row.itemId, plan: JSON.parse(row.planJson), actions: JSON.parse(row.actionsJson) };
  }

  pendingReviewForItem(itemId: number): { id: number; sidecarPath: string; sourcePath: string } | undefined {
    const row = this.db
      .prepare("SELECT id, sidecar_path AS sidecarPath, source_path AS sourcePath FROM reviews WHERE item_id = ? AND status = 'pending'")
      .get(itemId) as { id: number; sidecarPath: string; sourcePath: string } | undefined;
    return row;
  }

  createJob(itemId: number, suggestionId: number | null, plan: unknown, createdAt: string): number {
    this.db
      .prepare(
        "INSERT INTO jobs (item_id, suggestion_id, status, phase, plan_json, created_at) VALUES (?, ?, 'queued', 'queued', ?, ?)",
      )
      .run(itemId, suggestionId, JSON.stringify(plan), createdAt);
    return (this.db.prepare("SELECT last_insert_rowid() AS id").get() as { id: number }).id;
  }

  updateJob(
    id: number,
    patch: {
      status?: string;
      phase?: JobPhase;
      progress?: number;
      etaSec?: number | null;
      error?: string | null;
      log?: string;
      startedAt?: string;
      finishedAt?: string;
    },
  ): void {
    const current = this.db.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    if (!current) return;
    this.db
      .prepare(
        "UPDATE jobs SET status = ?, phase = ?, progress = ?, eta_sec = ?, error = ?, log = ?, started_at = ?, finished_at = ? WHERE id = ?",
      )
      .run(
        patch.status ?? current.status,
        patch.phase ?? current.phase ?? phaseFromStatus(String(patch.status ?? current.status)),
        patch.progress ?? current.progress,
        patch.etaSec === undefined ? current.eta_sec : patch.etaSec,
        patch.error === undefined ? current.error : patch.error,
        patch.log ?? current.log,
        patch.startedAt ?? current.started_at,
        patch.finishedAt ?? current.finished_at,
        id,
      );
  }

  getJob(id: number): Record<string, unknown> | undefined {
    return this.db
      .prepare(
        `SELECT id, item_id AS itemId, suggestion_id AS suggestionId, status, phase, plan_json AS planJson,
                progress, eta_sec AS etaSec, error, log FROM jobs WHERE id = ?`,
      )
      .get(id) as Record<string, unknown> | undefined;
  }

  listJobs(): Array<Record<string, unknown>> {
    const settings = this.getSettings();
    return this.db
      .prepare(
        `SELECT j.id, j.item_id AS itemId, j.status, j.phase, j.progress, j.eta_sec AS etaSec, j.error, j.log,
                j.created_at AS createdAt,
                i.title, i.series_title AS seriesTitle, i.season_number AS seasonNumber,
                i.episode_number AS episodeNumber
         FROM jobs j JOIN library_items i ON i.id = j.item_id ORDER BY j.id DESC`,
      )
      .all()
      .map((row) => {
        const r = row as Record<string, unknown>;
        const phase = publicJobPhase(r.status, r.phase);
        return {
          ...r,
          phase,
          progress: Number(r.progress ?? 0),
          etaSec: r.etaSec == null ? null : Number(r.etaSec),
          phaseLabel: jobPhaseLabel(phase, {
            targetCodec: settings.targetCodec,
            copyMode: settings.copyMode,
          }),
          displayTitle: displayTitle({
            title: String(r.title),
            seriesTitle: (r.seriesTitle as string | null) ?? null,
            seasonNumber: (r.seasonNumber as number | null) ?? null,
            episodeNumber: (r.episodeNumber as number | null) ?? null,
          }),
        };
      });
  }

  createReview(row: {
    itemId: number;
    jobId: number;
    sourcePath: string;
    sidecarPath: string;
    compare: unknown;
    flagged?: boolean;
  }): number {
    this.db
      .prepare(
        `INSERT INTO reviews (item_id, job_id, source_path, sidecar_path, compare_json, flagged, status)
         VALUES (?, ?, ?, ?, ?, ?, 'pending')
         ON CONFLICT(item_id) DO UPDATE SET
           job_id = excluded.job_id,
           source_path = excluded.source_path,
           sidecar_path = excluded.sidecar_path,
           compare_json = excluded.compare_json,
           flagged = excluded.flagged,
           status = 'pending'`,
      )
      .run(row.itemId, row.jobId, row.sourcePath, row.sidecarPath, JSON.stringify(row.compare), row.flagged ? 1 : 0);
    return (this.db.prepare("SELECT id FROM reviews WHERE item_id = ?").get(row.itemId) as { id: number }).id;
  }

  getReview(id: number): {
    id: number;
    itemId: number;
    jobId: number;
    sourcePath: string;
    sidecarPath: string;
    compare: unknown;
    flagged: boolean;
    status: string;
  } | undefined {
    const row = this.db
      .prepare(
        `SELECT id, item_id AS itemId, job_id AS jobId, source_path AS sourcePath, sidecar_path AS sidecarPath,
                compare_json AS compareJson, flagged, status FROM reviews WHERE id = ?`,
      )
      .get(id) as
      | {
          id: number;
          itemId: number;
          jobId: number;
          sourcePath: string;
          sidecarPath: string;
          compareJson: string;
          flagged: number;
          status: string;
        }
      | undefined;
    if (!row) return undefined;
    return { ...row, compare: JSON.parse(row.compareJson ?? "{}"), flagged: Boolean(row.flagged) };
  }

  listReviews(status = "pending"): Array<Record<string, unknown>> {
    return this.db
      .prepare(
        `SELECT r.id, r.item_id AS itemId, r.source_path AS sourcePath, r.sidecar_path AS sidecarPath,
                r.compare_json AS compareJson, r.flagged, r.status, i.title, i.instance_id AS instanceId,
                i.series_title AS seriesTitle, i.season_number AS seasonNumber, i.episode_number AS episodeNumber
         FROM reviews r JOIN library_items i ON i.id = r.item_id WHERE r.status = ? ORDER BY r.id DESC`,
      )
      .all(status)
      .map((r) => {
        const row = r as Record<string, unknown> & { compareJson: string; flagged: number };
        return {
          ...row,
          compare: JSON.parse(row.compareJson ?? "{}"),
          flagged: Boolean(row.flagged),
          displayTitle: displayTitle({
            title: String(row.title),
            seriesTitle: (row.seriesTitle as string | null) ?? null,
            seasonNumber: (row.seasonNumber as number | null) ?? null,
            episodeNumber: (row.episodeNumber as number | null) ?? null,
          }),
        };
      });
  }

  setReviewStatus(id: number, status: string): void {
    this.db.prepare("UPDATE reviews SET status = ? WHERE id = ?").run(status, id);
  }

  listPlayers(): PlayerInstance[] {
    return (
      this.db
        .prepare("SELECT id, kind, name, url, token, enabled FROM player_instances ORDER BY id")
        .all() as Array<PlayerInstance & { enabled: number }>
    ).map((p) => this.revealPlayer(p));
  }

  addHistory(itemId: number | null, title: string, action: string, detail?: string): void {
    this.db
      .prepare("INSERT INTO history (item_id, title, action, detail, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(itemId, title, action, detail ?? null, new Date().toISOString());
  }

  listHistory(): Array<Record<string, unknown>> {
    return this.db
      .prepare("SELECT id, item_id AS itemId, title, action, detail, created_at AS createdAt FROM history ORDER BY id DESC")
      .all() as Array<Record<string, unknown>>;
  }

  addExclusion(kind: string, value: string): void {
    this.db.prepare("INSERT INTO exclusions (kind, value) VALUES (?, ?)").run(kind, value);
  }

  listExclusions(): Array<{ id: number; kind: string; value: string }> {
    return this.db.prepare("SELECT id, kind, value FROM exclusions").all() as Array<{
      id: number;
      kind: string;
      value: string;
    }>;
  }

  isExcluded(item: { title: string; path: string; quality: string | null }): boolean {
    for (const ex of this.listExclusions()) {
      const v = ex.value.toLowerCase();
      if (ex.kind === "title" && item.title.toLowerCase().includes(v)) return true;
      if (ex.kind === "path" && item.path.toLowerCase().includes(v)) return true;
      if (ex.kind === "profile" && (item.quality ?? "").toLowerCase().includes(v)) return true;
      if (ex.kind === "tag" && item.title.toLowerCase().includes(v)) return true;
    }
    return false;
  }

  createPlayer(input: { kind: PlayerKind; name: string; url: string; token: string; enabled?: boolean }): PlayerInstance {
    const inserted = this.db
      .prepare("INSERT INTO player_instances (kind, name, url, token, enabled) VALUES (?, ?, ?, ?, ?)")
      .run(
        input.kind,
        input.name,
        input.url.replace(/\/+$/, ""),
        encryptSecret(input.token, this.secretKey),
        input.enabled === false ? 0 : 1,
      );
    const id = Number(inserted.lastInsertRowid);
    const created = this.listPlayers().find((p) => p.id === id);
    if (!created) throw new Error("failed to create player");
    return created;
  }

  updatePlayer(id: number, patch: Partial<Pick<PlayerInstance, "name" | "url" | "token" | "enabled" | "kind">>): PlayerInstance | undefined {
    const current = this.listPlayers().find((p) => p.id === id);
    if (!current) return undefined;
    const next = {
      ...current,
      ...patch,
      url: patch.url ? patch.url.replace(/\/+$/, "") : current.url,
      token: patch.token && patch.token.length > 0 ? patch.token : current.token,
    };
    this.db
      .prepare("UPDATE player_instances SET kind = ?, name = ?, url = ?, token = ?, enabled = ? WHERE id = ?")
      .run(next.kind, next.name, next.url, encryptSecret(next.token, this.secretKey), next.enabled ? 1 : 0, id);
    return this.listPlayers().find((p) => p.id === id);
  }

  deletePlayer(id: number): void {
    this.db.prepare("DELETE FROM player_instances WHERE id = ?").run(id);
  }

  countLibraryItems(instanceId: number, type: ItemType): number {
    const row = this.db
      .prepare("SELECT COUNT(*) AS n FROM library_items WHERE instance_id = ? AND type = ?")
      .get(instanceId, type) as { n: number };
    return row.n;
  }

  private revealInstance(row: ArrInstance & { enabled: number | boolean }): ArrInstance {
    return {
      ...row,
      enabled: Boolean(row.enabled),
      apiKey: decryptSecret(row.apiKey, this.secretKey),
    };
  }

  private revealPlayer(row: PlayerInstance & { enabled: number | boolean }): PlayerInstance {
    return {
      ...row,
      id: Number(row.id),
      enabled: Boolean(row.enabled),
      token: decryptSecret(row.token, this.secretKey),
    };
  }

  removeMissingLibraryItems(instanceId: number, type: ItemType, keepExternalIds: number[]): void {
    if (keepExternalIds.length === 0) {
      this.db.prepare("DELETE FROM library_items WHERE instance_id = ? AND type = ?").run(instanceId, type);
      return;
    }
    const placeholders = keepExternalIds.map(() => "?").join(",");
    this.db
      .prepare(
        `DELETE FROM library_items WHERE instance_id = ? AND type = ? AND external_id NOT IN (${placeholders})`,
      )
      .run(instanceId, type, ...keepExternalIds);
  }
}

const LIBRARY_ITEM_SQL = `
          i.id, i.instance_id AS instanceId, a.name AS instanceName, a.kind AS instanceKind,
          i.external_id AS externalId, i.series_id AS seriesId, i.type, i.title, i.series_title AS seriesTitle,
          i.season_number AS seasonNumber, i.episode_number AS episodeNumber,
          i.path, i.folder_path AS folderPath, i.quality, i.video_codec AS videoCodec,
          i.resolution, i.hdr, i.size, i.readable, i.path_error AS pathError, i.updated_at AS updatedAt,
          i.poster_remote_url AS posterRemoteUrl`;

function asLibraryItem(row: LibraryItem & { readable: number | boolean }): LibraryItem {
  return {
    ...row,
    readable: Boolean(row.readable),
    posterRemoteUrl: row.posterRemoteUrl ?? null,
  };
}

function phaseFromStatus(status: string): JobPhase {
  if (status === "held") return "held";
  return "queued";
}

function publicJobPhase(status: unknown, phase: unknown): JobPhase {
  if (status === "queued" || status === "held") return status;
  if (isJobPhase(phase)) return phase;
  if (status === "running") return "finishing";
  return "queued";
}

function normalizeUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

export function publicSettings(settings: Settings): Settings {
  return { ...settings, sizeCapsGbPerHour: { ...settings.sizeCapsGbPerHour } };
}

export function dataDirFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  return env.CONFIG_DIR || env.DATA_DIR || join(process.cwd(), "config");
}
