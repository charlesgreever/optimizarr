import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const PREFIX = "enc:v1:";
const SALT = "optimizarr-secrets-v1";

export function loadSecretKey(dataDir: string, env: NodeJS.ProcessEnv = process.env): Buffer {
  const fromEnv = env.OPTIMIZARR_SECRET?.trim();
  if (fromEnv) return scryptSync(fromEnv, SALT, 32);
  const file = join(dataDir, ".secret");
  if (existsSync(file)) {
    return scryptSync(readFileSync(file, "utf8").trim(), SALT, 32);
  }
  const generated = randomBytes(32).toString("hex");
  writeFileSync(file, generated, { mode: 0o600 });
  return scryptSync(generated, SALT, 32);
}

export function encryptSecret(plain: string, key: Buffer): string {
  if (!plain || plain.startsWith(PREFIX)) return plain;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `${PREFIX}${iv.toString("hex")}:${encrypted.toString("hex")}:${cipher.getAuthTag().toString("hex")}`;
}

export function decryptSecret(stored: string, key: Buffer): string {
  if (!stored.startsWith(PREFIX)) return stored;
  const parts = stored.slice(PREFIX.length).split(":");
  if (parts.length !== 3) return stored;
  const [ivHex, dataHex, tagHex] = parts;
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return Buffer.concat([decipher.update(Buffer.from(dataHex, "hex")), decipher.final()]).toString("utf8");
}
