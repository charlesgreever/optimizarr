import { describe, expect, it } from "vitest";
import { classifyInterruptedKeep } from "./review-recovery.ts";

describe("interrupted Keep classification", () => {
  it("treats a library file that already matches the sidecar size as a finished Keep", () => {
    expect(classifyInterruptedKeep({
      sidecarExists: false,
      libraryBytes: 507_045_036,
      sourceBytes: 759_120_269,
      sidecarBytes: 507_045_036,
    })).toBe("complete");
  });

  it("treats a remaining sidecar next to the original as interrupted", () => {
    expect(classifyInterruptedKeep({
      sidecarExists: true,
      libraryBytes: 22_754_768_554,
      sourceBytes: 22_754_768_554,
      sidecarBytes: 8_807_576_072,
    })).toBe("interrupted");
  });

  it("treats a missing sidecar with the original still in place as gone", () => {
    expect(classifyInterruptedKeep({
      sidecarExists: false,
      libraryBytes: 4_242_307_039,
      sourceBytes: 4_242_307_039,
      sidecarBytes: 3_205_566_748,
    })).toBe("sidecar_gone");
  });
});
