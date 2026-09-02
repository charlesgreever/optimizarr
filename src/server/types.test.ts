import { describe, expect, it } from "vitest";
import { effectiveWriteMode, planHasVideoTranscode, profileAssignmentEligible } from "./types.ts";
import type { ExecutablePlan } from "./types.ts";

function plan(over: Partial<ExecutablePlan> = {}): ExecutablePlan {
  return {
    origin: "bulk",
    video: { kind: "copy" },
    audio: [{ op: "keep", index: 1 }],
    subtitles: [{ op: "keep", index: 2 }],
    container: "mkv",
    writeMode: "sidecar",
    warning: null,
    reasons: ["Keep the current video."],
    estimatedOutputBytes: null,
    category: "movie1080p",
    ...over,
  };
}

describe("executable plans", () => {
  it("treats copy as not a video transcode", () => {
    expect(planHasVideoTranscode(plan())).toBe(false);
  });

  it("treats size mode and quality mode as video transcodes and not both at once", () => {
    const size = plan({
      video: { kind: "size", codec: "hevc", targetBytes: 4_000_000_000, downscale1080p: false, bitDepth: 10 },
    });
    const quality = plan({
      video: { kind: "quality", codec: "av1", quality: 20, downscale1080p: true, bitDepth: 10 },
    });
    expect(planHasVideoTranscode(size)).toBe(true);
    expect(planHasVideoTranscode(quality)).toBe(true);
    expect(size.video.kind === "size" && quality.video.kind === "quality").toBe(true);
    expect("targetBytes" in size.video && !("quality" in size.video)).toBe(true);
    expect("quality" in quality.video && !("targetBytes" in quality.video)).toBe(true);
  });

  it("keeps bulk suggestion fields compileable beside a custom origin", () => {
    const custom = plan({ origin: "custom", writeMode: "direct" });
    expect(custom.origin).toBe("custom");
    expect(custom.writeMode).toBe("direct");
  });

  it("follows house write mode unless the plan locked sidecar or direct write", () => {
    expect(effectiveWriteMode(plan(), "direct")).toBe("direct");
    expect(effectiveWriteMode(plan({ origin: "custom", writeMode: "direct" }), "sidecar")).toBe("direct");
    expect(effectiveWriteMode(plan({ writeMode: "sidecar", writeModeLocked: false }), "direct")).toBe("direct");
    expect(effectiveWriteMode(plan({ writeMode: "sidecar", writeModeLocked: true }), "direct")).toBe("sidecar");
    expect(effectiveWriteMode(plan({ writeMode: "direct", writeModeLocked: true }), "sidecar")).toBe("direct");
  });

  it("assigns profiles only for enabled, non-exempt video transcodes", () => {
    const transcode = plan({
      video: { kind: "size", codec: "hevc", targetBytes: 4_000_000_000, downscale1080p: false, bitDepth: 10 },
    });
    expect(profileAssignmentEligible({ autoAssign: true, sizeExempt: false, plan: transcode })).toBe(true);
    expect(profileAssignmentEligible({ autoAssign: false, sizeExempt: false, plan: transcode })).toBe(false);
    expect(profileAssignmentEligible({ autoAssign: true, sizeExempt: true, plan: transcode })).toBe(false);
    expect(profileAssignmentEligible({ autoAssign: true, sizeExempt: false, plan: plan() })).toBe(false);
  });
});
