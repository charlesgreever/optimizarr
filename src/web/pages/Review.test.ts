import { describe, expect, it } from "vitest";
import { frameFacts, keepAllConfirmCopy, keepStartedCopy } from "./Review.tsx";

describe("Keep all copy", () => {
  it("names the file count and that library files will be replaced", () => {
    expect(keepAllConfirmCopy(3)).toBe("Keep all 3 files? This replaces each library file with its new copy.");
    expect(keepAllConfirmCopy(1)).toBe("Keep all 1 file? This replaces each library file with its new copy.");
  });

  it("names accepted and skipped Keep counts", () => {
    expect(keepStartedCopy(3, 0)).toBe("Keep started for 3.");
    expect(keepStartedCopy(2, 1)).toBe("Keep started for 2; skipped 1.");
  });

  it("joins Now and Sidecar facts for the contact sheet", () => {
    expect(frameFacts({
      codec: "h264",
      sizeBytes: 1_000_000_000,
      sizePerHourGb: 2.5,
      durationSec: 3600,
      tracks: "1 audio / 0 subtitles",
    })).toContain("h264");
  });
});
