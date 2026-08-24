import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

export function loadOrCreateSecret(path: string): Buffer {
  if (existsSync(path)) {
    const raw = readFileSync(path, "utf8").trim();
    return Buffer.from(raw, "hex");
  }
  const key = randomBytes(32);
  writeFileSync(path, key.toString("hex"), { mode: 0o600 });
  return key;
}

export function encryptSecret(key: Buffer, plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}.${tag.toString("hex")}.${enc.toString("hex")}`;
}

export function decryptSecret(key: Buffer, packed: string): string {
  const [ivHex, tagHex, dataHex] = packed.split(".");
  if (!ivHex || !tagHex || !dataHex) throw new Error("Stored secret is unreadable.");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return Buffer.concat([decipher.update(Buffer.from(dataHex, "hex")), decipher.final()]).toString("utf8");
}
