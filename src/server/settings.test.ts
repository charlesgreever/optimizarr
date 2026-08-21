import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "./types.ts";
import { parseStoredSettings, updateSettings } from "./settings.ts";

describe("settings boundary", () => {
  it("rejects invalid HTTP fields instead of coercing them", () => {
    const result = updateSettings(DEFAULT_SETTINGS, {
      concurrency: "4",
      localAuthBypass: "yes",
      sizeCaps: { movie1080p: -1 },
    });

    expect(result).toEqual({ ok: false, error: expect.stringMatching(/invalid/i) });
  });

  it("normalizes persisted values into closed domain types", () => {
    expect(parseStoredSettings({ writeMode: "erase", videoTarget: "vp9", concurrency: 0 })).toMatchObject({
      writeMode: "sidecar",
      videoTarget: "hevc",
      concurrency: 1,
    });
  });
});
