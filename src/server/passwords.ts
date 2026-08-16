import { argon2id } from "@noble/hashes/argon2.js";
import { bytesToHex, hexToBytes, randomBytes } from "@noble/hashes/utils.js";

const OPSLIMIT = 3;
const MEM_KIB = 64 * 1024;
const DK_LEN = 32;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = argon2id(password, salt, {
    t: OPSLIMIT,
    m: MEM_KIB,
    p: 1,
    dkLen: DK_LEN,
  });
  return `argon2id$${bytesToHex(salt)}$${bytesToHex(hash)}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  try {
    const parts = stored.split("$");
    if (parts.length !== 3 || parts[0] !== "argon2id") return false;
    const salt = hexToBytes(parts[1]);
    const expected = hexToBytes(parts[2]);
    if (salt.length < 8 || expected.length < 16) return false;
    const actual = argon2id(password, salt, {
      t: OPSLIMIT,
      m: MEM_KIB,
      p: 1,
      dkLen: expected.length,
    });
    if (actual.length !== expected.length) return false;
    let diff = 0;
    for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i];
    return diff === 0;
  } catch {
    return false;
  }
}
