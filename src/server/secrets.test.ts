import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, loadSecretKey } from "./secrets.ts";

describe("secret box", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it("round-trips a value and leaves plaintext readable until sealed", () => {
    const dir = mkdtempSync(join(tmpdir(), "sec-"));
    dirs.push(dir);
    const key = loadSecretKey(dir);
    expect(decryptSecret("plain-key", key)).toBe("plain-key");
    const sealed = encryptSecret("plain-key", key);
    expect(sealed.startsWith("enc:v1:")).toBe(true);
    expect(decryptSecret(sealed, key)).toBe("plain-key");
    expect(encryptSecret(sealed, key)).toBe(sealed);
  });
});
