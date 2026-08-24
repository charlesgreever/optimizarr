import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadEnv } from "./env.ts";

describe("env", () => {
  it("renames an existing Optimizarr database to polisharr.db", () => {
    const dir = mkdtempSync(join(tmpdir(), "opt-env-"));
    writeFileSync(join(dir, "optimizarr.db"), "ok");
    const env = loadEnv({ CONFIG_DIR: dir });
    expect(env.dbPath).toBe(join(dir, "polisharr.db"));
  });

  it("accepts the previous widget key and trust-proxy names", () => {
    const dir = mkdtempSync(join(tmpdir(), "opt-env-"));
    const env = loadEnv({ CONFIG_DIR: dir, OPTIMIZARR_WIDGET_KEY: "k", OPTIMIZARR_TRUST_PROXY: "1" });
    expect(env.widgetKeyEnv).toBe("k");
    expect(env.trustProxy).toBe(true);
  });

  it("reads an optional language-identification command", () => {
    const dir = mkdtempSync(join(tmpdir(), "opt-env-"));
    expect(loadEnv({ CONFIG_DIR: dir }).whisperLid).toBeNull();
    expect(loadEnv({ CONFIG_DIR: dir, WHISPER_LID: "/usr/local/bin/whisper-lid" }).whisperLid).toBe("/usr/local/bin/whisper-lid");
  });
});
