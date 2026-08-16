import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { defaultSettings, type Settings, type User } from "./types.ts";
import { hashPassword, verifyPassword } from "./passwords.ts";

export class Store {
  readonly db: DatabaseSync;
  readonly dataDir: string;

  constructor(dataDir: string) {
    this.dataDir = dataDir;
    mkdirSync(dataDir, { recursive: true });
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
    `);
    const row = this.db.prepare("SELECT value FROM settings WHERE key = 'app'").get() as
      | { value: string }
      | undefined;
    if (!row) {
      this.db
        .prepare("INSERT INTO settings (key, value) VALUES ('app', ?)")
        .run(JSON.stringify(defaultSettings()));
    }
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
}

export function publicSettings(settings: Settings): Settings {
  return { ...settings, sizeCapsGbPerHour: { ...settings.sizeCapsGbPerHour } };
}

export function dataDirFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  return env.CONFIG_DIR || env.DATA_DIR || join(process.cwd(), "config");
}
